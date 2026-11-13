// Client for /api/v3 (docs/v3/voice-rep-contract.md, v3-r1). Field names stay
// snake_case to match the backend.

import { ApiError } from "@/lib/api/http";
import type { PracticeSession, QuestionType, TurnNode } from "@/lib/api/types";

import { readSse } from "./sse";

export type VoiceEventKind =
  | "learner_speech_start"
  | "learner_speech_end"
  | "bob_audio_start"
  | "bob_audio_end"
  | "whisper_shown"
  | "suggestion_shown";

export type VoiceEvent = {
  seq: number;
  t_ms: number;
  kind: VoiceEventKind;
  node_id?: number;
  interrupted?: boolean;
  rule?: string;
  trigger_ms?: number;
};

export type Scorecard = {
  ruleset: string;
  talk: { learner_ms: number; bob_ms: number; learner_ratio: number | null };
  questions: { closed: number; open: number; meaning: number; statements: number };
  pause_after_deflection: { deflections: number; waited: number; median_gap_ms: number | null };
  interruptions: number;
  rewind_recovery: { rewinds: number; recovered: number };
};

// One saved turn. The model times are measured by the server; the round trip
// runs from the learner's last word to Bob's first audio, in the browser.
export type TurnLatency = {
  node_id: number;
  model_first_sentence_ms: number;
  model_total_ms: number;
  voice_round_trip_ms: number | null;
};

// How long whispers took to appear after their trigger (launch blocker: 90% within limit).
export type WhisperLatency = {
  shown: number;
  within_limit: number;
  limit_ms: number;
  median_ms: number | null;
  max_ms: number | null;
};

export type RepResponse = {
  rep_id: number;
  rep_number: number;
  session_id: number;
  scenario_id: number;
  started_at: string;
  duration_ms: number | null;
  finished: boolean;
  score_ruleset: string;
  scorecard: Scorecard | null;
  latency: TurnLatency[];
  whisper_latency?: WhisperLatency;
  // Which judge decided Bob's needs: the meaning judge or the keyword rules.
  judge?: "semantic-r1" | "keywords";
};

export type RepCreated = {
  rep_id: number;
  rep_number: number;
  session: PracticeSession;
  duration_limit_ms: number;
  score_ruleset: string;
  whisper_ruleset: string;
  judge?: "semantic-r1" | "keywords";
  opening_message: string;
};

export type VoiceTurnRequest = {
  branch_id: number;
  parent_node_id: number | null;
  expected_revision: number;
  user_message: string;
  speech_start_ms: number;
  speech_end_ms: number;
};

export type TurnFacts = {
  question_type: QuestionType;
  leading: boolean;
  meaning: boolean;
  deflection: boolean;
};

// What /api/v3/classify says about one utterance, with no model call.
export type Classified = { question_type: QuestionType; leading: boolean; meaning: boolean };

export type TurnDone = { node: TurnNode; session: PracticeSession; turn: TurnFacts };

// The stream ended with `event: error`, or closed before `done`. Nothing was saved.
export class RepStreamError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Voice turn stream failed: ${code}`);
    this.name = "RepStreamError";
  }
}

export type RepApi = {
  createRep(scenarioId: number, key: string): Promise<RepCreated>;
  streamTurn(
    repId: number,
    request: VoiceTurnRequest,
    key: string,
    onSentence: (index: number, text: string) => void,
    signal?: AbortSignal,
  ): Promise<TurnDone>;
  classify(text: string): Promise<Classified>;
  postEvents(
    repId: number,
    events: VoiceEvent[],
    key: string,
  ): Promise<{ accepted: number; last_seq: number }>;
  finish(repId: number, durationMs: number, key: string): Promise<{ rep: RepResponse }>;
  list(scenarioId: number): Promise<RepResponse[]>;
};

export function createRepApi(baseUrl: string, fetchImpl: typeof fetch = fetch): RepApi {
  const root = baseUrl.replace(/\/+$/, "");

  async function send(
    path: string,
    body: unknown,
    key: string,
    accept: string,
    signal?: AbortSignal,
  ) {
    const res = await fetchImpl(`${root}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Accept: accept, "Idempotency-Key": key },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new ApiError(res.status, path, await res.text());
    return res;
  }

  const post = async <T>(path: string, body: unknown, key: string) =>
    (await (await send(path, body, key, "application/json")).json()) as T;

  return {
    createRep: (scenarioId, key) => post("/api/v3/reps", { scenario_id: scenarioId }, key),
    classify: async (text) => {
      const path = "/api/v3/classify";
      const res = await fetchImpl(`${root}${path}`, {
        method: "POST",
        body: JSON.stringify({ user_message: text }),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
      if (!res.ok) throw new ApiError(res.status, path, await res.text());
      return (await res.json()) as Classified;
    },
    postEvents: (repId, events, key) => post(`/api/v3/reps/${repId}/events`, { events }, key),
    finish: (repId, durationMs, key) =>
      post(`/api/v3/reps/${repId}/finish`, { duration_ms: durationMs }, key),
    async list(scenarioId) {
      const path = `/api/v3/reps?scenario_id=${scenarioId}`;
      const res = await fetchImpl(`${root}${path}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new ApiError(res.status, path, await res.text());
      return (await res.json()) as RepResponse[];
    },
    async streamTurn(repId, request, key, onSentence, signal) {
      const res = await send(
        `/api/v3/reps/${repId}/turns`,
        request,
        key,
        "text/event-stream",
        signal,
      );
      if (!res.body) throw new RepStreamError("stream_closed", true);
      for await (const item of readSse(res.body)) {
        if (item.event === "sentence") {
          const { index, text } = JSON.parse(item.data) as { index: number; text: string };
          onSentence(index, text);
        } else if (item.event === "done") {
          return JSON.parse(item.data) as TurnDone;
        } else if (item.event === "error") {
          const { code, retryable } = JSON.parse(item.data) as {
            code?: string;
            retryable?: boolean;
          };
          throw new RepStreamError(code ?? "unknown", retryable === true);
        }
      }
      throw new RepStreamError("stream_closed", true);
    },
  };
}
