"""Contract, persistence, isolation and concurrency proofs; provider is mocked."""

import copy
import json
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from database import create_sqlite_engine
from judge import evaluate
from main import create_app
from migrations import initialize_database
from models import ConversationNode, IdempotencyRecord, Scenario, Session, User
from persona import (
    PersonaInvalidResponseError,
    PersonaTimeoutError,
    PersonaUnavailableError,
)
from schemas import State


class Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.error: Exception | None = None
        self.entered = threading.Event()
        self.release: threading.Event | None = None

    def __call__(self, **kwargs: object) -> str:
        self.calls.append(copy.deepcopy(kwargs))
        self.entered.set()
        if self.release is not None:
            assert self.release.wait(10), "test provider was never released"
        if self.error:
            raise self.error
        return "A complete persona reply."


Harness = tuple[TestClient, Engine, Recorder]


@pytest.fixture
def harness(tmp_path: Path) -> Iterator[Harness]:
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'practice.db'}")
    recorder = Recorder()
    application = create_app(engine, recorder)
    with TestClient(application) as client:
        yield client, engine, recorder
    engine.dispose()


def headers(key: str | None = None) -> dict[str, str]:
    return {"Idempotency-Key": key or str(uuid4())}


def start(client: TestClient, key: str | None = None, title: str = "Bob:") -> dict:
    scenario = next(
        s for s in client.get("/api/scenarios").json() if s["title"].startswith(title)
    )
    response = client.post(
        "/api/sessions", json={"scenario_id": scenario["id"]}, headers=headers(key)
    )
    assert response.status_code == 201, response.text
    return response.json()


def turn_payload(
    session: dict, message: str = "What happened?", **overrides: object
) -> dict:
    result = {
        "session_id": session["id"],
        "branch_id": session["active_branch_id"],
        "parent_node_id": session["active_head_node_id"],
        "expected_revision": session["revision"],
        "user_message": message,
    }
    result.update(overrides)
    return result


def send(client: TestClient, session: dict, message: str = "What happened?") -> dict:
    response = client.post(
        "/api/chat/turn", json=turn_payload(session, message), headers=headers()
    )
    assert response.status_code == 200, response.text
    return response.json()


