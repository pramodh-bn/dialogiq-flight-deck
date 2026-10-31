import { classifyTurn } from "../classify";
import { ApiError } from "./http";
import type {
  Branch,
  Coaching,
  DialogApi,
  PracticeSession,
  RevealedNeed,
  Scenario,
  State,
  TurnNode,
  Whisper,
} from "./types";

// In-browser stand-in shaped like docs/api_contract.md, so the app runs with no server.
// It is bundled whenever VITE_API_BASE_URL is unset, so it holds invented placeholder
// needs and no cue table: any eligible open turn earns the next placeholder. Nothing
// here is the real judge, and sessions last only until the page reloads.

const hints = [
  "Invite their perspective before proposing a solution.",
  "Name the emotion you are hearing before moving on.",
  "Ask what a good next step looks like from their side.",
];

const persona = (
  name: string,
  role: string,
  tags: string[],
  opening_message: string,
  public_context: string,
) => ({
  name,
  role,
  initials: name.charAt(0),
  tags,
  opening_message,
  public_context,
  practice_hints: hints,
});

export const mockScenarios: Scenario[] = [
  {
    id: 1,
    title: "Bob: Defensive Team Member",
    description: "Performance review · missed Q3 deadlines",
    persona: persona(
      "Bob",
      "Defensive Team Member",
      ["Avoidant", "High Resistance"],
      "You wanted to see me? If this is about the Q3 thing, I already sent the update.",
      "You are meeting to discuss missed deadlines.",
    ),
  },
  {
    id: 2,
    title: "Teenage Daughter: Homework Friction",
    description: "Evening check-in · phone boundaries",
    persona: persona(
      "Daughter",
      "Teenager",
      ["Withdrawn", "Sarcastic"],
      "Is this about my phone again? I said I'd do it later.",
      "You are checking in about homework and phone use.",
    ),
  },
  {
    id: 3,
    title: "Priya: Burnout Disclosure",
    description: "1:1 · workload renegotiation",
    persona: persona(
      "Priya",
      "Senior Engineer",
      ["Guarded", "Emotional"],
      "Thanks for making time. I'm fine, it's just been a lot lately.",
      "You are holding a 1:1 about workload.",
    ),
  },
  {
    id: 4,
    title: "Vendor: Contract Pushback",
    description: "Negotiation · price increase",
    persona: persona(
      "Vendor",
      "Account Manager",
      ["Assertive", "Data-driven"],
      "Before we start, the new pricing is not really negotiable.",
      "You are negotiating a price increase.",
    ),
  },
];

const replies = {
  closed: ["Yes. Is that all?", "No.", "Sure, fine. Whatever you think."],
  open: [
    "Honestly? It's been a lot more complicated than it looks from the outside.",
    "I don't know… nobody really noticed how much was going on until it fell apart.",
    "If I'm being real, I stopped bringing it up because nothing changed.",
  ],
  empathy: [
    "…Yeah. It's been rough. Thanks for actually saying that.",
    "I appreciate that. I didn't think you'd see it that way.",
  ],
};

const placeholderNeed = (n: number): RevealedNeed => ({
  id: `n${n}`,
  title: `Placeholder need ${n}`,
  description: "Mock data. Real needs come from the backend.",
});

const INITIAL_STATE: State = {
  score: 0,
  total_needs: 7,
  revealed_needs: [],
  resistance: "guarded",
  metrics: {
    turns: 0,
    open_questions: 0,
    closed_questions: 0,
    empathy_turns: 0,
    open_question_ratio: 0,
  },
};

function resistanceFor(score: number): State["resistance"] {
  return score >= 6 ? "open" : score >= 3 ? "warming" : "guarded";
}

