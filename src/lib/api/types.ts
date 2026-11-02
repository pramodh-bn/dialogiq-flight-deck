// Wire types for the DialogIQ FastAPI backend, as agreed in docs/api_contract.md. Field
// names stay snake_case to match the Pydantic schemas exactly.

export type Persona = {
  name: string;
  role: string;
  initials: string;
  tags: string[];
  opening_message: string;
  public_context: string;
  practice_hints: string[];
};

export type Scenario = {
  id: number;
  title: string;
  description: string | null;
  persona: Persona;
};

export type RevealedNeed = { id: string; title: string; description: string };

export type Metrics = {
  turns: number;
  open_questions: number;
  closed_questions: number;
  empathy_turns: number;
  open_question_ratio: number;
};

export type Resistance = "guarded" | "warming" | "open";

export type State = {
  score: number;
  total_needs: number;
  revealed_needs: RevealedNeed[];
  resistance: Resistance;
  metrics: Metrics;
};

export type PracticeSession = State & {
  id: number;
  scenario_id: number;
  active_branch_id: number;
  active_head_node_id: number | null;
  revision: number;
};

export type Whisper = { kind: "good" | "warn" | "tip"; text: string };

export type QuestionType = "open" | "closed" | "statement";

export type Coaching = {
  source: "deterministic";
  question_type: QuestionType;
  empathy: boolean;
  leading: boolean;
  outcome: "breakthrough" | "deadend" | "neutral";
  alternatives: string[];
  whispers: Whisper[];
};

// One complete user/persona exchange; the contract calls this DTO "Node".
export type TurnNode = State & {
  id: number;
  session_id: number;
  parent_id: number | null;
  turn_number: number;
  user_text: string;
  character_text: string;
  coaching: Coaching;
};

export type Branch = State & {
  id: number;
  session_id: number;
  fork_node_id: number | null;
  head_node_id: number | null;
};

export type Tree = {
  session_id: number;
  revision: number;
  active_branch_id: number;
  branches: Branch[];
  nodes: TurnNode[];
};

export type CreateSessionRequest = { scenario_id: number };

export type ChatTurnRequest = {
  session_id: number;
  branch_id: number;
  parent_node_id: number | null;
  expected_revision: number;
  user_message: string;
};

export type ChatTurnResponse = {
  turn_id: number;
  character_response: string;
  revealed_node_score: number;
  node: TurnNode;
  session: PracticeSession;
};

export type CreateBranchRequest = {
  source_branch_id: number;
  rewind_to_node_id: number | null;
  expected_revision: number;
};

export type CreateBranchResponse = { branch: Branch; session: PracticeSession };

export type SelectBranchRequest = { branch_id: number; expected_revision: number };

// Contextual coaching, per docs/cs45-coaching-contract.md.
export const COACH_CONTRACT_REVISION = "s3-coach-r2";

export type HintTrigger = "automatic" | "requested";

export type HintAttempt = 1 | 2;

export type HintFallbackReason = "not_configured" | "timeout" | "unavailable" | "invalid_response";

export type Hint = {
  id: number;
  contract_revision: string;
  attempt: HintAttempt;
  approach: string;
  example: string;
  reason: string;
  source: "meta" | "deterministic";
  fallback_reason: HintFallbackReason | null;
  latency_ms: number;
};

export type CoachHintRequest = {
  branch_id: number;
  head_node_id: number | null;
  expected_revision: number;
  trigger: HintTrigger;
  attempt: HintAttempt;
};

export type CoachHintResponse = {
  session_id: number;
  branch_id: number;
  head_node_id: number | null;
  revision: number;
  hint: Hint;
};

export type CoachHintList = {
  session_id: number;
  branch_id: number;
  head_node_id: number | null;
  revision: number;
  hints: { head_node_id: number | null; hint: Hint }[];
};

// Mutations take an idempotency key, kept across retries of one action.
export interface DialogApi {
  listScenarios(): Promise<Scenario[]>;
  getScenario(scenarioId: number): Promise<Scenario>;
  listSessions(scenarioId: number): Promise<PracticeSession[]>;
  createSession(req: CreateSessionRequest, key: string): Promise<PracticeSession>;
  getSession(sessionId: number): Promise<PracticeSession>;
  getTree(sessionId: number): Promise<Tree>;
  sendTurn(req: ChatTurnRequest, key: string): Promise<ChatTurnResponse>;
  createBranch(
    sessionId: number,
    req: CreateBranchRequest,
    key: string,
  ): Promise<CreateBranchResponse>;
  selectBranch(sessionId: number, req: SelectBranchRequest, key: string): Promise<PracticeSession>;
  // timeoutMs is what remains of one action's budget, not a fresh limit per attempt. Null
  // sets no limit, which only demo waiting does. Aborting stops local waiting, not the server.
  requestCoachHint(
    sessionId: number,
    req: CoachHintRequest,
    key: string,
    timeoutMs?: number | null,
    abort?: AbortSignal,
  ): Promise<CoachHintResponse>;
  listCoachHints(
    sessionId: number,
    branchId: number,
    timeoutMs?: number,
    abort?: AbortSignal,
  ): Promise<CoachHintList>;
}
