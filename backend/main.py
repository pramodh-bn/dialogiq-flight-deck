import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

# Import local database dependency & models (CS-29 & CS-30)
from database import Base, SessionLocal, engine, get_db
from models import ConversationNode, Scenario, User  # noqa: F401
from models import Session as PracticeSession
from seed import get_or_create_demo_user, seed_scenarios


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Create tables and seed demo scenarios when the server starts.

    Kept out of import time so tests never touch the on-disk dialogiq.db.
    """
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_scenarios(db)
    yield


app = FastAPI(
    title="DialogIQ API",
    description="Backend API for Meta Hackathon Conversation Sparring Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# The Lovable/TanStack dev server is pinned to port 8080; 5173 covers plain Vite.
# Override with a comma-separated DIALOGIQ_CORS_ORIGINS.
DEFAULT_ORIGINS = (
    "http://localhost:8080,http://127.0.0.1:8080,"
    "http://localhost:5173,http://127.0.0.1:5173"
)
origins = [
    o.strip()
    for o in os.environ.get("DIALOGIQ_CORS_ORIGINS", DEFAULT_ORIGINS).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic Schemas ---
class ScenarioResponse(BaseModel):
    id: int
    title: str
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SessionCreateRequest(BaseModel):
    scenario_id: int


class SessionResponse(BaseModel):
    id: int
    scenario_id: int
    score: int

    model_config = ConfigDict(from_attributes=True)


class ChatTurnRequest(BaseModel):
    session_id: int
    user_message: str = Field(
        ..., min_length=1, description="The meaning-level question asked by the user"
    )


class ChatTurnResponse(BaseModel):
    turn_id: int
    character_response: str
    revealed_node_score: int | None = None


# --- API Endpoints ---


@app.get("/health", status_code=status.HTTP_200_OK)
def health_check() -> dict[str, str]:
    """Health check endpoint to verify server is up."""
    return {"status": "healthy", "service": "dialogiq-backend"}


@app.get("/api/scenarios", response_model=list[ScenarioResponse])
def get_scenarios(db: Session = Depends(get_db)) -> list[Scenario]:  # noqa: B008
    """Fetch all available conversation sparring scenarios."""
    scenarios = db.query(Scenario).all()
    return scenarios


@app.post(
    "/api/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    payload: SessionCreateRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> PracticeSession:
    """Start a practice run of a scenario for the Sprint 1 demo user."""
    if db.get(Scenario, payload.scenario_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    user = get_or_create_demo_user(db)
    session = PracticeSession(user_id=user.id, scenario_id=payload.scenario_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@app.post("/api/chat/turn", response_model=ChatTurnResponse)
def submit_chat_turn(
    payload: ChatTurnRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> ChatTurnResponse:
    """Submit a chat turn, process response, and evaluate against hidden need graph."""
    # Stub response for Sprint 1 foundation validation
    return ChatTurnResponse(
        turn_id=1,
        character_response=(
            "I understand your point on budget, but I need to know "
            "our delivery timeline won't slip."
        ),
        revealed_node_score=3,
    )
