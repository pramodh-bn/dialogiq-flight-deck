"""SQLAlchemy ORM models for the DialogIQ Sprint 1 foundation (CS-30)."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    """Application user: profile and session metadata."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="user")


class Scenario(Base):
    """Practice scenario: persona, prompts, and hidden need graph."""

    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    hidden_need: Mapped[str | None] = mapped_column(Text, nullable=True)
    persona_traits: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    sessions: Mapped[list["Session"]] = relationship(
        "Session", back_populates="scenario"
    )


class Session(Base):
    """One practice run of a scenario with breakthrough score tracking."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    scenario: Mapped["Scenario"] = relationship("Scenario", back_populates="sessions")
    nodes: Mapped[list["ConversationNode"]] = relationship(
        "ConversationNode", back_populates="session"
    )


class ConversationNode(Base):
    """One turn in a session, linked into a branching parent-child tree."""

    __tablename__ = "conversation_nodes"

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

    session: Mapped["Session"] = relationship("Session", back_populates="nodes")
    children: Mapped[list["ConversationNode"]] = relationship(
        "ConversationNode",
        back_populates="parent",
        cascade="all, delete-orphan",
        single_parent=True,
    )
    parent: Mapped["ConversationNode | None"] = relationship(
        "ConversationNode",
        back_populates="children",
        remote_side="ConversationNode.id",
    )
