"""Disposable CS-48 reproductions; in-process HTTP and SDK doubles, zero spend."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import jiter  # noqa: F401
from database import create_sqlite_engine
from fastapi.testclient import TestClient
from main import create_app
from models import Scenario
from sqlalchemy.orm import Session as DbSession


def headers(key: str | None = None) -> dict[str, str]:
    return {"Idempotency-Key": key or str(uuid4())}


def turn(session: dict, message: str = "What happened?") -> dict:
    return {
        "session_id": session["id"],
        "branch_id": session["active_branch_id"],
        "parent_node_id": session["active_head_node_id"],
        "expected_revision": session["revision"],
        "user_message": message,
    }


def start(client: TestClient) -> dict:
    scenarios = client.get("/api/scenarios").json()
    maya = next(s for s in scenarios if s["persona"]["name"] == "Maya")
    response = client.post(
        "/api/sessions", headers=headers(), json={"scenario_id": maya["id"]}
    )
    assert response.status_code == 201
    return response.json()


def run() -> None:
    evidence: dict = {"source": "939af9f", "mode": "in-process HTTP, SDK doubles"}
    evidence["python"] = sys.version.split()[0]
    calls: list[dict] = []

    def recorder(**kwargs: object) -> str:
        calls.append(copy.deepcopy(kwargs))
        return "A complete fixture reply."

    with TemporaryDirectory(prefix="cs48-repro-", dir=ROOT) as temporary:
        temp_path = Path(temporary).resolve()
        assert temp_path.is_relative_to(ROOT.resolve())
        engine = create_sqlite_engine(f"sqlite:///{temp_path / 'audit.db'}")
        app = create_app(engine, recorder)
        with TestClient(app, raise_server_exceptions=False) as client:
            session = start(client)
            key = str(uuid4())
            original = turn(session)
            first = client.post("/api/chat/turn", headers=headers(key), json=original)
            assert first.status_code == 200
            # Browser loses first response, refreshes truth, then rebuilds same text.
            refreshed = client.get(f"/api/sessions/{session['id']}").json()
            rebuilt = client.post(
                "/api/chat/turn", headers=headers(key), json=turn(refreshed)
            )
            exact_replay = client.post(
                "/api/chat/turn", headers=headers(key), json=original
            )
            third = client.post(
                "/api/chat/turn", headers=headers(), json=turn(refreshed)
            )
            evidence["lost_response_rebuilt_retry"] = {
                "first_status": first.status_code,
                "rebuilt_status": rebuilt.status_code,
                "rebuilt_error": rebuilt.json().get("detail", {}).get("code"),
                "exact_replay_status": exact_replay.status_code,
                "exact_replay_turn_id": exact_replay.json().get("turn_id"),
                "new_key_status": third.status_code,
                "node_count": len(
                    client.get(f"/api/sessions/{session['id']}/tree").json()["nodes"]
                ),
                "provider_calls": len(calls),
            }
            pinned = start(client)
            with DbSession(engine) as db:
                scenario = db.get(Scenario, pinned["scenario_id"])
                assert scenario is not None
                public = copy.deepcopy(scenario.public_persona)
                public["name"] = "Updated catalog persona"
                public["opening_message"] = "Updated catalog opening"
                scenario.public_persona = public
                db.commit()
            catalog = client.get(f"/api/scenarios/{pinned['scenario_id']}").json()
            sent = client.post("/api/chat/turn", headers=headers(), json=turn(pinned))
            assert sent.status_code == 200
            evidence["pinned_persona_vs_catalog"] = {
                "frontend_catalog_name": catalog["persona"]["name"],
                "frontend_catalog_opening": catalog["persona"]["opening_message"],
                "provider_pinned_name": calls[-1]["brief"].character_name,
                "provider_pinned_opening": calls[-1]["history"][0]["content"],
                "session_has_public_persona_snapshot": "persona" in pinned,
            }
        empty = SimpleNamespace(choices=[])
        fake_sdk = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_: empty))
        )
        with (
            patch.dict("os.environ", {"BASETEN_API_KEY": "audit-placeholder"}),
            patch("persona.OpenAI", return_value=fake_sdk),
            TestClient(create_app(engine), raise_server_exceptions=False) as client,
        ):
            # Catalog name was changed above; use an existing session's current state.
            state = client.get(f"/api/sessions/{pinned['id']}").json()
            before = state["revision"]
            response = client.post(
                "/api/chat/turn", headers=headers(), json=turn(state)
            )
            after = client.get(f"/api/sessions/{pinned['id']}").json()
            evidence["malformed_provider_empty_choices"] = {
                "status": response.status_code,
                "detail": response.json().get("detail"),
                "revision_unchanged": before == after["revision"],
            }
        engine.dispose()
    print(json.dumps(evidence, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    run()
