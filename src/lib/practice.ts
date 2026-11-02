import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  ApiError,
  COACH_CONTRACT_REVISION,
  type Branch,
  type ChatTurnResponse,
  type CoachHintList,
  type CoachHintRequest,
  type Hint,
  type PracticeSession,
  type Tree,
  type TurnNode,
} from "@/lib/api";

// Shared by the Hub, Arena and Flight Recorder: server state, retry handling and the
// tree walking the contract leaves to the client.

const retry = (failures: number, error: Error) =>
  failures < 2 && !(error instanceof ApiError && error.status < 500);

export const scenariosQuery = () =>
  queryOptions({ queryKey: ["scenarios"], queryFn: () => api.listScenarios(), retry });

export const scenarioQuery = (id: number) =>
  queryOptions({ queryKey: ["scenario", id], queryFn: () => api.getScenario(id), retry });

export const sessionsQuery = (scenarioId: number) =>
  queryOptions({
    queryKey: ["sessions", scenarioId],
    queryFn: () => api.listSessions(scenarioId),
    retry,
  });

export const sessionQuery = (id: number) =>
  queryOptions({ queryKey: ["session", id], queryFn: () => api.getSession(id), retry });

export const treeQuery = (id: number) =>
  queryOptions({ queryKey: ["tree", id], queryFn: () => api.getTree(id), retry });

export function refreshSession(client: QueryClient, sessionId: number) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["session", sessionId] }),
    client.invalidateQueries({ queryKey: ["tree", sessionId] }),
    client.invalidateQueries({ queryKey: ["sessions"] }),
  ]);
}

// A replayed response can be older than what is cached, so never move backwards.
export function storeSession(client: QueryClient, session: PracticeSession) {
  client.setQueryData<PracticeSession>(["session", session.id], (prev) =>
    prev && prev.revision > session.revision ? prev : session,
  );
}

export function applyTurn(tree: Tree, res: ChatTurnResponse): Tree {
  if (res.session.revision <= tree.revision) return tree;
  const { score, total_needs, revealed_needs, resistance, metrics } = res.node;
  return {
    ...tree,
    revision: res.session.revision,
    nodes: [...tree.nodes, res.node],
    branches: tree.branches.map((b) =>
      b.id === res.session.active_branch_id
        ? {
            ...b,
            head_node_id: res.node.id,
            score,
            total_needs,
            revealed_needs,
            resistance,
            metrics,
          }
        : b,
    ),
  };
}

export function branchChain(nodes: TurnNode[], headId: number | null): TurnNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: TurnNode[] = [];
  for (let id = headId; id !== null;) {
    const node = byId.get(id);
    if (!node) break;
    chain.unshift(node);
    id = node.parent_id;
  }
  return chain;
}

// The contract's source-branch rule: prefer the active branch, else the lowest id.
export function containingBranch(tree: Tree, nodeId: number): Branch | undefined {
  const contains = (b: Branch) =>
    branchChain(tree.nodes, b.head_node_id).some((n) => n.id === nodeId);
  const active = tree.branches.find((b) => b.id === tree.active_branch_id);
  if (active && contains(active)) return active;
  return [...tree.branches].sort((a, b) => a.id - b.id).find(contains);
}

export function blindSpots(chain: TurnNode[]): string[] {
  const spots: string[] = [];
  if (chain.some((n) => n.coaching.question_type === "closed")) spots.push("Yes/no openers");
  if (chain.some((n) => n.coaching.leading)) spots.push("Blame framing");
  if (chain.length > 0 && !chain.some((n) => n.coaching.empathy)) spots.push("Skipping empathy");
  return spots;
}

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 160;

// Lay leaves out left to right and center each parent over its children.
export function layoutTree(nodes: TurnNode[]): Map<number | null, { x: number; y: number }> {
  const children = new Map<number | null, TurnNode[]>();
  for (const node of [...nodes].sort((a, b) => a.id - b.id)) {
    children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node]);
  }
  const positions = new Map<number | null, { x: number; y: number }>();
  let nextLeaf = 0;
  function place(id: number | null, depth: number): number {
    const kids = children.get(id) ?? [];
    const xs = kids.map((kid) => place(kid.id, depth + 1));
    const x = xs.length ? (xs[0]! + xs[xs.length - 1]!) / 2 : nextLeaf++ * COLUMN_WIDTH;
    positions.set(id, { x, y: depth * ROW_HEIGHT });
    return x;
  }
  place(null, 0);
  return positions;
}

export type FailureAction = "retry" | "reload" | "stop";

// retry: resend with the same key. reload: state moved on, so refetch and start over.
export function failureAction(error: unknown): FailureAction {
  if (!(error instanceof ApiError)) return "retry";
  if (error.retryable) return "retry";
  return error.status === 409 ? "reload" : "stop";
}

