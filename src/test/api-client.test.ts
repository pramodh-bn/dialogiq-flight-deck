import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ApiError, type DialogApi } from "@/lib/api";
import { createHttpApi } from "@/lib/api/http";
import { createMockApi, mockScenarios } from "@/lib/api/mock";
import { classifyTurn } from "@/lib/classify";

const KEY = "3f2b8c1e-7a4d-4e8f-9b1a-2c3d4e5f6a7b";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function capturingFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body, status));
}

describe("classifyTurn", () => {
  it("labels open, closed, and statement turns", () => {
    expect(classifyTurn("What's been hardest this quarter?").questionType).toBe("open");
    expect(classifyTurn("Did you know the deadline slipped?").questionType).toBe("closed");
    expect(classifyTurn("That sounds really frustrating.").questionType).toBe("statement");
    expect(classifyTurn("That sounds really frustrating.").empathy).toBe(true);
  });

  it("treats an acknowledgment followed by an open question as open", () => {
    expect(classifyTurn("That sounds hard. How could I help?").questionType).toBe("open");
    expect(classifyTurn("How did you feel? Did it help?").questionType).toBe("open");
  });

  it("does not match a prefix inside a longer word", () => {
    expect(classifyTurn("Whatification is not a question.").questionType).toBe("statement");
  });

  it("flags leading turns of any class without changing their type", () => {
    expect(classifyTurn("What is obviously your fault?")).toMatchObject({
      questionType: "open",
      leading: true,
    });
    expect(classifyTurn("You must feel worried.")).toMatchObject({
      questionType: "statement",
      leading: true,
    });
  });
});

describe("HTTP adapter", () => {
  it("lists scenarios from /api/scenarios, trimming the base URL's trailing slash", async () => {
    const fetchImpl = capturingFetch([]);
    const api = createHttpApi("http://localhost:8080/", fetchImpl);

    await expect(api.listScenarios()).resolves.toEqual([]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://localhost:8080/api/scenarios");
  });

  it("sends a chat turn as snake_case JSON with its idempotency key", async () => {
    const fetchImpl = capturingFetch({ turn_id: 1 });
    const api = createHttpApi("http://api", fetchImpl);
    const req = {
      session_id: 4,
      branch_id: 9,
      parent_node_id: null,
      expected_revision: 0,
      user_message: "What happened?",
    };

    await api.sendTurn(req, KEY);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api/api/chat/turn");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Idempotency-Key": KEY });
    expect(JSON.parse(String(init?.body))).toEqual(req);
  });

  it("omits the idempotency header on reads", async () => {
    const fetchImpl = capturingFetch({});
    await createHttpApi("http://api", fetchImpl).getTree(4);

    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api/api/sessions/4/tree");
    expect(fetchImpl.mock.calls[0]![1]?.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("uses the contract's paths and methods for the remaining operations", async () => {
    const fetchImpl = capturingFetch({});
    const api = createHttpApi("http://api", fetchImpl);

    await api.listSessions(2);
    await api.createBranch(
      4,
      { source_branch_id: 1, rewind_to_node_id: null, expected_revision: 3 },
      KEY,
    );
    await api.selectBranch(4, { branch_id: 1, expected_revision: 4 }, KEY);

    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, init?.method]);
    expect(calls).toEqual([
      ["http://api/api/sessions?scenario_id=2", undefined],
      ["http://api/api/sessions/4/branches", "POST"],
      ["http://api/api/sessions/4/active-branch", "PUT"],
    ]);
  });

  it("reads the error envelope's code and retryable flag", async () => {
    const detail = { code: "persona_timeout", message: "Timed out.", retryable: true };
    const api = createHttpApi("http://api", capturingFetch({ detail }, 504));

    await expect(api.createSession({ scenario_id: 1 }, KEY)).rejects.toMatchObject({
      name: "ApiError",
      status: 504,
      path: "/api/sessions",
      code: "persona_timeout",
      retryable: true,
    });
  });

  it("still raises ApiError when the body is not the envelope", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const api = createHttpApi("http://api", fetchImpl);

    const error = await api.getSession(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: null, retryable: false });
  });
});

async function startTurn(api: DialogApi, text = "What happened?", key = crypto.randomUUID()) {
  const session = await api.createSession({ scenario_id: 1 }, crypto.randomUUID());
  const res = await api.sendTurn(
    {
      session_id: session.id,
      branch_id: session.active_branch_id,
      parent_node_id: null,
      expected_revision: 0,
      user_message: text,
    },
    key,
  );
  return { session, res };
}

function nextTurn(api: DialogApi, session: Awaited<ReturnType<DialogApi["getSession"]>>) {
  return (text: string) =>
    api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: session.active_head_node_id,
        expected_revision: session.revision,
        user_message: text,
      },
      crypto.randomUUID(),
    );
}

