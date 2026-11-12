import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";
import type { PracticeSession, TurnNode } from "@/lib/api/types";
import {
  createRepApi,
  RepStreamError,
  type RepApi,
  type RepCreated,
  type TurnDone,
  type VoiceEvent,
} from "@/lib/voice/repApi";
import { RepController, type RepSnapshot } from "@/lib/voice/repController";
import { readSse } from "@/lib/voice/sse";
import { createQueuedSpeaker, type Speaker } from "@/lib/voice/speech";
import { createVad } from "@/lib/voice/vad";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readSse", () => {
  it("joins events split across chunks and accepts CRLF", async () => {
    const events = [];
    const body = streamOf([
      'event: sentence\ndata: {"i',
      'ndex":0}\n\nevent: do',
      "ne\r\ndata: {}\r\n\r\n",
    ]);
    for await (const event of readSse(body)) events.push(event);
    expect(events).toEqual([
      { event: "sentence", data: '{"index":0}' },
      { event: "done", data: "{}" },
    ]);
  });
});

describe("createRepApi.streamTurn", () => {
  const request = {
    branch_id: 1,
    parent_node_id: null,
    expected_revision: 0,
    user_message: "what changed",
    speech_start_ms: 0,
    speech_end_ms: 900,
  };

  function api(response: Response) {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response);
    return { client: createRepApi("http://x/", fetchImpl), fetchImpl };
  }

  it("reports sentences in order and returns the done payload", async () => {
    const body = streamOf([
      'event: sentence\ndata: {"index":0,"text":"One."}\n\n',
      'event: sentence\ndata: {"index":1,"text":"Two."}\n\n',
      'event: done\ndata: {"node":{"id":5},"session":{},"turn":{"deflection":true}}\n\n',
    ]);
    const { client, fetchImpl } = api(new Response(body, { status: 200 }));
    const heard: string[] = [];
    const done = await client.streamTurn(7, request, "key-1", (_i, text) => heard.push(text));
    expect(heard).toEqual(["One.", "Two."]);
    expect(done.node.id).toBe(5);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://x/api/v3/reps/7/turns");
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
  });

  it("raises the stream's error code when the reply fails part way", async () => {
    const body = streamOf([
      'event: sentence\ndata: {"index":0,"text":"One."}\n\n',
      'event: error\ndata: {"code":"persona_unavailable","retryable":true}\n\n',
    ]);
    const { client } = api(new Response(body, { status: 200 }));
    const failure = await client.streamTurn(7, request, "k", () => {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RepStreamError);
    expect((failure as RepStreamError).code).toBe("persona_unavailable");
  });

  it("treats a stream that closes without done as a failure", async () => {
    const { client } = api(new Response(streamOf([]), { status: 200 }));
    await expect(client.streamTurn(7, request, "k", () => {})).rejects.toBeInstanceOf(
      RepStreamError,
    );
  });

  it("raises ApiError for a JSON error before any sentence", async () => {
    const detail = JSON.stringify({ detail: { code: "persona_timeout", retryable: true } });
    const { client } = api(new Response(detail, { status: 504 }));
    const failure = await client.streamTurn(7, request, "k", () => {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("persona_timeout");
  });
});

describe("createVad", () => {
  function run(levels: [number, number][]) {
    const marks: string[] = [];
    const vad = createVad(
      (t) => marks.push(`start ${t}`),
      (t) => marks.push(`end ${t}`),
    );
    for (const [level, t] of levels) vad.push(level, t);
    return { marks, vad };
  }

  it("starts at the first loud sample and ends at the last one", () => {
    const loud: [number, number][] = [];
    for (let t = 1000; t <= 2000; t += 20) loud.push([0.05, t]);
    const quiet: [number, number][] = [];
    for (let t = 2020; t <= 2700; t += 20) quiet.push([0.001, t]);
    expect(run([[0.001, 980], ...loud, ...quiet]).marks).toEqual(["start 1000", "end 2000"]);
  });

  it("ignores a click shorter than the start time", () => {
    expect(
      run([
        [0.2, 100],
        [0.2, 140],
        [0.001, 160],
        [0.001, 900],
      ]).marks,
    ).toEqual([]);
  });

  it("keeps one segment across a short gap between words", () => {
    const levels: [number, number][] = [];
    for (let t = 0; t <= 400; t += 20) levels.push([0.05, t]);
    for (let t = 420; t <= 800; t += 20) levels.push([0.001, t]);
    for (let t = 820; t <= 1200; t += 20) levels.push([0.05, t]);
    const { marks, vad } = run(levels);
    expect(marks).toEqual(["start 0"]);
    vad.stop(1300);
    expect(marks).toEqual(["start 0", "end 1200"]);
  });
});

// A speaker whose audio the test starts and ends by hand.
function fakeSpeaker() {
  const said: string[] = [];
  let playing = false;
  let open = false;
  const speaker: Speaker & { said: string[]; end(): void; playing(): boolean } = {
    said,
    onStart: null,
    onEnd: null,
    say(text) {
      said.push(text);
      open = true;
      if (!playing) {
        playing = true;
        speaker.onStart?.();
      }
    },
    close() {
      open = false;
    },
    cancel() {
      open = false;
      if (!playing) return;
      playing = false;
      speaker.onEnd?.(true);
    },
    end() {
      expect(open).toBe(false);
      playing = false;
      speaker.onEnd?.(false);
    },
    playing: () => playing,
  };
  return speaker;
}

const session = (revision: number, head: number | null) =>
  ({ id: 3, active_branch_id: 9, active_head_node_id: head, revision }) as PracticeSession;

type Turn = { sentences: string[]; fail?: RepStreamError; nodeId: number; deflection?: boolean };

function harness(options: { bargeIn?: boolean } = {}) {
  let clock = 0;
  let keys = 0;
  const turns: Turn[] = [];
  const posted: VoiceEvent[] = [];
  const requests: { body: unknown; key: string }[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const finished = vi.fn();
  const api: RepApi = {
    createRep: async () =>
      ({
        rep_id: 7,
        rep_number: 2,
        session: session(0, null),
        duration_limit_ms: 180_000,
        score_ruleset: "v3-score-r1",
        whisper_ruleset: "v3-whisper-r1",
        opening_message: "You wanted to see me?",
      }) as RepCreated,
    streamTurn: async (_rep, body, key, onSentence) => {
      requests.push({ body, key });
      const turn = turns.shift()!;
      turn.sentences.forEach((text, index) => onSentence(index, text));
      if (gate) await gate;
      if (turn.fail) throw turn.fail;
      return {
        node: { id: turn.nodeId, character_text: turn.sentences.join(" ") } as TurnNode,
        session: session(requests.length, turn.nodeId),
        turn: {
          question_type: "open",
          leading: false,
          meaning: true,
          deflection: !!turn.deflection,
        },
      } as TurnDone;
    },
    postEvents: async (_rep, events) => {
      posted.push(...events);
      return { accepted: events.length, last_seq: events[events.length - 1]!.seq };
    },
    finish: async (_rep, durationMs) => {
      finished(durationMs);
      return {
        rep: {
          rep_id: 7,
          rep_number: 2,
          session_id: 3,
          scenario_id: 2,
          started_at: "",
          duration_ms: durationMs,
          finished: true,
          score_ruleset: "v3-score-r1",
          scorecard: null,
          latency: [],
        },
      };
    },
    list: async () => [],
  };
  const speaker = fakeSpeaker();
  let last: RepSnapshot | null = null;
  const controller = new RepController({
    api,
    speaker,
    now: () => clock,
    newKey: () => `key-${(keys += 1)}`,
    onChange: (snapshot) => (last = snapshot),
    bargeIn: options.bargeIn ?? true,
  });
  return {
    controller,
    speaker,
    turns,
    posted,
    requests,
    finished,
    at: (ms: number) => (clock = ms),
    snap: () => last!,
    hold() {
      gate = new Promise((resolve) => (release = resolve));
    },
    release() {
      release?.();
      gate = null;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function started(options: { bargeIn?: boolean } = {}) {
  const h = harness(options);
  await h.controller.start(2);
  expect(h.snap().phase).toBe("bob_speaking");
  h.at(2000);
  h.speaker.end();
  expect(h.snap().phase).toBe("listening");
  return h;
}

describe("RepController", () => {
  it("sends a spoken turn after the quiet gap and logs timing for both speakers", async () => {
    const h = await started();
    h.turns.push({
      sentences: ["It's in the report.", "Design changed."],
      nodeId: 31,
      deflection: true,
    });

    h.controller.speechStarted(3000);
    h.at(4200);
    h.controller.speechEnded(4100);
    h.controller.heard("what changed on the design");
    h.at(4500);
    h.controller.tick();
    expect(h.requests).toHaveLength(0);

    h.at(4800);
    h.controller.tick();
    await settle();
    expect(h.requests[0]!.body).toMatchObject({
      branch_id: 9,
      parent_node_id: null,
      expected_revision: 0,
      user_message: "what changed on the design",
      speech_start_ms: 3000,
      speech_end_ms: 4100,
    });
    expect(h.speaker.said.slice(1)).toEqual(["It's in the report.", "Design changed."]);
    expect(h.snap().phase).toBe("bob_speaking");

    h.at(7000);
    h.speaker.end();
    expect(h.snap().phase).toBe("listening");
    expect(h.snap().lines.map((line) => line.text)).toEqual([
      "You wanted to see me?",
      "what changed on the design",
      "It's in the report. Design changed.",
    ]);
    expect(h.snap().lines[1]!.facts?.deflection).toBe(true);
    expect(h.snap().timings[0]).toEqual({
      speech_end_ms: 4100,
      sent_ms: 4800,
      first_sentence_ms: 4800,
      audio_start_ms: 4800,
    });

    await h.controller.finish();
    expect(h.posted.map(({ seq: _seq, ...event }) => event)).toEqual([
      { t_ms: 3000, kind: "learner_speech_start" },
      { t_ms: 4100, kind: "learner_speech_end" },
      { t_ms: 4800, kind: "bob_audio_start", node_id: 31 },
      { t_ms: 7000, kind: "bob_audio_end", node_id: 31 },
    ]);
    expect(h.posted.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(h.finished).toHaveBeenCalledWith(7000);
    expect(h.snap().phase).toBe("finished");
  });

  it("cuts Bob only after the learner has spoken over him for 500 ms", async () => {
    const h = await started();
    h.turns.push({ sentences: ["Long answer."], nodeId: 31 });
    h.controller.typed("tell me more", 2500);
    await settle();
    expect(h.speaker.playing()).toBe(true);

    h.at(5000);
    h.controller.speechStarted(5000);
    h.at(5400);
    h.controller.tick();
    expect(h.speaker.playing()).toBe(true);
    h.at(5500);
    h.controller.tick();
    expect(h.speaker.playing()).toBe(false);

    await h.controller.finish();
    expect(h.posted.find((event) => event.kind === "bob_audio_end")).toMatchObject({
      t_ms: 5500,
      node_id: 31,
      interrupted: true,
    });
  });

  it("ignores the microphone while Bob speaks when barge-in is off", async () => {
    const h = await started({ bargeIn: false });
    h.turns.push({ sentences: ["Long answer."], nodeId: 31 });
    h.controller.typed("tell me more", 2500);
    await settle();
    h.at(5000);
    h.controller.speechStarted(5000);
    h.controller.heard("long answer");
    h.at(6000);
    h.controller.tick();
    expect(h.speaker.playing()).toBe(true);
    expect(h.snap().pendingText).toBe("");
    expect(h.snap().learnerSpeaking).toBe(false);
  });

  it("drops a lost reply and resends the same turn with the same key", async () => {
    const h = await started();
    h.turns.push({
      sentences: ["Half a"],
      nodeId: 0,
      fail: new RepStreamError("persona_unavailable", true),
    });
    h.turns.push({ sentences: ["Whole answer."], nodeId: 31 });
    h.at(3000);
    h.controller.typed("what happened", 2500);
    await settle();
    expect(h.snap().phase).toBe("turn_failed");
    expect(h.snap().error).toContain("persona_unavailable");
    expect(h.snap().lines.map((line) => line.text)).toEqual([
      "You wanted to see me?",
      "what happened",
    ]);
    expect(h.speaker.playing()).toBe(false);

    h.controller.retry();
    await settle();
    expect(h.requests[1]).toEqual(h.requests[0]);
    expect(h.snap().lines).toHaveLength(3);
    h.at(6000);
    h.speaker.end();
    await h.controller.finish();
    // Only the saved reply has Bob events; the lost one left none.
    expect(h.posted.filter((event) => event.kind === "bob_audio_start")).toEqual([
      expect.objectContaining({ node_id: 31 }),
    ]);
  });

  it("logs Bob's segment when the audio ends before the turn is saved", async () => {
    const h = await started();
    h.turns.push({ sentences: ["Short."], nodeId: 31 });
    h.hold();
    h.at(3000);
    h.controller.typed("ok", 2800);
    await settle();
    h.speaker.close();
    h.at(3600);
    h.speaker.end();
    expect(h.snap().phase).toBe("bob_thinking");
    h.release();
    await settle();
    expect(h.snap().phase).toBe("listening");
    await h.controller.finish();
    expect(h.posted.filter((event) => event.kind.startsWith("bob"))).toEqual([
      expect.objectContaining({ kind: "bob_audio_start", t_ms: 3000, node_id: 31 }),
      expect.objectContaining({ kind: "bob_audio_end", t_ms: 3600, node_id: 31 }),
    ]);
  });

  it("finishes by itself at the time limit and closes open segments there", async () => {
    const h = await started();
    h.controller.speechStarted(179_000);
    h.at(180_400);
    h.controller.tick();
    await settle();
    await settle();
    expect(h.finished).toHaveBeenCalledWith(180_000);
    expect(h.posted).toEqual([
      expect.objectContaining({ kind: "learner_speech_start", t_ms: 179_000 }),
      expect.objectContaining({ kind: "learner_speech_end", t_ms: 180_000 }),
    ]);
    expect(h.snap().phase).toBe("finished");
  });
});

describe("createQueuedSpeaker", () => {
  it("plays sentences in order and reports one start and one end", async () => {
    const spoken: string[] = [];
    const speaker = createQueuedSpeaker({
      speak: async (text) => {
        spoken.push(text);
      },
      stop: () => {},
    });
    const marks: string[] = [];
    speaker.onStart = () => marks.push("start");
    speaker.onEnd = (interrupted) => marks.push(`end ${interrupted}`);
    speaker.say("One.");
    speaker.say("Two.");
    speaker.close();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(spoken).toEqual(["One.", "Two."]);
    expect(marks).toEqual(["start", "end false"]);
  });

  it("reports an interrupted end when cancelled", async () => {
    let finishSpeaking: () => void = () => {};
    const speaker = createQueuedSpeaker({
      speak: () => new Promise<void>((resolve) => (finishSpeaking = resolve)),
      stop: () => finishSpeaking(),
    });
    const marks: string[] = [];
    speaker.onEnd = (interrupted) => marks.push(`end ${interrupted}`);
    speaker.say("One.");
    speaker.say("Two.");
    speaker.cancel();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(marks).toEqual(["end true"]);
  });
});
