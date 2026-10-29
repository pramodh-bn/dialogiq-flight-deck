// Wire types for the DialogIQ FastAPI backend (backend/main.py). Field names stay
// snake_case to match the Pydantic schemas exactly.

export type Scenario = {
  id: number;
  title: string;
  description: string | null;
};

// Proposed for CS-28: the backend has a Session model but no create endpoint yet.
export type CreateSessionRequest = { scenario_id: number };

export type PracticeSession = {
  id: number;
  scenario_id: number;
  score: number;
};

export type ChatTurnRequest = {
  session_id: number;
  user_message: string;
};

export type ChatTurnResponse = {
  turn_id: number;
  character_response: string;
  revealed_node_score: number | null;
};

export interface DialogApi {
  listScenarios(): Promise<Scenario[]>;
  createSession(req: CreateSessionRequest): Promise<PracticeSession>;
  sendTurn(req: ChatTurnRequest): Promise<ChatTurnResponse>;
}
