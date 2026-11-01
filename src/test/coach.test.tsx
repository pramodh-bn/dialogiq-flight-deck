import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoachHint } from "@/components/CoachHint";
import {
  api,
  ApiError,
  COACH_CONTRACT_REVISION,
  type CoachHintList,
  type CoachHintRequest,
  type CoachHintResponse,
  type DialogApi,
  type Hint,
  type TurnNode,
} from "@/lib/api";
import { createHttpApi } from "@/lib/api/http";
import { createMockApi } from "@/lib/api/mock";
import {
  hintsAtHead,
  isStalled,
  latestEarlierHint,
  mergeHint,
  observeCoachHint,
  useCoach,
} from "@/lib/practice";

// The accepted contract's own examples, so the client cannot drift from them.
const fixtures = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/cs45-coaching-fixtures.json"), "utf8"),
) as {
  contract_revision: string;
  success: CoachHintResponse;
  fallback: CoachHintResponse;
  second_success: CoachHintResponse;
  list_with_two: CoachHintList;
  errors: { status: number; body: { detail: { code: string; retryable: boolean } } }[];
};

const keysOf = (value: object) => Object.keys(value).sort();

function errorFor(code: string) {
  const fixture = fixtures.errors.find((e) => e.body.detail.code === code)!;
  return new ApiError(fixture.status, "/coach", JSON.stringify(fixture.body));
}

const hint = (over: Partial<Hint> = {}): Hint => ({ ...fixtures.success.hint, ...over });

const node = (id: number, score: number) => ({ id, score }) as TurnNode;

const request: CoachHintRequest = {
  branch_id: 31,
  head_node_id: 103,
  expected_revision: 4,
  trigger: "automatic",
  attempt: 1,
};

const emptyList: CoachHintList = {
  session_id: 12,
  branch_id: 31,
  head_node_id: 103,
  revision: 4,
  hints: [],
};

afterEach(() => vi.restoreAllMocks());

describe("contract fixtures", () => {
  it("pins the accepted revision", () => {
    expect(COACH_CONTRACT_REVISION).toBe(fixtures.contract_revision);
  });

  it("gets the mock's response in the contract's shape", async () => {
    const mock = createMockApi();
    const session = await mock.createSession({ scenario_id: 1 }, crypto.randomUUID());
    const res = await mock.requestCoachHint(
      session.id,
      {
        branch_id: session.active_branch_id,
        head_node_id: null,
        expected_revision: 0,
        trigger: "requested",
        attempt: 1,
      },
      crypto.randomUUID(),
    );

    expect(keysOf(res)).toEqual(keysOf(fixtures.success));
    expect(keysOf(res.hint)).toEqual(keysOf(fixtures.success.hint));
  });

  it("orders a head's two hints as the contract's GET example does", () => {
    const hints = hintsAtHead(fixtures.list_with_two, 103);

    expect(hints.map((h) => h.attempt)).toEqual([1, 2]);
    expect(hints.map((h) => h.source)).toEqual(["deterministic", "meta"]);
  });
});

describe("HTTP adapter", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("posts the request with its key and the remaining budget", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json(fixtures.success),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await createHttpApi("http://api", fetchImpl).requestCoachHint(12, request, "k", 6_000);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api/api/sessions/12/coach-hints");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "k" });
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(timeout).toHaveBeenCalledWith(6_000);
  });

  it("reads hints from the branch route without a key", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json(emptyList),
    );

    await createHttpApi("http://api", fetchImpl).listCoachHints(12, 31);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api/api/sessions/12/branches/31/coach-hints");
    expect(init?.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("reads hints within the budget it is given", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json(emptyList),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await createHttpApi("http://api", fetchImpl).listCoachHints(12, 31, 4_000);

    expect(timeout).toHaveBeenCalledWith(4_000);
  });
});

describe("the automatic trigger", () => {
  it("fires on a turn that revealed nothing, and only then", () => {
    expect(isStalled([])).toBe(false);
    expect(isStalled([node(1, 0)])).toBe(true);
    expect(isStalled([node(1, 1)])).toBe(false);
    expect(isStalled([node(1, 2), node(2, 2)])).toBe(true);
    expect(isStalled([node(1, 2), node(2, 3)])).toBe(false);
  });

  it("stays quiet at seven", () => {
    expect(isStalled([node(1, 7), node(2, 7)])).toBe(false);
  });
});

