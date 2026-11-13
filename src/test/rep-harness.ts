import { expect, vi } from "vitest";

import type { PracticeSession, TurnNode } from "@/lib/api/types";
import {
  RepStreamError,
  type Classified,
  type RepApi,
  type RepCreated,
  type TurnDone,
  type VoiceEvent,
} from "@/lib/voice/repApi";
import { RepController, type RepSnapshot } from "@/lib/voice/repController";
import type { Speaker } from "@/lib/voice/speech";

// A speaker whose audio the test starts and ends by hand.
export function fakeSpeaker() {
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

export function harness(options: { bargeIn?: boolean; openingDelayMs?: number } = {}) {
  let clock = 0;
  let keys = 0;
  const turns: Turn[] = [];
  const posted: VoiceEvent[] = [];
  const requests: { body: unknown; key: string }[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const finished = vi.fn();
  const classified = { question_type: "open", leading: false, meaning: true } as Classified;
  const api: RepApi = {
    classify: async () => ({ ...classified }),
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
    ...(options.openingDelayMs ? { openingDelayMs: options.openingDelayMs } : {}),
  });
  return {
    controller,
    speaker,
    turns,
    posted,
    requests,
    finished,
    classified,
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

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function started(options: { bargeIn?: boolean } = {}) {
  const h = harness(options);
  await h.controller.start(2);
  expect(h.snap().phase).toBe("bob_speaking");
  h.at(2000);
  h.speaker.end();
  expect(h.snap().phase).toBe("listening");
  return h;
}
