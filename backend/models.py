"""SQLAlchemy ORM models for the DialogIQ Sprint 1 foundation (CS-30)."""

from datetime import datetime
from typing import ClassVar

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    """Application user: profile and session metadata."""

    __tablename__ = "users"
    __table_args__: ClassVar[dict[str, bool]] = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="user")


class Scenario(Base):
    """Practice scenario: persona, prompts, and hidden need graph."""

    __tablename__ = "scenarios"
    __table_args__: ClassVar[dict[str, bool]] = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    hidden_need: Mapped[str | None] = mapped_column(Text, nullable=True)
    persona_traits: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_persona: Mapped[dict] = mapped_column(JSON, default=dict)
    needs: Mapped[list] = mapped_column(JSON, default=list)
    config_revision: Mapped[str] = mapped_column(String(100), default="s2-r2")

    sessions: Mapped[list["Session"]] = relationship(
        "Session", back_populates="scenario"
    )


class Session(Base):
    """One practice run of a scenario with breakthrough score tracking."""

    __tablename__ = "sessions"
    __table_args__: ClassVar[dict[str, bool]] = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    score: Mapped[int] = mapped_column(Integer, default=0)
    active_branch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    scenario_config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    scenario: Mapped["Scenario"] = relationship("Scenario", back_populates="sessions")
    nodes: Mapped[list["ConversationNode"]] = relationship(
        "ConversationNode", back_populates="session"
    )


class ConversationNode(Base):
    """One turn in a session, linked into a branching parent-child tree."""

    __tablename__ = "conversation_nodes"
    __table_args__ = (
        UniqueConstraint("id", "session_id", name="uq_node_session"),
        ForeignKeyConstraint(
            ["parent_id", "session_id"],
            ["conversation_nodes.id", "conversation_nodes.session_id"],
            name="fk_parent_same_session",
        ),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversation_nodes.id"), nullable=True
    )
    turn_number: Mapped[int] = mapped_column(Integer)
    user_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    character_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    question_tag: Mapped[str | None] = mapped_column(String(32), nullable=True)
    revealed_count: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    coaching: Mapped[dict] = mapped_column(JSON, default=dict)

    session: Mapped["Session"] = relationship(
        "Session", back_populates="nodes", foreign_keys=[session_id]
    )
    children: Mapped[list["ConversationNode"]] = relationship(
        "ConversationNode",
        back_populates="parent",
        cascade="all, delete-orphan",
        single_parent=True,
        foreign_keys=[parent_id],
    )
    parent: Mapped["ConversationNode | None"] = relationship(
        "ConversationNode",
        back_populates="children",
        remote_side="ConversationNode.id",
        foreign_keys=[parent_id],
    )


class Branch(Base):
    __tablename__ = "branches"
    __table_args__ = (
        ForeignKeyConstraint(
            ["head_node_id", "session_id"],
            ["conversation_nodes.id", "conversation_nodes.session_id"],
        ),
        ForeignKeyConstraint(
            ["fork_node_id", "session_id"],
            ["conversation_nodes.id", "conversation_nodes.session_id"],
        ),
        {"sqlite_autoincrement": True},
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    fork_node_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    head_node_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    key: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(Text)
    owner: Mapped[str] = mapped_column(String(36))
    expires_at: Mapped[float] = mapped_column(Float)
    status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
