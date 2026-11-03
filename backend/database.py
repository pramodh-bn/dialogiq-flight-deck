"""Database engine, session factory, and FastAPI dependency (CS-29)."""

import os
from collections.abc import Generator
from pathlib import Path
from sqlite3 import Connection

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DB_PATH = Path(
    os.environ.get("DIALOGIQ_DB_PATH", Path(__file__).resolve().parent / "dialogiq.db")
).resolve()
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"


def create_sqlite_engine(url: str, **options: object) -> Engine:
    """Build a SQLite engine that enforces declared foreign keys."""
    sqlite_engine = create_engine(
        url, connect_args={"check_same_thread": False, "timeout": 30}, **options
    )

    @event.listens_for(sqlite_engine, "connect")
    def enable_foreign_keys(connection: Connection, _record: object) -> None:
        # SQLite requires this on every connection, before a transaction begins.
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    return sqlite_engine


engine = create_sqlite_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base for all DialogIQ ORM models."""


def get_db() -> Generator[Session, None, None]:
    """Yield a database session for FastAPI dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
