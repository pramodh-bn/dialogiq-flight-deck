"""Idempotent demo data for a fresh dialogiq.db (CS-28 follow-up).

Titles match the frontend mock scenarios so the Scenario Hub cards line up
whether the app runs on the mock API or this backend.
"""

from sqlalchemy.orm import Session

from models import Scenario, User

DEMO_USERNAME = "demo"
DEMO_EMAIL = "demo@dialogiq.local"

DEMO_SCENARIOS = [
    ("Bob: Defensive Team Member", "Performance review · missed Q3 deadlines"),
    ("Teenage Daughter: Homework Friction", "Evening check-in · phone boundaries"),
    ("Priya: Burnout Disclosure", "1:1 · workload renegotiation"),
    ("Vendor: Contract Pushback", "Negotiation · price increase"),
]


def seed_scenarios(db: Session) -> int:
    """Insert the demo scenarios when the table is empty; return rows added."""
    if db.query(Scenario).first() is not None:
        return 0
    db.add_all(
        Scenario(title=title, description=description)
        for title, description in DEMO_SCENARIOS
    )
    db.commit()
    return len(DEMO_SCENARIOS)


def get_or_create_demo_user(db: Session) -> User:
    """Return the single demo user; there is no auth in Sprint 1."""
    user = db.query(User).filter_by(username=DEMO_USERNAME).first()
    if user is None:
        user = User(username=DEMO_USERNAME, email=DEMO_EMAIL)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
