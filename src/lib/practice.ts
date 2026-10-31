import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import {
  api,
  ApiError,
  type Branch,
  type ChatTurnResponse,
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
  return {
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
  };
}