export function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Couldn't reach the simulator. Your message is still here, so try again.";
  switch (error.code) {
    case "stale_revision":
    case "parent_mismatch":
    case "inactive_branch":
    case "rewind_target_not_on_branch":
      return "This session changed elsewhere. It has been reloaded, so please try again.";
    case "persona_unavailable":
      return "The persona service is unavailable. Try again shortly.";
    case "persona_timeout":
      return "The persona took too long to reply. Try again.";
    case "persona_invalid_response":
      return "The persona couldn't produce a reply. Try again.";
    case "request_in_progress":
      return "That request is still running. Try again in a moment.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// One idempotency key per intended action, kept until that action resolves.
export function useActionKeys() {
  const keys = useRef(new Map<string, string>());
  return useMemo(
    () => ({
      keyFor(action: string): string {
        const existing = keys.current.get(action);
        if (existing) return existing;
        const key = crypto.randomUUID();
        keys.current.set(action, key);
        return key;
      },
      release(action: string) {
        keys.current.delete(action);
      },
    }),
    [],
  );
}

// Contextual coaching: see docs/cs45-coaching-contract.md.

const MAX_SCORE = 7;
const COACH_BUDGET_MS = 15_000;
const COACH_RETRY_MS = 2_000;

export const coachHintsKey = (sessionId: number, branchId: number, headId: number | null) => [
  "coach-hints",
  sessionId,
  branchId,
  headId,
  COACH_CONTRACT_REVISION,
];

export const coachHintsQuery = (sessionId: number, branchId: number, headId: number | null) =>
  queryOptions({
    queryKey: coachHintsKey(sessionId, branchId, headId),
    queryFn: () => api.listCoachHints(sessionId, branchId),
    retry,
  });

// The automatic trigger: the latest turn revealed nothing and there is more to find.
export function isStalled(chain: TurnNode[]): boolean {
  const head = chain.at(-1);
  if (!head) return false;
  const parentScore = chain.at(-2)?.score ?? 0;
  return head.score === parentScore && head.score < MAX_SCORE;
}

type ListedHint = CoachHintList["hints"][number];

const isCurrentContract = (entry: ListedHint) =>
  entry.hint.contract_revision === COACH_CONTRACT_REVISION;

export function hintsAtHead(list: CoachHintList | undefined, headId: number | null): Hint[] {
  return (list?.hints ?? [])
    .filter((h) => h.head_node_id === headId && isCurrentContract(h))
    .map((h) => h.hint)
    .sort((a, b) => a.attempt - b.attempt);
}

// GET lists oldest first, so the last entry at another head is the most recent earlier one.
export function latestEarlierHint(
  list: CoachHintList | undefined,
  headId: number | null,
): ListedHint | undefined {
  return (list?.hints ?? [])
    .filter((h) => h.head_node_id !== headId && isCurrentContract(h))
    .at(-1);
}

export function mergeHint(list: CoachHintList, entry: ListedHint): CoachHintList {
  if (list.hints.some((h) => h.hint.id === entry.hint.id)) return list;
  return { ...list, hints: [...list.hints, entry] };
}

export type CoachOutcome =
  | { kind: "hint"; hint: Hint; revision: number | null }
  // Still unresolved when the budget ran out, or the response was lost: keep the key.
  | { kind: "unresolved" }
  // The conversation moved on, so this action no longer applies: discard the key.
  | { kind: "state_changed" }
  | { kind: "not_eligible" }
  | { kind: "failed" }
  // The learner left this position. Nothing may be shown.
  | { kind: "abandoned" };

type ObserveOptions = {
  sessionId: number;
  request: CoachHintRequest;
  key: string;
  isCurrent: () => boolean;
  budgetMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const STILL_RUNNING = new Set(["request_in_progress", "hint_not_ready"]);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Holds one action through the 409s of a generation running elsewhere: another tab, a
// reload, or the automatic request. All attempts share a single budget.
export async function observeCoachHint({
  sessionId,
  request,
  key,
  isCurrent,
  budgetMs = COACH_BUDGET_MS,
  retryMs = COACH_RETRY_MS,
  now = Date.now,
  sleep = wait,
}: ObserveOptions): Promise<CoachOutcome> {
  const deadline = now() + budgetMs;

  async function savedHint(): Promise<Hint | undefined> {
    const remaining = deadline - now();
    if (remaining <= 0) return undefined;
    try {
      const list = await api.listCoachHints(sessionId, request.branch_id, remaining);
      return hintsAtHead(list, request.head_node_id).find((h) => h.attempt === request.attempt);
    } catch {
      return undefined;
    }
  }

  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) return { kind: "unresolved" };
    try {
      const response = await api.requestCoachHint(sessionId, request, key, remaining);
      return isCurrent()
        ? { kind: "hint", hint: response.hint, revision: response.revision }
        : { kind: "abandoned" };
    } catch (error) {
      if (!isCurrent()) return { kind: "abandoned" };
      if (!(error instanceof ApiError)) {
        const hint = await savedHint();
        if (!isCurrent()) return { kind: "abandoned" };
        return hint ? { kind: "hint", hint, revision: null } : { kind: "unresolved" };
      }
      if (!error.code || !STILL_RUNNING.has(error.code)) {
        if (error.status === 409) return { kind: "state_changed" };
        return { kind: error.code === "hint_not_eligible" ? "not_eligible" : "failed" };
      }
      const hint = await savedHint();
      if (!isCurrent()) return { kind: "abandoned" };
      if (hint) return { kind: "hint", hint, revision: null };
      await sleep(Math.min(retryMs, Math.max(deadline - now(), 0)));
      if (!isCurrent()) return { kind: "abandoned" };
    }
  }
}