function coachingFor(text: string, revealed: boolean): Coaching {
  const { questionType, empathy, leading } = classifyTurn(text);
  const whispers: Whisper[] = [
    questionType === "open"
      ? { kind: "good", text: "Open invitation: leave room for their perspective." }
      : questionType === "closed"
        ? { kind: "warn", text: "Closed question detected. Try an open invitation." }
        : { kind: "tip", text: "Follow up with a question that invites their perspective." },
  ];
  if (empathy) whispers.push({ kind: "good", text: "You acknowledged emotion or difficulty." });
  if (leading)
    whispers.push({ kind: "warn", text: "Try a question without blame or an assumed answer." });
  const alternative = leading
    ? "How are you seeing this situation?"
    : questionType === "closed"
      ? "What would you like me to understand?"
      : questionType === "statement"
        ? "How has this been for you?"
        : "What else would you like to share?";
  return {
    source: "deterministic",
    question_type: questionType,
    empathy,
    leading,
    outcome: revealed
      ? "breakthrough"
      : questionType === "closed" || leading
        ? "deadend"
        : "neutral",
    alternatives: [alternative],
    whispers,
  };
}

function nextState(prev: State, coaching: Coaching): State {
  const revealed = coaching.outcome === "breakthrough";
  const score = prev.score + (revealed ? 1 : 0);
  const open = prev.metrics.open_questions + (coaching.question_type === "open" ? 1 : 0);
  const closed = prev.metrics.closed_questions + (coaching.question_type === "closed" ? 1 : 0);
  return {
    score,
    total_needs: 7,
    revealed_needs: revealed
      ? [...prev.revealed_needs, placeholderNeed(score)]
      : prev.revealed_needs,
    resistance: resistanceFor(score),
    metrics: {
      turns: prev.metrics.turns + 1,
      open_questions: open,
      closed_questions: closed,
      empathy_turns: prev.metrics.empathy_turns + (coaching.empathy ? 1 : 0),
      open_question_ratio: open + closed ? open / (open + closed) : 0,
    },
  };
}

function fail(status: number, path: string, code: string, retryable = false): ApiError {
  return new ApiError(status, path, JSON.stringify({ detail: { code, message: code, retryable } }));
}

function pickState(s: State): State {
  const { score, total_needs, revealed_needs, resistance, metrics } = s;
  return { score, total_needs, revealed_needs, resistance, metrics };
}

