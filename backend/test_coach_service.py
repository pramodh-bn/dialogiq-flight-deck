"""Coach route/service tests: validation, cache, leases, fallback, GET, deadline.

Mocked coach providers only; zero paid calls. Real SQLite database plus
TestClient transport; wall-clock deadline tests use real sleeps and the
real monotonic clock, never a staged clock.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import sessionmaker

import coach_service
from coach import (
    CoachCompletion,
    CoachInvalidResponseError,
    CoachNotConfiguredError,
    CoachTimeoutError,
    CoachUnavailableError,
)
from database import create_sqlite_engine
from main import create_app
from migrations import SCHEMA_VERSION, initialize_database
from models import CoachHint, CoachSlotLease
from schemas import CoachHintRequest
from test_integration import Recorder, fork, headers, send, start

META_HINT_JSON = (
    '{"approach": "Name one small observable step", '
    '"example": "What feels heaviest about tonight?", '
    '"reason": "It asks for one concrete detail."}'
)
META_HINT_JSON_2 = (
    '{"approach": "Offer a clean pause with a return time", '
    '"example": "Want to pause and try again after dinner?", '
    '"reason": "A bounded pause lowers pressure without ending the talk."}'
)


class CoachStub:
    """Scriptable coach provider: records calls, delays, blocks, or fails."""

    def __init__(
        self,
        result: object = None,
        error: Exception | None = None,
        delay: float = 0.0,
    ) -> None:
        self.result = (
            result
            if result is not None
            else CoachCompletion(content=META_HINT_JSON, finish_reason="stop")
        )
        self.error = error
        self.delay = delay
        self.calls: list[dict] = []
        self.entered = threading.Event()
        self.release: threading.Event | None = None

    def __call__(self, system_prompt: str, context_json: str):  # type: ignore[no-untyped-def]
        self.calls.append(
            {"system_prompt": system_prompt, "context_json": context_json}
        )
        self.entered.set()
        if self.release is not None:
            assert self.release.wait(10), "coach stub was never released"
        if self.delay:
            time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.result


CoachHarness = tuple[TestClient, Engine, Recorder, CoachStub]


@pytest.fixture
def coach_harness(tmp_path: Path) -> Iterator[CoachHarness]:
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'coach.db'}")
    persona = Recorder()
    coach = CoachStub()
    application = create_app(engine, persona, coach_provider=coach)
    with TestClient(application) as client:
        yield client, engine, persona, coach
    engine.dispose()


def hint_payload(session: dict, **overrides: object) -> dict:
    payload = {
        "branch_id": session["active_branch_id"],
        "head_node_id": session["active_head_node_id"],
        "expected_revision": session["revision"],
        "trigger": "requested",
        "attempt": 1,
    }
    payload.update(overrides)
    return payload


def ask(client: TestClient, session_id: int, payload: dict, key: str | None = None):  # type: ignore[no-untyped-def]
    return client.post(
        f"/api/sessions/{session_id}/coach-hints",
        json=payload,
        headers=headers(key),
    )


def test_requested_root_hint_returns_meta_and_preserves_revision(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    response = ask(client, session["id"], hint_payload(session))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session_id"] == session["id"]
    assert body["head_node_id"] is None
    assert body["revision"] == 0
    hint = body["hint"]
    assert hint["attempt"] == 1
    assert hint["source"] == "meta"
    assert hint["fallback_reason"] is None
    assert hint["contract_revision"] == "s3-coach-r2"
    assert hint["approach"] == "Name one small observable step"
    assert 0 <= hint["latency_ms"] <= 10000
    assert len(coach.calls) == 1
    resumed = client.get(f"/api/sessions/{session['id']}").json()
    assert resumed["revision"] == 0


def test_attempt2_before_attempt1_is_not_ready(coach_harness: CoachHarness) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    response = ask(client, session["id"], hint_payload(session, attempt=2))
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "hint_not_ready"
    assert coach.calls == []


def test_automatic_attempt2_attempt3_and_unknown_fields_rejected(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    automatic2 = ask(
        client, session["id"], hint_payload(session, trigger="automatic", attempt=2)
    )
    assert automatic2.status_code == 422, automatic2.text
    assert automatic2.json()["detail"]["code"] == "validation_error"
    attempt3 = ask(client, session["id"], hint_payload(session, attempt=3))
    assert attempt3.status_code == 422, attempt3.text
    unknown = ask(
        client,
        session["id"],
        hint_payload(session, model="other"),  # type: ignore[arg-type]
    )
    assert unknown.status_code == 422, unknown.text
    assert coach.calls == []


def test_automatic_at_root_is_not_eligible(coach_harness: CoachHarness) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    response = ask(client, session["id"], hint_payload(session, trigger="automatic"))
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "hint_not_eligible"
    assert coach.calls == []


def test_automatic_on_stalled_head_succeeds(coach_harness: CoachHarness) -> None:
    client, _, _, _ = coach_harness
    session = start(client, title="Teenage Daughter:")
    first = send(client, session, "Did the work get done?")
    assert first["revealed_node_score"] == 0
    stalled = first["session"]
    response = ask(client, stalled["id"], hint_payload(stalled, trigger="automatic"))
    assert response.status_code == 200, response.text
    assert response.json()["hint"]["source"] == "meta"


def test_automatic_on_unstalled_head_is_not_eligible(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    first = send(client, session, "What happened?")
    assert first["revealed_node_score"] == 1
    moved = first["session"]
    response = ask(client, moved["id"], hint_payload(moved, trigger="automatic"))
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "hint_not_eligible"
    assert coach.calls == []


def test_stale_inactive_and_mismatched_heads_rejected(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, _ = coach_harness
    session = start(client, title="Teenage Daughter:")
    stale = ask(client, session["id"], hint_payload(session, expected_revision=99))
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "stale_revision"
    first = send(client, session, "What happened?")
    moved = first["session"]
    mismatched = ask(client, moved["id"], hint_payload(moved, head_node_id=None))
    assert mismatched.status_code == 409, mismatched.text
    assert mismatched.json()["detail"]["code"] == "parent_mismatch"
    forked = fork(client, moved, first["turn_id"])
    assert forked["active_branch_id"] != moved["active_branch_id"]
    inactive = ask(
        client,
        moved["id"],
        hint_payload(forked, branch_id=moved["active_branch_id"]),
    )
    assert inactive.status_code == 409, inactive.text
    assert inactive.json()["detail"]["code"] == "inactive_branch"


def test_saved_slot_serves_cache_across_keys_and_triggers(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    first = send(client, session, "Did the work get done?")
    stalled = first["session"]
    automatic = ask(client, stalled["id"], hint_payload(stalled, trigger="automatic"))
    assert automatic.status_code == 200, automatic.text
    saved_id = automatic.json()["hint"]["id"]
    requested = ask(client, stalled["id"], hint_payload(stalled))
    assert requested.status_code == 200, requested.text
    assert requested.json()["hint"]["id"] == saved_id
    assert len(coach.calls) == 1


def test_exact_replay_and_fingerprint_conflict(coach_harness: CoachHarness) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    key = str(uuid4())
    payload = hint_payload(session)
    original = ask(client, session["id"], payload, key)
    assert original.status_code == 200, original.text
    replayed = ask(client, session["id"], payload, key)
    assert replayed.status_code == 200, replayed.text
    assert replayed.json() == original.json()
    conflict = ask(client, session["id"], hint_payload(session, attempt=2), key)
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["detail"]["code"] == "idempotency_conflict"
    assert len(coach.calls) == 1


def test_fallback_bank_selects_by_position_and_count(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    coach.error = CoachTimeoutError("slow upstream")
    session = start(client, title="Teenage Daughter:")
    root1 = ask(client, session["id"], hint_payload(session))
    assert root1.status_code == 200, root1.text
    hint1 = root1.json()["hint"]
    assert (hint1["source"], hint1["fallback_reason"]) == (
        "deterministic",
        "timeout",
    )
    assert hint1["approach"] == "Start with a low-pressure invitation."
    root2 = ask(client, session["id"], hint_payload(session, attempt=2))
    assert root2.status_code == 200, root2.text
    # Root attempt2 counts its saved attempt1, so it rotates to A.
    assert root2.json()["hint"]["approach"] == "Ask permission for one small question."
    session = start(client, title="Teenage Daughter:")
    first = send(client, session, "What happened?")
    moved = first["session"]
    head1 = ask(client, moved["id"], hint_payload(moved))
    assert head1.status_code == 200, head1.text
    assert head1.json()["hint"]["approach"] == "Pause and invite their perspective."
    second = send(client, moved, "Did the work get done?")
    moved2 = second["session"]
    head2 = ask(client, moved2["id"], hint_payload(moved2))
    assert head2.status_code == 200, head2.text
    assert head2.json()["hint"]["approach"] == "Ask permission for one small question."


def test_provider_failures_map_to_typed_fallbacks(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    cases = [
        (CoachNotConfiguredError("no key"), "not_configured"),
        (CoachUnavailableError("down"), "unavailable"),
        (CoachInvalidResponseError("bad shape"), "invalid_response"),
        (ValueError("unexpected"), "invalid_response"),
    ]
    for error, reason in cases:
        coach.error = error
        session = start(client, title="Teenage Daughter:")
        response = ask(client, session["id"], hint_payload(session))
        assert response.status_code == 200, response.text
        hint = response.json()["hint"]
        assert hint["source"] == "deterministic"
        assert hint["fallback_reason"] == reason
        resumed = client.get(f"/api/sessions/{session['id']}").json()
        assert resumed["revision"] == 0
    coach.error = None
    coach.result = CoachCompletion(content="not json", finish_reason="stop")
    session = start(client, title="Teenage Daughter:")
    malformed = ask(client, session["id"], hint_payload(session))
    assert malformed.json()["hint"]["fallback_reason"] == "invalid_response"
    coach.result = "a plain string, not a completion"
    session = start(client, title="Teenage Daughter:")
    mistyped = ask(client, session["id"], hint_payload(session))
    assert mistyped.json()["hint"]["fallback_reason"] == "invalid_response"


def test_provider_receives_only_allowlisted_context(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    first = send(client, session, "Did the work get done?")
    moved = first["session"]
    response = ask(client, moved["id"], hint_payload(moved))
    assert response.status_code == 200, response.text
    raw = coach.calls[-1]["context_json"]
    context = json.loads(raw)
    assert set(context) == {
        "contract_revision",
        "persona",
        "learner_situation",
        "turns",
        "omitted_turns",
        "truncated",
        "previous_hints",
    }
    assert set(context["persona"]) == {"name", "role", "opening_message"}
    assert context["contract_revision"] == "s3-coach-r2"
    for turn in context["turns"]:
        assert set(turn) == {"user_text", "character_text"}
    for key in (
        '"system_prompt"',
        '"hidden_need"',
        '"persona_traits"',
        '"scenario_config"',
        '"revealed_needs"',
        '"question_tag"',
        '"resistance"',
    ):
        assert key not in raw


def test_attempt2_receives_saved_attempt1_as_previous(
    coach_harness: CoachHarness,
) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    first_hint = ask(client, session["id"], hint_payload(session))
    assert first_hint.status_code == 200, first_hint.text
    coach.result = CoachCompletion(content=META_HINT_JSON_2, finish_reason="stop")
    second_hint = ask(client, session["id"], hint_payload(session, attempt=2))
    assert second_hint.status_code == 200, second_hint.text
    assert second_hint.json()["hint"]["attempt"] == 2
    context = json.loads(coach.calls[-1]["context_json"])
    assert context["previous_hints"] == [
        {
            "approach": "Name one small observable step",
            "example": "What feels heaviest about tonight?",
            "reason": "It asks for one concrete detail.",
        }
    ]


def test_get_lists_branch_hints_oldest_first(coach_harness: CoachHarness) -> None:
    client, _, _, _ = coach_harness
    session = start(client, title="Teenage Daughter:")
    branch_id = session["active_branch_id"]
    empty = client.get(
        f"/api/sessions/{session['id']}/branches/{branch_id}/coach-hints"
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["hints"] == []
    root = ask(client, session["id"], hint_payload(session))
    assert root.status_code == 200, root.text
    first = send(client, session, "What happened?")
    moved = first["session"]
    head1 = ask(client, moved["id"], hint_payload(moved))
    assert head1.status_code == 200, head1.text
    head1b = ask(client, moved["id"], hint_payload(moved, attempt=2))
    assert head1b.status_code == 200, head1b.text
    listing = client.get(
        f"/api/sessions/{session['id']}/branches/{branch_id}/coach-hints"
    )
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["head_node_id"] == moved["active_head_node_id"]
    assert [(h["head_node_id"], h["hint"]["attempt"]) for h in body["hints"]] == [
        (None, 1),
        (moved["active_head_node_id"], 1),
        (moved["active_head_node_id"], 2),
    ]
    queried = client.get(
        f"/api/sessions/{session['id']}/branches/{branch_id}/coach-hints?x=1"
    )
    assert queried.status_code == 422, queried.text
    missing = client.get("/api/sessions/999/branches/999/coach-hints")
    assert missing.status_code == 404, missing.text


def test_migration_creates_coach_tables_and_stamps_version(tmp_path: Path) -> None:
    path = tmp_path / "fresh.db"
    engine = create_sqlite_engine(f"sqlite:///{path}")
    initialize_database(engine)
    tables = inspect(engine).get_table_names()
    assert "coach_hints" in tables
    assert "coach_slot_leases" in tables
    hint_columns = {
        column["name"] for column in inspect(engine).get_columns("coach_hints")
    }
    assert {
        "head_slot",
        "contract_revision",
        "attempt",
        "approach",
        "source",
        "latency_ms",
    } <= hint_columns
    with engine.connect() as connection:
        assert (
            connection.exec_driver_sql("PRAGMA user_version").scalar_one()
            == SCHEMA_VERSION
        )
    engine.dispose()


def test_wait_budget_abandons_slow_provider_on_real_clock() -> None:
    stub = CoachStub(delay=2.0)
    fallback = {"approach": "a", "example": "e", "reason": "r"}
    started = time.monotonic()
    fields, source, reason, latency_ms = coach_service._call_or_fallback(
        stub, "system", "{}", fallback, started, wait_seconds=0.2, total_seconds=5.0
    )
    elapsed = time.monotonic() - started
    assert (fields, source, reason) == (fallback, "deterministic", "timeout")
    assert elapsed < 1.5
    assert 0 <= latency_ms <= 5000


def test_total_budget_converts_late_meta_to_saturated_timeout() -> None:
    stub = CoachStub(delay=0.3)
    fallback = {"approach": "a", "example": "e", "reason": "r"}
    started = time.monotonic()
    fields, source, reason, latency_ms = coach_service._call_or_fallback(
        stub, "system", "{}", fallback, started, wait_seconds=1.0, total_seconds=0.15
    )
    assert (fields, source, reason, latency_ms) == (
        fallback,
        "deterministic",
        "timeout",
        10000,
    )


def test_production_wait_budget_enforced_on_wall_clock() -> None:
    stub = CoachStub(delay=8.6)
    fallback = {"approach": "a", "example": "e", "reason": "r"}
    started = time.monotonic()
    fields, source, reason, latency_ms = coach_service._call_or_fallback(
        stub, "system", "{}", fallback, started
    )
    elapsed = time.monotonic() - started
    assert (fields, source, reason) == (fallback, "deterministic", "timeout")
    assert 7.9 <= elapsed < 8.6
    assert 7900 <= latency_ms <= 10000


def test_late_worker_result_is_never_published(
    coach_harness: CoachHarness,
) -> None:
    client, engine, _, _ = coach_harness
    session = start(client, title="Teenage Daughter:")
    payload = CoachHintRequest(
        branch_id=session["active_branch_id"],
        head_node_id=None,
        expected_revision=0,
        trigger="requested",
        attempt=1,
    )
    stub = CoachStub(delay=0.6)
    factory = sessionmaker(bind=engine)
    db = factory()
    try:
        status, body = coach_service.request_hint(
            db,
            session["id"],
            payload,
            str(uuid4()),
            stub,
            wait_seconds=0.2,
            total_seconds=5.0,
        )
    finally:
        db.close()
    assert status == 200
    assert body["hint"]["source"] == "deterministic"
    assert body["hint"]["fallback_reason"] == "timeout"
    time.sleep(0.8)
    with factory() as check:
        rows = list(
            check.scalars(
                select(CoachHint).where(CoachHint.session_id == session["id"])
            )
        )
        assert len(rows) == 1
        assert rows[0].source == "deterministic"
        assert list(check.scalars(select(CoachSlotLease)).all()) == []
    resumed = client.get(f"/api/sessions/{session['id']}").json()
    assert resumed["revision"] == 0


def test_slot_race_loser_converges_on_winner(coach_harness: CoachHarness) -> None:
    client, _, _, coach = coach_harness
    session = start(client, title="Teenage Daughter:")
    payload = hint_payload(session)
    path = f"/api/sessions/{session['id']}/coach-hints"
    coach.release = threading.Event()
    key_a, key_b = str(uuid4()), str(uuid4())
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, path, json=payload, headers=headers(key_a))
        assert coach.entered.wait(10), "winner never reached the provider"
        loser = client.post(path, json=payload, headers=headers(key_b))
        assert loser.status_code == 409, loser.text
        assert loser.json()["detail"]["code"] == "request_in_progress"
        coach.release.set()
        winner = pending.result(timeout=10)
    assert winner.status_code == 200, winner.text
    retry = client.post(path, json=payload, headers=headers(key_b))
    assert retry.status_code == 200, retry.text
    assert retry.json()["hint"]["id"] == winner.json()["hint"]["id"]
    assert len(coach.calls) == 1
