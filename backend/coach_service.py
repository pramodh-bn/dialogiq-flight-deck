"""Coach hint service: attempts, cache, leases, provider calls, fallback.

CS-43 implementation of the accepted s3-coach-r2 coach flow plus the adopted
provider delta s3-coach-r2.token-2048.1. Provider calls never hold a database
lock; coach failure never rolls back or fails a saved turn. No node, score,
branch, or session revision is mutated here.
"""

from __future__ import annotations

import copy
import os
import threading
import time
from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from api_errors import ApiError, conflict
from coach import (
    CoachCompletion,
    CoachError,
    CoachNotConfiguredError,
    CoachTimeoutError,
    CoachUnavailableError,
    MetaCoachClient,
    parse_coach_output,
)
from coach_context import (
    CONTRACT_REVISION,
    build_coach_context,
    build_coach_system_prompt,
    serialize_coach_context,
)
from conversation_context import ancestor_chain
from models import Branch, CoachHint, CoachSlotLease, IdempotencyRecord, Session
from practice import (
    finish,
    get_branch,
    get_node,
    get_session,
    reserve,
    state_at,
    validate_revision,
    write_lock,
)
from schemas import (
    CoachHintRequest,
    CoachHintResponse,
    CoachHintsGetResponse,
    HeadHint,
    Hint,
)

COACH_LEASE_SECONDS = 30
COACH_PROVIDER_WAIT_SECONDS = 8.0
COACH_FALLBACK_DEADLINE_SECONDS = 10.0
COACH_HEARTBEAT_SECONDS = 5.0
DEMO_WAIT_ENV_VAR = "COACH_DEMO_WAIT"
LATENCY_SATURATION_MS = 10000
EFFECTIVE_PROVIDER_DELTA = "s3-coach-r2.token-2048.1"

CoachProvider = Callable[[str, str], CoachCompletion]

_FALLBACK_ROOT = {
    "approach": "Start with a low-pressure invitation.",
    "example": "Is now an okay time to talk, or would later be better?",
    "reason": "Giving a choice can make it easier to begin.",
}
_FALLBACK_FIRST = {
    "approach": "Pause and invite their perspective.",
    "example": "I may be missing something. What would you like me to understand?",
    "reason": "An invitation leaves room for their account without assuming their reasons.",
}
_FALLBACK_ROTATE_A = {
    "approach": "Ask permission for one small question.",
    "example": "Would it be okay if I asked one thing, or should we stop here?",
    "reason": "Permission gives the other person a clear way to set a boundary.",
}
_FALLBACK_ROTATE_B = {
    "approach": "Invite them to correct your understanding.",
    "example": "I may be reading this wrong. Is there anything you want to correct?",
    "reason": "Checking your interpretation avoids assuming you know their reasons.",
}


def _monotonic() -> float:
    """Monotonic clock indirection so tests can stage elapsed time."""
    return time.monotonic()


def demo_wait_enabled(explicit: bool | None = None) -> bool:
    """True only for demo-wait mode: exact env "1", or an explicit opt-in.

    An explicit argument always wins so tests can force either mode
    without touching the process environment; routes pass nothing and
    follow the paired backend flag exactly.
    """
    if explicit is not None:
        return explicit
    return os.environ.get(DEMO_WAIT_ENV_VAR) == "1"


def real_coach_provider(system_prompt: str, context_json: str) -> CoachCompletion:
    """Production Meta call; the client is built per request from current env."""
    if demo_wait_enabled():
        return MetaCoachClient().respond(
            system_prompt=system_prompt, context_json=context_json, timeout=None
        )
    return MetaCoachClient().respond(
        system_prompt=system_prompt, context_json=context_json
    )


def _slot(head_node_id: int | None) -> int:
    """Explicit null-root slot key; node IDs are positive, so 0 means root."""
    return head_node_id if head_node_id is not None else 0


def _not_eligible() -> ApiError:
    return ApiError(
        422,
        "hint_not_eligible",
        "Automatic help is not available at this position.",
        retryable=False,
    )


def _not_ready() -> ApiError:
    return ApiError(
        409,
        "hint_not_ready",
        "Save the first hint before requesting another approach.",
        retryable=True,
    )


def _bad_attempt() -> ApiError:
    return ApiError(422, "validation_error", "Invalid request.", retryable=False)


def _in_progress() -> ApiError:
    return ApiError(
        409, "request_in_progress", "This request is still running.", retryable=True
    )


