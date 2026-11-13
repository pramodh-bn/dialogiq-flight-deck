"""V3 voice reps: timed spoken practice on a normal session (contract v3-r1).

The dialogue lives in the existing session, branch and node tables. This module
adds the rep, its browser-timed events, the streamed turn and the scorecard.
Routes are built by ``build_router`` and mounted under ``/api/v3``.
"""

import json
import logging
import re
import time
from collections.abc import AsyncIterator, Callable, Iterator
from datetime import UTC, datetime
from typing import Annotated, Literal

import anyio
from fastapi import APIRouter, Path, Request
from fastapi.concurrency import iterate_in_threadpool, run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

import practice
import stance
import v3_score
from api_errors import ApiError, conflict, not_found
from conversation_context import ancestor_chain
from models import (
    ConversationNode,
    Scenario,
    User,
    VoiceEvent,
    VoiceRep,
    VoiceTurnLatency,
)
from persona import (
    PersonaInvalidResponseError,
    PersonaTimeoutError,
    PersonaUnavailableError,
    split_sentences,
)
from schemas import ChatTurnRequest, Identifier, Revision, WireModel
from seed import DEMO_USERNAME

logger = logging.getLogger("dialogiq.v3")

DURATION_LIMIT_MS = 180_000
MAX_REP_MS = 600_000  # a rep may overrun its limit; nothing later is believable
WHISPER_RULESET = "v3-whisper-r1"
MAX_EVENTS_PER_CALL = 200
StreamProvider = Callable[..., Iterator[str]]
Millis = Annotated[int, Field(strict=True, ge=0, le=MAX_REP_MS)]

PERSONA_ERROR_CODES: tuple[tuple[type[Exception], str], ...] = (
    (PersonaTimeoutError, "persona_timeout"),
    (PersonaInvalidResponseError, "persona_invalid_response"),
    (PersonaUnavailableError, "persona_unavailable"),
)

EventKind = Literal[
    "learner_speech_start",
    "learner_speech_end",
    "bob_audio_start",
    "bob_audio_end",
    "whisper_shown",
    "suggestion_shown",
]
# Fields each kind must carry, and may carry; anything else is rejected.
EVENT_FIELDS: dict[str, tuple[set[str], set[str]]] = {
    "learner_speech_start": (set(), set()),
    "learner_speech_end": (set(), set()),
    "bob_audio_start": ({"node_id"}, set()),
    "bob_audio_end": ({"node_id"}, {"interrupted"}),
    "whisper_shown": ({"rule", "trigger_ms"}, set()),
    "suggestion_shown": ({"trigger_ms"}, set()),
}
EVENT_EXTRAS = ("node_id", "interrupted", "rule", "trigger_ms")


class RepCreateRequest(WireModel):
    scenario_id: Identifier