def fork(
    client: TestClient, session: dict, target: int | None, source: int | None = None
) -> dict:
    response = client.post(
        f"/api/sessions/{session['id']}/branches",
        headers=headers(),
        json={
            "source_branch_id": source or session["active_branch_id"],
            "rewind_to_node_id": target,
            "expected_revision": session["revision"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["session"]


def test_scenario_session_hub_cors_and_idempotent_seed(harness: Harness) -> None:
    client, engine, _ = harness
    assert client.get("/health").json()["status"] == "healthy"
    scenarios = client.get("/api/scenarios").json()
    assert len(scenarios) == 4
    assert len({s["persona"]["name"] for s in scenarios}) == 4
    for scenario in scenarios:
        assert set(scenario) == {"id", "title", "description", "persona"}
        assert client.get(f"/api/scenarios/{scenario['id']}").json() == scenario
    first = start(client)
    second = start(client)
    listed = client.get(f"/api/sessions?scenario_id={first['scenario_id']}").json()
    assert [s["id"] for s in listed] == [second["id"], first["id"]]
    assert client.get("/api/sessions?scenario_id=999999").status_code == 404
    for query in (
        "",
        "?scenario_id=1&extra=1",
        "?scenario_id=true",
        "?scenario_id=1&scenario_id=1",
    ):
        assert client.get("/api/sessions" + query).status_code == 422
    cors = client.options(
        "/api/chat/turn",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )
    assert cors.status_code == 200
    assert cors.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    initialize_database(engine)
    assert len(client.get("/api/scenarios").json()) == 4


def test_runtime_judge_matches_all_reference_fixtures() -> None:
    fixtures = json.loads(
        (Path(__file__).parents[1] / "docs/cs36-judge-fixtures.json").read_text(
            encoding="utf-8"
        )
    )
    facts = [
        {"id": f"n{i}", "title": f"Need {i}", "description": f"Fact {i}"}
        for i in range(1, 8)
    ]
    for case in fixtures["cases"]:
        prior = State().model_dump()
        prior["revealed_needs"] = [
            n for n in facts if n["id"] in case.get("initial_revealed", [])
        ]
        prior["score"] = len(prior["revealed_needs"])
        for item in case["turns"]:
            old = copy.deepcopy(prior)
            state, coaching, newly = evaluate(item["text"], prior, facts)
            label = case["name"] + ": " + item["text"]
            assert coaching["question_type"] == item["question_type"], label
            assert coaching["leading"] == item["leading"], label
            expected = [n["title"] for n in facts if n["id"] == item["new_need"]]
            assert newly == expected, label
            assert prior == old, "judge mutated the committed parent snapshot"
            prior = state


def test_seven_turns_persist_and_reload_with_selected_persona(harness: Harness) -> None:
    client, engine, recorder = harness
    session = start(client, title="Teenage Daughter:")
    questions = [
        "What was school like?",
        "What has been hardest?",
        "How have you felt?",
        "How has that affected you?",
        "What matters most?",
        "How can I help?",
        "What step could we agree on?",
    ]
    for score, question in enumerate(questions, 1):
        result = send(client, session, question)
        session = result["session"]
        assert result["node"]["score"] == score
        assert result["revealed_node_score"] == score
        assert result["node"]["metrics"]["turns"] == score
        assert recorder.calls[-1]["brief"].character_name == "Maya"
        assert len(recorder.calls[-1]["history"]) == 1 + 2 * (score - 1)
        assert recorder.calls[-1]["timeout"] == 30.0
        assert len(recorder.calls[-1]["newly_revealed_titles"]) == 1
    before = client.get(f"/api/sessions/{session['id']}/tree").json()
    with TestClient(create_app(engine, recorder)) as restarted:
        assert restarted.get(f"/api/sessions/{session['id']}").json() == session
        assert restarted.get(f"/api/sessions/{session['id']}/tree").json() == before
    assert session["score"] == 7 and session["resistance"] == "open"


def test_closed_run_zero_and_rewind_keeps_original_and_excludes_siblings(
    harness,
) -> None:
    client, _, recorder = harness
    session = start(client)
    first = send(client, session)
    second = send(client, first["session"], "What is hardest?")
    third = send(client, second["session"], "How have you felt?")
    original = third["session"]
    alternate = fork(client, original, first["turn_id"])
    assert alternate["score"] == 1 and alternate["metrics"]["turns"] == 1
    result = send(client, alternate, "Did the work get done?")
    assert result["node"]["score"] == 1
    history = recorder.calls[-1]["history"]
    assert [m["content"] for m in history if m["role"] == "user"] == ["What happened?"]
    assert recorder.calls[-1]["revealed_titles"] == [
        first["node"]["revealed_needs"][0]["title"]
    ]
    assert recorder.calls[-1]["newly_revealed_titles"] == []
    tree = client.get(f"/api/sessions/{original['id']}/tree").json()
    assert len(tree["branches"]) == 2 and len(tree["nodes"]) == 4
    old_branch = next(
        b for b in tree["branches"] if b["id"] == original["active_branch_id"]
    )
    assert old_branch["head_node_id"] == third["turn_id"] and old_branch["score"] == 3
    activated = client.put(
        f"/api/sessions/{original['id']}/active-branch",
        headers=headers(),
        json={
            "branch_id": original["active_branch_id"],
            "expected_revision": result["session"]["revision"],
        },
    ).json()
    assert (
        activated["score"] == 3 and activated["active_head_node_id"] == third["turn_id"]
    )
    fresh = fork(client, activated, None)
    assert fresh["score"] == 0 and fresh["metrics"]["turns"] == 0
    for _ in range(7):
        fresh = send(client, fresh, "Did you finish it?")["session"]
    assert fresh["score"] == 0


def test_session_and_turn_replay_survive_later_branch_changes_and_restart(
    harness,
) -> None:
    client, engine, recorder = harness
    key = str(uuid4())
    first = start(client, key)
    assert start(client, key) == first
    with DbSession(engine) as db:
        assert len(list(db.scalars(select(Session)))) == 1
        assert len(list(db.scalars(select(User)))) == 1
    turn_key = str(uuid4())
    payload = turn_payload(first, " What happened? ")
    result = client.post("/api/chat/turn", headers=headers(turn_key), json=payload)
    assert result.status_code == 200
    alternate = fork(client, result.json()["session"], None)
    with TestClient(create_app(engine, recorder)) as restarted:
        replay = restarted.post(
            "/api/chat/turn", headers=headers(turn_key), json=payload
        )
        assert replay.json() == result.json()
        assert restarted.get(f"/api/sessions/{first['id']}").json() == alternate
    assert len(recorder.calls) == 1
    payload["user_message"] = "What is different?"
    assert (
        client.post("/api/chat/turn", headers=headers(turn_key), json=payload).json()[
            "detail"
        ]["code"]
        == "idempotency_conflict"
    )


@pytest.mark.parametrize(
    "error,status,code",
    [
        (PersonaUnavailableError("PRIVATE_KEY"), 503, "persona_unavailable"),
        (PersonaTimeoutError("PRIVATE_PROMPT"), 504, "persona_timeout"),
        (PersonaInvalidResponseError("PRIVATE_NEED"), 502, "persona_invalid_response"),
        (RuntimeError("PRIVATE_PROGRAMMING_DETAIL"), 500, "internal_error"),
    ],
)
def test_provider_failure_atomic_safe_and_same_key_retry(
    harness: Harness,
    error: Exception,
    status: int,
    code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, engine, recorder = harness
    session = start(client)
    key = str(uuid4())
    payload = turn_payload(session)
    recorder.error = error
    response = client.post("/api/chat/turn", headers=headers(key), json=payload)
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert "PRIVATE_" not in response.text and "PRIVATE_" not in caplog.text
    assert client.get(f"/api/sessions/{session['id']}").json() == session
    with DbSession(engine) as db:
        assert list(db.scalars(select(ConversationNode))) == []
        assert db.get(IdempotencyRecord, key) is None
    recorder.error = None
    assert (
        client.post("/api/chat/turn", headers=headers(key), json=payload).status_code
        == 200
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"session_id": True},
        {"branch_id": "1"},
        {"expected_revision": 0.5},
        {"parent_node_id": False},
        {"user_message": " \n "},
        {"user_message": "a" * 4001},
        {"private_need": "invented"},
        {"user_message": 5},
    ],
)
def test_invalid_mutation_inputs_never_call_provider(
    harness: Harness, changes: dict
) -> None:
    client, _, recorder = harness
    session = start(client)
    result = client.post(
        "/api/chat/turn", headers=headers(), json=turn_payload(session, **changes)
    )
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "validation_error"
    assert recorder.calls == []


def test_invalid_ids_parent_stale_and_inactive_references(harness: Harness) -> None:
    client, _, recorder = harness
    left, right = start(client), start(client)
    right_turn = send(client, right)
    for changes, code in [
        ({"session_id": 999999}, "session_not_found"),
        ({"branch_id": right["active_branch_id"]}, "branch_not_found"),
        ({"parent_node_id": right_turn["turn_id"]}, "node_not_found"),
        ({"expected_revision": 999}, "stale_revision"),
    ]:
        response = client.post(
            "/api/chat/turn", headers=headers(), json=turn_payload(left, **changes)
        )
        assert response.json()["detail"]["code"] == code
    first = send(client, left)
    stale = client.post("/api/chat/turn", headers=headers(), json=turn_payload(left))
    assert stale.json()["detail"]["code"] == "stale_revision"
    mismatch = client.post(
        "/api/chat/turn",
        headers=headers(),
        json=turn_payload(first["session"], parent_node_id=None),
    )
    assert mismatch.json()["detail"]["code"] == "parent_mismatch"
    alternate = fork(client, first["session"], None)
    inactive = client.post(
        "/api/chat/turn",
        headers=headers(),
        json=turn_payload(alternate, branch_id=left["active_branch_id"]),
    )
    assert inactive.json()["detail"]["code"] == "inactive_branch"
    assert len(recorder.calls) == 2


def test_db_constraints_and_public_private_boundaries(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, engine, recorder = harness
    with DbSession(engine) as db:
        scenario = db.scalar(select(Scenario).order_by(Scenario.id))
        scenario.persona_traits = "PRIVATE_TRAITS"
        scenario.system_prompt = "PRIVATE_SYSTEM"
        facts = copy.deepcopy(scenario.needs)
        for i, fact in enumerate(facts, 1):
            fact["description"] = f"PRIVATE_NEED_{i}"
        scenario.needs = facts
        db.commit()
    import judge

    original = judge.coach_public_text
    coach_inputs = []

    def capture(text_value: str, ruleset_revision: str) -> dict:
        coach_inputs.append(text_value)
        return original(text_value, ruleset_revision)

    monkeypatch.setattr(judge, "coach_public_text", capture)
    left, right = start(client), start(client)
    closed = send(client, left, "Did it happen?")
    for output in (
        client.get("/api/scenarios").text,
        json.dumps(left),
        json.dumps(closed),
        client.get(f"/api/sessions/{left['id']}/tree").text,
    ):
        assert "PRIVATE_" not in output
        assert "system_prompt" not in output and "hidden_need" not in output
    assert coach_inputs == ["Did it happen?"]
    assert "PRIVATE_NEED_7" in recorder.calls[-1]["brief"].hidden_need
    with DbSession(engine) as db:
        with pytest.raises(IntegrityError):
            db.add(
                ConversationNode(
                    session_id=right["id"], parent_id=closed["turn_id"], turn_number=1
                )
            )
            db.commit()
        db.rollback()
        with pytest.raises(IntegrityError):
            db.execute(
                text("UPDATE conversation_nodes SET user_text='edited' WHERE id=:id"),
                {"id": closed["turn_id"]},
            )
            db.commit()
        db.rollback()
        with pytest.raises(IntegrityError):
            db.execute(
                text("UPDATE sessions SET active_branch_id=:b WHERE id=:s"),
                {"b": right["active_branch_id"], "s": left["id"]},
            )
            db.commit()
        db.rollback()
        with pytest.raises(IntegrityError):
            db.add(Session(user_id=999999, scenario_id=999999))
            db.commit()
        db.rollback()


def test_inflight_duplicate_and_revision_race_have_no_partial_node(
    harness: Harness,
) -> None:
    client, engine, recorder = harness
    session = start(client)
    key = str(uuid4())
    payload = turn_payload(session)
    recorder.release = threading.Event()
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            client.post, "/api/chat/turn", json=payload, headers=headers(key)
        )
        assert recorder.entered.wait(5)
        duplicate = client.post("/api/chat/turn", json=payload, headers=headers(key))
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["code"] == "request_in_progress"
        # A separate write must work while the model is waiting (no held DB lock).
        alternate = fork(client, session, None)
        recorder.release.set()
        raced = pending.result(timeout=10)
    assert (
        raced.status_code == 409 and raced.json()["detail"]["code"] == "stale_revision"
    )
    assert client.get(f"/api/sessions/{session['id']}").json() == alternate
    with DbSession(engine) as db:
        assert list(db.scalars(select(ConversationNode))) == []
        assert db.get(IdempotencyRecord, key) is None


@pytest.mark.parametrize("bad_key", [None, "not-a-uuid", str(uuid4()).upper()])
def test_missing_or_noncanonical_key_rejected_before_provider(
    harness: Harness, bad_key: str | None
) -> None:
    client, _, recorder = harness
    session = start(client)
    request_headers = {} if bad_key is None else {"Idempotency-Key": bad_key}
    response = client.post(
        "/api/chat/turn", headers=request_headers, json=turn_payload(session)
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "validation_error"
    assert recorder.calls == []


def test_expired_pending_key_recovers_after_process_restart(harness: Harness) -> None:
    client, engine, recorder = harness
    scenario_id = client.get("/api/scenarios").json()[0]["id"]
    key = str(uuid4())
    fingerprint = json.dumps(
        ["POST", "/api/sessions", {"scenario_id": scenario_id}],
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    with DbSession(engine) as db:
        db.add(
            IdempotencyRecord(
                key=key,
                fingerprint=fingerprint,
                owner="dead-process",
                expires_at=time.time() - 1,
            )
        )
        db.commit()
    with TestClient(create_app(engine, recorder)) as restarted:
        first = restarted.post(
            "/api/sessions", headers=headers(key), json={"scenario_id": scenario_id}
        )
        assert first.status_code == 201
        replay = restarted.post(
            "/api/sessions", headers=headers(key), json={"scenario_id": scenario_id}
        )
        assert replay.json() == first.json()


def test_rules_and_private_facts_pin_per_session(harness: Harness) -> None:
    client, engine, recorder = harness
    with DbSession(engine) as db:
        scenario = db.scalar(select(Scenario).order_by(Scenario.id))
        scenario.config_revision = "s2-r2:old-fixture"
        db.commit()
    old = start(client)
    old = send(client, old)["session"]
    with DbSession(engine) as db:
        scenario = db.get(Scenario, old["scenario_id"])
        scenario.config_revision = "s2-r2.1:new-fixture"
        scenario.system_prompt = "NEW_PRIVATE_PROMPT"
        db.commit()
    assert send(client, old, "What happened next?")["session"]["score"] == 2
    assert "NEW_PRIVATE_PROMPT" not in recorder.calls[-1]["brief"].system_prompt
    new = start(client)
    new = send(client, new)["session"]
    assert send(client, new, "What happened next?")["session"]["score"] == 1
    with DbSession(engine) as db:
        with pytest.raises(IntegrityError):
            db.execute(
                text("UPDATE sessions SET scenario_config='{}' WHERE id=:id"),
                {"id": old["id"]},
            )
            db.commit()
        db.rollback()
