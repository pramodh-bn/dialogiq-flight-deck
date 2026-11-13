"""CS-82 mocked consistency/safety checks; no model calls or learner acceptance."""

import copy
import threading
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import semantic_feedback as feedback
import stance
from coach import CoachUnavailableError
from database import create_sqlite_engine
from main import create_app
from schemas import State

LEARNER = "Let's share the release work and assign an owner for the review."
PERSONA = "The release review has no owner. I need help with that part."
NEEDS = [{"id": "n1", "title": "Ownership", "description": "Clear review ownership"}]


def decision(**changes: object) -> feedback.Decision:
    """An explicit mocked judgment, not a semantic oracle."""
    return feedback.Decision.model_validate(
        {
            "question_type": "statement",
            "question_quote": "",
            "acknowledgment": False,
            "acknowledgment_quote": "",
            "pressure": False,
            "pressure_quote": "",
            "stance_signal": "support",
            "stance_change": 1,
            "stance_quote": "Let's share the release work",
            "reaction_quote": "I need help with that part.",
            "revealed_need": {
                "need_id": "n1",
                "persona_quote": "The release review has no owner.",
            },
            **changes,
        }
    )


def initial_state() -> dict:
    return {
        **State().model_dump(),
        **stance.initial_state_fields(),
        "feedback": feedback.initial(),
    }


def test_post_reply_feedback_does_not_deadlock_persona_disclosure() -> None:
    from persona import PersonaBrief, build_persona_system_prompt

    brief = PersonaBrief(
        character_name="Bob", role="Engineer", hidden_need="Private roleplay fixture"
    )
    legacy = build_persona_system_prompt(brief, behavior_revision="s4-bob-r1")
    assert "Nothing new is permitted this reply." in legacy
    assert (
        build_persona_system_prompt(
            brief, behavior_revision="s4-bob-r1", feedback_revision="unknown"
        )
        == legacy
    )
    semantic = build_persona_system_prompt(
        brief, behavior_revision="s4-bob-r1", feedback_revision="semantic-r1"
    )
    assert "Nothing new is permitted this reply." not in semantic
    assert "There is no pre-authorized topic list" in semantic
    assert "Never list the hidden brief" in semantic
    assert "do not require a question form" in semantic


def context() -> dict:
    return {
        "learner": LEARNER,
        "persona": PERSONA,
        "rubric": NEEDS,
        "revealed_ids": [],
        "history": [],
    }


def test_statement_support_and_persona_evidence_can_progress() -> None:
    original = initial_state()
    state, coaching = feedback.evaluate(
        original, LEARNER, PERSONA, [], NEEDS, lambda _: decision()
    )
    assert original == initial_state()
    assert state["score"] == 1
    assert state["metrics"]["open_questions"] == 0
    assert state["resistance"] == "warming"
    assert coaching["question_type"] == "statement"
    assert coaching["outcome"] == "breakthrough"
    assert state["feedback"]["evaluated_turns"] == 1
    assert state["feedback"]["evidence"][-1]["role"] == "assistant"


@pytest.mark.parametrize(
    "changes",
    [
        {"stance_quote": "A quote that was never said"},
        {"stance_change": True},
        {"stance_change": 2},
        {"acknowledgment": True, "acknowledgment_quote": ""},
        {"pressure": True},
        {"reaction_quote": ""},
        {"stance_signal": "none", "stance_quote": "", "stance_change": 1},
        {"question_type": "open", "question_quote": PERSONA},
        {"revealed_need": {"need_id": "invented", "persona_quote": PERSONA}},
        {"revealed_need": {"need_id": "n1", "persona_quote": LEARNER}},
        {"hidden_rubric": "must not become a public field"},
    ],
)
def test_untrusted_output_rejected(changes: dict) -> None:
    with pytest.raises((ValueError, ValidationError)):
        feedback.checked(decision(**changes), context())


def test_baseten_evaluator_never_uses_fireworks_or_meta_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_PROVIDER", "baseten")
    monkeypatch.delenv("BASETEN_API_KEY", raising=False)
    monkeypatch.delenv("FEEDBACK_MODEL", raising=False)
    monkeypatch.delenv("BASETEN_API_BASE", raising=False)
    monkeypatch.setenv("FIREWORKS_API_KEY", "other-provider-test-key")
    monkeypatch.setenv("META_MODEL_API_KEY", "other-provider-test-key")
    client = feedback.selected_client()
    assert client.provider == "baseten"
    assert client.model == feedback.BASETEN_MODEL
    assert not client.configured
    from coach import CoachNotConfiguredError

    with pytest.raises(CoachNotConfiguredError):
        client.respond(system_prompt="classification", context_json="{}")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-key")
    configured = feedback.selected_client()
    assert configured.configured and configured.api_key == "baseten-test-key"
    assert configured.base_url == feedback.BASETEN_BASE


