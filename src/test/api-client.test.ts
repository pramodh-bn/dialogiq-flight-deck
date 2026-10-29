import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { createHttpApi } from "@/lib/api/http";
import { createMockApi, mockScenarios } from "@/lib/api/mock";
import { classifyTurn } from "@/lib/classify";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("classifyTurn", () => {
  it("labels open, closed, and empathy turns", () => {
    expect(classifyTurn("What's been hardest this quarter?")).toMatchObject({
      open: true,
      closed: false,
    });
    expect(classifyTurn("Did you know the deadline slipped?")).toMatchObject({
      open: false,
      closed: true,
    });
    expect(classifyTurn("That sounds really frustrating.").empathy).toBe(true);
  });

  it("never marks a turn both open and closed", () => {
    const c = classifyTurn("How did you feel? Did it help?");
    expect(c.open && c.closed).toBe(false);
  });
});

describe("HTTP adapter", () => {
  it("lists scenarios from /api/scenarios, trimming the base URL's trailing slash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ id: 7, title: "T", description: null }]));
    const api = createHttpApi("http://localhost:8000/", fetchImpl);

    await expect(api.listScenarios()).resolves.toEqual([{ id: 7, title: "T", description: null }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8000/api/scenarios",
      expect.anything(),
    );
  });

  it("posts a chat turn as snake_case JSON", async () => {
    const reply = { turn_id: 1, character_response: "Hi", revealed_node_score: 3 };
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(reply),
    );
    const api = createHttpApi("http://api", fetchImpl);

    await expect(api.sendTurn({ session_id: 4, user_message: "What happened?" })).resolves.toEqual(
      reply,
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api/api/chat/turn");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      session_id: 4,
      user_message: "What happened?",
    });
  });

  it("raises ApiError with the status on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 422 }));
    const api = createHttpApi("http://api", fetchImpl);

    await expect(api.createSession({ scenario_id: 1 })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      path: "/api/sessions",
    });
    await expect(api.createSession({ scenario_id: 1 })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mock adapter", () => {
  it("serves the canned scenarios and numbered sessions", async () => {
    const api = createMockApi();
    await expect(api.listScenarios()).resolves.toEqual(mockScenarios);
    const a = await api.createSession({ scenario_id: 2 });
    const b = await api.createSession({ scenario_id: 2 });
    expect(a).toEqual({ id: 1, scenario_id: 2, score: 0 });
    expect(b.id).toBe(2);
  });

  it("counts turns per session and replies from the matching pool", async () => {
    const api = createMockApi(() => 0);
    const { id } = await api.createSession({ scenario_id: 1 });

    const closed = await api.sendTurn({ session_id: id, user_message: "Is that all?" });
    const open = await api.sendTurn({ session_id: id, user_message: "What got in the way?" });

    expect(closed).toEqual({
      turn_id: 1,
      character_response: "Yeah. I guess. Is that all?",
      revealed_node_score: null,
    });
    expect(open.turn_id).toBe(2);
    expect(open.character_response).toMatch(/^Honestly\?/);
  });
});
