import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { ApiError, type Coaching, type PracticeSession, type Tree, type TurnNode } from "@/lib/api";
import { createMockApi } from "@/lib/api/mock";
import {
  applyTurn,
  blindSpots,
  branchChain,
  containingBranch,
  failureAction,
  layoutTree,
  storeSession,
} from "@/lib/practice";

const coaching = (over: Partial<Coaching> = {}): Coaching => ({
  source: "deterministic",
  question_type: "open",
  empathy: true,
  leading: false,
  outcome: "neutral",
  alternatives: [],
  whispers: [],
  ...over,
});

const node = (id: number, parent_id: number | null, over: Partial<Coaching> = {}) =>
  ({ id, parent_id, coaching: coaching(over) }) as TurnNode;

const branch = (id: number, head_node_id: number | null) =>
  ({ id, head_node_id }) as Tree["branches"][number];

const apiError = (status: number, code: string, retryable = false) =>
  new ApiError(status, "/x", JSON.stringify({ detail: { code, message: code, retryable } }));

describe("branchChain", () => {
  it("walks from the head back to the root, oldest first", () => {
    const nodes = [node(1, null), node(2, 1), node(3, 2), node(4, 1)];

    expect(branchChain(nodes, 3).map((n) => n.id)).toEqual([1, 2, 3]);
    expect(branchChain(nodes, 4).map((n) => n.id)).toEqual([1, 4]);
    expect(branchChain(nodes, null)).toEqual([]);
  });
});

describe("containingBranch", () => {
  const tree = {
    active_branch_id: 20,
    nodes: [node(1, null), node(2, 1), node(3, 1)],
    branches: [branch(20, 3), branch(10, 2), branch(5, 2)],
  } as Tree;

  it("prefers the active branch for a shared node", () => {
    expect(containingBranch(tree, 1)?.id).toBe(20);
  });

  it("otherwise picks the lowest-id branch containing the node", () => {
    expect(containingBranch(tree, 2)?.id).toBe(5);
  });
});

describe("blindSpots", () => {
  it("reports only what the selected chain shows", () => {
    expect(blindSpots([])).toEqual([]);
    expect(blindSpots([node(1, null)])).toEqual([]);
    expect(
      blindSpots([node(1, null, { question_type: "closed", leading: true, empathy: false })]),
    ).toEqual(["Yes/no openers", "Blame framing", "Skipping empathy"]);
  });
});

describe("layoutTree", () => {
  it("places the opening over the turns and gives each leaf its own column", () => {
    const positions = layoutTree([node(1, null), node(2, 1), node(3, 1)]);

    expect(positions.get(null)?.y).toBe(0);
    expect(positions.get(1)?.y).toBe(160);
    expect(positions.get(2)?.y).toBe(320);
    expect(positions.get(2)?.x).not.toBe(positions.get(3)?.x);
    expect(positions.get(1)?.x).toBe(((positions.get(2)?.x ?? 0) + (positions.get(3)?.x ?? 0)) / 2);
  });

  it("handles a rewind to before the first turn", () => {
    const positions = layoutTree([node(1, null), node(2, null)]);

    expect(positions.get(1)?.x).not.toBe(positions.get(2)?.x);
  });
});

describe("failureAction", () => {
  it("retries network failures and retryable errors with the same key", () => {
    expect(failureAction(new TypeError("Failed to fetch"))).toBe("retry");
    expect(failureAction(apiError(504, "persona_timeout", true))).toBe("retry");
    expect(failureAction(apiError(409, "request_in_progress", true))).toBe("retry");
  });

  it("reloads on conflicts and stops on anything else", () => {
    expect(failureAction(apiError(409, "stale_revision"))).toBe("reload");
    expect(failureAction(apiError(404, "session_not_found"))).toBe("stop");
    expect(failureAction(apiError(422, "validation_error"))).toBe("stop");
  });
});

describe("replayed responses", () => {
  async function turnPair() {
    const api = createMockApi();
    const session = await api.createSession({ scenario_id: 1 }, crypto.randomUUID());
    const first = await api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: null,
        expected_revision: 0,
        user_message: "What happened?",
      },
      crypto.randomUUID(),
    );
    const second = await api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: first.node.id,
        expected_revision: 1,
        user_message: "How did it feel?",
      },
      crypto.randomUUID(),
    );
    return { api, session, first, second };
  }

  it("never moves the cached session backwards", async () => {
    const { first, second } = await turnPair();
    const client = new QueryClient();

    storeSession(client, second.session);
    storeSession(client, first.session);

    const cached = client.getQueryData<PracticeSession>(["session", second.session.id]);
    expect(cached?.revision).toBe(2);
  });

  it("does not add a replayed turn to the tree twice", async () => {
    const { api, session, first, second } = await turnPair();
    const tree = await api.getTree(session.id);

    expect(applyTurn(tree, first)).toBe(tree);
    expect(applyTurn(tree, second)).toBe(tree);
  });

  it("appends a new turn and advances its branch", async () => {
    const { api, session, first, second } = await turnPair();
    const before: Tree = {
      ...(await api.getTree(session.id)),
      revision: 1,
      nodes: [first.node],
    };

    const after = applyTurn(before, second);

    expect(after.revision).toBe(2);
    expect(after.nodes.map((n) => n.id)).toEqual([first.node.id, second.node.id]);
    expect(after.branches[0]).toMatchObject({ head_node_id: second.node.id, score: 2 });
  });
});
