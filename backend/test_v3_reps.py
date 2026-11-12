"""V3 voice rep routes: streamed turn, event log and scorecard; provider is faked."""

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session as DbSession

from database import create_sqlite_engine
from main import create_app
from models import ConversationNode, IdempotencyRecord, VoiceEvent
from persona import PersonaTimeoutError, PersonaUnavailableError


class FakeStream:
    """A sentence stream that can fail before or after a given sentence."""

    def __init__(self) -> None:
        self.sentences = ["It's in the report.", "Design changed twice."]
        self.fail_at: int | None = None
        self.error: Exception = PersonaUnavailableError("down")
        self.calls: list[dict] = []
        self.closed = 0

    def __call__(self, **kwargs: object) -> Iterator[str]:
        self.calls.append(kwargs)
        return self._run()

    def _run(self) -> Iterator[str]:
        try:
            for index, sentence in enumerate(self.sentences):
                if self.fail_at == index:
                    raise self.error
                yield sentence
            if self.fail_at == len(self.sentences):
                raise self.error
        finally:
            self.closed += 1


Harness = tuple[TestClient, Engine, FakeStream]


@pytest.fixture
def harness(tmp_path: Path) -> Iterator[Harness]:
    engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'reps.db'}")
    stream = FakeStream()
    application = create_app(
        engine, lambda **_kwargs: "Typed reply.", stream_provider=stream
    )
    with TestClient(application) as client:
        yield client, engine, stream
    engine.dispose()


def key() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


def scenario_id(client: TestClient, *, bob: bool = True) -> int:
    return next(
        s["id"]
        for s in client.get("/api/scenarios").json()
        if s["title"].startswith("Bob:") == bob
    )


def new_rep(client: TestClient) -> dict:
    response = client.post(
        "/api/v3/reps", json={"scenario_id": scenario_id(client)}, headers=key()
    )
    assert response.status_code == 201, response.text
    return response.json()


def turn_body(session: dict, message: str = "is it late", **over: object) -> dict:
    return {
        "branch_id": session["active_branch_id"],
        "parent_node_id": session["active_head_node_id"],
        "expected_revision": session["revision"],
        "user_message": message,
        "speech_start_ms": 1000,
        "speech_end_ms": 2500,
        **over,
    }


def parse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        name, data = block.split("\n", 1)
        assert name.startswith("event: ") and data.startswith("data: ")
        events.append((name[7:], json.loads(data[6:])))
    return events


def say(client: TestClient, rep: dict, session: dict, message: str) -> dict:
    response = client.post(
        f"/api/v3/reps/{rep['rep_id']}/turns",
        json=turn_body(session, message),
        headers=key(),
    )
    assert response.status_code == 200, response.text
    name, done = parse(response.text)[-1]
    assert name == "done"
    return done


def count(engine: Engine, model: type) -> int:
    with DbSession(engine) as db:
        return db.scalar(select(func.count()).select_from(model))


def test_create_rep_pins_new_bob_and_numbers_reps(harness: Harness):
    client, _engine, _stream = harness
    first, second = new_rep(client), new_rep(client)
    assert (first["rep_number"], second["rep_number"]) == (1, 2)
    assert first["duration_limit_ms"] == 180000
    assert first["score_ruleset"] == "v3-score-r1"
    assert first["whisper_ruleset"] == "v3-whisper-r1"
    session = first["session"]
    assert session["conversation_progress"]["behavior_revision"] == "s4-bob-r1"
    assert session["feedback"] is None  # never the semantic grader
    assert first["opening_message"] == session["persona"]["opening_message"]
    assert "stance_ledger" not in json.dumps(first)


def test_create_rep_replays_and_rejects_other_scenarios(harness: Harness):
    client, _engine, _stream = harness
    headers = key()
    body = {"scenario_id": scenario_id(client)}
    first = client.post("/api/v3/reps", json=body, headers=headers)
    again = client.post("/api/v3/reps", json=body, headers=headers)
    assert first.json() == again.json()
    other = client.post(
        "/api/v3/reps",
        json={"scenario_id": scenario_id(client, bob=False)},
        headers=key(),
    )
    assert other.status_code == 422
    assert client.post("/api/v3/reps", json=body).status_code == 422  # no key
    missing = client.post("/api/v3/reps", json={"scenario_id": 9999}, headers=key())
    assert missing.status_code == 404


