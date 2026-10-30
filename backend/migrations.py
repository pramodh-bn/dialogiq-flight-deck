"""Transactional additive upgrade from Sprint 1; never delete existing data."""

import copy

from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import Session as DbSession

from conversation_context import ancestor_chain
from database import Base
from judge import coach_public_text
from models import Branch, ConversationNode, Session
from schemas import State
from seed import pin_scenario, seed_scenarios

SCHEMA_VERSION = 2
ADDITIONS = {
    "scenarios": {
        "public_persona": "JSON NOT NULL DEFAULT '{}'",
        "needs": "JSON NOT NULL DEFAULT '[]'",
        "config_revision": "VARCHAR(100) NOT NULL DEFAULT 's2-r2'",
    },
    "sessions": {
        "active_branch_id": "INTEGER",
        "revision": "INTEGER NOT NULL DEFAULT 0",
        "scenario_config": "JSON NOT NULL DEFAULT '{}'",
    },
    "conversation_nodes": {
        "state": "JSON NOT NULL DEFAULT '{}'",
        "coaching": "JSON NOT NULL DEFAULT '{}'",
    },
}
TRIGGERS = (
    """CREATE TRIGGER IF NOT EXISTS immutable_session_config
    BEFORE UPDATE OF scenario_config ON sessions
    WHEN OLD.scenario_config IS NOT NEW.scenario_config
    BEGIN SELECT RAISE(ABORT, 'session configuration is immutable'); END""",
    """CREATE TRIGGER IF NOT EXISTS validate_node_parent
    BEFORE INSERT ON conversation_nodes WHEN NEW.parent_id IS NOT NULL
    AND (NEW.parent_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM conversation_nodes p
        WHERE p.id=NEW.parent_id AND p.session_id=NEW.session_id))
    BEGIN SELECT RAISE(ABORT, 'invalid same-session parent'); END""",
    """CREATE TRIGGER IF NOT EXISTS immutable_conversation_node
    BEFORE UPDATE ON conversation_nodes
    BEGIN SELECT RAISE(ABORT, 'committed nodes are immutable'); END""",
    """CREATE TRIGGER IF NOT EXISTS validate_active_branch
    BEFORE UPDATE OF active_branch_id ON sessions
    WHEN NEW.active_branch_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM branches b WHERE b.id=NEW.active_branch_id AND b.session_id=NEW.id)
    BEGIN SELECT RAISE(ABORT, 'invalid active branch'); END""",
    """CREATE TRIGGER IF NOT EXISTS validate_initial_active_branch
    BEFORE INSERT ON sessions WHEN NEW.active_branch_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'new sessions must start without a branch'); END""",
    """CREATE TRIGGER IF NOT EXISTS immutable_branch_identity
    BEFORE UPDATE OF session_id, fork_node_id ON branches
    WHEN OLD.session_id != NEW.session_id OR OLD.fork_node_id IS NOT NEW.fork_node_id
    BEGIN SELECT RAISE(ABORT, 'branch identity is immutable'); END""",
)


def backfill_sessions(db: DbSession) -> None:
    """Preserve legacy dialogue/IDs, without inventing reveals from stub scores."""
    for session in db.scalars(select(Session).order_by(Session.id)):
        if session.scenario_config:
            continue
        session.scenario_config = pin_scenario(session.scenario)
        session.score = 0
        session.revision = 0
        nodes = list(
            db.scalars(
                select(ConversationNode)
                .where(ConversationNode.session_id == session.id)
                .order_by(ConversationNode.id)
            )
        )
        # Old API persisted no chat; retain any valid manually created model trees.
        for node in nodes:
            chain = ancestor_chain(db, session.id, node.id)
            state = State().model_dump()
            for entry in chain:
                coaching = coach_public_text(entry.user_text or "")
                metrics = state["metrics"]
                metrics["turns"] += 1
                metrics["open_questions"] += int(coaching["question_type"] == "open")
                metrics["closed_questions"] += int(
                    coaching["question_type"] == "closed"
                )
                metrics["empathy_turns"] += int(coaching["empathy"])
            questions = (
                state["metrics"]["open_questions"]
                + state["metrics"]["closed_questions"]
            )
            state["metrics"]["open_question_ratio"] = (
                state["metrics"]["open_questions"] / questions if questions else 0.0
            )
            node.state = copy.deepcopy(state)
            node.coaching = coach_public_text(node.user_text or "")
            node.revealed_count = 0
            node.turn_number = len(chain)
        parent_ids = {n.parent_id for n in nodes}
        leaves = [n for n in nodes if n.id not in parent_ids]
        for head in leaves or [None]:
            branch = Branch(
                session_id=session.id,
                fork_node_id=None,
                head_node_id=head.id if head else None,
            )
            db.add(branch)
            db.flush()
            if session.active_branch_id is None:
                session.active_branch_id = branch.id
    db.flush()


def initialize_database(engine: Engine) -> None:
    """Upgrade schema and legacy data atomically, with an exclusive writer slot."""
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
            if version > SCHEMA_VERSION:
                raise RuntimeError("Database schema is newer than this application.")
            Base.metadata.create_all(connection)
            for table, additions in ADDITIONS.items():
                columns = {
                    column["name"] for column in inspect(connection).get_columns(table)
                }
                for column, definition in additions.items():
                    if column not in columns:
                        connection.exec_driver_sql(
                            f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
                        )
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_node_session_idx ON conversation_nodes(id, session_id)"
            )
            with DbSession(bind=connection, expire_on_commit=False) as db:
                seed_scenarios(db)
                backfill_sessions(db)
                db.flush()
            if connection.exec_driver_sql("PRAGMA foreign_key_check").fetchone():
                raise RuntimeError("Database contains invalid foreign key references.")
            for trigger in TRIGGERS:
                connection.exec_driver_sql(trigger)
            connection.exec_driver_sql(f"PRAGMA user_version={SCHEMA_VERSION}")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
