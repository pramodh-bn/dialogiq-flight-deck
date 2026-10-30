import type { DialogApi } from "./types";

// Must outlast the backend's 30-second persona timeout, so the server decides that case.
const REQUEST_TIMEOUT_MS = 45_000;

function parseDetail(body: string): { code: string | null; retryable: boolean } {
  try {
    const detail = (JSON.parse(body) as { detail?: { code?: unknown; retryable?: unknown } })
      .detail;
    return {
      code: typeof detail?.code === "string" ? detail.code : null,
      retryable: detail?.retryable === true,
    };
  } catch {
    return { code: null, retryable: false };
  }
}

export class ApiError extends Error {
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`DialogIQ API ${path} failed with ${status}`);
    this.name = "ApiError";
    ({ code: this.code, retryable: this.retryable } = parseDetail(body));
  }
}

export function createHttpApi(baseUrl: string, fetchImpl: typeof fetch = fetch): DialogApi {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init?: RequestInit, key?: string): Promise<T> {
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
    });
    if (!res.ok) throw new ApiError(res.status, path, await res.text());
    return (await res.json()) as T;
  }

  const post = <T>(path: string, body: unknown, key: string) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, key);

  return {
    listScenarios: () => request("/api/scenarios"),
    getScenario: (id) => request(`/api/scenarios/${id}`),
    listSessions: (scenarioId) => request(`/api/sessions?scenario_id=${scenarioId}`),
    createSession: (req, key) => post("/api/sessions", req, key),
    getSession: (id) => request(`/api/sessions/${id}`),
    getTree: (id) => request(`/api/sessions/${id}/tree`),
    sendTurn: (req, key) => post("/api/chat/turn", req, key),
    createBranch: (id, req, key) => post(`/api/sessions/${id}/branches`, req, key),
    selectBranch: (id, req, key) =>
      request(
        `/api/sessions/${id}/active-branch`,
        { method: "PUT", body: JSON.stringify(req) },
        key,
      ),
  };
}
