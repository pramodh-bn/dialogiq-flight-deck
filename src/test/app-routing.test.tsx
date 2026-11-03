import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

const makeRouter = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const matches = makeRouter().matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("carries the session through the Arena and Flight Recorder URLs", () => {
    const router = makeRouter();

    for (const path of ["/arena", "/flight-recorder"]) {
      expect(router.matchRoutes(path, { sessionId: 12 }).at(-1)?.search).toMatchObject({
        sessionId: 12,
      });
    }
  });

  it("drops an invalid session id rather than passing it to the API", () => {
    for (const path of ["/arena", "/flight-recorder"]) {
      const search = makeRouter().matchRoutes(path, { sessionId: "abc" }).at(-1)?.search;

      expect(search).toHaveProperty("sessionId", undefined);
    }
  });
});
