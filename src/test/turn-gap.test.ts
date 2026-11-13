import { describe, expect, it, vi } from "vitest";

import {
  endsUnfinished,
  TURN_GAP_MS,
  turnGapFor,
  UNFINISHED_GAP_MS,
} from "@/lib/voice/repController";

import { harness, settle, started } from "./rep-harness";

describe("end of turn", () => {
  it("treats a trailing connector or filler as an unfinished thought", () => {
    for (const text of ["I wanted to ask and", "so um", "what I mean is, ", "because the"]) {
      expect(endsUnfinished(text)).toBe(true);
      expect(turnGapFor(text)).toBe(UNFINISHED_GAP_MS);
    }
    for (const text of ["what changed on the design", "did you send it"]) {
      expect(endsUnfinished(text)).toBe(false);
      expect(turnGapFor(text)).toBe(TURN_GAP_MS);
    }
  });

  it("does not send during a one second pause", async () => {
    const h = await started();
    h.controller.speechStarted(3000);
    h.controller.speechEnded(4000);
    h.controller.heard("what changed on the design");
    h.at(5000);
    h.controller.tick();
    await settle();
    expect(h.requests).toHaveLength(0);
  });

  it("joins words said after a pause into one turn", async () => {
    const h = await started();
    h.turns.push({ sentences: ["Fine."], nodeId: 50 });
    h.controller.speechStarted(3000);
    h.controller.speechEnded(4000);
    h.controller.heard("I was thinking about the design");
    h.at(5000);
    h.controller.tick();
    h.controller.speechStarted(5000);
    h.controller.speechEnded(6500);
    h.controller.heard("and what changed there");
    h.at(7800);
    h.controller.tick();
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.body).toMatchObject({
      user_message: "I was thinking about the design and what changed there",
      speech_start_ms: 3000,
    });
  });

  it("waits longer after an unfinished sentence", async () => {
    const h = await started();
    h.turns.push({ sentences: ["Fine."], nodeId: 51 });
    h.controller.speechStarted(3000);
    h.controller.speechEnded(4000);
    h.controller.heard("I wanted to ask about the timeline and");
    h.at(4000 + TURN_GAP_MS + 100);
    h.controller.tick();
    await settle();
    expect(h.requests).toHaveLength(0);
    h.at(4000 + UNFINISHED_GAP_MS + 100);
    h.controller.tick();
    await settle();
    expect(h.requests).toHaveLength(1);
  });
});

describe("opening line", () => {
  it("waits for the audio to settle before Bob speaks", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ openingDelayMs: 1000 });
      const starting = h.controller.start(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.speaker.said).toEqual([]);
      await vi.advanceTimersByTimeAsync(600);
      await starting;
      expect(h.speaker.said).toEqual(["You wanted to see me?"]);
      expect(h.warmedUp).toHaveBeenCalledTimes(1);
      expect(h.snap().phase).toBe("bob_speaking");
    } finally {
      vi.useRealTimers();
    }
  });
});
