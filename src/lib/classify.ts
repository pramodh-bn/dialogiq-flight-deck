// Client-side copy of the contract's turn classifier, used only by the mock API. The
// backend's coaching is authoritative whenever VITE_API_BASE_URL is set.
import type { QuestionType } from "./api/types";

const OPEN = /^(what|how|why|tell me|help me|walk me|describe|in what)(?![a-z0-9])/;
const CLOSED =
  /^(do|does|did|is|are|was|were|can|could|will|would|should|have|has|had|won't|don't|isn't|aren't)(?![a-z0-9])/;
const LEADING =
  /(?<![a-z0-9'])(don't you|isn't it|you should|you must|your fault|just admit|obviously)(?![a-z0-9'])/;
const EMPATHY = /understand|sounds like|i hear|feel|frustrat|appreciate|makes sense|tough|hard/;

export type TurnClass = { questionType: QuestionType; empathy: boolean; leading: boolean };

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim().replace(/^["'“”‘’]+/, ""))
    .filter(Boolean);
}

export function classifyTurn(text: string): TurnClass {
  const value = normalize(text);
  const parts = sentences(value);
  const questionType: QuestionType = parts.some((s) => OPEN.test(s))
    ? "open"
    : parts.some((s) => CLOSED.test(s))
      ? "closed"
      : "statement";
  return { questionType, empathy: EMPATHY.test(value), leading: LEADING.test(value) };
}
