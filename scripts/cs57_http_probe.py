"""CS-57 HTTP fault-injection probe: real Baseten path, faked OpenAI.

Zero paid calls. Disposable SQLite. Verifies malformed completions map to
502 persona_invalid_response retryable=true with state unchanged and the
same idempotency key retryable to success.
"""
import os, sys, uuid
from types import SimpleNamespace

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "backend"))
os.environ["BASETEN_API_KEY"] = "fake-nonsecret-key"
os.environ["BASETEN_API_BASE"] = "https://example.invalid/v1"

import persona
from fastapi.testclient import TestClient
from sqlalchemy import select

from sqlalchemy.orm import Session as DbSession
from database import create_sqlite_engine
from main import create_app
from models import ConversationNode, IdempotencyRecord

STATE = {"completion": None}


class FakeCompletions:
    def create(self, **kwargs):
        return STATE["completion"]


class FakeOpenAI:
    def __init__(self, **kwargs):
        self.chat = SimpleNamespace(completions=FakeCompletions())


persona.OpenAI = FakeOpenAI

import tempfile
tmp = tempfile.mkdtemp()
engine = create_sqlite_engine(f"sqlite:///{tmp}/probe.db")
app = create_app(engine)

def completion(content_marker):
    if content_marker == "empty-choices":
        return SimpleNamespace(choices=[])
    if content_marker == "no-message":
        return SimpleNamespace(choices=[SimpleNamespace(message=None)])
    if content_marker == "bad-content":
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=42))])
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="  A complete persona reply.  "))])

with TestClient(app) as client:
    scenarios = client.get("/api/scenarios").json()
    bob = next(s for s in scenarios if s["title"].startswith("Bob:"))
    r = client.post("/api/sessions", json={"scenario_id": bob["id"]}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    session = r.json()
    for marker in ("empty-choices", "no-message", "bad-content"):
        with DbSession(engine) as db:
            nodes_before = len(list(db.scalars(select(ConversationNode))))
        STATE["completion"] = completion(marker)
        key = str(uuid.uuid4())
        payload = {"session_id": session["id"], "branch_id": session["active_branch_id"],
                   "parent_node_id": session["active_head_node_id"],
                   "expected_revision": session["revision"], "user_message": "What happened?"}
        resp = client.post("/api/chat/turn", json=payload, headers={"Idempotency-Key": key})
        detail = resp.json()["detail"]
        assert resp.status_code == 502, (marker, resp.status_code, resp.text)
        assert detail["code"] == "persona_invalid_response" and detail["retryable"] is True, (marker, detail)
        assert client.get(f"/api/sessions/{session['id']}").json() == session, marker
        with DbSession(engine) as db:
            assert len(list(db.scalars(select(ConversationNode)))) == nodes_before, marker
            assert db.get(IdempotencyRecord, key) is None, marker
        print(f"{marker}: 502 persona_invalid_response retryable=true, state unchanged, key unconsumed")
        if marker == "empty-choices":
            STATE["completion"] = completion("valid")
            ok = client.post("/api/chat/turn", json=payload, headers={"Idempotency-Key": key})
            assert ok.status_code == 200, ok.text
            print("same-key retry after empty-choices: 200 (key was not consumed)")
            session = client.get(f"/api/sessions/{session['id']}").json()
print("CS-57 HTTP PROBE PASS")
