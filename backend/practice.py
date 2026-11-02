"""Persisted practice operations; provider calls never hold a database lock."""

import copy
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from api_errors import ApiError, conflict, not_found
from conversation_context import ancestor_chain, build_history
from judge import evaluate
from models import Branch, ConversationNode, IdempotencyRecord, Scenario, Session
from persona import BasetenPersonaClient, PersonaBrief, generate_persona_reply
from schemas import (
    BranchCreateRequest,
    BranchCreateResponse,
    BranchResponse,
    BranchSelectRequest,
    ChatTurnRequest,
    ChatTurnResponse,
    NodeResponse,
    ScenarioResponse,
    SessionResponse,
    State,
    TreeResponse,
)
from seed import get_or_create_demo_user, pin_scenario

LEASE_SECONDS = 120
Provider = Callable[..., str]


def write_lock(db: DbSession) -> None:
    """Discard stale read snapshots before acquiring the SQLite writer slot."""
    db.rollback()
    db.expire_all()
    db.connection().exec_driver_sql("BEGIN IMMEDIATE")


def get_session(db: DbSession, session_id: int) -> Session:
    session = db.get(Session, session_id)
    if session is None:
        raise not_found("session")
    return session


def get_branch(db: DbSession, session_id: int, branch_id: int) -> Branch:
    branch = db.get(Branch, branch_id)
    if branch is None or branch.session_id != session_id:
        raise not_found("branch")
    return branch


def get_node(
    db: DbSession, session_id: int, node_id: int | None
) -> ConversationNode | None:
    if node_id is None:
        return None
    node = db.get(ConversationNode, node_id)
    if node is None or node.session_id != session_id:
        raise not_found("node")
    return node


def state_at(db: DbSession, session_id: int, node_id: int | None) -> dict:
    node = get_node(db, session_id, node_id)
    return copy.deepcopy(node.state) if node else State().model_dump()


def scenario_dto(scenario: Scenario) -> dict:
    return ScenarioResponse(
        id=scenario.id,
        title=scenario.title,
        description=scenario.description,
        persona=scenario.public_persona,
    ).model_dump()


def session_dto(db: DbSession, session: Session) -> dict:
    branch = get_branch(db, session.id, session.active_branch_id)
    return SessionResponse(
        id=session.id,
        scenario_id=session.scenario_id,
        active_branch_id=branch.id,
        active_head_node_id=branch.head_node_id,
        revision=session.revision,
        **state_at(db, session.id, branch.head_node_id),
    ).model_dump()


def branch_dto(db: DbSession, branch: Branch) -> dict:
    return BranchResponse(
        id=branch.id,
        session_id=branch.session_id,
        fork_node_id=branch.fork_node_id,
        head_node_id=branch.head_node_id,
        **state_at(db, branch.session_id, branch.head_node_id),
    ).model_dump()


def node_dto(node: ConversationNode) -> dict:
    return NodeResponse(
        id=node.id,
        session_id=node.session_id,
        parent_id=node.parent_id,
        turn_number=node.turn_number,
        user_text=node.user_text or "",
        character_text=node.character_text or "",
        coaching=node.coaching,
        **copy.deepcopy(node.state),
    ).model_dump()


def tree_dto(db: DbSession, session_id: int) -> dict:
    session = get_session(db, session_id)
    branches = db.scalars(
        select(Branch).where(Branch.session_id == session_id).order_by(Branch.id)
    )
    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.session_id == session_id)
        .order_by(ConversationNode.id)
    )
    return TreeResponse(
        session_id=session_id,
        revision=session.revision,
        active_branch_id=session.active_branch_id,
        branches=[branch_dto(db, b) for b in branches],
        nodes=[node_dto(n) for n in nodes],
    ).model_dump()


def validate_revision(session: Session, expected: int) -> None:
    if session.revision != expected:
        raise conflict("stale_revision")


