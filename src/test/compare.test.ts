import { describe, expect, it } from "vitest";

import type { Tree, TurnNode } from "@/lib/api";
import { compareAttempts } from "@/lib/compare";

type Over = {
  q?: "open" | "closed" | "statement";
  empathy?: boolean;
  signal?: string;
  needs?: string[];
  user?: string;
  bob?: string;
};

const turn = (id: number, parent: number | null, o: Over = {}) =>
  ({
    id,
    parent_id: parent,
    user_text: o.user ?? `you ${id}`,
    character_text: o.bob ?? `bob ${id}`,
    coaching: { question_type: o.q ?? "statement", empathy: o.empathy ?? false },
    conversation_progress: { stance: "guarded", last_signal: o.signal ?? "none" },
    resistance: "guarded",
    revealed_needs: (o.needs ?? []).map((title) => ({ id: title, title, description: "" })),
  }) as unknown as TurnNode;

const tree = (nodes: TurnNode[], heads: [number, number][]): Tree =>
  ({
    nodes,
    active_branch_id: heads[0]?.[0],
    branches: heads.map(([id, head]) => ({ id, head_node_id: head })),
  }) as unknown as Tree;

describe("compareAttempts", () => {
  const nodes = [
    turn(1, null, { needs: ["Workload"] }),
    // attempt 1: pressure, nothing new
    turn(2, 1, { q: "open", signal: "pressure", needs: ["Workload"], user: "Why not?" }),
    // attempt 2: acknowledgment, a new concern
    turn(3, 1, {
      q: "closed",
      empathy: true,
      needs: ["Workload", "Priorities"],
      user: "Sounds like you had no say. Right?",
      bob: "Yes, exactly.",
    }),
  ];

  it("splits at the last shared turn and summarises each attempt's own turns", () => {
    const result = compareAttempts(
      tree(nodes, [
        [1, 2],
        [2, 3],
      ]),
      1,
      2,
    );
    expect(result?.forkNodeId).toBe(1);
    expect(result?.sharedTurns).toBe(1);
    expect(result?.a.pressureTurns).toBe(1);
    expect(result?.a.newlyRevealed).toEqual([]);
    expect(result?.b.acknowledgments).toBe(1);
    expect(result?.b.closedQuestions).toBe(1);
    expect(result?.b.newlyRevealed).toEqual(["Priorities"]);
    expect(result?.b.firstReply).toBe("Yes, exactly.");
  });

  it("counts only concerns disclosed after the fork", () => {
    const result = compareAttempts(
      tree(nodes, [
        [1, 2],
        [2, 3],
      ]),
      2,
      1,
    );
    expect(result?.a.newlyRevealed).toEqual(["Priorities"]);
    expect(result?.b.newlyRevealed).toEqual([]);
  });

  it("returns null for the same branch or an unknown one", () => {
    expect(
      compareAttempts(
        tree(nodes, [
          [1, 2],
          [2, 3],
        ]),
        1,
        1,
      ),
    ).toBeNull();
    expect(compareAttempts(tree(nodes, [[1, 2]]), 1, 9)).toBeNull();
  });

  it("treats branches that part at the opening as having no shared turns", () => {
    const roots = [turn(1, null), turn(2, null)];
    const result = compareAttempts(
      tree(roots, [
        [1, 1],
        [2, 2],
      ]),
      1,
      2,
    );
    expect(result?.forkNodeId).toBeNull();
    expect(result?.sharedTurns).toBe(0);
  });
});
