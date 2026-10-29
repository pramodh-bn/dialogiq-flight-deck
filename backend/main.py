from fastapi import Depends, FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional

# Import local database dependency & models (CS-29 & CS-30)
from database import Base, engine, get_db
from models import Scenario
from models import ConversationNode, Session as ChatSession, User  # noqa: F401

# Initialize database tables on startup (or via migration tool)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="DialogIQ API",
    description="Backend API for Meta Hackathon Conversation Sparring Platform",
    version="1.0.0"
)

# Configure CORS middleware for Vite frontend (CS-25 / local dev)
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
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
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ChatTurnRequest(BaseModel):
    session_id: int
    user_message: str = Field(
        ..., min_length=1, description="The meaning-level question asked by the user"
    )


class ChatTurnResponse(BaseModel):
    turn_id: int
    character_response: str
    revealed_node_score: Optional[int] = None


# --- API Endpoints ---

@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    """Health check endpoint to verify server is up."""
    return {"status": "healthy", "service": "dialogiq-backend"}


@app.get("/api/scenarios", response_model=List[ScenarioResponse])
def get_scenarios(db: Session = Depends(get_db)):
    """Fetch all available conversation sparring scenarios."""
    scenarios = db.query(Scenario).all()
    return scenarios


@app.post("/api/chat/turn", response_model=ChatTurnResponse)
def submit_chat_turn(payload: ChatTurnRequest, db: Session = Depends(get_db)):
    """Submit a chat turn, process response, and evaluate against hidden need graph."""
    # Stub response for Sprint 1 foundation validation
    return ChatTurnResponse(
        turn_id=1,
        character_response="I understand your point on budget, but I need to know our delivery timeline won't slip.",
        revealed_node_score=3
    )