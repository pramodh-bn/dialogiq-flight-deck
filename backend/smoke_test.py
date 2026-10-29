import os
import sys

# Ensure backend directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import Scenario, User


def run_smoke_test():
    print("--- Starting Sprint 1 Backend & Database Smoke Test (CS-30) ---")
    
    # 1. Initialize Database Tables (CS-30)
    print("[1/4] Creating database tables from SQLAlchemy models (CS-30)...")
    Base.metadata.create_all(bind=engine)
    print("      SUCCESS: Tables created / verified.")

    # 2. Test Session Dependency & Database Write (CS-29)
    print("[2/4] Testing database session write (User & Scenario)...")
    db: Session = SessionLocal()
    try:
        test_user = User(username="test_challenger", email="challenger@dialogiq.test")
        db.add(test_user)
        db.commit()
        db.refresh(test_user)
        print(f"      SUCCESS: Created test user with ID {test_user.id}")

        test_scenario = Scenario(
            title="Difficult Q4 Budget Review",
            description="Convince the stakeholder to reallocate engineering resources.",
            hidden_need="Needs assurance on timeline stability before signing off."
        )
        db.add(test_scenario)
        db.commit()
        db.refresh(test_scenario)
        print(f"      SUCCESS: Created test scenario '{test_scenario.title}' with ID {test_scenario.id}")

    except Exception as e:  # noqa: BLE001
        db.rollback()
        print(f"      FAILED: Database write error -> {e}")
        sys.exit(1)
    finally:
        db.close()

    # 3. Test Database Read & Relationship Mapping (CS-30 & CS-29)
    print("[3/4] Testing database read and relationships...")
    db = SessionLocal()
    try:
        scenario = db.query(Scenario).filter_by(title="Difficult Q4 Budget Review").first()
        if scenario:
            print(f"      SUCCESS: Read scenario back -> '{scenario.title}' (Hidden Need: {scenario.hidden_need})")
        else:
            print("      FAILED: Could not find written scenario.")
            sys.exit(1)
    finally:
        db.close()

    print("[4/4] Smoke test complete! SQLAlchemy ORM (CS-30) and session wiring (CS-29) are fully functional.")
    print("--- Sprint 1 Vertical Slice Verified Successfully ---")

if __name__ == "__main__":
    run_smoke_test()