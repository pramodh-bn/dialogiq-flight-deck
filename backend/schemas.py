"""Explicit public DTOs and strict mutation inputs for the CS-36 contract."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Identifier = Annotated[int, Field(strict=True, gt=0, le=2**53 - 1)]
Revision = Annotated[int, Field(strict=True, ge=0)]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Persona(WireModel):
    name: str
    role: str
    initials: str
    opening_message: str
    public_context: str
    tags: list[str]
    practice_hints: list[str]


class ScenarioResponse(WireModel):
    id: Identifier
    title: str
    description: str | None
    persona: Persona


class RevealedNeed(WireModel):
    id: str
    title: str
    description: str


class Metrics(WireModel):
    turns: int = Field(ge=0, default=0)
    open_questions: int = Field(ge=0, default=0)
    closed_questions: int = Field(ge=0, default=0)
    empathy_turns: int = Field(ge=0, default=0)
    open_question_ratio: float = Field(ge=0, le=1, default=0.0)


class State(WireModel):
    score: int = Field(ge=0, le=7, default=0)
    total_needs: Literal[7] = 7
    revealed_needs: list[RevealedNeed] = Field(default_factory=list)
    resistance: Literal["guarded", "warming", "open"] = "guarded"
    metrics: Metrics = Field(default_factory=Metrics)


class Whisper(WireModel):
    kind: Literal["good", "warn", "tip"]
    text: str


class Coaching(WireModel):
    source: Literal["deterministic"] = "deterministic"
    question_type: Literal["open", "closed", "statement"]
    empathy: bool
    leading: bool
    outcome: Literal["breakthrough", "deadend", "neutral"]
    alternatives: list[str]
    whispers: list[Whisper]


class SessionResponse(State):
    id: Identifier
    scenario_id: Identifier
    active_branch_id: Identifier
    active_head_node_id: Identifier | None
    revision: Revision


class NodeResponse(State):
    id: Identifier
    session_id: Identifier
    parent_id: Identifier | None
    turn_number: int = Field(gt=0)
    user_text: str
    character_text: str
    coaching: Coaching


class BranchResponse(State):
    id: Identifier
    session_id: Identifier
    fork_node_id: Identifier | None
    head_node_id: Identifier | None


class TreeResponse(WireModel):
    session_id: Identifier
    revision: Revision
    active_branch_id: Identifier
    branches: list[BranchResponse]
    nodes: list[NodeResponse]


class SessionCreateRequest(WireModel):
    scenario_id: Identifier


class ChatTurnRequest(WireModel):
    session_id: Identifier
    branch_id: Identifier
    parent_node_id: Identifier | None
    expected_revision: Revision
    user_message: str = Field(min_length=1, max_length=4000)

    @field_validator("user_message", mode="before")
    @classmethod
    def trim_message(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class BranchCreateRequest(WireModel):
    source_branch_id: Identifier
    rewind_to_node_id: Identifier | None
    expected_revision: Revision


class BranchSelectRequest(WireModel):
    branch_id: Identifier
    expected_revision: Revision


class ChatTurnResponse(WireModel):
    turn_id: Identifier
    character_response: str
    revealed_node_score: int = Field(ge=0, le=7)
    node: NodeResponse
    session: SessionResponse


class BranchCreateResponse(WireModel):
    branch: BranchResponse
    session: SessionResponse
