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
    behavior_revisions: list[str]
    feedback_revisions: list[str] = Field(default_factory=list)


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


class ConversationProgress(WireModel):
    """Bob's simulated stance on s4-bob-r1 sessions; not a measure of trust."""

    behavior_revision: Literal["s4-bob-r1"]
    stance: Literal["guarded", "warming", "open"]
    last_signal: Literal[
        "initial",
        "clarity",
        "support",
        "acknowledgment",
        "repair",
        "pressure",
        "boundary",
        "none",
    ]
    explanation: str = Field(max_length=240)


class FeedbackEvidence(WireModel):
    kind: Literal["question", "acknowledgment", "pressure", "stance", "need"]
    role: Literal["user", "assistant"]
    quote: str = Field(min_length=1, max_length=4000)
    need_id: str | None = None


class FeedbackStatus(WireModel):
    revision: Literal["semantic-r1"]
    status: Literal["not_evaluated", "ready", "unavailable"]
    evaluated_turns: int = Field(ge=0)
    skipped_turns: int = Field(ge=0)
    failure_reason: (
        Literal[
            "timeout", "not_configured", "invalid_response", "unavailable", "saturated"
        ]
        | None
    )
    latency_ms: int = Field(ge=0)
    evidence: list[FeedbackEvidence]


class State(WireModel):
    score: int = Field(ge=0, le=7, default=0)
    total_needs: Literal[7] = 7
    revealed_needs: list[RevealedNeed] = Field(default_factory=list)
    resistance: Literal["guarded", "warming", "open"] = "guarded"
    metrics: Metrics = Field(default_factory=Metrics)
    conversation_progress: ConversationProgress | None = None
    feedback: FeedbackStatus | None = None


class Whisper(WireModel):
    kind: Literal["good", "warn", "tip"]
    text: str


class Coaching(WireModel):
    source: Literal["deterministic", "semantic"] = "deterministic"
    question_type: Literal["open", "closed", "statement", "unavailable"]
    empathy: bool | None
    leading: bool | None
    outcome: Literal["breakthrough", "deadend", "neutral", "unavailable"]
    alternatives: list[str]
    whispers: list[Whisper]


class SessionResponse(State):
    id: Identifier
    scenario_id: Identifier
    active_branch_id: Identifier
    active_head_node_id: Identifier | None
    revision: Revision
    persona: Persona


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
    behavior_revision: Literal["s4-bob-r1"] | None = None
    feedback_revision: Literal["semantic-r1"] | None = None


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


class CoachHintRequest(WireModel):
    branch_id: Identifier
    head_node_id: Identifier | None
    expected_revision: Revision
    trigger: Literal["automatic", "requested"]
    attempt: int = Field(strict=True, ge=1, le=2)


class Hint(WireModel):
    id: Identifier
    contract_revision: Literal["s3-coach-r2"]
    attempt: Literal[1, 2]
    approach: str = Field(min_length=1, max_length=240)
    example: str = Field(min_length=1, max_length=320)
    reason: str = Field(min_length=1, max_length=360)
    source: Literal["meta", "deterministic"]
    fallback_reason: (
        Literal["not_configured", "timeout", "unavailable", "invalid_response"] | None
    )
    latency_ms: int = Field(strict=True, ge=0, le=10000)


class CoachHintResponse(WireModel):
    session_id: Identifier
    branch_id: Identifier
    head_node_id: Identifier | None
    revision: Revision
    hint: Hint


class HeadHint(WireModel):
    head_node_id: Identifier | None
    hint: Hint


class CoachHintsGetResponse(WireModel):
    session_id: Identifier
    branch_id: Identifier
    head_node_id: Identifier | None
    revision: Revision
    hints: list[HeadHint]
