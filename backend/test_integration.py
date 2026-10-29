import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import Scenario

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


if __name__ == "__main__":
    print("--- Running Sprint 1 Vertical Slice Integration Tests ---")
    test_health_check()
    test_scenarios_workflow()
    test_chat_turn_endpoint()
    print("--- All Sprint 1 Integration Tests Passed Successfully! ---")