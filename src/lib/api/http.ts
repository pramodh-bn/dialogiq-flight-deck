import type { DialogApi } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`DialogIQ API ${path} failed with ${status}`);
    this.name = "ApiError";
  }
}

export function createHttpApi(baseUrl: string, fetchImpl: typeof fetch = fetch): DialogApi {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    if (!res.ok) throw new ApiError(res.status, path, await res.text());
    return (await res.json()) as T;
  }

  return {
    listScenarios: () => request("/api/scenarios"),
    createSession: (req) => request("/api/sessions", { method: "POST", body: JSON.stringify(req) }),
    sendTurn: (req) => request("/api/chat/turn", { method: "POST", body: JSON.stringify(req) }),
  };
}
