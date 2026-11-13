import type { Branch, TurnNode, Tree } from "@/lib/api/types";
import { branchChain } from "@/lib/practice";

export type AttemptSummary = {
  branchId: number;
  turns: TurnNode[];
  openQuestions: number;
  closedQuestions: number;
  acknowledgments: number;
  pressureTurns: number;
  /** Titles of concerns Bob disclosed on these turns and not before the fork. */
  newlyRevealed: string[];
  finalStance: string | null;
  firstLine: string | null;
  firstReply: string | null;
};

export type AttemptComparison = {
  /** Last turn both attempts share, or null when they diverge at the opening. */
  forkNodeId: number | null;
  sharedTurns: number;
  a: AttemptSummary;
  b: AttemptSummary;
};

function summarize(branch: Branch, tail: TurnNode[], before: Set<string>): AttemptSummary {
  const last = tail.at(-1);
  const revealed = (last?.revealed_needs ?? []).map((n) => n.title);
  return {
    branchId: branch.id,
    turns: tail,
    openQuestions: tail.filter((n) => n.coaching.question_type === "open").length,
    closedQuestions: tail.filter((n) => n.coaching.question_type === "closed").length,
    acknowledgments: tail.filter((n) => n.coaching.empathy === true).length,
    pressureTurns: tail.filter((n) => n.conversation_progress?.last_signal === "pressure").length,
    newlyRevealed: revealed.filter((title) => !before.has(title)),
    finalStance: last?.conversation_progress?.stance ?? last?.resistance ?? null,
    firstLine: tail[0]?.user_text ?? null,
    firstReply: tail[0]?.character_text ?? null,
  };
}

/** Compare two branches of one session from the turn where they part ways. */
export function compareAttempts(tree: Tree, aId: number, bId: number): AttemptComparison | null {
  const a = tree.branches.find((x) => x.id === aId);
  const b = tree.branches.find((x) => x.id === bId);
  if (!a || !b || a.id === b.id) return null;
  const chainA = branchChain(tree.nodes, a.head_node_id);
  const chainB = branchChain(tree.nodes, b.head_node_id);
  let shared = 0;
  while (shared < chainA.length && shared < chainB.length) {
    if (chainA[shared]?.id !== chainB[shared]?.id) break;
    shared += 1;
  }
  const fork = shared > 0 ? (chainA[shared - 1] ?? null) : null;
  const before = new Set((fork?.revealed_needs ?? []).map((n) => n.title));
  return {
    forkNodeId: fork?.id ?? null,
    sharedTurns: shared,
    a: summarize(a, chainA.slice(shared), before),
    b: summarize(b, chainB.slice(shared), before),
  };
}
