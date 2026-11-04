import type { ReactNode } from "react";
import type { FeedbackStatus } from "@/lib/api/types";

export function SemanticFeedback({
  feedback,
  turns,
  persona,
  children,
}: {
  feedback: FeedbackStatus | null;
  turns: number;
  persona: string;
  children: ReactNode;
}) {
  return (
    <>
      {feedback && (
        <p className="text-xs text-muted-foreground" role="status">
          {feedback.evaluated_turns} of {turns} turns evaluated.
          {feedback.skipped_turns > 0 && ` ${feedback.skipped_turns} unavailable.`} AI feedback
          describes this rehearsal, not real trust or ability.
        </p>
      )}
      {feedback?.status === "unavailable" ? (
        <div className="rounded-lg border border-border p-3" role="status">
          <p className="font-semibold">Feedback unavailable for this turn</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your conversation is saved. Earlier feedback is retained; this turn was not counted as
            zero progress. Continue the conversation normally.
          </p>
        </div>
      ) : (
        children
      )}
      {!!feedback?.evidence.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Evidence for this turn</summary>
          {feedback.evidence.map((item, index) => (
            <p key={index} className="mt-2">
              {item.role === "user" ? "You" : persona}: “{item.quote}”
            </p>
          ))}
        </details>
      )}
    </>
  );
}