export function createMockApi(random: () => number = Math.random): DialogApi {
  let nextId = 1;
  const sessions = new Map<number, Omit<PracticeSession, keyof State | "active_head_node_id">>();
  const branches = new Map<number, Branch>();
  const nodes = new Map<number, TurnNode>();
  const completed = new Map<string, { request: string; result: unknown }>();

  function once<T>(path: string, key: string, body: unknown, run: () => T): T {
    const request = `${path}:${JSON.stringify(body)}`;
    const prior = completed.get(key);
    if (prior) {
      if (prior.request !== request) throw fail(409, path, "idempotency_conflict");
      return prior.result as T;
    }
    const result = run();
    completed.set(key, { request, result });
    return result;
  }

  function sessionOr404(id: number, path: string) {
    const session = sessions.get(id);
    if (!session) throw fail(404, path, "session_not_found");
    return session;
  }

  function branchOr404(id: number, sessionId: number, path: string): Branch {
    const branch = branches.get(id);
    if (!branch || branch.session_id !== sessionId) throw fail(404, path, "branch_not_found");
    return branch;
  }

  function snapshot(id: number): PracticeSession {
    const session = sessions.get(id)!;
    const branch = branches.get(session.active_branch_id)!;
    return { ...session, active_head_node_id: branch.head_node_id, ...pickState(branch) };
  }

  function addBranch(sessionId: number, forkNodeId: number | null, state: State): Branch {
    const branch: Branch = {
      id: nextId++,
      session_id: sessionId,
      fork_node_id: forkNodeId,
      head_node_id: forkNodeId,
      ...pickState(state),
    };
    branches.set(branch.id, branch);
    return branch;
  }

  function onChain(headId: number | null, target: number): boolean {
    for (let id = headId; id !== null; id = nodes.get(id)?.parent_id ?? null) {
      if (id === target) return true;
    }
    return false;
  }

  const api: DialogApi = {
    async listScenarios() {
      return mockScenarios;
    },
    async getScenario(id) {
      const scenario = mockScenarios.find((s) => s.id === id);
      if (!scenario) throw fail(404, `/api/scenarios/${id}`, "scenario_not_found");
      return scenario;
    },
    async listSessions(scenarioId) {
      return [...sessions.values()]
        .filter((s) => s.scenario_id === scenarioId)
        .sort((a, b) => b.id - a.id)
        .map((s) => snapshot(s.id));
    },
    async createSession(req, key) {
      const path = "/api/sessions";
      return once(path, key, req, () => {
        if (!mockScenarios.some((s) => s.id === req.scenario_id))
          throw fail(404, path, "scenario_not_found");
        const id = nextId++;
        const branch = addBranch(id, null, INITIAL_STATE);
        sessions.set(id, {
          id,
          scenario_id: req.scenario_id,
          active_branch_id: branch.id,
          revision: 0,
        });
        return snapshot(id);
      });
    },
    async getSession(id) {
      sessionOr404(id, `/api/sessions/${id}`);
      return snapshot(id);
    },
    async getTree(id) {
      const session = sessionOr404(id, `/api/sessions/${id}/tree`);
      return {
        session_id: id,
        revision: session.revision,
        active_branch_id: session.active_branch_id,
        branches: [...branches.values()].filter((b) => b.session_id === id),
        nodes: [...nodes.values()].filter((n) => n.session_id === id),
      };
    },
    async sendTurn(req, key) {
      const path = "/api/chat/turn";
      return once(path, key, req, () => {
        const session = sessionOr404(req.session_id, path);
        const branch = branchOr404(req.branch_id, req.session_id, path);
        if (req.expected_revision !== session.revision) throw fail(409, path, "stale_revision");
        if (branch.id !== session.active_branch_id) throw fail(409, path, "inactive_branch");
        if (req.parent_node_id !== branch.head_node_id) throw fail(409, path, "parent_mismatch");

        const c = classifyTurn(req.user_message);
        const eligible = c.questionType === "open" && !c.leading;
        const reveals = eligible && branch.score < 7;
        const coaching = coachingFor(req.user_message, reveals);
        const pool = c.empathy ? replies.empathy : eligible ? replies.open : replies.closed;
        const reply = pool[Math.floor(random() * pool.length)] ?? pool[0]!;
        const node: TurnNode = {
          id: nextId++,
          session_id: req.session_id,
          parent_id: req.parent_node_id,
          turn_number: branch.metrics.turns + 1,
          user_text: req.user_message.trim(),
          character_text: reply,
          coaching,
          ...nextState(branch, coaching),
        };
        nodes.set(node.id, node);
        branches.set(branch.id, { ...branch, head_node_id: node.id, ...pickState(node) });
        session.revision += 1;
        return {
          turn_id: node.id,
          character_response: reply,
          revealed_node_score: node.score,
          node,
          session: snapshot(session.id),
        };
      });
    },
    async createBranch(id, req, key) {
      const path = `/api/sessions/${id}/branches`;
      return once(path, key, req, () => {
        const session = sessionOr404(id, path);
        const source = branchOr404(req.source_branch_id, id, path);
        if (req.expected_revision !== session.revision) throw fail(409, path, "stale_revision");
        const target = req.rewind_to_node_id;
        if (target !== null && !onChain(source.head_node_id, target))
          throw fail(409, path, "rewind_target_not_on_branch");
        const branch = addBranch(id, target, target === null ? INITIAL_STATE : nodes.get(target)!);
        session.active_branch_id = branch.id;
        session.revision += 1;
        return { branch, session: snapshot(id) };
      });
    },
    async selectBranch(id, req, key) {
      const path = `/api/sessions/${id}/active-branch`;
      return once(path, key, req, () => {
        const session = sessionOr404(id, path);
        branchOr404(req.branch_id, id, path);
        if (req.expected_revision !== session.revision) throw fail(409, path, "stale_revision");
        if (session.active_branch_id !== req.branch_id) {
          session.active_branch_id = req.branch_id;
          session.revision += 1;
        }
        return snapshot(id);
      });
    },
  };
  return api;
}
