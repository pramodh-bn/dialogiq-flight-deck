import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import type { DialogApi } from "./types";

export * from "./types";
export { ApiError } from "./http";

// Set VITE_API_BASE_URL (e.g. http://127.0.0.1:8080) to talk to the FastAPI backend;
// leave it unset to run on the in-browser mock.
const baseUrl: unknown = import.meta.env["VITE_API_BASE_URL"];

export const api: DialogApi =
  typeof baseUrl === "string" && baseUrl ? createHttpApi(baseUrl) : createMockApi();