def test_baseten_feedback_uses_separate_bounded_json_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace
    from unittest.mock import Mock

    import coach

    monkeypatch.setenv("FEEDBACK_PROVIDER", "baseten")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-only")
    monkeypatch.delenv("BASETEN_API_BASE", raising=False)
    monkeypatch.delenv("FEEDBACK_MODEL", raising=False)
    sdk = Mock()
    sdk.chat.completions.create.return_value = SimpleNamespace(
        choices=[
            SimpleNamespace(message=SimpleNamespace(content="{}"), finish_reason="stop")
        ],
        usage=SimpleNamespace(completion_tokens=10, completion_tokens_details=None),
    )
    constructor = Mock(return_value=sdk)
    monkeypatch.setattr(coach, "OpenAI", constructor)
    result = feedback.selected_client().respond(
        system_prompt="classify public exchange",
        context_json="{}",
        temperature=0,
        max_tokens=4096,
        timeout=12,
        reasoning_effort="low",
        response_format={"type": "json_object"},
    )
    assert result.content == "{}"
    constructor.assert_called_once_with(
        base_url=feedback.BASETEN_BASE, api_key="baseten-test-only", max_retries=0
    )
    request = sdk.chat.completions.create.call_args.kwargs
    assert request["model"] == feedback.BASETEN_MODEL
    assert request["response_format"] == {"type": "json_object"}
    assert request["timeout"] == 12
    assert request["messages"][0]["content"] == "classify public exchange"


def test_unknown_evaluator_provider_is_inert(monkeypatch: pytest.MonkeyPatch) -> None:
    from coach import CoachNotConfiguredError

    monkeypatch.setenv("FEEDBACK_PROVIDER", "unknown")
    with pytest.raises(CoachNotConfiguredError):
        feedback.selected_client()


def test_already_revealed_need_is_not_new_discovery() -> None:
    prior = context()
    prior["revealed_ids"] = ["n1"]
    with pytest.raises(ValueError):
        feedback.checked(decision(), prior)


def test_validation_telemetry_does_not_echo_private_error_inputs() -> None:
    assert (
        feedback.validation_failure_code(ValueError("PRIVATE-RUBRIC-TEXT"))
        == "invalid_structure"
    )
    assert (
        feedback.validation_failure_code(
            ValueError("Stance movement requires a current persona reaction.")
        )
        == "reaction_missing"
    )


@pytest.mark.parametrize("identifier", ["L1", "P99", "the hidden rubric"])
def test_model_cannot_forge_persona_source_ids(identifier: str) -> None:
    model = feedback.ModelDecision(
        question_type="statement",
        question_evidence="",
        acknowledgment=False,
        acknowledgment_evidence="",
        pressure=False,
        pressure_evidence="",
        stance_signal="none",
        stance_change=0,
        stance_evidence="",
        revealed_need=feedback.ModelNeed(need_id="n1", persona_evidence=identifier),
    )
    with pytest.raises(ValueError):
        feedback.resolve_evidence(model, context())


def test_unavailable_does_not_count_as_zero_observation() -> None:
    prior, _ = feedback.evaluate(
        initial_state(), LEARNER, PERSONA, [], NEEDS, lambda _: decision()
    )

    def failing(_: dict) -> feedback.Decision:
        raise CoachUnavailableError("Provider unavailable")

    state, coaching = feedback.evaluate(prior, LEARNER, PERSONA, [], NEEDS, failing)
    assert state["score"] == prior["score"]
    assert state["resistance"] == prior["resistance"]
    assert state["metrics"]["turns"] == 2
    assert state["metrics"]["empathy_turns"] == prior["metrics"]["empathy_turns"]
    assert state["feedback"]["evaluated_turns"] == 1
    assert state["feedback"]["skipped_turns"] == 1
    assert state["feedback"]["status"] == "unavailable"
    assert state["feedback"]["evidence"] == []
    assert coaching["empathy"] is None
    assert coaching["question_type"] == "unavailable"


def test_timeout_late_result_cannot_modify_snapshot() -> None:
    release = threading.Event()
    finished = threading.Event()

    def slow(_: dict) -> feedback.Decision:
        assert release.wait(2)
        finished.set()
        return decision()

    try:
        state, _ = feedback.evaluate(
            initial_state(), LEARNER, PERSONA, [], NEEDS, slow, timeout=0.01
        )
        snapshot = copy.deepcopy(state)
        assert state["feedback"]["failure_reason"] == "timeout"
    finally:
        release.set()
    assert finished.wait(2)
    assert state == snapshot