def test_turn_streams_sentences_then_saves_once(harness: Harness):
    client, engine, stream = harness
    rep = new_rep(client)
    response = client.post(
        f"/api/v3/reps/{rep['rep_id']}/turns",
        json=turn_body(rep["session"], "  what's been making delivery harder  "),
        headers=key(),
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse(response.text)
    assert [name for name, _data in events] == ["sentence", "sentence", "done"]
    assert events[0][1] == {"index": 0, "text": "It's in the report."}
    done = events[2][1]
    assert done["node"]["character_text"] == "It's in the report. Design changed twice."
    assert done["node"]["user_text"] == "what's been making delivery harder"
    assert done["session"]["revision"] == 1
    assert done["session"]["active_head_node_id"] == done["node"]["id"]
    assert done["turn"]["question_type"] == "open"
    assert "stance_ledger" not in response.text
    assert count(engine, ConversationNode) == 1
    assert stream.closed == 1
    (call,) = stream.calls
    assert call["behavior_revision"] == "s4-bob-r1"
    assert call["user_text"] == "what's been making delivery harder"


def test_same_key_replays_saved_turn_without_a_second_call(harness: Harness):
    client, engine, stream = harness
    rep = new_rep(client)
    headers, body = key(), turn_body(rep["session"])
    path = f"/api/v3/reps/{rep['rep_id']}/turns"
    first = client.post(path, json=body, headers=headers)
    again = client.post(path, json=body, headers=headers)
    assert parse(first.text) == parse(again.text)
    assert len(stream.calls) == 1
    assert count(engine, ConversationNode) == 1
    changed = client.post(path, json={**body, "speech_end_ms": 2600}, headers=headers)
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "idempotency_conflict"


def test_failure_before_first_sentence_is_a_normal_error(harness: Harness):
    client, engine, stream = harness
    rep = new_rep(client)
    headers, body = key(), turn_body(rep["session"])
    path = f"/api/v3/reps/{rep['rep_id']}/turns"
    stream.fail_at, stream.error = 0, PersonaTimeoutError("slow")
    failed = client.post(path, json=body, headers=headers)
    assert failed.status_code == 504
    assert failed.json()["detail"]["code"] == "persona_timeout"
    assert count(engine, ConversationNode) == 0
    assert count(engine, IdempotencyRecord) == 1  # only the rep creation
    stream.fail_at = None
    assert client.post(path, json=body, headers=headers).status_code == 200
    assert count(engine, ConversationNode) == 1


def test_failure_after_a_sentence_ends_with_error_and_saves_nothing(harness: Harness):
    client, engine, stream = harness
    rep = new_rep(client)
    headers, body = key(), turn_body(rep["session"])
    path = f"/api/v3/reps/{rep['rep_id']}/turns"
    stream.fail_at = 1
    failed = client.post(path, json=body, headers=headers)
    assert failed.status_code == 200
    events = parse(failed.text)
    assert [name for name, _data in events] == ["sentence", "error"]
    assert events[1][1] == {"code": "persona_unavailable", "retryable": True}
    assert count(engine, ConversationNode) == 0
    session = client.get(f"/api/sessions/{rep['session']['id']}").json()
    assert session["revision"] == 0
    stream.fail_at = None
    retried = parse(client.post(path, json=body, headers=headers).text)
    assert retried[-1][0] == "done"
    assert stream.closed == 2


def test_empty_stream_is_an_invalid_response(harness: Harness):
    client, engine, stream = harness
    rep = new_rep(client)
    stream.sentences = []
    response = client.post(
        f"/api/v3/reps/{rep['rep_id']}/turns",
        json=turn_body(rep["session"]),
        headers=key(),
    )
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "persona_invalid_response"
    assert count(engine, ConversationNode) == 0


@pytest.mark.parametrize(
    "change,status,code",
    [
        ({"expected_revision": 5}, 409, "stale_revision"),
        ({"parent_node_id": 77}, 404, "node_not_found"),
        ({"branch_id": 77}, 404, "branch_not_found"),
        ({"user_message": "   "}, 422, "validation_error"),
        ({"speech_start_ms": 3000}, 422, "validation_error"),
        ({"speech_end_ms": -1}, 422, "validation_error"),
        ({"extra": 1}, 422, "validation_error"),
    ],
)
def test_turn_checks_run_before_the_provider(harness, change, status, code):
    client, engine, stream = harness
    rep = new_rep(client)
    response = client.post(
        f"/api/v3/reps/{rep['rep_id']}/turns",
        json=turn_body(rep["session"], **change),
        headers=key(),
    )
    assert response.status_code == status, response.text
    assert response.json()["detail"]["code"] == code
    assert stream.calls == []
    assert count(engine, IdempotencyRecord) == 1


def test_unknown_rep_is_404_everywhere(harness: Harness):
    client, _engine, _stream = harness
    rep = new_rep(client)
    for path, body in (
        ("turns", turn_body(rep["session"])),
        ("events", {"events": [{"seq": 1, "t_ms": 0, "kind": "learner_speech_start"}]}),
        ("finish", {"duration_ms": 1000}),
    ):
        response = client.post(f"/api/v3/reps/999/{path}", json=body, headers=key())
        assert response.status_code == 404, path
        assert response.json()["detail"]["code"] == "rep_not_found"


def post_events(client: TestClient, rep: dict, events: list[dict]):
    return client.post(
        f"/api/v3/reps/{rep['rep_id']}/events", json={"events": events}, headers=key()
    )


def test_events_are_stored_once_per_seq(harness: Harness):
    client, engine, _stream = harness
    rep = new_rep(client)
    batch = [
        {"seq": 1, "t_ms": 100, "kind": "learner_speech_start"},
        {"seq": 2, "t_ms": 900, "kind": "learner_speech_end"},
        {"seq": 2, "t_ms": 950, "kind": "learner_speech_end"},
    ]
    assert post_events(client, rep, batch).json() == {"accepted": 2, "last_seq": 2}
    more = [
        *batch[:2],
        {"seq": 3, "t_ms": 1200, "kind": "bob_audio_start", "node_id": 4},
    ]
    assert post_events(client, rep, more).json() == {"accepted": 1, "last_seq": 3}
    assert count(engine, VoiceEvent) == 3
    with DbSession(engine) as db:
        stored = db.scalars(select(VoiceEvent).order_by(VoiceEvent.seq)).all()
    assert [(e.seq, e.t_ms, e.data) for e in stored] == [
        (1, 100, {}),
        (2, 900, {}),
        (3, 1200, {"node_id": 4}),
    ]


@pytest.mark.parametrize(
    "event",
    [
        {"seq": 1, "t_ms": 0, "kind": "laugh"},
        {"seq": 0, "t_ms": 0, "kind": "learner_speech_start"},
        {"seq": 1, "t_ms": -5, "kind": "learner_speech_start"},
        {"seq": 1, "t_ms": 0, "kind": "bob_audio_start"},
        {"seq": 1, "t_ms": 0, "kind": "learner_speech_end", "node_id": 3},
        {"seq": 1, "t_ms": 0, "kind": "whisper_shown", "rule": "leading"},
        {
            "seq": 1,
            "t_ms": 0,
            "kind": "bob_audio_start",
            "node_id": 3,
            "interrupted": True,
        },
        {"seq": 1, "t_ms": 0, "kind": "learner_speech_start", "audio": "..."},
    ],
)
def test_malformed_events_are_rejected_whole(harness, event):
    client, engine, _stream = harness
    rep = new_rep(client)
    good = {"seq": 9, "t_ms": 0, "kind": "learner_speech_start"}
    assert post_events(client, rep, [good, event]).status_code == 422
    assert count(engine, VoiceEvent) == 0


def test_event_batch_size_is_bounded(harness: Harness):
    client, _engine, _stream = harness
    rep = new_rep(client)
    many = [
        {"seq": n, "t_ms": n, "kind": "learner_speech_start"} for n in range(1, 202)
    ]
    assert post_events(client, rep, many).status_code == 422
    assert post_events(client, rep, []).status_code == 422
    assert post_events(client, rep, many[:200]).json()["accepted"] == 200


def test_finish_scores_the_stored_rep_and_then_freezes_it(harness: Harness):
    client, _engine, _stream = harness
    rep = new_rep(client)
    first = say(client, rep, rep["session"], "is it late")
    assert first["turn"] == {
        "question_type": "closed",
        "leading": False,
        "meaning": False,
        "deflection": True,
    }
    second = say(client, rep, first["session"], "what has been hard for you")
    assert second["turn"]["meaning"] is True
    one, two = first["node"]["id"], second["node"]["id"]
    timeline = [
        {"seq": 1, "t_ms": 1000, "kind": "learner_speech_start"},
        {"seq": 2, "t_ms": 2500, "kind": "learner_speech_end"},
        {"seq": 3, "t_ms": 3000, "kind": "bob_audio_start", "node_id": one},
        {"seq": 4, "t_ms": 7000, "kind": "bob_audio_end", "node_id": one},
        {"seq": 5, "t_ms": 9500, "kind": "learner_speech_start"},
        {"seq": 6, "t_ms": 12000, "kind": "learner_speech_end"},
        {"seq": 7, "t_ms": 12500, "kind": "bob_audio_start", "node_id": two},
        {
            "seq": 8,
            "t_ms": 15500,
            "kind": "bob_audio_end",
            "node_id": two,
            "interrupted": False,
        },
        {
            "seq": 9,
            "t_ms": 9600,
            "kind": "whisper_shown",
            "rule": "x",
            "trigger_ms": 9500,
        },
    ]
    assert post_events(client, rep, timeline).json()["accepted"] == 9
    path = f"/api/v3/reps/{rep['rep_id']}/finish"
    finished = client.post(path, json={"duration_ms": 20000}, headers=key())
    assert finished.status_code == 200, finished.text
    result = finished.json()["rep"]
    assert result["finished"] is True and result["duration_ms"] == 20000
    assert result["rep_number"] == 1 and result["session_id"] == rep["session"]["id"]
    card = result["scorecard"]
    assert card["ruleset"] == "v3-score-r1"
    assert card["talk"] == {"learner_ms": 4000, "bob_ms": 7000, "learner_ratio": 0.36}
    assert card["questions"]["closed"] == 1 and card["questions"]["meaning"] == 1
    assert card["pause_after_deflection"]["deflections"] >= 1
    assert card["pause_after_deflection"]["waited"] >= 1
    assert card["interruptions"] == 0
    assert card["rewind_recovery"] == {"rewinds": 0, "recovered": 0}

    again = client.post(path, json={"duration_ms": 99}, headers=key())
    assert again.json()["rep"] == result  # the stored result, not a rescoring
    late = post_events(
        client, rep, [{"seq": 10, "t_ms": 1, "kind": "learner_speech_end"}]
    )
    assert late.status_code == 409
    assert late.json()["detail"]["code"] == "rep_finished"
    more = client.post(
        f"/api/v3/reps/{rep['rep_id']}/turns",
        json=turn_body(second["session"]),
        headers=key(),
    )
    assert more.status_code == 409
    assert more.json()["detail"]["code"] == "rep_finished"


def test_retry_after_a_rewind_is_scored_against_the_first_attempt(harness: Harness):
    client, _engine, _stream = harness
    rep = new_rep(client)
    session = rep["session"]
    first = say(client, rep, session, "is it late")
    branch = client.post(
        f"/api/sessions/{session['id']}/branches",
        json={
            "source_branch_id": session["active_branch_id"],
            "rewind_to_node_id": None,
            "expected_revision": first["session"]["revision"],
        },
        headers=key(),
    )
    assert branch.status_code == 201, branch.text
    retry = say(client, rep, branch.json()["session"], "what has been hard for you")
    assert retry["node"]["parent_id"] is None
    finished = client.post(
        f"/api/v3/reps/{rep['rep_id']}/finish",
        json={"duration_ms": 5000},
        headers=key(),
    ).json()["rep"]["scorecard"]
    assert finished["rewind_recovery"]["rewinds"] == 1
    # Only the selected branch's turn is counted as a question.
    assert finished["questions"] == {
        "closed": 0,
        "open": 1,
        "meaning": 1,
        "statements": 0,
    }


def test_reps_are_listed_oldest_first_for_one_scenario(harness: Harness):
    client, _engine, _stream = harness
    first, second = new_rep(client), new_rep(client)
    bob = scenario_id(client)
    listed = client.get(f"/api/v3/reps?scenario_id={bob}").json()
    assert [r["rep_id"] for r in listed] == [first["rep_id"], second["rep_id"]]
    assert all(r["finished"] is False and r["scorecard"] is None for r in listed)
    assert listed[0]["started_at"].endswith("Z")
    assert (
        client.get(f"/api/v3/reps?scenario_id={scenario_id(client, bob=False)}").json()
        == []
    )
    for bad in ("", "?scenario_id=0", "?scenario_id=x", f"?scenario_id={bob}&x=1"):
        assert client.get(f"/api/v3/reps{bad}").status_code == 422, bad
    assert client.get("/api/v3/reps?scenario_id=9999").status_code == 404


def test_existing_typed_turn_still_works_on_a_rep_session(harness: Harness):
    client, _engine, _stream = harness
    session = new_rep(client)["session"]
    response = client.post(
        "/api/chat/turn",
        json={
            "session_id": session["id"],
            "branch_id": session["active_branch_id"],
            "parent_node_id": None,
            "expected_revision": 0,
            "user_message": "What changed?",
        },
        headers=key(),
    )
    assert response.status_code == 200
    assert response.json()["character_response"] == "Typed reply."
