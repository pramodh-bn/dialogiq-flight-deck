"""DialogIQ practice API: explicit DTOs, durable mutations and safe errors."""

import logging
import os
import re
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker
from starlette.middleware.base import RequestResponseEndpoint

import practice
from api_errors import ApiError, not_found
from database import engine
from migrations import initialize_database
from models import Scenario, Session, User
from persona import (
    PersonaInvalidResponseError,
    PersonaTimeoutError,
    PersonaUnavailableError,
)
from schemas import (
    BranchCreateRequest,
    BranchCreateResponse,
    BranchSelectRequest,
    ChatTurnRequest,
    ChatTurnResponse,
    ScenarioResponse,
    SessionCreateRequest,
    SessionResponse,
    TreeResponse,
)
from seed import DEMO_USERNAME

IdPath = Annotated[int, Path(gt=0, le=2**53 - 1)]
logger = logging.getLogger("dialogiq.api")


def request_db(request: Request) -> Iterator[DbSession]:
    with request.app.state.session_factory() as db:
        if request.method == "GET":
            # sqlite3 otherwise permits mixed snapshots across separate SELECTs.
            db.connection().exec_driver_sql("BEGIN")
        yield db


def provider_dependency(request: Request) -> practice.Provider:
    return request.app.state.provider


def idempotency_key(request: Request) -> str:
    values = request.headers.getlist("Idempotency-Key")
    value = values[0] if len(values) == 1 else ""
    try:
        if str(UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        raise ApiError(
            422, "validation_error", "A canonical Idempotency-Key UUID is required."
        ) from None
    return value


DbDep = Annotated[DbSession, Depends(request_db)]
KeyDep = Annotated[str, Depends(idempotency_key)]
ProviderDep = Annotated[practice.Provider, Depends(provider_dependency)]


def reply(result: tuple[int, dict]) -> JSONResponse:
    status, body = result
    return JSONResponse(status_code=status, content=body)


def create_app(
    db_engine: Engine = engine, provider: practice.Provider | None = None
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        initialize_database(db_engine)
        yield

    application = FastAPI(title="DialogIQ API", version="2.0.0", lifespan=lifespan)
    application.state.session_factory = sessionmaker(
        bind=db_engine, expire_on_commit=False
    )
    application.state.provider = provider or practice.real_persona

    @application.middleware("http")
    async def safe_failures(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        try:
            return await call_next(request)
        except Exception as error:  # noqa: BLE001 - sanitize all unexpected API-boundary failures
            # Never log the exception string/trace or a provider prompt/response.
            logger.error("Unhandled request failure of type %s", type(error).__name__)
            return JSONResponse(
                status_code=500,
                content={
                    "detail": {
                        "code": "internal_error",
                        "message": "Request could not be completed.",
                        "retryable": False,
                    }
                },
            )

    @application.exception_handler(ApiError)
    async def api_failure(request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @application.exception_handler(RequestValidationError)
    async def validation_failure(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "validation_error",
                    "message": "Invalid request.",
                    "retryable": False,
                }
            },
        )

    for error_type, status, code, message in (
        (
            PersonaUnavailableError,
            503,
            "persona_unavailable",
            "Persona service is unavailable.",
        ),
        (PersonaTimeoutError, 504, "persona_timeout", "Persona response timed out."),
        (
            PersonaInvalidResponseError,
            502,
            "persona_invalid_response",
            "Persona response could not be generated.",
        ),
    ):

        def handler_for(
            http_status: int, error_code: str, safe_message: str
        ) -> Callable[[Request, Exception], Awaitable[Response]]:
            async def handler(request: Request, error: Exception) -> JSONResponse:
                return JSONResponse(
                    status_code=http_status,
                    content={
                        "detail": {
                            "code": error_code,
                            "message": safe_message,
                            "retryable": True,
                        }
                    },
                )

            return handler

        application.add_exception_handler(
            error_type, handler_for(status, code, message)
        )

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "healthy", "service": "dialogiq-backend"}

    @application.get("/api/scenarios", response_model=list[ScenarioResponse])
    def scenarios(db: DbDep) -> list[dict]:
        return [
            practice.scenario_dto(s)
            for s in db.scalars(select(Scenario).order_by(Scenario.id))
        ]

    @application.get("/api/scenarios/{scenario_id}", response_model=ScenarioResponse)
    def scenario(scenario_id: IdPath, db: DbDep) -> dict:
        item = db.get(Scenario, scenario_id)
        if item is None:
            raise not_found("scenario")
        return practice.scenario_dto(item)

    @application.post("/api/sessions", response_model=SessionResponse, status_code=201)
    def create(payload: SessionCreateRequest, key: KeyDep, db: DbDep) -> JSONResponse:
        return reply(practice.create_session(db, payload.scenario_id, key))

    @application.get("/api/sessions", response_model=list[SessionResponse])
    def sessions(request: Request, db: DbDep) -> list[dict]:
        query = request.query_params
        values = query.getlist("scenario_id")
        if (
            set(query) != {"scenario_id"}
            or len(values) != 1
            or len(values[0]) > 16
            or not re.fullmatch(r"[0-9]+", values[0])
        ):
            raise ApiError(422, "validation_error", "A scenario_id query is required.")
        scenario_id = int(values[0])
        if scenario_id < 1 or scenario_id > 2**53 - 1:
            raise ApiError(422, "validation_error", "Invalid scenario_id.")
        if db.get(Scenario, scenario_id) is None:
            raise not_found("scenario")
        demo_id = db.scalar(select(User.id).where(User.username == DEMO_USERNAME))
        items = db.scalars(
            select(Session)
            .where(Session.scenario_id == scenario_id, Session.user_id == demo_id)
            .order_by(Session.created_at.desc(), Session.id.desc())
        )
        return [practice.session_dto(db, item) for item in items]

    @application.get("/api/sessions/{session_id}", response_model=SessionResponse)
    def resume(session_id: IdPath, db: DbDep) -> dict:
        return practice.session_dto(db, practice.get_session(db, session_id))

    @application.get("/api/sessions/{session_id}/tree", response_model=TreeResponse)
    def tree(session_id: IdPath, db: DbDep) -> dict:
        return practice.tree_dto(db, session_id)

    @application.post("/api/chat/turn", response_model=ChatTurnResponse)
    def turn(
        payload: ChatTurnRequest, key: KeyDep, db: DbDep, provider_call: ProviderDep
    ) -> JSONResponse:
        return reply(practice.send_turn(db, payload, key, provider_call))

    @application.post(
        "/api/sessions/{session_id}/branches",
        response_model=BranchCreateResponse,
        status_code=201,
    )
    def branch(
        session_id: IdPath, payload: BranchCreateRequest, key: KeyDep, db: DbDep
    ) -> JSONResponse:
        return reply(practice.create_branch(db, session_id, payload, key))

    @application.put(
        "/api/sessions/{session_id}/active-branch", response_model=SessionResponse
    )
    def activate(
        session_id: IdPath, payload: BranchSelectRequest, key: KeyDep, db: DbDep
    ) -> JSONResponse:
        return reply(practice.select_branch(db, session_id, payload, key))

    # Outer CORS also decorates safe unexpected-failure responses.
    origins = [
        item.strip()
        for item in os.environ.get(
            "DIALOGIQ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if item.strip()
    ]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key"],
    )
    return application


app = create_app()
