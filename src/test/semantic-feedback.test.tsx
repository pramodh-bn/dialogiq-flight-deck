import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SemanticFeedback } from "@/components/SemanticFeedback";
import { createMockApi, mockScenarios } from "@/lib/api/mock";
import type { FeedbackStatus } from "@/lib/api/types";
import { createSessionBody, isStalled } from "@/lib/practice";

afterEach(cleanup);
const unavailable: FeedbackStatus = {
  revision: "semantic-r1",
  status: "unavailable",
  evaluated_turns: 2,
  skipped_turns: 1,
  failure_reason: "timeout",
  latency_ms: 12000,
  evidence: [],
};

describe("semantic feedback availability", () => {
  it("hides stale gauges and reports partial coverage after an evaluation failure", () => {
    render(
      <SemanticFeedback feedback={unavailable} turns={3} persona="Bob">
        <p>Needs: 0/7</p>
        <p>Open: 0%</p>
        <p>Empathy: 0%</p>
        <p>Guarded</p>
      </SemanticFeedback>,
    );
    expect(screen.getByText("Feedback unavailable for this turn")).toBeTruthy();
    expect(screen.getByText(/2 of 3 turns evaluated/)).toBeTruthy();
    expect(screen.queryByText("Needs: 0/7")).toBeNull();
    expect(screen.queryByText("Guarded")).toBeNull();
  });
  it("shows validated public speaker evidence beside available gauges", () => {
    render(
      <SemanticFeedback
        feedback={{
          ...unavailable,
          status: "ready",
          failure_reason: null,
          evidence: [{ kind: "stance", role: "user", quote: "Let's share the release work" }],
        }}
        turns={3}
        persona="Bob"
      >
        <p>Warming</p>
      </SemanticFeedback>,
    );
    expect(screen.getByText("Warming")).toBeTruthy();
    expect(screen.getByText(/You:.*share the release work/)).toBeTruthy();
  });
  it("opts in only when the new server capability is advertised", () => {
    const bob = mockScenarios[0]!;
    expect(createSessionBody(bob).feedback_revision).toBeUndefined();
    expect(
      createSessionBody({ ...bob, feedback_revisions: ["semantic-r1"] }).feedback_revision,
    ).toBe("semantic-r1");
    expect(
      createSessionBody({ ...bob, behavior_revisions: [], feedback_revisions: ["semantic-r1"] })
        .feedback_revision,
    ).toBeUndefined();
  });
  it("does not trigger a paid automatic hint merely because feedback failed", async () => {
    const api = createMockApi();
    const session = await api.createSession({ scenario_id: 1 }, crypto.randomUUID());
    const result = await api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: null,
        expected_revision: session.revision,
        user_message: "Hello",
      },
      crypto.randomUUID(),
    );
    expect(isStalled([{ ...result.node, feedback: unavailable }])).toBe(false);
  });
});
