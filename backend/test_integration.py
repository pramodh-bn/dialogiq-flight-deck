import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import Scenario, User
from seed import DEMO_SCENARIOS, seed_scenarios

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)


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
        hidden_need="Verify vertical slice integrity."
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
        "user_message": "What is our primary priority for this quarter?"
    }
    response = client.post("/api/chat/turn", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert "character_response" in data
    assert data["turn_id"] == 1
    print(" [PASS] Chat turn endpoint successfully validated and responded.")


def test_create_session_for_existing_scenario():
    """POST /api/sessions starts a run owned by the demo user (CS-28 follow-up)."""
    scenario_id = client.get("/api/scenarios").json()[0]["id"]

    first = client.post("/api/sessions", json={"scenario_id": scenario_id})
    second = client.post("/api/sessions", json={"scenario_id": scenario_id})

    assert first.status_code == 201
    assert first.json() == {"id": first.json()["id"], "scenario_id": scenario_id, "score": 0}
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
    engine_ = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine_)
    db = sessionmaker(bind=engine_)()
    assert seed_scenarios(db) == len(DEMO_SCENARIOS)
    assert seed_scenarios(db) == 0
    assert db.query(Scenario).count() == len(DEMO_SCENARIOS)
    db.close()


if __name__ == "__main__":
    print("--- Running Sprint 1 Vertical Slice Integration Tests ---")
    test_health_check()
    test_scenarios_workflow()
    test_chat_turn_endpoint()
    test_create_session_for_existing_scenario()
    test_create_session_unknown_scenario_is_404()
    test_cors_allows_lovable_dev_server()
    test_seed_scenarios_is_idempotent()
    print("--- All Sprint 1 Integration Tests Passed Successfully! ---")