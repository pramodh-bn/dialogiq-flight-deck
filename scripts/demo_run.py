"""Reproducible V2 scoring/branch demo: default fixture, --live real HTTP.

Default uses a fresh temporary SQLite database and explicit fake persona; no
network or paid calls. --live --base-url http://127.0.0.1:8080 uses the running
real API and submits 15 new turns (7 closed, 7 good, 1 alternate). Configure the
backend separately; this script never reads or prints credentials or dialogue.
"""

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from database import create_sqlite_engine
from main import create_app

GOOD_QUESTIONS = (
    "What has this situation been like for you?",
    "What has been the hardest part?",
    "How does that make you feel?",
    "How does that affect you?",
    "What matters most to you here?",
    "What support would help?",
    "What next step could we agree on?",
)


def checked(response: httpx.Response, status: int) -> dict | list:
    if response.status_code != status:
        try:
            code = response.json().get("detail", {}).get("code", "unknown")
        except (ValueError, AttributeError):
            code = "non-json"
        raise AssertionError(
            f"Expected HTTP{status}, got{response.status_code}, code={code}"
        )
    return response.json()


def request_headers(key: str | None = None) -> dict[str, str]:
    return {"Idempotency-Key": key or str(uuid4()), "Origin": "http://127.0.0.1:5173"}


def run_demo(
    client: httpx.Client | TestClient, scenario_title: str, require_empty: bool
) -> dict:
    scenarios = checked(client.get("/api/scenarios"), 200)
    matches = [
        scenario for scenario in scenarios if scenario["title"] == scenario_title
    ]
    assert len(matches) == 1, "Choose exactly one known scenario title."
    scenario = matches[0]
    if require_empty:
        for item in scenarios:
            assert (
                checked(client.get(f"/api/sessions?scenario_id={item['id']}"), 200)
                == []
            ), "Use a fresh database."

    def new_session() -> dict:
        return checked(
            client.post(
                "/api/sessions",
                json={"scenario_id": scenario["id"]},
                headers=request_headers(),
            ),
            201,
        )

    def send(session: dict, message: str) -> tuple[dict, dict, str, dict]:
        body = {
            "session_id": session["id"],
            "branch_id": session["active_branch_id"],
            "parent_node_id": session["active_head_node_id"],
            "expected_revision": session["revision"],
            "user_message": message,
        }
        key = str(uuid4())
        result = checked(
            client.post("/api/chat/turn", json=body, headers=request_headers(key)), 200
        )
        assert result["character_response"].strip(), "Persona reply must not be empty."
        return result["session"], result["node"], key, body

    closed = new_session()
    for _ in range(7):
        closed, node, _, _ = send(closed, "Did you finish it?")
        assert node["coaching"]["question_type"] == "closed"
        assert node["coaching"]["outcome"] == "deadend"
    assert closed["score"] <= 3, "Closed-only proof failed."
    assert closed["score"] == 0, "The fixed closed fixture should score zero."

    good = new_session()
    good_scores = []
    for question in GOOD_QUESTIONS:
        good, node, replay_key, replay_body = send(good, question)
        good_scores.append(good["score"])
    assert good["score"] >= 6, "Good-run proof failed."
    assert good_scores == list(range(1, 8))
    original = checked(client.get(f"/api/sessions/{good['id']}/tree"), 200)
    assert len(original["nodes"]) == 7
    # Replay the last successful action without paying for another reply.
    replay = checked(
        client.post(
            "/api/chat/turn", json=replay_body, headers=request_headers(replay_key)
        ),
        200,
    )
    assert replay["session"] == good and replay["node"] == node
    assert checked(client.get(f"/api/sessions/{good['id']}"), 200) == good

    target = original["nodes"][2]
    created = checked(
        client.post(
            f"/api/sessions/{good['id']}/branches",
            headers=request_headers(),
            json={
                "source_branch_id": good["active_branch_id"],
                "rewind_to_node_id": target["id"],
                "expected_revision": good["revision"],
            },
        ),
        201,
    )
    alternate = created["session"]
    assert alternate["score"] == target["score"] == 3
    alternate, alternate_node, _, _ = send(alternate, "Did you finish it?")
    assert alternate["score"] == 3
    assert alternate_node["parent_id"] == target["id"]
    branched = checked(client.get(f"/api/sessions/{good['id']}/tree"), 200)
    original_nodes = {entry["id"]: entry for entry in original["nodes"]}
    assert all(
        entry == original_nodes[entry["id"]]
        for entry in branched["nodes"]
        if entry["id"] in original_nodes
    )
    old_branch = next(
        b for b in branched["branches"] if b["id"] == good["active_branch_id"]
    )
    assert (
        old_branch["head_node_id"] == good["active_head_node_id"]
        and old_branch["score"] == 7
    )
    resumed = checked(
        client.put(
            f"/api/sessions/{good['id']}/active-branch",
            headers=request_headers(),
            json={
                "branch_id": good["active_branch_id"],
                "expected_revision": alternate["revision"],
            },
        ),
        200,
    )
    assert (
        resumed["score"] == 7
        and resumed["active_head_node_id"] == good["active_head_node_id"]
    )
    final_tree = checked(client.get(f"/api/sessions/{good['id']}/tree"), 200)
    digest = hashlib.sha256(
        json.dumps(original["nodes"], sort_keys=True).encode()
    ).hexdigest()
    return {
        "scenario": scenario_title,
        "closed_score": closed["score"],
        "closed_threshold": "<=3/7",
        "good_score": good["score"],
        "good_threshold": ">=6/7",
        "good_progression": good_scores,
        "sessions": {"closed": closed["id"], "good": good["id"]},
        "original_branch": good["active_branch_id"],
        "alternate_branch": alternate["active_branch_id"],
        "alternate_score": alternate["score"],
        "branches": len(final_tree["branches"]),
        "good_tree_nodes": len(final_tree["nodes"]),
        "original_nodes_sha256": digest,
        "replay": "passed",
        "reload": "passed",
        "rewind_inclusive": "passed",
        "original_transcript_and_score": "preserved",
        "new_turn_requests": 15,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--scenario", default="Bob: Defensive Team Member")
    parser.add_argument("--require-empty", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.live:
        with httpx.Client(base_url=args.base_url, timeout=45) as client:
            result = run_demo(client, args.scenario, args.require_empty)
        result["mode"] = "external real HTTP (provider configured by server)"
    else:
        with tempfile.TemporaryDirectory(prefix="cs40-demo-") as folder:
            engine = create_sqlite_engine(f"sqlite:///{Path(folder) / 'demo.db'}")

            def fixture_reply(**kwargs: object) -> str:
                return "Explicit demo fixture reply."

            with TestClient(create_app(engine, fixture_reply)) as client:
                result = run_demo(client, args.scenario, True)
            engine.dispose()
        result["mode"] = "explicit fixture provider; no paid calls"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(result, output, indent=2)
            output.write("\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
