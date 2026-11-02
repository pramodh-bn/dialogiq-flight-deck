"""Upgrade actual legacy SQLite layouts transactionally without losing records."""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session as DbSession

from database import create_sqlite_engine
from migrations import SCHEMA_VERSION, initialize_database
from models import Branch, ConversationNode, Scenario, Session, User


def legacy_database(path: Path, *, corrupt: bool = False) -> None:
    with sqlite3.connect(path) as db:
        db.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(80) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL);
        CREATE TABLE scenarios (id INTEGER PRIMARY KEY, title VARCHAR(200) NOT NULL,
          description TEXT, hidden_need TEXT, persona_traits TEXT, system_prompt TEXT);
        CREATE TABLE sessions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          scenario_id INTEGER NOT NULL REFERENCES scenarios(id), score INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL);
        CREATE TABLE conversation_nodes (id INTEGER PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES sessions(id), parent_id INTEGER REFERENCES conversation_nodes(id),
          turn_number INTEGER NOT NULL, user_text TEXT, character_text TEXT,
          question_tag VARCHAR(32), revealed_count INTEGER NOT NULL);
        INSERT INTO users(id,username,email) VALUES(5,'legacy','legacy@example.test');
        INSERT INTO scenarios(id,title,description,hidden_need,persona_traits,system_prompt)
          VALUES(11,'Bob: Defensive Team Member','Old description','old private need','old traits','old prompt');
        INSERT INTO sessions(id,user_id,scenario_id,score,created_at) VALUES(29,5,11,3,'2026-10-29 10:00:00');
        INSERT INTO conversation_nodes VALUES(41,29,NULL,1,'Opening question','Legacy reply','open',3);
        INSERT INTO conversation_nodes VALUES(42,29,41,2,'Old left','Left reply','statement',3);
        INSERT INTO conversation_nodes VALUES(43,29,41,2,'Old right','Right reply','closed',3);
        """)
        if corrupt:
            db.execute("UPDATE conversation_nodes SET parent_id=999 WHERE id=42")


def test_legacy_upgrade_preserves_forks_ids_text_and_private_fields(
    tmp_path: Path,
) -> None:
    path = tmp_path / "old.db"
    legacy_database(path)
    engine = create_sqlite_engine(f"sqlite:///{path}")
    initialize_database(engine)
    with DbSession(engine) as db:
        assert db.get(User, 5).username == "legacy"
        scenario = db.get(Scenario, 11)
        assert (
            scenario.description,
            scenario.hidden_need,
            scenario.persona_traits,
            scenario.system_prompt,
        ) == (
            "Old description",
            "old private need",
            "old traits",
            "old prompt",
        )
        assert len(scenario.needs) == 7
        session = db.get(Session, 29)
        assert session.user_id == 5 and session.scenario_id == 11 and session.score == 0
        assert str(session.created_at) == "2026-10-29 10:00:00"
        nodes = list(db.scalars(select(ConversationNode).order_by(ConversationNode.id)))
        assert [(n.id, n.parent_id, n.character_text) for n in nodes] == [
            (41, None, "Legacy reply"),
            (42, 41, "Left reply"),
            (43, 41, "Right reply"),
        ]
        assert all(n.state["score"] == 0 for n in nodes)
        branches = list(db.scalars(select(Branch).where(Branch.session_id == 29)))
        assert {b.head_node_id for b in branches} == {42, 43}
        first_branch_ids = {b.id for b in branches}
    initialize_database(engine)
    with DbSession(engine) as db:
        assert {b.id for b in db.scalars(select(Branch))} == first_branch_ids
        assert len(list(db.scalars(select(ConversationNode)))) == 3
        assert len(list(db.scalars(select(Scenario)))) == 4
    with engine.connect() as connection:
        assert (
            connection.exec_driver_sql("PRAGMA user_version").scalar_one()
            == SCHEMA_VERSION
        )
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    engine.dispose()


def test_corrupt_legacy_upgrade_rolls_back_schema_and_rows(tmp_path: Path) -> None:
    path = tmp_path / "corrupt.db"
    legacy_database(path, corrupt=True)
    engine = create_sqlite_engine(f"sqlite:///{path}")
    with pytest.raises(ValueError, match="ancestry"):
        initialize_database(engine)
    assert "scenario_config" not in {
        c["name"] for c in inspect(engine).get_columns("sessions")
    }
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT score FROM sessions WHERE id=29").fetchone() == (3,)
        assert db.execute("SELECT COUNT(*) FROM conversation_nodes").fetchone() == (3,)
        assert db.execute("PRAGMA user_version").fetchone() == (0,)
    engine.dispose()