describe("mock adapter", () => {
  it("gives every scenario its own persona and opening", async () => {
    const api = createMockApi();
    await expect(api.listScenarios()).resolves.toEqual(mockScenarios);
    const openings = mockScenarios.map((s) => s.persona.opening_message);
    expect(new Set(openings).size).toBe(mockScenarios.length);
  });

  it("creates one run per idempotency key", async () => {
    const api = createMockApi();
    const a = await api.createSession({ scenario_id: 2 }, KEY);
    const b = await api.createSession({ scenario_id: 2 }, KEY);

    expect(b).toEqual(a);
    await expect(api.listSessions(2)).resolves.toHaveLength(1);
    await expect(api.createSession({ scenario_id: 3 }, KEY)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("commits a turn and replays it without adding another", async () => {
    const api = createMockApi(() => 0);
    const { session, res } = await startTurn(api, "What got in the way?", KEY);

    expect(res.turn_id).toBe(res.node.id);
    expect(res.revealed_node_score).toBe(1);
    expect(res.session).toMatchObject({ revision: 1, active_head_node_id: res.node.id });

    const replay = await api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: null,
        expected_revision: 0,
        user_message: "What got in the way?",
      },
      KEY,
    );
    expect(replay).toEqual(res);
    await expect(api.getTree(session.id)).resolves.toMatchObject({
      nodes: [{ id: res.node.id }],
    });
  });

  it("rejects a stale revision", async () => {
    const api = createMockApi();
    const { session } = await startTurn(api);

    await expect(
      api.sendTurn(
        {
          session_id: session.id,
          branch_id: session.active_branch_id,
          parent_node_id: null,
          expected_revision: 0,
          user_message: "How?",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409, code: "stale_revision" });
  });

  it("scores a closed turn zero and marks it a dead end", async () => {
    const { res } = await startTurn(createMockApi(), "Did you finish it?");

    expect(res.node.score).toBe(0);
    expect(res.node.coaching).toMatchObject({ question_type: "closed", outcome: "deadend" });
  });

  it("keeps the original branch intact after an inclusive rewind", async () => {
    const api = createMockApi();
    const { session, res } = await startTurn(api);
    const second = await nextTurn(api, res.session)("How did that feel?");
    const third = await nextTurn(api, second.session)("What would help?");
    const originalBranch = session.active_branch_id;

    const { branch, session: rewound } = await api.createBranch(
      session.id,
      {
        source_branch_id: originalBranch,
        rewind_to_node_id: res.node.id,
        expected_revision: third.session.revision,
      },
      crypto.randomUUID(),
    );
    expect(branch).toMatchObject({ fork_node_id: res.node.id, head_node_id: res.node.id });
    expect(rewound).toMatchObject({ active_branch_id: branch.id, score: 1 });

    const alternate = await nextTurn(api, rewound)("Did you finish it?");
    expect(alternate.node.parent_id).toBe(res.node.id);
    expect(alternate.session.score).toBe(1);

    const back = await api.selectBranch(
      session.id,
      { branch_id: originalBranch, expected_revision: alternate.session.revision },
      crypto.randomUUID(),
    );
    expect(back).toMatchObject({ active_head_node_id: third.node.id, score: 3 });
  });

  it("refuses to rewind to a node outside the source branch", async () => {
    const api = createMockApi();
    const { session, res } = await startTurn(api);
    const { branch, session: rewound } = await api.createBranch(
      session.id,
      { source_branch_id: session.active_branch_id, rewind_to_node_id: null, expected_revision: 1 },
      crypto.randomUUID(),
    );

    await expect(
      api.createBranch(
        session.id,
        {
          source_branch_id: branch.id,
          rewind_to_node_id: res.node.id,
          expected_revision: rewound.revision,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "rewind_target_not_on_branch" });
  });
});

// Guards the mock against drifting from the agreed wire format.
describe("contract examples", () => {
  const contract = readFileSync(resolve(process.cwd(), "docs/api_contract.md"), "utf8");
  const examples = [...contract.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
  const example = (field: string) => examples.find((e) => field in e)!;
  const keys = (value: object) => Object.keys(value).sort();

  it("matches the turn response example field for field", async () => {
    const { res } = await startTurn(createMockApi());
    const reply = example("turn_id") as unknown as typeof res;

    expect(keys(res)).toEqual(keys(reply));
    expect(keys(res.node)).toEqual(keys(reply.node));
    expect(keys(res.node.coaching)).toEqual(keys(reply.node.coaching));
    expect(keys(res.session)).toEqual(keys(reply.session));
  });

  it("matches the scenario example field for field", () => {
    const scenario = example("persona") as unknown as (typeof mockScenarios)[number];

    expect(keys(mockScenarios[0]!)).toEqual(keys(scenario));
    expect(keys(mockScenarios[0]!.persona)).toEqual(keys(scenario.persona));
  });

  it("uses the contract's exact coaching text for an open turn", async () => {
    const { res } = await startTurn(createMockApi(), "What has this quarter been like for you?");
    const reply = example("turn_id") as unknown as typeof res;

    expect(res.node.coaching).toEqual(reply.node.coaching);
  });
});