def reserve(
    db: DbSession,
    key: str,
    method: str,
    path: str,
    payload: dict,
    lease_seconds: int = LEASE_SECONDS,
) -> tuple[str, tuple[int, dict] | None]:
    fingerprint = json.dumps(
        [method, path, payload],
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    write_lock(db)
    record = db.get(IdempotencyRecord, key)
    if record:
        if record.fingerprint != fingerprint:
            db.rollback()
            raise conflict("idempotency_conflict")
        if record.status is not None:
            result = (record.status, copy.deepcopy(record.response))
            db.rollback()
            return "", result
        if record.expires_at > time.time():
            db.rollback()
            raise ApiError(
                409,
                "request_in_progress",
                "This request is still running.",
                retryable=True,
            )
        db.delete(record)
        db.flush()
    owner = str(uuid4())
    db.add(
        IdempotencyRecord(
            key=key,
            fingerprint=fingerprint,
            owner=owner,
            expires_at=time.time() + lease_seconds,
        )
    )
    db.commit()
    return owner, None


def finish(
    db: DbSession, key: str, owner: str, status: int, response: dict
) -> tuple[int, dict]:
    record = db.get(IdempotencyRecord, key)
    if record is None or record.owner != owner or record.status is not None:
        raise ApiError(
            409, "request_in_progress", "Retry the original request.", retryable=True
        )
    record.status = status
    record.response = copy.deepcopy(response)
    db.commit()
    return status, response


def mutate(
    db: DbSession,
    key: str,
    method: str,
    path: str,
    payload: dict,
    operation: Callable[[str], tuple[int, dict]],
) -> tuple[int, dict]:
    owner, replay = reserve(db, key, method, path, payload)
    if replay:
        return replay
    try:
        return operation(owner)
    except Exception:
        db.rollback()
        db.execute(
            delete(IdempotencyRecord).where(
                IdempotencyRecord.key == key,
                IdempotencyRecord.owner == owner,
                IdempotencyRecord.status.is_(None),
            )
        )
        db.commit()
        raise


def create_session(db: DbSession, scenario_id: int, key: str) -> tuple[int, dict]:
    def operation(owner: str) -> tuple[int, dict]:
        write_lock(db)
        scenario = db.get(Scenario, scenario_id)
        if scenario is None:
            raise not_found("scenario")
        session = Session(
            user_id=get_or_create_demo_user(db).id,
            scenario_id=scenario_id,
            score=0,
            revision=0,
            scenario_config=pin_scenario(scenario),
        )
        db.add(session)
        db.flush()
        branch = Branch(session_id=session.id)
        db.add(branch)
        db.flush()
        session.active_branch_id = branch.id
        db.flush()
        return finish(db, key, owner, 201, session_dto(db, session))

    return mutate(
        db, key, "POST", "/api/sessions", {"scenario_id": scenario_id}, operation
    )


@dataclass(frozen=True)
class GenerationContext:
    config: dict
    previous: dict
    history: list[dict[str, str]]
    depth: int


def turn_context(db: DbSession, payload: ChatTurnRequest) -> GenerationContext:
    session = get_session(db, payload.session_id)
    branch = get_branch(db, session.id, payload.branch_id)
    parent = get_node(db, session.id, payload.parent_node_id)
    validate_revision(session, payload.expected_revision)
    if session.active_branch_id != branch.id:
        raise conflict("inactive_branch")
    if branch.head_node_id != payload.parent_node_id:
        raise conflict("parent_mismatch")
    config = copy.deepcopy(session.scenario_config)
    return GenerationContext(
        config,
        state_at(db, session.id, branch.head_node_id),
        build_history(
            db, session.id, branch.head_node_id, config["persona"]["opening_message"]
        ),
        parent.turn_number + 1 if parent else 1,
    )


def real_persona(**kwargs: object) -> str:
    """Production provider; tests override this callable via FastAPI dependency."""
    return generate_persona_reply(BasetenPersonaClient(), **kwargs)


def send_turn(
    db: DbSession, payload: ChatTurnRequest, key: str, provider: Provider
) -> tuple[int, dict]:
    def operation(owner: str) -> tuple[int, dict]:
        context = turn_context(db, payload)
        state, coaching, newly = evaluate(
            payload.user_message,
            context.previous,
            context.config["needs"],
            context.config["revision"].split(":", 1)[0],
        )
        config = context.config
        brief = PersonaBrief(
            character_name=config["persona"]["name"],
            role=config["persona"]["role"],
            persona_traits=config["persona_traits"],
            system_prompt=config["system_prompt"],
            hidden_need=json.dumps(config["needs"], ensure_ascii=False, sort_keys=True),
        )
        # No ORM objects/read transaction survive the slow provider operation.
        db.rollback()
        response = provider(
            brief=brief,
            user_text=payload.user_message,
            history=context.history,
            revealed_titles=[n["title"] for n in context.previous["revealed_needs"]],
            newly_revealed_titles=newly,
            resistance=state["resistance"],
            timeout=30.0,
        )
        if not isinstance(response, str) or not response.strip():
            from persona import PersonaInvalidResponseError

            raise PersonaInvalidResponseError("Persona returned no dialogue.")
        write_lock(db)
        turn_context(db, payload)  # Recheck revision/head/ownership after generation.
        session = get_session(db, payload.session_id)
        branch = get_branch(db, session.id, payload.branch_id)
        node = ConversationNode(
            session_id=session.id,
            parent_id=payload.parent_node_id,
            turn_number=context.depth,
            user_text=payload.user_message,
            character_text=response.strip(),
            question_tag=coaching["question_type"],
            revealed_count=state["score"],
            state=state,
            coaching=coaching,
        )
        db.add(node)
        db.flush()
        branch.head_node_id = node.id
        session.score = state["score"]
        session.revision += 1
        db.flush()
        result = ChatTurnResponse(
            turn_id=node.id,
            character_response=node.character_text,
            revealed_node_score=state["score"],
            node=node_dto(node),
            session=session_dto(db, session),
        ).model_dump()
        return finish(db, key, owner, 200, result)

    return mutate(db, key, "POST", "/api/chat/turn", payload.model_dump(), operation)


def create_branch(
    db: DbSession, session_id: int, payload: BranchCreateRequest, key: str
) -> tuple[int, dict]:
    path = f"/api/sessions/{session_id}/branches"

    def operation(owner: str) -> tuple[int, dict]:
        write_lock(db)
        session = get_session(db, session_id)
        source = get_branch(db, session.id, payload.source_branch_id)
        get_node(db, session.id, payload.rewind_to_node_id)
        validate_revision(session, payload.expected_revision)
        if payload.rewind_to_node_id is not None and payload.rewind_to_node_id not in {
            n.id for n in ancestor_chain(db, session.id, source.head_node_id)
        }:
            raise conflict("rewind_target_not_on_branch")
        branch = Branch(
            session_id=session.id,
            fork_node_id=payload.rewind_to_node_id,
            head_node_id=payload.rewind_to_node_id,
        )
        db.add(branch)
        db.flush()
        session.active_branch_id = branch.id
        session.score = state_at(db, session.id, branch.head_node_id)["score"]
        session.revision += 1
        db.flush()
        result = BranchCreateResponse(
            branch=branch_dto(db, branch), session=session_dto(db, session)
        ).model_dump()
        return finish(db, key, owner, 201, result)

    return mutate(db, key, "POST", path, payload.model_dump(), operation)


def select_branch(
    db: DbSession, session_id: int, payload: BranchSelectRequest, key: str
) -> tuple[int, dict]:
    path = f"/api/sessions/{session_id}/active-branch"

    def operation(owner: str) -> tuple[int, dict]:
        write_lock(db)
        session = get_session(db, session_id)
        branch = get_branch(db, session.id, payload.branch_id)
        validate_revision(session, payload.expected_revision)
        if session.active_branch_id != branch.id:
            session.active_branch_id = branch.id
            session.score = state_at(db, session.id, branch.head_node_id)["score"]
            session.revision += 1
        db.flush()
        return finish(db, key, owner, 200, session_dto(db, session))

    return mutate(db, key, "PUT", path, payload.model_dump(), operation)
