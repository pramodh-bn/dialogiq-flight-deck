import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import type { DialogApi } from "./types";

export * from "./types";
export { ApiError } from "./http";

// Set VITE_API_BASE_URL (e.g. http://127.0.0.1:8080) to talk to the FastAPI backend;
// leave it unset to run on the in-browser mock.
const baseUrl: unknown = import.meta.env["VITE_API_BASE_URL"];

// Demo waiting, per docs/cs60-demo-wait-delta.md. Pair it with COACH_DEMO_WAIT=1 on the
// backend. Only the exact string 1 turns it on.
export const COACH_DEMO_WAIT: boolean = import.meta.env["VITE_COACH_DEMO_WAIT"] === "1";

export const api: DialogApi =
  typeof baseUrl === "string" && baseUrl ? createHttpApi(baseUrl) : createMockApi();