type CoachPosition = { branchId: number; headId: number | null; revision: number };

type CoachRun =
  | { binding: string; status: "pending" }
  | { binding: string; status: "failed"; message: string; retry: CoachHintRequest | null };

export function useCoach({
  sessionId,
  position,
  stalled,
  hold,
}: {
  sessionId: number;
  // Null until the session and tree agree on where the conversation is.
  position: CoachPosition | null;
  stalled: boolean;
  // True while a turn is in flight, when the head is about to move.
  hold: boolean;
}) {
  const client = useQueryClient();
  const keys = useActionKeys();
  const binding = position && `${sessionId}:${position.branchId}:${position.headId}`;
  const headId = position?.headId ?? null;
  const hintsResult = useQuery({
    ...coachHintsQuery(sessionId, position?.branchId ?? 0, headId),
    enabled: position !== null,
  });
  const [run, setRun] = useState<CoachRun | null>(null);
  const scope = useRef<{ binding: string | null; generation: number }>({
    binding: null,
    generation: 0,
  });
  const mounted = useRef(false);
  const automaticStarted = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Moving away ends any run here. Its late result stays out, even an exact replay.
  useEffect(() => {
    if (scope.current.binding === binding) return;
    scope.current = { binding, generation: scope.current.generation + 1 };
    setRun(null);
  }, [binding]);

  const execute = useCallback(
    async (request: CoachHintRequest) => {
      const runBinding = `${sessionId}:${request.branch_id}:${request.head_node_id}`;
      const generation = scope.current.generation;
      const isCurrent = () => mounted.current && scope.current.generation === generation;
      const action = `coach:${sessionId}:${JSON.stringify(request)}`;
      setRun({ binding: runBinding, status: "pending" });
      const outcome = await observeCoachHint({
        sessionId,
        request,
        key: keys.keyFor(action),
        isCurrent,
      });
      if (outcome.kind !== "unresolved") keys.release(action);

      switch (outcome.kind) {
        case "abandoned":
          return;
        case "hint": {
          const queryKey = coachHintsKey(sessionId, request.branch_id, request.head_node_id);
          client.setQueryData<CoachHintList>(queryKey, (prev) =>
            prev
              ? mergeHint(prev, { head_node_id: request.head_node_id, hint: outcome.hint })
              : prev,
          );
          void client.invalidateQueries({ queryKey });
          if (outcome.revision !== null && outcome.revision !== request.expected_revision) {
            void refreshSession(client, sessionId);
          }
          setRun(null);
          return;
        }
        case "state_changed":
          void refreshSession(client, sessionId);
          setRun(null);
          return;
        case "not_eligible":
          setRun(null);
          return;
        case "unresolved":
          setRun({
            binding: runBinding,
            status: "failed",
            message: "That hint is taking longer than expected.",
            retry: request,
          });
          return;
        case "failed":
          setRun({
            binding: runBinding,
            status: "failed",
            message: "Couldn't get a hint right now. Your conversation is safe.",
            retry: null,
          });
      }
    },
    [client, keys, sessionId],
  );

  const saved = hintsAtHead(hintsResult.data, headId);
  const pending = run?.status === "pending" && run.binding === binding;
  const failure = run?.status === "failed" && run.binding === binding ? run : null;
  const settled = hintsResult.isSuccess && !hintsResult.isFetching;
  const shouldAutomate =
    binding !== null && stalled && !hold && settled && saved.length === 0 && !pending && !failure;

  useEffect(() => {
    if (!shouldAutomate || !position || !binding) return;
    if (automaticStarted.current.has(binding)) return;
    automaticStarted.current.add(binding);
    void execute({
      branch_id: position.branchId,
      head_node_id: position.headId,
      expected_revision: position.revision,
      trigger: "automatic",
      attempt: 1,
    });
  }, [binding, execute, position, shouldAutomate]);

  const exhausted = saved.length >= 2;

  function requestHelp() {
    if (!position || pending || hold || exhausted) return;
    const retained = failure?.retry;
    if (retained && retained.expected_revision === position.revision) {
      void execute(retained);
      return;
    }
    void execute({
      branch_id: position.branchId,
      head_node_id: position.headId,
      expected_revision: position.revision,
      trigger: "requested",
      attempt: saved.length === 0 ? 1 : 2,
    });
  }

  return {
    hints: saved,
    earlier: latestEarlierHint(hintsResult.data, headId),
    pending,
    exhausted,
    failure: failure?.message ?? null,
    canRetry: failure?.retry != null,
    requestHelp,
  };
}