def test_saturation_is_bounded_and_makes_no_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slots = threading.BoundedSemaphore(1)
    slots.acquire()
    monkeypatch.setattr(feedback, "SLOTS", slots)

    def must_not_run(_: dict) -> feedback.Decision:
        pytest.fail("Saturated evaluator must not make a paid call")

    state, _ = feedback.evaluate(
        initial_state(), LEARNER, PERSONA, [], NEEDS, must_not_run
    )
    assert state["feedback"]["failure_reason"] == "saturated"
    slots.release()


def test_one_attempt_strict_provider_request(monkeypatch: pytest.MonkeyPatch) -> None:
    from coach import CoachCompletion

    monkeypatch.setenv("FEEDBACK_PROVIDER", "fireworks")

    calls = []

    class Client:
        provider = "fireworks"
        model = "test-model"

        def __init__(self, *, provider: str, model: str) -> None:
            assert provider == "fireworks"
            assert model == feedback.DEFAULT_MODEL

        def respond(self, **kwargs: object) -> CoachCompletion:
            calls.append(kwargs)
            model = feedback.ModelDecision(
                question_type="statement",
                question_evidence="",
                acknowledgment=False,
                acknowledgment_evidence="",
                pressure=False,
                pressure_evidence="",
                stance_signal="support",
                stance_change=1,
                stance_evidence="L1",
                reaction_evidence="P2",
                revealed_need=feedback.ModelNeed(need_id="n1", persona_evidence="P1"),
            )
            return CoachCompletion(model.model_dump_json(), "stop", 100, 20)

    monkeypatch.setattr(feedback, "MetaCoachClient", Client)
    assert feedback.real_provider(context()) == decision(stance_quote=LEARNER)
    assert len(calls) == 1
    assert calls[0]["timeout"] == feedback.TIMEOUT_SECONDS
    assert calls[0]["reasoning_effort"] == "low"
    assert calls[0]["max_tokens"] == 4096
    assert "coach" not in context()


def test_real_routes_replay_fork_reload_and_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_ENABLED", "1")
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'feedback.db'}")
    calls = {"persona": 0, "feedback": 0}
    fail = False

    def persona(**kwargs: object) -> str:
        calls["persona"] += 1
        assert kwargs["newly_revealed_titles"] == []
        assert kwargs["stance_signal"] == "none"
        assert kwargs["feedback_revision"] == "semantic-r1"
        return PERSONA

    def evaluator(data: dict) -> feedback.Decision:
        calls["feedback"] += 1
        assert "system_prompt" not in data and "coach_hints" not in data
        if fail:
            raise CoachUnavailableError("Unavailable")
        need_id = data["rubric"][0]["id"]
        repeated = need_id in data["revealed_ids"]
        return decision(
            stance_change=0 if repeated else 1,
            revealed_need=None
            if repeated
            else {
                "need_id": need_id,
                "persona_quote": "The release review has no owner.",
            },
        )

    coach_inputs = []

    def coach(system_prompt: str, context_json: str) -> object:
        import json

        from coach import CoachCompletion

        parsed = json.loads(context_json)
        assert "rubric" not in parsed and "needs" not in parsed
        coach_inputs.append(parsed)
        return CoachCompletion(
            json.dumps(
                {
                    "approach": "Offer a concrete next step.",
                    "example": LEARNER,
                    "reason": "Bob described work that needs an owner.",
                }
            ),
            "stop",
        )

    def headers() -> dict:
        return {"Idempotency-Key": str(uuid4())}

    try:
        with TestClient(
            create_app(
                engine, persona, coach_provider=coach, feedback_provider=evaluator
            )
        ) as client:
            scenario = client.get("/api/scenarios").json()[0]
            assert scenario["feedback_revisions"] == [feedback.REVISION]
            legacy = client.post(
                "/api/sessions", headers=headers(), json={"scenario_id": scenario["id"]}
            ).json()
            assert legacy["feedback"] is None
            session = client.post(
                "/api/sessions",
                headers=headers(),
                json={
                    "scenario_id": scenario["id"],
                    "behavior_revision": "s4-bob-r1",
                    "feedback_revision": feedback.REVISION,
                },
            ).json()
            assert session["feedback"]["status"] == "not_evaluated"

            def send(current: dict) -> tuple[dict, dict, dict]:
                body = {
                    "session_id": current["id"],
                    "branch_id": current["active_branch_id"],
                    "parent_node_id": current["active_head_node_id"],
                    "expected_revision": current["revision"],
                    "user_message": LEARNER,
                }
                key = headers()
                result = client.post("/api/chat/turn", headers=key, json=body)
                assert result.status_code == 200, result.text
                return result.json(), body, key

            first, body, key = send(session)
            assert first["session"]["score"] == 1
            assert first["session"]["resistance"] == "warming"
            replay = client.post("/api/chat/turn", headers=key, json=body)
            assert replay.json() == first
            assert calls == {"persona": 1, "feedback": 1}
            hint_body = {
                "branch_id": first["session"]["active_branch_id"],
                "head_node_id": first["node"]["id"],
                "expected_revision": first["session"]["revision"],
                "trigger": "requested",
                "attempt": 1,
            }
            for attempt in (1, 2):
                hint_body["attempt"] = attempt
                hint = client.post(
                    f"/api/sessions/{session['id']}/coach-hints",
                    headers=headers(),
                    json=hint_body,
                )
                assert hint.status_code == 200, hint.text
                assert hint.json()["hint"]["source"] == "meta"
            assert len(coach_inputs) == 2
            second, _, _ = send(first["session"])
            assert second["session"]["score"] == 1
            assert second["session"]["feedback"]["evaluated_turns"] == 2
            assert second["session"]["resistance"] == "warming"
            fork = client.post(
                f"/api/sessions/{session['id']}/branches",
                headers=headers(),
                json={
                    "source_branch_id": session["active_branch_id"],
                    "rewind_to_node_id": None,
                    "expected_revision": second["session"]["revision"],
                },
            )
            assert fork.status_code == 201
            assert fork.json()["session"]["feedback"]["evaluated_turns"] == 0
            fail = True
            failed, body, key = send(fork.json()["session"])
            assert failed["session"]["feedback"]["status"] == "unavailable"
            assert failed["node"]["coaching"]["question_type"] == "unavailable"
            assert (
                client.post("/api/chat/turn", headers=key, json=body).json() == failed
            )
            tree = client.get(f"/api/sessions/{session['id']}/tree").json()
            original = next(n for n in tree["nodes"] if n["id"] == first["node"]["id"])
            assert original == first["node"]
            client.get(f"/api/sessions/{session['id']}")
            assert calls == {"persona": 3, "feedback": 3}
    finally:
        engine.dispose()


