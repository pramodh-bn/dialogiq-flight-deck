"""CS-76: s4-bob-r1 opt-in and Bob's simulated stance, through the real routes.

Fixture persona only, zero paid calls. Signal wording comes from the shared CS-72/76
contrast file; the private held-out lines are never read here.
"""

# ruff: noqa: F811  (the shared `harness` fixture is imported, then requested by name)

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session as DbSession

import stance
from models import Session
from test_integration import Harness, fork, harness, headers, send  # noqa: F401

CONTRASTS = (
    Path(__file__).resolve().parents[1] / "docs/sprint4/bob_feedback_contrasts.json"
)
LINES = [
    line
    for group in json.loads(CONTRASTS.read_text(encoding="utf-8"))["groups"]
    for line in group["lines"]
]


def scenario_id(client: TestClient, prefix: str) -> int:
    return next(
        s["id"]
        for s in client.get("/api/scenarios").json()
        if s["title"].startswith(prefix)
    )


def create(client: TestClient, prefix: str = "Bob:", **body: object) -> Response:
    return client.post(
        "/api/sessions",
        json={"scenario_id": scenario_id(client, prefix), **body},
        headers=headers(),
    )


def new_bob(client: TestClient) -> dict:
    response = create(client, behavior_revision="s4-bob-r1")
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("line", LINES, ids=[line["id"] for line in LINES])
def test_shared_contrast_signal(line: dict) -> None:
    got = stance.signal_for(line["learner"])
    assert got in line["signal"]
    assert got != line.get("not_signal")


# CS-C475: negation must not invert ordinary meaning. The first four are Codex's
# reproductions; the rest pin both sides of the boundary.
NEGATION_CONTRASTS = [
    ("This is not your fault.", "none"),
    ("I cannot promise that I can hold the date.", "none"),
    ("I am not saying that was unfair.", "none"),
    ("I will not say that I can help you.", "none"),
    ("It isn't your fault.", "none"),
    ("I never said you were slow.", "none"),
    ("I don't think you're slow.", "none"),
    ("I don't think it sounds hard.", "none"),
    ("I cannot promise those yet, but I will check.", "clarity"),
    ("I said everyone else hits their dates, and I take that back.", "repair"),
    ("I can't promise the date, but I can help you with the setup.", "support"),
    ("It's your fault.", "pressure"),
    ("You were slow.", "pressure"),
    ("Help me understand why you can't keep up with everyone else.", "pressure"),
    ("I don't think you've had it that tough.", "pressure"),
    ("She didn't make all this fuss.", "pressure"),
    ("I'm not leaving until you tell me.", "pressure"),
]


@pytest.mark.parametrize(("text", "expected"), NEGATION_CONTRASTS)
def test_negation_contrast_signal(text: str, expected: str) -> None:
    assert stance.signal_for(text) == expected


def test_ledger_follows_the_contract_table() -> None:
    ledger = stance.initial_ledger()
    ledger = stance.advance(ledger, "acknowledgment")
    assert (ledger["balance"], stance.stance_for(ledger["balance"])) == (1, "warming")
    assert stance.advance(ledger, "acknowledgment") == ledger  # repeats do not rise
    assert stance.advance(ledger, "none") == ledger
    assert stance.advance(ledger, "boundary") == ledger
    opened = stance.advance(ledger, "clarity")
    assert stance.stance_for(opened["balance"]) == "open"
    assert stance.advance(opened, "support")["balance"] == 2  # bounded at 2
    dropped = stance.advance(opened, "pressure")
    assert dropped == {"balance": 1, "last_positive": None}
    floor = stance.initial_ledger()
    for _ in range(4):
        floor = stance.advance(floor, "pressure")
    assert floor["balance"] == -2
    # Repair cannot jump guarded to open on its own turn.
    assert (
        stance.advance({"balance": 1, "last_positive": "clarity"}, "repair")["balance"]
        == 1
    )
    assert stance.advance(floor, "repair")["balance"] == -1


