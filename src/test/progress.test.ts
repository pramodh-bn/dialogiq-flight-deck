import { describe, expect, it } from "vitest";

import { createMockApi, mockScenarios } from "@/lib/api/mock";
import type { DialogApi, PracticeSession, Scenario } from "@/lib/api/types";
import { applyTurn, branchChain, createSessionBody, stanceChange } from "@/lib/practice";

const bob = mockScenarios[0]!;
const other = mockScenarios[1]!;

async function start(api: DialogApi, scenario: Scenario = bob) {
  return api.createSession(createSessionBody(scenario), crypto.randomUUID());
}

async function say(api: DialogApi, session: PracticeSession, user_message: string) {
  return api.sendTurn(
    {
      session_id: session.id,
      branch_id: session.active_branch_id,
      parent_node_id: session.active_head_node_id,
      expected_revision: session.revision,
      user_message,
    },
    crypto.randomUUID(),
  );
}

describe("behavior opt-in", () => {
  it("asks for the revision only when the scenario lists it", () => {
    expect(createSessionBody(bob)).toEqual({ scenario_id: 1, behavior_revision: "s4-bob-r1" });
    expect(createSessionBody(other)).toEqual({ scenario_id: 2 });
    const { behavior_revisions: _dropped, ...older } = bob;
    expect(createSessionBody(older)).toEqual({ scenario_id: 1 });
  });

  it("leaves legacy sessions without progress and refuses an unlisted revision", async () => {
    const api = createMockApi();
    const legacy = await start(api, other);
    expect(legacy.conversation_progress).toBeNull();
    const { node } = await say(api, legacy, "It sounds like a hard week.");
    expect(node.conversation_progress).toBeNull();
    await expect(
      api.createSession({ scenario_id: 2, behavior_revision: "s4-bob-r1" }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("simulated stance", () => {
  it("starts guarded with the initial explanation", async () => {
    const session = await start(createMockApi());
    expect(session.conversation_progress).toMatchObject({
      stance: "guarded",
      last_signal: "initial",
    });
    expect(stanceChange([])).toBeNull();
  });

  it("moves without a scored need and keeps resistance equal to stance", async () => {
    const api = createMockApi();
    const session = await start(api);
    const { node } = await say(api, session, "It sounds like a hard week.");
    expect(node.score).toBe(0);
    expect(node.conversation_progress?.stance).toBe("warming");
    expect(node.resistance).toBe("warming");
    expect(stanceChange([node])).toBe("less_guarded");
  });

  it("does not claim an increase for a repeated signal", async () => {
    const api = createMockApi();
    const first = await say(api, await start(api), "It sounds like a hard week.");
    const second = await say(api, first.session, "That sounds hard too.");
    expect(second.node.conversation_progress?.stance).toBe("warming");
    expect(stanceChange([first.node, second.node])).toBe("unchanged");
  });

  it("reports a step back and restores the state on rewind", async () => {
    const api = createMockApi();
    const session = await start(api);
    const first = await say(api, session, "It sounds like a hard week.");
    const second = await say(api, first.session, "Why did you miss it, you always do?");
    expect(second.node.conversation_progress?.last_signal).toBe("pressure");
    expect(stanceChange([first.node, second.node])).toBe("more_guarded");

    const toFirst = await api.createBranch(
      session.id,
      {
        source_branch_id: second.session.active_branch_id,
        rewind_to_node_id: first.node.id,
        expected_revision: second.session.revision,
      },
      crypto.randomUUID(),
    );
    expect(toFirst.session.conversation_progress?.stance).toBe("warming");

    const toRoot = await api.createBranch(
      session.id,
      {
        source_branch_id: toFirst.session.active_branch_id,
        rewind_to_node_id: null,
        expected_revision: toFirst.session.revision,
      },
      crypto.randomUUID(),
    );
    expect(toRoot.session.conversation_progress?.last_signal).toBe("initial");
  });

  it("keeps progress on the branch after a turn is applied to a cached tree", async () => {
    const api = createMockApi();
    const session = await start(api);
    const tree = await api.getTree(session.id);
    const res = await say(api, session, "It sounds like a hard week.");
    const next = applyTurn(tree, res);
    expect(next.branches[0]?.conversation_progress?.stance).toBe("warming");
    expect(stanceChange(branchChain(next.nodes, res.node.id))).toBe("less_guarded");
  });
});
