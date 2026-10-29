import os
import sys
from collections.abc import Iterator

import pytest

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, create_sqlite_engine, get_db
from main import app
from models import ConversationNode, Scenario, User
from models import Session as PracticeSession
from seed import DEMO_SCENARIOS, seed_scenarios

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_sqlite_engine(
    SQLALCHEMY_DATABASE_URL,
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db() -> Iterator[Session]:
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_database() -> Iterator[None]:
    """Each API test starts empty and leaves no rows or overrides behind."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def test_health_check():
    """Verify health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print(" [PASS] Health check endpoint verified.")


def test_scenarios_workflow():
    """Verify database write (CS-30 models) and API read endpoint (CS-28 / CS-29)."""
    db = TestingSessionLocal()
    seed_scenario = Scenario(
        title="Integration Test Scenario",
        description="Testing database and API synchronization.",
        hidden_need="Verify vertical slice integrity.",
    )
    db.add(seed_scenario)
    db.commit()
    db.close()

    response = client.get("/api/scenarios")
    assert response.status_code == 200
    scenarios = response.json()

    assert len(scenarios) >= 1
    assert scenarios[0]["title"] == "Integration Test Scenario"
    print(" [PASS] Scenarios API endpoint successfully retrieved DB records (CS-30).")


def test_chat_turn_endpoint():
    """Verify chat turn submission endpoint (CS-28)."""
    payload = {
        "session_id": 1,
        "user_message": "What is our primary priority for this quarter?",
    }
    response = client.post("/api/chat/turn", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "character_response" in data
    assert data["turn_id"] == 1
    print(" [PASS] Chat turn endpoint successfully validated and responded.")


def test_create_session_for_existing_scenario():
    """POST /api/sessions starts a run owned by the demo user (CS-28 follow-up)."""
    with TestingSessionLocal() as db:
        scenario = Scenario(title="Session creation test")
        db.add(scenario)
        db.commit()
        scenario_id = scenario.id

    first = client.post("/api/sessions", json={"scenario_id": scenario_id})
    second = client.post("/api/sessions", json={"scenario_id": scenario_id})

    assert first.status_code == 201
    assert first.json() == {
        "id": first.json()["id"],
        "scenario_id": scenario_id,
        "score": 0,
    }
    assert second.json()["id"] != first.json()["id"]
    db = TestingSessionLocal()
    assert db.query(User).filter_by(username="demo").count() == 1
    db.close()


def test_create_session_unknown_scenario_is_404():
    response = client.post("/api/sessions", json={"scenario_id": 999_999})
    assert response.status_code == 404


def test_cors_allows_lovable_dev_server():
    """The TanStack/Lovable dev server runs on 8080, not Vite's 5173."""
    response = client.options(
        "/api/scenarios",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8080"


def test_seed_scenarios_is_idempotent():
    engine_ = create_sqlite_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine_)
    db = sessionmaker(bind=engine_)()
    assert seed_scenarios(db) == len(DEMO_SCENARIOS)
    assert seed_scenarios(db) == 0
    assert db.query(Scenario).count() == len(DEMO_SCENARIOS)
    db.close()


def test_public_api_never_serializes_private_scenario_brief() -> None:
    """Private persona data must not reach the browser or regex coach."""
    secret = "PRIVATE_NEED_SENTINEL"
    with TestingSessionLocal() as db:
        scenario = Scenario(
            title="Public scenario",
            description="Public description",
            hidden_need=secret,
            persona_traits="PRIVATE_TRAITS_SENTINEL",
            system_prompt="PRIVATE_SYSTEM_SENTINEL",
        )
        db.add(scenario)
        db.commit()
        scenario_id = scenario.id
    scenarios = client.get("/api/scenarios")
    assert scenarios.json() == [
        {
            "id": scenario_id,
            "title": "Public scenario",
            "description": "Public description",
        }
    ]
    session = client.post("/api/sessions", json={"scenario_id": scenario_id})
    assert session.status_code == 201
    turn = client.post(
        "/api/chat/turn",
        json={"session_id": session.json()["id"], "user_message": "What matters?"},
    )
    assert turn.status_code == 200
    for response in (scenarios, session, turn):
        assert "PRIVATE_" not in response.text
        assert "hidden_need" not in response.text
        assert "system_prompt" not in response.text


def test_model_tree_roundtrip_and_subtree_delete() -> None:
    """Persist a fork and remove one subtree without deleting its sibling."""
    with TestingSessionLocal() as db:
        user = User(username="tree-test", email="tree@example.test")
        scenario = Scenario(title="Tree test")
        session = PracticeSession(user=user, scenario=scenario)
        root = ConversationNode(session=session, turn_number=0)
        left = ConversationNode(session=session, parent=root, turn_number=1)
        right = ConversationNode(session=session, parent=root, turn_number=1)
        leaf = ConversationNode(session=session, parent=left, turn_number=2)
        db.add_all([root, left, right, leaf])
        db.commit()
        root_id, left_id, right_id, leaf_id = root.id, left.id, right.id, leaf.id
        db.expire_all()
        assert {node.id for node in db.get(ConversationNode, root_id).children} == {
            left_id,
            right_id,
        }
        db.delete(db.get(ConversationNode, left_id))
        db.commit()
        db.expire_all()
        assert db.get(ConversationNode, leaf_id) is None
        assert db.get(ConversationNode, right_id) is not None


def test_empty_chat_message_is_rejected() -> None:
    response = client.post("/api/chat/turn", json={"session_id": 1, "user_message": ""})
    assert response.status_code == 422


def test_sqlite_rejects_orphan_session() -> None:
    with TestingSessionLocal() as db:
        db.add(PracticeSession(user_id=999, scenario_id=999))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