describe("hint lists", () => {
  const entry = (head_node_id: number | null, over: Partial<Hint> = {}) => ({
    head_node_id,
    hint: hint(over),
  });

  it("ignores hints saved under another contract revision", () => {
    const list = {
      ...emptyList,
      hints: [entry(103, { contract_revision: "s3-coach-r1" })],
    };

    expect(hintsAtHead(list, 103)).toEqual([]);
    expect(latestEarlierHint(list, 104)).toBeUndefined();
  });

  it("finds the most recent hint from before this head", () => {
    const list = {
      ...emptyList,
      hints: [entry(null, { id: 1 }), entry(101, { id: 2 }), entry(103, { id: 3 })],
    };

    expect(latestEarlierHint(list, 103)?.hint.id).toBe(2);
  });

  it("does not add the same hint twice", () => {
    const list = { ...emptyList, hints: [entry(103)] };

    expect(mergeHint(list, entry(103))).toBe(list);
  });
});

describe("the mock's attempt rules", () => {
  async function stalledSession(mock: DialogApi) {
    const session = await mock.createSession({ scenario_id: 1 }, crypto.randomUUID());
    const turn = await mock.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: null,
        expected_revision: 0,
        user_message: "Did you finish it?",
      },
      crypto.randomUUID(),
    );
    const base: CoachHintRequest = {
      branch_id: session.active_branch_id,
      head_node_id: turn.node.id,
      expected_revision: 1,
      trigger: "requested",
      attempt: 1,
    };
    return { id: session.id, base };
  }

  it("refuses a second attempt before the first is saved", async () => {
    const mock = createMockApi();
    const { id, base } = await stalledSession(mock);

    await expect(
      mock.requestCoachHint(id, { ...base, attempt: 2 }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409, code: "hint_not_ready", retryable: true });
  });

  it("refuses an automatic second attempt and a third", async () => {
    const mock = createMockApi();
    const { id, base } = await stalledSession(mock);

    await expect(
      mock.requestCoachHint(id, { ...base, trigger: "automatic", attempt: 2 }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 422, code: "validation_error" });
    await expect(
      mock.requestCoachHint(id, { ...base, attempt: 3 as 2 }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 422, code: "validation_error" });
  });

  it("keeps two different fallbacks and never replaces the first", async () => {
    const mock = createMockApi();
    const { id, base } = await stalledSession(mock);

    const first = await mock.requestCoachHint(id, base, crypto.randomUUID());
    const second = await mock.requestCoachHint(id, { ...base, attempt: 2 }, crypto.randomUUID());
    const firstAgain = await mock.requestCoachHint(
      id,
      { ...base, trigger: "automatic" },
      crypto.randomUUID(),
    );

    expect(second.hint.approach).not.toBe(first.hint.approach);
    expect(firstAgain.hint).toEqual(first.hint);
    const list = await mock.listCoachHints(id, base.branch_id);
    expect(list.hints.map((h) => h.hint.attempt)).toEqual([1, 2]);
  });

  it("uses a different template for a second attempt at the root", async () => {
    const mock = createMockApi();
    const session = await mock.createSession({ scenario_id: 1 }, crypto.randomUUID());
    const base: CoachHintRequest = {
      branch_id: session.active_branch_id,
      head_node_id: null,
      expected_revision: 0,
      trigger: "requested",
      attempt: 1,
    };

    const first = await mock.requestCoachHint(session.id, base, crypto.randomUUID());
    const second = await mock.requestCoachHint(
      session.id,
      { ...base, attempt: 2 },
      crypto.randomUUID(),
    );

    expect(first.hint.approach).toBe("Start with a low-pressure invitation.");
    expect(second.hint.approach).toBe("Ask permission for one small question.");
  });

  it("labels every mock hint as a fallback, never as live coaching", async () => {
    const mock = createMockApi();
    const { id, base } = await stalledSession(mock);

    const { hint: saved } = await mock.requestCoachHint(id, base, crypto.randomUUID());

    expect(saved).toMatchObject({ source: "deterministic", fallback_reason: "not_configured" });
  });

  it("refuses automatic help at the root", async () => {
    const mock = createMockApi();
    const session = await mock.createSession({ scenario_id: 1 }, crypto.randomUUID());

    await expect(
      mock.requestCoachHint(
        session.id,
        {
          branch_id: session.active_branch_id,
          head_node_id: null,
          expected_revision: 0,
          trigger: "automatic",
          attempt: 1,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 422, code: "hint_not_eligible" });
  });
});

