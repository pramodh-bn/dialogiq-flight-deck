// Coach whisper rules, ruleset v3-whisper-r1 (docs/v3/voice-rep-contract.md).
// Pure functions: the controller feeds them events and they say what to show.

export const WHISPER_RULESET = "v3-whisper-r1";
// At most one whisper in any window; a suppressed whisper is dropped.
export const WHISPER_WINDOW_MS = 8000;
// A reply this soon after Bob deflects is pushing.
export const NO_PAUSE_MS = 2000;
// Learner speech this long, with no question among it, is a monologue.
export const MONOLOGUE_MS = 30_000;
// Launch blocker: whispers must appear within this long of their trigger.
export const WHISPER_LATENCY_LIMIT_MS = 2000;

export type WhisperRule = "closed_question" | "leading" | "interruption" | "no_pause" | "monologue";

export const WHISPER_TEXT: Record<WhisperRule, string> = {
  closed_question: "That was a closed question. Try a meaning question.",
  leading: "That assumed the answer. Ask how he sees it.",
  interruption: "You interrupted. Pause 2 seconds.",
  no_pause: "He deflected. Wait before you push.",
  monologue: "Hand it back with a question.",
};

export type Whisper = {
  rule: WhisperRule;
  text: string;
  // When the thing that caused it happened, and when it became visible.
  triggerMs: number;
  shownMs: number;
};

// "leading" wins when a turn is both leading and closed.
export function ruleForTurn(facts: {
  question_type: string;
  leading: boolean;
}): WhisperRule | null {
  if (facts.leading) return "leading";
  if (facts.question_type === "closed") return "closed_question";
  return null;
}

// Decide whether a whisper may be shown now. Returns it, or null when the
// window is still closed. The caller records `lastShownMs` when it shows one.
export function offer(
  rule: WhisperRule,
  triggerMs: number,
  nowMs: number,
  lastShownMs: number | null,
): Whisper | null {
  if (lastShownMs !== null && nowMs - lastShownMs < WHISPER_WINDOW_MS) return null;
  return { rule, text: WHISPER_TEXT[rule], triggerMs, shownMs: nowMs };
}

// The learner starts speaking too soon after Bob's deflection ended.
export function startedTooSoon(speechStartMs: number, deflectionEndMs: number | null): boolean {
  return deflectionEndMs !== null && speechStartMs - deflectionEndMs < NO_PAUSE_MS;
}