def test_capability_and_validation(harness: Harness) -> None:
    client, _, _ = harness
    for scenario in client.get("/api/scenarios").json():
        expected = ["s4-bob-r1"] if scenario["title"].startswith("Bob:") else []
        assert scenario["behavior_revisions"] == expected
    refused = create(client, "Priya:", behavior_revision="s4-bob-r1")
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "validation_error"
    assert create(client, behavior_revision="s9-unknown").status_code == 422


def test_legacy_sessions_keep_null_progress_and_score_resistance(
    harness: Harness,
) -> None:
    client, _, _ = harness
    legacy = create(client).json()
    assert legacy["conversation_progress"] is None
    turn = send(
        client, legacy, "It sounds like the rework has been really hard on you."
    )
    assert turn["node"]["conversation_progress"] is None
    assert turn["session"]["resistance"] == "guarded"


def test_new_bob_stance_moves_without_a_reveal_and_survives_reload(
    harness: Harness,
) -> None:
    client, engine, recorder = harness
    session = new_bob(client)
    progress = session["conversation_progress"]
    assert progress["stance"] == "guarded" and progress["last_signal"] == "initial"
    assert session["persona"]["name"] == "Bob"

    first = send(client, session, "Three redesigns in a month sounds exhausting.")
    node = first["node"]
    assert node["score"] == 0
    assert node["conversation_progress"]["stance"] == "warming"
    assert node["conversation_progress"]["last_signal"] == "acknowledgment"
    assert node["resistance"] == "warming"
    assert recorder.calls[-1]["resistance"] == "warming"

    second = send(client, first["session"], "That sounds hard too.")
    assert second["node"]["conversation_progress"]["stance"] == "warming"
    third = send(
        client,
        second["session"],
        "Let's write down what has to work for the demo to pass.",
    )
    assert third["node"]["conversation_progress"]["stance"] == "open"
    blamed = send(
        client, third["session"], "Everyone else stayed late. It is you who is slow."
    )
    assert blamed["node"]["conversation_progress"]["last_signal"] == "pressure"
    assert blamed["node"]["conversation_progress"]["stance"] == "warming"

    reloaded = client.get(f"/api/sessions/{session['id']}").json()
    assert reloaded["conversation_progress"] == blamed["node"]["conversation_progress"]
    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    body = json.dumps(tree)
    assert stance.LEDGER_KEY not in body and "balance" not in body
    with DbSession(engine) as db:
        stored = db.get(Session, session["id"]).scenario_config
        assert stored["behavior_revision"] == "s4-bob-r1"
        assert stored["revision"].startswith("s2-r2.3-bob:")


def test_rewind_and_fork_derive_the_selected_path(harness: Harness) -> None:
    client, _, _ = harness
    session = new_bob(client)
    first = send(client, session, "Three redesigns in a month sounds exhausting.")
    second = send(client, first["session"], "Poor you. We're all exhausted.")
    assert second["session"]["conversation_progress"]["stance"] == "guarded"

    to_first = fork(client, second["session"], first["node"]["id"])
    assert to_first["conversation_progress"]["stance"] == "warming"
    to_root = fork(client, to_first, None)
    assert to_root["conversation_progress"]["last_signal"] == "initial"
    branches = client.get(f"/api/sessions/{session['id']}/tree").json()["branches"]
    active = next(b for b in branches if b["id"] == to_root["active_branch_id"])
    assert active["conversation_progress"]["stance"] == "guarded"

    # The original branch keeps its own history.
    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    by_id = {n["id"]: n for n in tree["nodes"]}
    assert by_id[second["node"]["id"]]["conversation_progress"]["stance"] == "guarded"


def test_create_replay_keeps_the_opt_in_in_the_idempotent_body(
    harness: Harness,
) -> None:
    client, _, _ = harness
    key = headers()
    body = {
        "scenario_id": scenario_id(client, "Bob:"),
        "behavior_revision": "s4-bob-r1",
    }
    first = client.post("/api/sessions", json=body, headers=key)
    again = client.post("/api/sessions", json=body, headers=key)
    assert first.status_code == again.status_code == 201
    assert first.json()["id"] == again.json()["id"]
    changed = client.post(
        "/api/sessions", json={"scenario_id": body["scenario_id"]}, headers=key
    )
    assert changed.status_code == 409