describe("observeCoachHint", () => {
  function clock() {
    let time = 0;
    return {
      now: () => time,
      sleep: vi.fn(async (ms: number) => {
        time += ms;
      }),
    };
  }

  const run = (timing = clock(), isCurrent = () => true) =>
    observeCoachHint({ sessionId: 12, request, key: "k", isCurrent, ...timing });

  it("returns the hint from a single call", async () => {
    vi.spyOn(api, "requestCoachHint").mockResolvedValue(fixtures.success);

    await expect(run()).resolves.toEqual({
      kind: "hint",
      hint: fixtures.success.hint,
      revision: 4,
    });
  });

  it("keeps the same key and watches GET through a generation running elsewhere", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValueOnce(errorFor("request_in_progress"))
      .mockRejectedValueOnce(errorFor("request_in_progress"))
      .mockResolvedValue(fixtures.success);
    const list = vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);
    const timing = clock();

    const outcome = await run(timing);

    expect(outcome.kind).toBe("hint");
    expect(post.mock.calls.map((c) => c[2])).toEqual(["k", "k", "k"]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(timing.sleep.mock.calls).toEqual([[2_000], [2_000]]);
  });

  it("gives each attempt only what remains of one budget", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValueOnce(errorFor("request_in_progress"))
      .mockResolvedValue(fixtures.success);
    vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await run();

    expect(post.mock.calls.map((c) => c[3])).toEqual([15_000, 13_000]);
  });

  it("gives the recovery GET after a network error only what remains", async () => {
    const timing = clock();
    vi.spyOn(api, "requestCoachHint").mockImplementation(async () => {
      await timing.sleep(6_000);
      throw new TypeError("network");
    });
    const list = vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await expect(run(timing)).resolves.toEqual({ kind: "unresolved" });

    expect(list.mock.calls[0]![2]).toBe(9_000);
  });

  it("gives the GET after a late 409 only what remains", async () => {
    const timing = clock();
    vi.spyOn(api, "requestCoachHint").mockImplementation(async () => {
      await timing.sleep(14_000);
      throw errorFor("request_in_progress");
    });
    const list = vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await expect(run(timing)).resolves.toEqual({ kind: "unresolved" });

    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]![2]).toBe(1_000);
  });

  it("skips the GET once the budget is gone", async () => {
    const timing = clock();
    vi.spyOn(api, "requestCoachHint").mockImplementation(async () => {
      await timing.sleep(15_000);
      throw new TypeError("timed out");
    });
    const list = vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await expect(run(timing)).resolves.toEqual({ kind: "unresolved" });

    expect(list).not.toHaveBeenCalled();
  });

  it("stops at the first GET that shows the hint", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValue(errorFor("request_in_progress"));
    vi.spyOn(api, "listCoachHints").mockResolvedValue({
      ...emptyList,
      hints: [{ head_node_id: 103, hint: hint({ id: 99 }) }],
    });

    const outcome = await run();

    expect(post).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ kind: "hint", hint: { id: 99 } });
  });

  it("treats a second attempt racing its first the same way", async () => {
    vi.spyOn(api, "requestCoachHint")
      .mockRejectedValueOnce(errorFor("hint_not_ready"))
      .mockResolvedValue(fixtures.second_success);
    vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    const outcome = await observeCoachHint({
      sessionId: 12,
      request: { ...request, trigger: "requested", attempt: 2 },
      key: "k",
      isCurrent: () => true,
      ...clock(),
    });

    expect(outcome).toMatchObject({ kind: "hint", hint: { attempt: 2 } });
  });

  it("gives up after 15 seconds, leaving the key usable", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValue(errorFor("request_in_progress"));
    vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await expect(run()).resolves.toEqual({ kind: "unresolved" });
    expect(post).toHaveBeenCalledTimes(8);
  });

  it.each(["stale_revision", "inactive_branch", "parent_mismatch", "idempotency_conflict"])(
    "stops on %s without retrying",
    async (code) => {
      const post = vi.spyOn(api, "requestCoachHint").mockRejectedValue(errorFor(code));

      await expect(run()).resolves.toEqual({ kind: "state_changed" });
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it("never retries a 404, 422 or 500 by itself", async () => {
    const post = vi.spyOn(api, "requestCoachHint");

    post.mockRejectedValueOnce(errorFor("hint_not_eligible"));
    await expect(run()).resolves.toEqual({ kind: "not_eligible" });
    post.mockRejectedValueOnce(errorFor("branch_not_found"));
    await expect(run()).resolves.toEqual({ kind: "failed" });
    post.mockRejectedValueOnce(new ApiError(500, "/coach", "nope"));
    await expect(run()).resolves.toEqual({ kind: "failed" });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("checks GET after a lost response, then leaves the retry to the learner", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const list = vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);

    await expect(run()).resolves.toEqual({ kind: "unresolved" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("drops a late result once the learner has moved on", async () => {
    vi.spyOn(api, "requestCoachHint").mockResolvedValue(fixtures.success);

    await expect(run(clock(), () => false)).resolves.toEqual({ kind: "abandoned" });
  });

  it("stops retrying once the learner has moved on", async () => {
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValue(errorFor("request_in_progress"));
    vi.spyOn(api, "listCoachHints").mockResolvedValue(emptyList);
    let current = true;
    const timing = clock();
    timing.sleep.mockImplementation(async () => {
      current = false;
    });

    await expect(run(timing, () => current)).resolves.toEqual({ kind: "abandoned" });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("useCoach", () => {
  const position = { branchId: 31, headId: 103, revision: 4 };

  function wrapper(strict = false) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => {
      const tree = <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      return strict ? <StrictMode>{tree}</StrictMode> : tree;
    };
  }

  const stubList = (list: CoachHintList = emptyList) =>
    vi.spyOn(api, "listCoachHints").mockResolvedValue(list);

  it("asks once on a stalled head, even under StrictMode's double mount", async () => {
    stubList();
    const post = vi.spyOn(api, "requestCoachHint").mockResolvedValue(fixtures.success);

    const { result } = renderHook(
      () => useCoach({ sessionId: 12, position, stalled: true, hold: false }),
      { wrapper: wrapper(true) },
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(post.mock.calls[0]![1]).toEqual({ ...request, attempt: 1 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not call the model when this head already has a saved hint", async () => {
    const list = stubList({
      ...emptyList,
      hints: [{ head_node_id: 103, hint: fixtures.success.hint }],
    });
    const post = vi.spyOn(api, "requestCoachHint");

    const { result } = renderHook(
      () => useCoach({ sessionId: 12, position, stalled: true, hold: false }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.hints).toHaveLength(1));
    expect(list).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("does not ask automatically on a head that made progress", async () => {
    const list = stubList();
    const post = vi.spyOn(api, "requestCoachHint");

    renderHook(() => useCoach({ sessionId: 12, position, stalled: false, hold: false }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });

  it("does not ask while a turn is in flight", async () => {
    const list = stubList();
    const post = vi.spyOn(api, "requestCoachHint");

    renderHook(() => useCoach({ sessionId: 12, position, stalled: true, hold: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });

  it("moves from a first request to a second, then stops at two", async () => {
    stubList({ ...emptyList, hints: [{ head_node_id: 103, hint: fixtures.success.hint }] });
    const post = vi.spyOn(api, "requestCoachHint").mockResolvedValue(fixtures.second_success);

    const { result } = renderHook(
      () => useCoach({ sessionId: 12, position, stalled: false, hold: false }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.hints).toHaveLength(1));

    stubList({
      ...emptyList,
      hints: [
        { head_node_id: 103, hint: fixtures.success.hint },
        { head_node_id: 103, hint: fixtures.second_success.hint },
      ],
    });
    act(() => result.current.requestHelp());

    await waitFor(() => expect(result.current.exhausted).toBe(true));
    expect(post.mock.calls[0]![1]).toMatchObject({ trigger: "requested", attempt: 2 });

    act(() => result.current.requestHelp());
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("shows nothing from a head the learner has left", async () => {
    stubList();
    let resolvePost: (value: CoachHintResponse) => void = () => {};
    const post = vi.spyOn(api, "requestCoachHint").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ head }) =>
        useCoach({
          sessionId: 12,
          position: { ...position, headId: head },
          stalled: head === 103,
          hold: false,
        }),
      { wrapper: wrapper(), initialProps: { head: 103 } },
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(result.current.pending).toBe(true);

    rerender({ head: 104 });
    await waitFor(() => expect(result.current.pending).toBe(false));
    await act(async () => resolvePost(fixtures.success));

    expect(result.current.hints).toEqual([]);
  });

  it("does not let a late result end the newer request's pending state", async () => {
    stubList();
    const resolvers: ((value: CoachHintResponse) => void)[] = [];
    const post = vi.spyOn(api, "requestCoachHint").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ head }) =>
        useCoach({
          sessionId: 12,
          position: { ...position, headId: head },
          stalled: true,
          hold: false,
        }),
      { wrapper: wrapper(), initialProps: { head: 103 } },
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    rerender({ head: 104 });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(result.current.pending).toBe(true);

    await act(async () => resolvers[0]!(fixtures.success));

    expect(result.current.pending).toBe(true);
  });

  it.each([
    ["hint_not_eligible", "the server refused"],
    ["stale_revision", "the state moved"],
  ])("does not ask again by itself after %s", async (code) => {
    stubList();
    // Takes as long as a real request, so the pending state renders before it clears.
    const post = vi.spyOn(api, "requestCoachHint").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw errorFor(code);
    });

    const { result } = renderHook(
      () => useCoach({ sessionId: 12, position, stalled: true, hold: false }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(post).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("retries an unresolved action with the same key", async () => {
    stubList();
    const post = vi
      .spyOn(api, "requestCoachHint")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(fixtures.success);

    const { result } = renderHook(
      () => useCoach({ sessionId: 12, position, stalled: true, hold: false }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.canRetry).toBe(true));

    act(() => result.current.requestHelp());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect(post.mock.calls[1]![1]).toEqual(post.mock.calls[0]![1]);
    expect(post.mock.calls[1]![2]).toBe(post.mock.calls[0]![2]);
  });
});

describe("CoachHint", () => {
  const base = { hints: [], earlierLabel: "From turn 2", pending: false, failure: null };

  it("labels provider and fallback hints honestly", () => {
    const { rerender } = render(<CoachHint {...base} hints={[fixtures.success.hint]} />);
    expect(screen.getByText("AI coach")).toBeInTheDocument();

    rerender(<CoachHint {...base} hints={[fixtures.fallback.hint]} />);
    expect(screen.getByText("Basic hint")).toBeInTheDocument();
    expect(screen.queryByText("AI coach")).not.toBeInTheDocument();
  });

  it("shows the second approach and tucks the first away", () => {
    render(<CoachHint {...base} hints={[fixtures.fallback.hint, fixtures.second_success.hint]} />);

    expect(screen.getByText(fixtures.second_success.hint.approach)).toBeVisible();
    expect(screen.getByText("First approach")).toBeInTheDocument();
  });

  it("renders markup in a hint as text", () => {
    const { container } = render(
      <CoachHint {...base} hints={[hint({ approach: "<img src=x onerror=alert(1)>" })]} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("labels an earlier hint for its turn while the next one loads", () => {
    render(<CoachHint {...base} pending earlier={fixtures.success.hint} />);

    expect(screen.getByText("From turn 2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Getting a hint…");
  });

  it("does not present an earlier hint as the current one", () => {
    render(<CoachHint {...base} pending hints={[]} earlier={fixtures.success.hint} />);

    expect(screen.getByRole("status")).not.toHaveTextContent(fixtures.success.hint.approach);
  });
});