def _saved_hint(
    db: DbSession,
    session_id: int,
    branch_id: int,
    head_node_id: int | None,
    attempt: int,
) -> CoachHint | None:
    return db.scalar(
        select(CoachHint).where(
            CoachHint.session_id == session_id,
            CoachHint.branch_id == branch_id,
            CoachHint.head_slot == _slot(head_node_id),
            CoachHint.contract_revision == CONTRACT_REVISION,
            CoachHint.attempt == attempt,
        )
    )


def _slot_lease(
    db: DbSession,
    session_id: int,
    branch_id: int,
    head_node_id: int | None,
    attempt: int,
) -> CoachSlotLease | None:
    return db.scalar(
        select(CoachSlotLease).where(
            CoachSlotLease.session_id == session_id,
            CoachSlotLease.branch_id == branch_id,
            CoachSlotLease.head_slot == _slot(head_node_id),
            CoachSlotLease.contract_revision == CONTRACT_REVISION,
            CoachSlotLease.attempt == attempt,
        )
    )


def _require_automatic_eligible(
    db: DbSession, session_id: int, head_node_id: int | None
) -> None:
    if head_node_id is None:
        raise _not_eligible()
    node = get_node(db, session_id, head_node_id)
    assert node is not None
    score = state_at(db, session_id, head_node_id)["score"]
    parent_score = (
        state_at(db, session_id, node.parent_id)["score"]
        if node.parent_id is not None
        else 0
    )
    if score != parent_score or score >= 7:
        raise _not_eligible()


def _validate_action(
    db: DbSession, session_id: int, payload: CoachHintRequest
) -> tuple[Session, Branch]:
    session = get_session(db, session_id)
    branch = get_branch(db, session.id, payload.branch_id)
    get_node(db, session.id, payload.head_node_id)
    validate_revision(session, payload.expected_revision)
    if session.active_branch_id != branch.id:
        raise conflict("inactive_branch")
    if branch.head_node_id != payload.head_node_id:
        raise conflict("parent_mismatch")
    if payload.attempt == 2:
        if payload.trigger != "requested":
            raise _bad_attempt()
        if _saved_hint(db, session.id, branch.id, payload.head_node_id, 1) is None:
            raise _not_ready()
    if payload.trigger == "automatic":
        _require_automatic_eligible(db, session.id, payload.head_node_id)
    return session, branch


def _claim_slot_lease(
    db: DbSession,
    session_id: int,
    branch_id: int,
    payload: CoachHintRequest,
    key: str,
    owner: str,
) -> None:
    write_lock(db)
    lease = _slot_lease(
        db, session_id, branch_id, payload.head_node_id, payload.attempt
    )
    if lease is not None and lease.expires_at > time.time():
        db.rollback()
        db.execute(
            delete(IdempotencyRecord).where(
                IdempotencyRecord.key == key,
                IdempotencyRecord.owner == owner,
                IdempotencyRecord.status.is_(None),
            )
        )
        db.commit()
        raise _in_progress()
    if lease is not None:
        db.delete(lease)
        db.flush()
    db.add(
        CoachSlotLease(
            session_id=session_id,
            branch_id=branch_id,
            head_slot=_slot(payload.head_node_id),
            contract_revision=CONTRACT_REVISION,
            attempt=payload.attempt,
            owner=owner,
            expires_at=time.time() + COACH_LEASE_SECONDS,
        )
    )
    db.commit()


def _release_owned(db: DbSession, key: str, owner: str) -> None:
    db.rollback()
    db.execute(
        delete(IdempotencyRecord).where(
            IdempotencyRecord.key == key,
            IdempotencyRecord.owner == owner,
            IdempotencyRecord.status.is_(None),
        )
    )
    db.execute(delete(CoachSlotLease).where(CoachSlotLease.owner == owner))
    db.commit()


