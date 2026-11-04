"""Zero-network checks of the verification hard stop, including concurrent hints."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from run_bounded_verification_backend import CallBudget, bounded, required_cap


def test_concurrent_attempts_cannot_exceed_caps(tmp_path: Path) -> None:
    path = tmp_path / "budget.jsonl"
    budget = CallBudget({"coach": 7, "persona": 2}, path)
    original = Mock(return_value="reply")
    limited = bounded(original, budget, "coach", RuntimeError)

    def attempt(_: int) -> bool:
        try:
            return limited() == "reply"
        except RuntimeError:
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        assert sum(pool.map(attempt, range(50))) == 7
    assert original.call_count == 7
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(rows) == 51
    assert rows[-1]["attempts_admitted"] == {"coach": 7, "persona": 0}
    assert rows[-1]["attempts_blocked"]["coach"] == 43


def test_zero_budget_blocks_before_provider_and_failures_count(tmp_path: Path) -> None:
    budget = CallBudget({"coach": 0, "persona": 1}, tmp_path / "budget.jsonl")
    original = Mock(side_effect=ValueError("provider failure"))
    coach = bounded(original, budget, "coach", RuntimeError)
    persona = bounded(original, budget, "persona", RuntimeError)
    with pytest.raises(RuntimeError, match="attempt cap reached"):
        coach()
    original.assert_not_called()
    with pytest.raises(ValueError, match="provider failure"):
        persona()
    with pytest.raises(RuntimeError, match="attempt cap reached"):
        persona()
    assert original.call_count == 1


def test_budget_requires_new_evidence_file(tmp_path: Path) -> None:
    path = tmp_path / "budget.jsonl"
    CallBudget({"coach": 1}, path)
    with pytest.raises(FileExistsError):
        CallBudget({"coach": 1}, path)


def test_feedback_and_coach_have_independent_pre_sdk_caps(tmp_path: Path) -> None:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from coach import CoachUnavailableError
    from run_bounded_verification_backend import bounded_feedback_client
    from semantic_feedback import SYSTEM_PROMPT

    budget = CallBudget({"coach": 1, "feedback": 0}, tmp_path / "separate.jsonl")
    sdk = Mock(return_value="coach-result")
    call = bounded_feedback_client(sdk, budget)
    with pytest.raises(CoachUnavailableError):
        call(system_prompt=SYSTEM_PROMPT)
    assert call(system_prompt="coach instructions") == "coach-result"
    with pytest.raises(CoachUnavailableError):
        call(system_prompt="coach instructions")
    assert sdk.call_count == 1
    assert budget.counts == {"coach": 1, "feedback": 0}
    assert budget.blocked == {"coach": 1, "feedback": 1}


def test_zero_caps_reach_real_api_boundaries_without_sdk_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The runner hooks both real provider paths, not just a stand-in counter."""
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "backend"))
    import coach
    import persona
    import run_backend
    import run_bounded_verification_backend as runner
    from database import create_sqlite_engine
    from fastapi.testclient import TestClient
    from main import create_app

    path = tmp_path / "budget.jsonl"
    for name, value in {
        "VERIFY_MAX_COACH_CALLS": "0",
        "VERIFY_MAX_PERSONA_CALLS": "0",
        "VERIFY_BUDGET_LOG": str(path),
        "BASETEN_API_KEY": "test-only",
        "FIREWORKS_API_KEY": "test-only",
        "COACH_PROVIDER": "fireworks",
    }.items():
        monkeypatch.setenv(name, value)
    sdk = Mock(side_effect=AssertionError("SDK must not be constructed at zero cap"))
    monkeypatch.setattr(coach, "OpenAI", sdk)
    monkeypatch.setattr(persona, "OpenAI", sdk)
    monkeypatch.setattr(coach.MetaCoachClient, "respond", coach.MetaCoachClient.respond)
    monkeypatch.setattr(
        persona.BasetenPersonaClient, "respond", persona.BasetenPersonaClient.respond
    )
    monkeypatch.setattr(run_backend, "main", lambda: None)
    runner.main()
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'guard.db'}")
    with TestClient(create_app(engine)) as client:
        bob = next(
            s
            for s in client.get("/api/scenarios").json()
            if s["persona"]["name"] == "Bob"
        )
        created = client.post(
            "/api/sessions",
            json={"scenario_id": bob["id"], "behavior_revision": "s4-bob-r1"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert created.status_code == 201
        session = created.json()
        turn = client.post(
            "/api/chat/turn",
            json={
                "session_id": session["id"],
                "branch_id": session["active_branch_id"],
                "parent_node_id": session["active_head_node_id"],
                "expected_revision": session["revision"],
                "user_message": "Can we talk?",
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert turn.status_code == 503
        assert turn.json()["detail"]["code"] == "persona_unavailable"
        hint = client.post(
            f"/api/sessions/{session['id']}/coach-hints",
            json={
                "branch_id": session["active_branch_id"],
                "head_node_id": session["active_head_node_id"],
                "expected_revision": session["revision"],
                "trigger": "requested",
                "attempt": 1,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert hint.status_code == 200
        assert hint.json()["hint"]["source"] == "deterministic"
    engine.dispose()
    sdk.assert_not_called()
    last = json.loads(path.read_text().splitlines()[-1])
    assert last["attempts_admitted"] == {"coach": 0, "persona": 0}
    assert last["attempts_blocked"] == {"coach": 1, "persona": 1}


@pytest.mark.parametrize("value", [None, "", "-1", "1.5", "unbounded"])
def test_invalid_or_missing_cap_is_rejected(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    if value is None:
        monkeypatch.delenv("VERIFY_MAX_COACH_CALLS", raising=False)
    else:
        monkeypatch.setenv("VERIFY_MAX_COACH_CALLS", value)
    with pytest.raises(ValueError, match="VERIFY_MAX_COACH_CALLS"):
        required_cap("VERIFY_MAX_COACH_CALLS")