def test_opt_in_requires_advertised_capability(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FEEDBACK_ENABLED", raising=False)
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'disabled.db'}")
    try:
        with TestClient(create_app(engine)) as client:
            scenario = client.get("/api/scenarios").json()[0]
            assert scenario["feedback_revisions"] == []
            result = client.post(
                "/api/sessions",
                headers={"Idempotency-Key": str(uuid4())},
                json={
                    "scenario_id": scenario["id"],
                    "behavior_revision": "s4-bob-r1",
                    "feedback_revision": feedback.REVISION,
                },
            )
            assert result.status_code == 422
    finally:
        engine.dispose()


def test_turn_notes_name_what_was_done_revealed_and_left() -> None:
    _, coaching = feedback.evaluate(
        initial_state(),
        LEARNER,
        PERSONA,
        [],
        NEEDS,
        lambda _: decision(
            question_type="open", question_quote="Let's share the release work"
        ),
    )
    texts = [note["text"] for note in coaching["whispers"]]
    assert any("invited Bob to explain" in text for text in texts)
    assert any("Ownership" in text and "no owner" in text for text in texts)
    assert any("every concern" in text for text in texts)


def test_pressure_is_a_dead_end_even_when_bob_discloses() -> None:
    _, coaching = feedback.evaluate(
        initial_state(),
        LEARNER,
        PERSONA,
        [],
        NEEDS,
        lambda _: decision(
            pressure=True,
            pressure_quote="Let's share the release work",
            stance_signal="pressure",
            stance_change=-1,
        ),
    )
    assert coaching["outcome"] == "deadend"
    assert any("still told you" in n["text"] for n in coaching["whispers"])
    assert any(n["kind"] == "warn" for n in coaching["whispers"])


def test_no_disclosure_note_does_not_name_hidden_needs() -> None:
    _, coaching = feedback.evaluate(
        initial_state(),
        LEARNER,
        PERSONA,
        [],
        [*NEEDS, {"id": "n2", "title": "SecretTopic", "description": "x"}],
        lambda _: decision(
            revealed_need=None,
            reaction_quote="",
            stance_signal="none",
            stance_change=0,
            stance_quote="",
        ),
    )
    joined = " ".join(n["text"] for n in coaching["whispers"])
    assert "SecretTopic" not in joined
    assert "nothing beyond what he had already shared" in joined
    assert "2 of 2 concerns" in joined