def renew_owned_leases(
    db: DbSession,
    key: str,
    owner: str,
    session_id: int,
    branch_id: int,
    head_node_id: int | None,
    attempt: int,
) -> bool:
    """Extend one live generation's pending UUID and slot leases by 30s.

    Both rows move atomically to 30s after renewal, only while both are
    present, pending, unexpired, and owned by this generation. Anything
    else — missing, finished, foreign, or already expired — returns False
    without touching either row, so a heartbeat never creates, reclaims,
    or resurrects ownership. Any database failure also returns False.
    """
    try:
        write_lock(db)
        record = db.get(IdempotencyRecord, key)
        lease = _slot_lease(db, session_id, branch_id, head_node_id, attempt)
        now = time.time()
        if (
            record is None
            or record.owner != owner
            or record.status is not None
            or record.expires_at <= now
            or lease is None
            or lease.owner != owner
            or lease.expires_at <= now
        ):
            db.rollback()
            return False
        record.expires_at = now + COACH_LEASE_SECONDS
        lease.expires_at = now + COACH_LEASE_SECONDS
        db.commit()
        return True
    except Exception:  # noqa: BLE001 - a failed heartbeat abandons, never raises
        db.rollback()
        return False


def _earlier_hint_rows(
    db: DbSession,
    session_id: int,
    branch_id: int,
    head_node_id: int | None,
    attempt: int,
) -> list[CoachHint]:
    """Strict-ancestor hints plus same-head attempt1 when generating attempt2.

    Ordered by ancestry position (root first), then attempt, so same-head
    attempt1 sorts last for attempt2 generation.
    """
    chain = ancestor_chain(db, session_id, head_node_id)
    positions: dict[int | None, int] = {None: 0}
    for index, node in enumerate(chain, start=1):
        positions[node.id] = index
    rows = list(
        db.scalars(
            select(CoachHint).where(
                CoachHint.session_id == session_id,
                CoachHint.branch_id == branch_id,
                CoachHint.contract_revision == CONTRACT_REVISION,
            )
        )
    )
    current = set(positions) - {head_node_id}
    earlier = [row for row in rows if row.head_node_id in current]
    if attempt == 2:
        same_first = _saved_hint(db, session_id, branch_id, head_node_id, 1)
        if same_first is not None:
            earlier.append(same_first)
    earlier.sort(key=lambda row: (positions[row.head_node_id], row.attempt, row.id))
    return earlier


def _fallback_fields(
    count: int, head_node_id: int | None, attempt: int
) -> dict[str, str]:
    if head_node_id is None and attempt == 1:
        return dict(_FALLBACK_ROOT)
    if count == 0:
        return dict(_FALLBACK_FIRST)
    if count % 2 == 1:
        return dict(_FALLBACK_ROTATE_A)
    return dict(_FALLBACK_ROTATE_B)


def _prepare_provider_input(
    db: DbSession, session: Session, branch: Branch, payload: CoachHintRequest
) -> tuple[str, str, dict[str, str]]:
    config = copy.deepcopy(session.scenario_config)
    persona = config["persona"]
    chain = ancestor_chain(db, session.id, payload.head_node_id)
    earlier = _earlier_hint_rows(
        db, session.id, branch.id, payload.head_node_id, payload.attempt
    )
    previous = [
        {"approach": row.approach, "example": row.example, "reason": row.reason}
        for row in earlier[-2:]
    ]
    context = build_coach_context(
        persona_name=persona["name"],
        persona_role=persona["role"],
        opening_message=persona["opening_message"],
        learner_situation=persona["public_context"],
        turns=[(node.user_text or "", node.character_text or "") for node in chain],
        previous_hints=previous,
    )
    system_prompt = build_coach_system_prompt(persona["name"], persona["role"])
    fallback = _fallback_fields(len(earlier), payload.head_node_id, payload.attempt)
    return system_prompt, serialize_coach_context(context), fallback


def _run_provider_boxed(
    provider: CoachProvider,
    system_prompt: str,
    context_json: str,
    box: dict[str, object],
) -> None:
    """Run one provider call, boxing its outcome for the waiting thread."""
    try:
        box["completion"] = provider(system_prompt, context_json)
    except Exception as exc:  # noqa: BLE001 - every provider failure maps below
        box["error"] = exc


def _choice_timing(
    started: float, total_seconds: float, demo_wait: bool = False
) -> tuple[int, bool]:
    """Return (latency_ms, over_total) at the moment a result is chosen."""
    elapsed = _monotonic() - started
    if not demo_wait and elapsed > total_seconds:
        return LATENCY_SATURATION_MS, True
    return min(LATENCY_SATURATION_MS, int(elapsed * 1000)), False


