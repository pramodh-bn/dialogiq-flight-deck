// Client-side turn classifier. Placeholder for the Fireworks "Whispers" classifier
// in docs/spec.md; shared by the Arena's coaching panel and the mock API.
const CLOSED =
  /^(do|does|did|is|are|was|were|can|could|will|would|should|have|has|had|won't|don't|isn't|aren't)\b/i;
const OPEN = /^(what|how|why|tell me|help me|walk me|describe|in what)\b/i;
const EMPATHY = /(understand|sounds like|i hear|feel|frustrat|appreciate|makes sense|tough|hard)/i;

export type TurnClass = { open: boolean; closed: boolean; empathy: boolean };

export function classifyTurn(text: string): TurnClass {
  const open = OPEN.test(text);
  return { open, closed: !open && CLOSED.test(text), empathy: EMPATHY.test(text) };
}