class VoiceTurnRequest(WireModel):
    branch_id: Identifier
    parent_node_id: Identifier | None
    expected_revision: Revision
    user_message: str = Field(min_length=1, max_length=4000)
    speech_start_ms: Millis
    speech_end_ms: Millis

    @field_validator("user_message", mode="before")
    @classmethod
    def trim_message(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def speech_is_ordered(self) -> "VoiceTurnRequest":
        if self.speech_end_ms < self.speech_start_ms:
            raise ValueError("speech_end_ms is before speech_start_ms")
        return self


class EventIn(WireModel):
    seq: int = Field(strict=True, ge=1, le=1_000_000)
    t_ms: Millis
    kind: EventKind
    node_id: Identifier | None = None
    interrupted: bool | None = None
    rule: str | None = Field(default=None, min_length=1, max_length=40)
    trigger_ms: Millis | None = None

    @model_validator(mode="after")
    def fields_match_kind(self) -> "EventIn":
        required, optional = EVENT_FIELDS[self.kind]
        present = {name for name in EVENT_EXTRAS if getattr(self, name) is not None}
        if not required <= present or not present <= required | optional:
            raise ValueError("fields do not match the event kind")
        return self

    def extras(self) -> dict:
        return {
            name: getattr(self, name)
            for name in EVENT_EXTRAS
            if getattr(self, name) is not None
        }


class EventsRequest(WireModel):
    events: list[EventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_CALL)


class ClassifyRequest(WireModel):
    user_message: str = Field(min_length=1, max_length=4000)


class FinishRequest(WireModel):
    duration_ms: int = Field(strict=True, ge=1, le=MAX_REP_MS)


def get_rep(db: DbSession, rep_id: int) -> VoiceRep:
    rep = db.get(VoiceRep, rep_id)
    if rep is None:
        raise not_found("rep")
    return rep


def latency_rows(db: DbSession, rep: VoiceRep) -> list[dict]:
    """One row per saved turn, oldest first.

    ``model_*`` are timed by the server around the model call.
    ``voice_round_trip_ms`` runs from the learner's last word to Bob's first
    audio, both on the browser's clock; it is null when that audio never
    started or its event was not logged.
    """
    audio_start: dict[int, int] = {}
    for event in db.scalars(
        select(VoiceEvent)
        .where(VoiceEvent.rep_id == rep.id, VoiceEvent.kind == "bob_audio_start")
        .order_by(VoiceEvent.t_ms, VoiceEvent.seq)
    ):
        audio_start.setdefault(event.data.get("node_id"), event.t_ms)
    rows = []
    for row in db.scalars(
        select(VoiceTurnLatency)
        .where(VoiceTurnLatency.rep_id == rep.id)
        .order_by(VoiceTurnLatency.id)
    ):
        started = audio_start.get(row.node_id)
        round_trip = None if started is None else started - row.speech_end_ms
        rows.append(
            {
                "node_id": row.node_id,
                "model_first_sentence_ms": row.model_first_sentence_ms,
                "model_total_ms": row.model_total_ms,
                "voice_round_trip_ms": (
                    round_trip if round_trip is not None and round_trip >= 0 else None
                ),
            }
        )
    return rows


WHISPER_LIMIT_MS = 2000


def whisper_latency(db: DbSession, rep: VoiceRep) -> dict:
    """How long whispers took to appear, from their trigger to being visible.

    The launch blocker (contract v3-r1) is that at least 90% of whispers appear
    within 2000 ms of their trigger. ``within_limit`` is null with no whispers.
    """
    gaps = sorted(
        max(0, event.t_ms - event.data["trigger_ms"])
        for event in db.scalars(
            select(VoiceEvent).where(
                VoiceEvent.rep_id == rep.id, VoiceEvent.kind == "whisper_shown"
            )
        )
        if isinstance(event.data.get("trigger_ms"), int)
    )
    within = sum(1 for gap in gaps if gap <= WHISPER_LIMIT_MS)
    return {
        "shown": len(gaps),
        "within_limit": within,
        "limit_ms": WHISPER_LIMIT_MS,
        "median_ms": gaps[len(gaps) // 2] if gaps else None,
        "max_ms": gaps[-1] if gaps else None,
    }


def rep_dto(db: DbSession, rep: VoiceRep) -> dict:
    return {
        "rep_id": rep.id,
        "rep_number": rep.rep_number,
        "session_id": rep.session_id,
        "scenario_id": rep.scenario_id,
        "started_at": rep.started_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "duration_ms": rep.duration_ms,
        "finished": rep.scorecard is not None,
        "score_ruleset": rep.score_ruleset,
        "scorecard": rep.scorecard,
        "latency": latency_rows(db, rep),
        "whisper_latency": whisper_latency(db, rep),
    }


def create_rep(db: DbSession, payload: RepCreateRequest, key: str) -> tuple[int, dict]:
    def operation(owner: str) -> tuple[int, dict]:
        practice.write_lock(db)
        # Always the deterministic judge and rule-based stance; never semantic.
        session = practice.new_session(
            db, payload.scenario_id, stance.BEHAVIOR_REVISION
        )
        earlier = db.scalar(
            select(func.count(VoiceRep.id)).where(
                VoiceRep.user_id == session.user_id,
                VoiceRep.scenario_id == session.scenario_id,
            )
        )
        rep = VoiceRep(
            session_id=session.id,
            user_id=session.user_id,
            scenario_id=session.scenario_id,
            rep_number=earlier + 1,
            started_at=datetime.now(UTC).replace(tzinfo=None, microsecond=0),
            score_ruleset=v3_score.RULESET,
            whisper_ruleset=WHISPER_RULESET,
        )
        db.add(rep)
        db.flush()
        result = {
            "rep_id": rep.id,
            "rep_number": rep.rep_number,
            "session": practice.session_dto(db, session),
            "duration_limit_ms": DURATION_LIMIT_MS,
            "score_ruleset": rep.score_ruleset,
            "whisper_ruleset": rep.whisper_ruleset,
            "opening_message": session.scenario_config["persona"]["opening_message"],
        }
        return practice.finish(db, key, owner, 201, result)

    return practice.mutate(
        db, key, "POST", "/api/v3/reps", payload.model_dump(), operation
    )


def record_events(
    db: DbSession, rep_id: int, payload: EventsRequest, key: str
) -> tuple[int, dict]:
    def operation(owner: str) -> tuple[int, dict]:
        practice.write_lock(db)
        rep = get_rep(db, rep_id)
        if rep.scorecard is not None:
            raise conflict("rep_finished")
        held = set(
            db.scalars(select(VoiceEvent.seq).where(VoiceEvent.rep_id == rep.id))
        )
        accepted = 0
        for event in payload.events:
            if event.seq in held:
                continue  # a resent batch, or a repeat inside this one
            held.add(event.seq)
            accepted += 1
            db.add(
                VoiceEvent(
                    rep_id=rep.id,
                    seq=event.seq,
                    t_ms=event.t_ms,
                    kind=event.kind,
                    data=event.extras(),
                )
            )
        db.flush()
        result = {"accepted": accepted, "last_seq": max(held)}
        return practice.finish(db, key, owner, 200, result)

    return practice.mutate(
        db,
        key,
        "POST",
        f"/api/v3/reps/{rep_id}/events",
        payload.model_dump(),
        operation,
    )


def score_inputs(db: DbSession, rep: VoiceRep) -> tuple[list, list, list]:
    """Stored events, turns and rewind pairs in the shape ``score_rep`` takes."""
    session = practice.get_session(db, rep.session_id)
    branch = practice.get_branch(db, session.id, session.active_branch_id)
    selected = {n.id for n in ancestor_chain(db, session.id, branch.head_node_id)}
    nodes = list(
        db.scalars(
            select(ConversationNode)
            .where(ConversationNode.session_id == session.id)
            .order_by(ConversationNode.id)
        )
    )
    score_of = {node.id: node.state["score"] for node in nodes}
    turns = [
        {
            "node_id": node.id,
            "text": node.user_text or "",
            "revealed_new": node.state["score"] > score_of.get(node.parent_id, 0),
            "stance_after": node.state["resistance"],
            "selected": node.id in selected,
        }
        for node in nodes
    ]
    # Turns sharing a parent are attempts at the same moment: the first is the
    # original and every later one a retry of it.
    first_attempt: dict[int | None, int] = {}
    rewinds = []
    for node in nodes:
        original = first_attempt.setdefault(node.parent_id, node.id)
        if original != node.id:
            rewinds.append({"original_node_id": original, "retry_node_id": node.id})
    events = [
        {"seq": event.seq, "t_ms": event.t_ms, "kind": event.kind, **event.data}
        for event in db.scalars(
            select(VoiceEvent)
            .where(VoiceEvent.rep_id == rep.id)
            .order_by(VoiceEvent.seq)
        )
    ]
    return events, turns, rewinds


def finish_rep(
    db: DbSession, rep_id: int, payload: FinishRequest, key: str
) -> tuple[int, dict]:
    def operation(owner: str) -> tuple[int, dict]:
        practice.write_lock(db)
        rep = get_rep(db, rep_id)
        if rep.scorecard is None:  # finishing twice returns the stored result
            events, turns, rewinds = score_inputs(db, rep)
            rep.scorecard = v3_score.score_rep(
                events=events,
                turns=turns,
                rewinds=rewinds,
                duration_ms=payload.duration_ms,
            )
            rep.duration_ms = payload.duration_ms
            db.flush()
        return practice.finish(db, key, owner, 200, {"rep": rep_dto(db, rep)})

    return practice.mutate(
        db,
        key,
        "POST",
        f"/api/v3/reps/{rep_id}/finish",
        payload.model_dump(),
        operation,
    )


def list_reps(db: DbSession, scenario_id: int) -> list[dict]:
    if db.get(Scenario, scenario_id) is None:
        raise not_found("scenario")
    demo_id = db.scalar(select(User.id).where(User.username == DEMO_USERNAME))
    reps = db.scalars(
        select(VoiceRep)
        .where(VoiceRep.scenario_id == scenario_id, VoiceRep.user_id == demo_id)
        .order_by(VoiceRep.rep_number, VoiceRep.id)
    )
    return [rep_dto(db, rep) for rep in reps]


def sse(event: str, data: dict) -> str:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {body}\n\n"


def persona_error_code(error: Exception) -> str | None:
    return next(
        (code for kind, code in PERSONA_ERROR_CODES if isinstance(error, kind)), None
    )


def replay_stream(done: dict) -> Iterator[str]:
    """A saved turn, sent again in the same shape as the first time."""
    sentences, _rest = split_sentences(done["node"]["character_text"], final=True)
    for index, text in enumerate(sentences):
        yield sse("sentence", {"index": index, "text": text})
    yield sse("done", done)


def open_turn(
    session_factory: Callable[[], DbSession],
    rep_id: int,
    payload: VoiceTurnRequest,
    key: str,
    provider: StreamProvider,
) -> Iterator[str]:
    """Start one streamed voice turn and return its event stream.

    Everything that can fail before Bob's first sentence fails here, as a
    normal error with nothing saved. The returned generator then streams the
    remaining sentences, saves the turn once the reply is complete and ends
    with ``done``; a later failure ends it with ``error`` and saves nothing.
    The generator owns its database session, because the request's own
    session may be closed before a streamed body is sent.
    """
    db = session_factory()
    owner = ""
    sentences: Iterator[str] | None = None
    try:
        rep = get_rep(db, rep_id)
        if rep.scorecard is not None:
            raise conflict("rep_finished")
        chat = ChatTurnRequest(
            session_id=rep.session_id,
            branch_id=payload.branch_id,
            parent_node_id=payload.parent_node_id,
            expected_revision=payload.expected_revision,
            user_message=payload.user_message,
        )
        owner, replay = practice.reserve(
            db, key, "POST", f"/api/v3/reps/{rep_id}/turns", payload.model_dump()
        )
        if replay:
            db.close()
            return replay_stream(replay[1])
        prepared = practice.prepare_turn(db, chat)
        asked = time.monotonic()
        sentences = iter(provider(**prepared.provider_kwargs))
        first = next(sentences, None)
        first_ms = round((time.monotonic() - asked) * 1000)
        if first is None:
            raise PersonaInvalidResponseError("Persona returned no dialogue.")
    except BaseException:
        close = getattr(sentences, "close", None)
        if callable(close):
            close()
        if owner:
            practice.release(db, key, owner)
        db.close()
        raise

    def stream() -> Iterator[str]:
        spoken = [first]
        try:
            yield sse("sentence", {"index": 0, "text": first})
            for text in sentences:
                spoken.append(text)
                yield sse("sentence", {"index": len(spoken) - 1, "text": text})
            total_ms = round((time.monotonic() - asked) * 1000)
            node, session = practice.save_turn(
                db,
                chat,
                prepared.context,
                prepared.state,
                prepared.coaching,
                " ".join(spoken),
            )
            db.add(
                VoiceTurnLatency(
                    rep_id=rep_id,
                    node_id=node.id,
                    speech_end_ms=payload.speech_end_ms,
                    model_first_sentence_ms=first_ms,
                    model_total_ms=total_ms,
                )
            )
            spoken_type = v3_score.classify_spoken(chat.user_message)
            done = {
                "node": practice.node_dto(node),
                "session": practice.session_dto(db, session),
                "turn": {
                    "question_type": spoken_type["type"],
                    "leading": spoken_type["leading"],
                    "meaning": spoken_type["meaning"],
                    "deflection": not prepared.newly
                    and prepared.state["resistance"] == "guarded",
                },
            }
            practice.finish(db, key, owner, 200, done)
            yield sse("done", done)
        except GeneratorExit:
            # The learner spoke over Bob or left: an unsaved turn is dropped.
            practice.release(db, key, owner)
            raise
        except Exception as error:  # noqa: BLE001 - the stream must end with an event
            practice.release(db, key, owner)
            code = persona_error_code(error)
            if code is None and isinstance(error, ApiError):
                code = error.detail["code"]
            if code is None:
                # Never log the exception text: it may hold a prompt or a reply.
                logger.error("Voice turn failed with %s", type(error).__name__)
                code = "internal_error"
            retryable = code.startswith("persona_")
            yield sse("error", {"code": code, "retryable": retryable})
        finally:
            close = getattr(sentences, "close", None)
            if callable(close):
                close()
            db.close()

    return stream()


async def closing_stream(events: Iterator[str]) -> AsyncIterator[str]:
    """Send a turn's events and close its generator as soon as sending stops.

    When the learner speaks over Bob or leaves, the response is cancelled
    mid-stream. Left alone, the generator would keep its idempotency lease
    and database session until garbage collection got to it.
    """
    try:
        async for chunk in iterate_in_threadpool(events):
            yield chunk
    finally:
        close = getattr(events, "close", None)
        if callable(close):
            with anyio.CancelScope(shield=True):
                try:
                    await run_in_threadpool(close)
                except ValueError:
                    # Still running in a worker thread; it ends on its own.
                    pass


def build_router(db_dep: object, key_dep: object) -> APIRouter:
    """Routes under ``/api/v3``, using the application's own dependencies."""
    router = APIRouter(prefix="/api/v3")
    rep_path = Annotated[int, Path(gt=0, le=2**53 - 1)]

    def reply(result: tuple[int, dict]) -> JSONResponse:
        return JSONResponse(status_code=result[0], content=result[1])

    @router.post("/reps", status_code=201)
    def create(payload: RepCreateRequest, key: key_dep, db: db_dep) -> JSONResponse:  # type: ignore[valid-type]
        return reply(create_rep(db, payload, key))

    @router.get("/reps")
    def reps(request: Request, db: db_dep) -> list[dict]:  # type: ignore[valid-type]
        query = request.query_params
        values = query.getlist("scenario_id")
        if (
            set(query) != {"scenario_id"}
            or len(values) != 1
            or not re.fullmatch(r"[1-9][0-9]{0,15}", values[0])
        ):
            raise ApiError(422, "validation_error", "A scenario_id query is required.")
        return list_reps(db, int(values[0]))

    @router.post("/reps/{rep_id}/turns")
    def turn(
        rep_id: rep_path,  # type: ignore[valid-type]
        payload: VoiceTurnRequest,
        key: key_dep,  # type: ignore[valid-type]
        request: Request,
    ) -> StreamingResponse:
        state = request.app.state
        events = open_turn(
            state.session_factory, rep_id, payload, key, state.stream_provider
        )
        return StreamingResponse(
            closing_stream(events),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.post("/classify")
    def classify(payload: ClassifyRequest) -> dict:
        """Question type of one utterance, with no model call and nothing saved.

        The browser asks this in parallel with the turn so a whisper can appear
        long before Bob's reply (contract v3-r1, whisper latency).
        """
        found = v3_score.classify_spoken(payload.user_message)
        return {
            "question_type": found["type"],
            "leading": found["leading"],
            "meaning": found["meaning"],
            "ruleset": found["ruleset"],
        }

    @router.post("/reps/{rep_id}/events")
    def events(
        rep_id: rep_path,  # type: ignore[valid-type]
        payload: EventsRequest,
        key: key_dep,  # type: ignore[valid-type]
        db: db_dep,  # type: ignore[valid-type]
    ) -> JSONResponse:
        return reply(record_events(db, rep_id, payload, key))

    @router.post("/reps/{rep_id}/finish")
    def finish(
        rep_id: rep_path,  # type: ignore[valid-type]
        payload: FinishRequest,
        key: key_dep,  # type: ignore[valid-type]
        db: db_dep,  # type: ignore[valid-type]
    ) -> JSONResponse:
        return reply(finish_rep(db, rep_id, payload, key))

    return router