def _call_or_fallback(
    provider: CoachProvider,
    system_prompt: str,
    context_json: str,
    fallback_fields: dict[str, str],
    started: float,
    wait_seconds: float = COACH_PROVIDER_WAIT_SECONDS,
    total_seconds: float = COACH_FALLBACK_DEADLINE_SECONDS,
    demo_wait: bool = False,
    heartbeat: Callable[[], bool] | None = None,
    heartbeat_seconds: float = COACH_HEARTBEAT_SECONDS,
) -> tuple[dict[str, str], str, str | None, int]:
    """Run one provider call under a real wall-clock wait budget.

    The provider runs on a daemon worker holding no database resources
    while this thread joins only until ``started + wait_seconds``. A
    worker still running then is abandoned: its late outcome stays boxed
    where nobody reads it, so it can never publish. Provider failures
    map to typed fallbacks; a wrong-typed provider result counts as
    invalid_response, and any outcome chosen past ``total_seconds``
    becomes a saturated timeout fallback.

    In demo-wait mode both cutoffs are removed instead of lengthened:
    this thread joins in heartbeat-sized slices with no total deadline,
    renewing ownership each slice. A failed heartbeat raises
    request_in_progress so the generation is abandoned and its late
    outcome can never publish; wire latency still saturates at 10000.
    """
    box: dict[str, object] = {}
    worker = threading.Thread(
        target=_run_provider_boxed,
        args=(provider, system_prompt, context_json, box),
        daemon=True,
    )
    worker.start()
    if demo_wait:
        while worker.is_alive():
            worker.join(timeout=max(0.0, heartbeat_seconds))
            if worker.is_alive() and heartbeat is not None and not heartbeat():
                raise _in_progress()
    else:
        worker.join(timeout=max(0.0, started + wait_seconds - _monotonic()))
    if worker.is_alive():
        latency_ms, _ = _choice_timing(started, total_seconds, demo_wait)
        return fallback_fields, "deterministic", "timeout", latency_ms
    error = box.get("error")
    if error is None:
        completion = box.get("completion")
        if isinstance(completion, CoachCompletion):
            try:
                fields = parse_coach_output(completion.content)
            except CoachError:
                fields = None
            if fields is not None:
                latency_ms, over_total = _choice_timing(
                    started, total_seconds, demo_wait
                )
                if over_total:
                    return (
                        fallback_fields,
                        "deterministic",
                        "timeout",
                        latency_ms,
                    )
                return fields, "meta", None, latency_ms
        fields, source, reason = fallback_fields, "deterministic", "invalid_response"
    elif isinstance(error, CoachNotConfiguredError):
        fields, source, reason = fallback_fields, "deterministic", "not_configured"
    elif isinstance(error, CoachTimeoutError):
        fields, source, reason = fallback_fields, "deterministic", "timeout"
    elif isinstance(error, CoachUnavailableError):
        fields, source, reason = fallback_fields, "deterministic", "unavailable"
    else:
        fields, source, reason = fallback_fields, "deterministic", "invalid_response"
    latency_ms, _ = _choice_timing(started, total_seconds, demo_wait)
    return fields, source, reason, latency_ms


def _hint_dto(row: CoachHint) -> dict:
    return Hint(
        id=row.id,
        contract_revision=row.contract_revision,
        attempt=row.attempt,
        approach=row.approach,
        example=row.example,
        reason=row.reason,
        source=row.source,
        fallback_reason=row.fallback_reason,
        latency_ms=row.latency_ms,
    ).model_dump()


def _envelope(
    session: Session, branch: Branch, payload: CoachHintRequest, row: CoachHint
) -> dict:
    return CoachHintResponse(
        session_id=session.id,
        branch_id=branch.id,
        head_node_id=payload.head_node_id,
        revision=session.revision,
        hint=_hint_dto(row),
    ).model_dump()


