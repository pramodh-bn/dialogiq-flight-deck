import sys
import os

# Ensure backend directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import local modules
from main import app
from database import Base, get_db
from models import Scenario, User

# --- Setup In-Memory SQLite for Fast, Isolated Testing ---
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables in memory
Base.metadata.create_all(bind=engine)

# Override FastAPI's dependency injection to use our test database
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

# Initialize TestClient
client = TestClient(app)


def test_health_check():
    """Verify health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "dialogiq-backend"
    print(" [PASS] Health check endpoint verified.")


def test_scenarios_workflow():
    """Verify database write (CS-30) and API read endpoint (CS-28 / CS-29)."""
    # Seed a scenario directly into test DB
    db = TestingSessionLocal()
    seed_scenario = Scenario(
        title="Integration Test Scenario",
        description="Testing database and API synchronization.",
        hidden_need="Verify vertical slice integrity."
    )
    db.add(seed_scenario)
    db.commit()
    db.close()

    # Hit the API endpoint
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    scenarios = response.json()
    
    assert len(scenarios) >= 1
    assert scenarios[0]["title"] == "Integration Test Scenario"
    print(" [PASS] Scenarios API endpoint successfully retrieved DB records.")


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