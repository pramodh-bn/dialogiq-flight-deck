"""Idempotent demo data for a fresh dialogiq.db (CS-28 follow-up).

Titles match the frontend mock scenarios so the Scenario Hub cards line up
whether the app runs on the mock API or this backend.
"""

import copy
import json
from pathlib import Path

from sqlalchemy.orm import Session

from judge import RULESET_REVISION
from models import Scenario, User
from need_catalog import NEEDS_BY_TITLE
from schemas import Persona

DEMO_USERNAME = "demo"
DEMO_EMAIL = "demo@dialogiq.local"

DEMO_SCENARIOS = [
    ("Bob: Defensive Team Member", "Performance review · missed Q3 deadlines"),
    ("Teenage Daughter: Homework Friction", "Evening check-in · phone boundaries"),
    ("Priya: Burnout Disclosure", "1:1 · workload renegotiation"),
    ("Vendor: Contract Pushback", "Negotiation · price increase"),
]


def seed_scenarios(db: Session) -> int:
    """Load Muse's fixture without overwriting complete existing configurations."""
    fixture = json.loads(
        Path(__file__).with_name("persona_fixtures.json").read_text(encoding="utf-8")
    )
    wording = {item["scenario_title"]: item for item in fixture["scenarios"]}
    if set(wording) != set(NEEDS_BY_TITLE) or len(fixture["scenarios"]) != 4:
        raise ValueError("Persona fixture must contain the four unique seed scenarios.")
    added = 0
    for title, description in DEMO_SCENARIOS:
        scenario = db.query(Scenario).filter_by(title=title).first()
        if scenario is None:
            scenario = Scenario(title=title, description=description)
            db.add(scenario)
            added += 1
        if not scenario.public_persona or not scenario.needs:
            item = wording[title]
            scenario.public_persona = Persona.model_validate(
                item["persona"]
            ).model_dump()
            scenario.needs = copy.deepcopy(NEEDS_BY_TITLE[title])
            scenario.config_revision = f"{RULESET_REVISION}:{fixture['revision']}"
            # Preserve valid old private data, but pin structured facts for new runs.
            scenario.persona_traits = scenario.persona_traits or item["persona_traits"]
            scenario.system_prompt = scenario.system_prompt or item["system_prompt"]
            scenario.hidden_need = scenario.hidden_need or json.dumps(scenario.needs)
    db.flush()
    get_or_create_demo_user(db)
    return added


def pin_scenario(scenario: Scenario) -> dict:
    """Private immutable session configuration, never a public response DTO."""
    if len(scenario.needs) != 7 or not scenario.public_persona:
        raise ValueError("Scenario has no supported seven-need configuration.")
    return copy.deepcopy(
        {
            "revision": scenario.config_revision,
            "persona": scenario.public_persona,
            "needs": scenario.needs,
            "persona_traits": scenario.persona_traits or "",
            "system_prompt": scenario.system_prompt or "",
        }
    )


def get_or_create_demo_user(db: Session) -> User:
    """Return the single demo user; there is no auth in Sprint 1."""
    user = db.query(User).filter_by(username=DEMO_USERNAME).first()
    if user is None:
        user = User(username=DEMO_USERNAME, email=DEMO_EMAIL)
        db.add(user)
        db.flush()
    return user