def _generate(
    db: DbSession,
    session_id: int,
    payload: CoachHintRequest,
    key: str,
    owner: str,
    provider: CoachProvider,
    started: float,
    wait_seconds: float,
    total_seconds: float,
    demo_wait: bool,
    heartbeat_seconds: float,
) -> tuple[int, dict]:
    session, branch = _validate_action(db, session_id, payload)
    write_lock(db)
    saved = _saved_hint(
        db, session.id, branch.id, payload.head_node_id, payload.attempt
    )
    if saved is not None:
        session, branch = _validate_action(db, session_id, payload)
        return finish(db, key, owner, 200, _envelope(session, branch, payload, saved))
    _claim_slot_lease(db, session.id, branch.id, payload, key, owner)
    system_prompt, context_json, fallback_fields = _prepare_provider_input(
        db, session, branch, payload
    )
    db.rollback()

    def heartbeat() -> bool:
        return renew_owned_leases(
            db,
            key,
            owner,
            session_id,
            payload.branch_id,
            payload.head_node_id,
            payload.attempt,
        )

    fields, source, reason, latency_ms = _call_or_fallback(
        provider,
        system_prompt,
        context_json,
        fallback_fields,
        started,
        wait_seconds=wait_seconds,
        total_seconds=total_seconds,
        demo_wait=demo_wait,
        heartbeat=heartbeat,
        heartbeat_seconds=heartbeat_seconds,
    )
    write_lock(db)
    session, branch = _validate_action(db, session_id, payload)
    saved = _saved_hint(
        db, session.id, branch.id, payload.head_node_id, payload.attempt
    )
    if saved is not None:
        db.execute(delete(CoachSlotLease).where(CoachSlotLease.owner == owner))
        return finish(db, key, owner, 200, _envelope(session, branch, payload, saved))
    lease = _slot_lease(
        db, session.id, branch.id, payload.head_node_id, payload.attempt
    )
    if lease is None or lease.owner != owner or lease.expires_at <= time.time():
        raise _in_progress()
    row = CoachHint(
        session_id=session.id,
        branch_id=branch.id,
        head_node_id=payload.head_node_id,
        head_slot=_slot(payload.head_node_id),
        contract_revision=CONTRACT_REVISION,
        attempt=payload.attempt,
        approach=fields["approach"],
        example=fields["example"],
        reason=fields["reason"],
        source=source,
        fallback_reason=reason,
        latency_ms=latency_ms,
    )
    db.add(row)
    db.flush()
    db.execute(delete(CoachSlotLease).where(CoachSlotLease.owner == owner))
    return finish(db, key, owner, 200, _envelope(session, branch, payload, row))


def request_hint(
    db: DbSession,
    session_id: int,
    payload: CoachHintRequest,
    key: str,
    provider: CoachProvider,
    *,
    wait_seconds: float = COACH_PROVIDER_WAIT_SECONDS,
    total_seconds: float = COACH_FALLBACK_DEADLINE_SECONDS,
    demo_wait: bool | None = None,
    heartbeat_seconds: float = COACH_HEARTBEAT_SECONDS,
) -> tuple[int, dict]:
    """Run one coach-hint action: replay, cache, generate, or safe fallback.

    Latency is measured from entry here until the result or fallback is
    chosen. Tests scale the wait/total budgets down; production routes
    always use the 8/10-second defaults. Demo-wait mode follows the
    COACH_DEMO_WAIT flag unless forced explicitly: no wait/total cutoff,
    with ownership heartbeated until the provider answers or fails.
    """
    started = _monotonic()
    demo = demo_wait_enabled(demo_wait)
    path = f"/api/sessions/{session_id}/coach-hints"
    owner, replay = reserve(
        db, key, "POST", path, payload.model_dump(), COACH_LEASE_SECONDS
    )
    if replay:
        return replay
    try:
        return _generate(
            db,
            session_id,
            payload,
            key,
            owner,
            provider,
            started,
            wait_seconds,
            total_seconds,
            demo,
            heartbeat_seconds,
        )
    except Exception:
        _release_owned(db, key, owner)
        raise


def list_hints(db: DbSession, session_id: int, branch_id: int) -> dict:
    """Return this branch's persisted hints on its current ancestry, root first."""
    session = get_session(db, session_id)
    branch = get_branch(db, session.id, branch_id)
    chain = ancestor_chain(db, session.id, branch.head_node_id)
    positions: dict[int | None, int] = {None: 0}
    for index, node in enumerate(chain, start=1):
        positions[node.id] = index
    rows = [
        row
        for row in db.scalars(
            select(CoachHint).where(
                CoachHint.session_id == session.id,
                CoachHint.branch_id == branch.id,
            )
        )
        if row.head_node_id in positions
    ]
    rows.sort(
        key=lambda row: (
            positions[row.head_node_id],
            row.contract_revision,
            row.attempt,
            row.id,
        )
    )
    return CoachHintsGetResponse(
        session_id=session.id,
        branch_id=branch.id,
        head_node_id=branch.head_node_id,
        revision=session.revision,
        hints=[
            HeadHint(head_node_id=row.head_node_id, hint=_hint_dto(row)) for row in rows
        ],
    ).model_dump()


def new_request_owner() -> str:
    """Mint an owner token for tests that seed reservations directly."""
    return str(uuid4())
