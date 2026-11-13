// Client for the research brief API (contract research-r1,
// docs/research-brief-contract.md). There is no mock: the brief is only worth
// showing when its sources were really fetched.

export interface BriefRequest {
  counterpart: string;
  situation: string;
  goal: string;
  constraints: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  why: string;
  queries: string[];
  answered: boolean;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  published_date: string | null;
  retrieved_at: string;
  cited: boolean;
}

export interface Fact {
  id: string;
  question_id: string;
  claim: string;
  source_id: string;
  quote: string;
}

export interface Rejected {
  question_id: string;
  claim: string;
  source_id: string | null;
  reason: "unknown_source" | "malformed" | "quote_not_in_source" | "figure_not_in_quote";
}

export interface Brief {
  brief_id: number;
  status: "running" | "complete" | "failed" | "interrupted";
  created_at: string;
  request: BriefRequest;
  questions: ResearchQuestion[];
  sources: Source[];
  facts: Fact[];
  rejected: Rejected[];
  learner_said: string[];
  assumptions: string[];
  talking_points: { text: string; facts: string[] }[];
  questions_to_ask: string[];
  open_questions: string[];
  dropped_points: number;
  run: {
    model: string;
    llm_provider: string;
    search_provider: string;
    llm_calls: number;
    search_calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    seconds: number;
  };
}

export interface BriefSummary {
  brief_id: number;
  created_at: string;
  counterpart: string;
  goal: string;
  facts: number;
  sources: number;
}

export type ResearchEvent =
  | { event: "started"; data: { brief_id: number } }
  | {
      event: "step";
      data: { stage: string; message?: string; question_id?: string; query?: string };
    }
  | {
      event: "plan";
      data: { questions: ResearchQuestion[]; learner_said: string[]; assumptions: string[] };
    }
  | {
      event: "sources";
      data: {
        question_id: string;
        query: string;
        sources: Pick<Source, "id" | "title" | "url">[];
      };
    }
  | {
      event: "finding";
      data: ({ verified: true } & Fact) | ({ verified: false } & Rejected);
    }
  | { event: "brief"; data: Brief }
  | { event: "error"; data: { code: string; message: string; retryable: boolean } };

const base: unknown = import.meta.env["VITE_API_BASE_URL"];

/** The backend address, or null when the app runs on mock data only. */
export const researchBaseUrl: string | null =
  typeof base === "string" && base ? base.replace(/\/+$/, "") : null;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${researchBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Request failed with ${res.status}`);
  return (await res.json()) as T;
}

export const listBriefs = () => getJson<BriefSummary[]>("/api/research/briefs");
export const getBrief = (id: number) => getJson<Brief>(`/api/research/briefs/${id}`);

/** Split complete server-sent events off the front of a buffer. */
export function takeEvents(buffer: string): { events: ResearchEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: ResearchEvent[] = [];
  for (const block of blocks) {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!event || !data) continue;
    try {
      events.push({ event, data: JSON.parse(data) } as ResearchEvent);
    } catch {
      // A malformed event is skipped; the run's outcome still arrives.
    }
  }
  return { events, rest };
}

/** Start a research run and hand each event to `onEvent` as it arrives. */
export async function streamBrief(
  request: BriefRequest,
  onEvent: (event: ResearchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${researchBaseUrl}/api/research/briefs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(
      res.status === 422
        ? "Please fill in who, what happened and what you want (a sentence or two each)."
        : `The research service answered ${res.status}.`,
    );
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const taken = takeEvents(buffer + value);
    buffer = taken.rest;
    taken.events.forEach(onEvent);
  }
}
