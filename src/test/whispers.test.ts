import { describe, expect, it } from "vitest";

import { offer, ruleForTurn, startedTooSoon, WHISPER_TEXT } from "@/lib/voice/whispers";

import { settle, started } from "./rep-harness";

const whispersPosted = (h: Awaited<ReturnType<typeof started>>) =>
  h.posted.filter((e) => e.kind === "whisper_shown");

async function say(h: Awaited<ReturnType<typeof started>>, at: number, text: string) {
  h.turns.push({ sentences: ["Fine."], nodeId: at });
  h.controller.speechStarted(at - 1500);
  h.at(at);
  h.controller.speechEnded(at);
  h.controller.heard(text);
  h.at(at + 1300);
  h.controller.tick();
  await settle();
}

describe("whisper rules", () => {
  it("picks leading over closed and ignores open turns", () => {
    expect(ruleForTurn({ question_type: "closed", leading: true })).toBe("leading");
    expect(ruleForTurn({ question_type: "closed", leading: false })).toBe("closed_question");
    expect(ruleForTurn({ question_type: "open", leading: false })).toBeNull();
    expect(ruleForTurn({ question_type: "statement", leading: false })).toBeNull();
  });

  it("allows one whisper per 8 seconds and drops the rest", () => {
    expect(offer("leading", 1000, 1500, null)?.text).toBe(WHISPER_TEXT.leading);
    expect(offer("leading", 5000, 5500, 1500)).toBeNull();
    expect(offer("leading", 9000, 9500, 1500)).not.toBeNull();
  });

  it("flags a start under 2 seconds after a deflection ended", () => {
    expect(startedTooSoon(11_000, 10_000)).toBe(true);
    expect(startedTooSoon(12_000, 10_000)).toBe(false);
    expect(startedTooSoon(11_000, null)).toBe(false);
  });
});

describe("whispers in a rep", () => {
  it("shows a closed-question whisper within 2 seconds and logs it", async () => {
    const h = await started();
    h.classified.question_type = "closed";
    await say(h, 5000, "did you send the update");
    const shown = h.snap().whisper;
    expect(shown?.rule).toBe("closed_question");
    expect(shown!.shownMs - shown!.triggerMs).toBeLessThanOrEqual(2000);
    expect(whispersPosted(h)).toHaveLength(0);
    await h.controller.finish();
    const [event] = whispersPosted(h);
    expect(event).toMatchObject({ rule: "closed_question", trigger_ms: 5000 });
  });

  it("drops a second whisper inside the 8 second window", async () => {
    const h = await started();
    h.classified.question_type = "closed";
    await say(h, 5000, "did you send the update");
    h.speaker.end();
    await say(h, 8000, "was it late");
    await h.controller.finish();
    expect(whispersPosted(h)).toHaveLength(1);
  });

  it("whispers when the learner talks over Bob", async () => {
    const h = await started();
    h.turns.push({ sentences: ["Well."], nodeId: 40 });
    await say(h, 5000, "what changed");
    h.controller.speechStarted(6400);
    h.at(7000);
    h.controller.tick();
    expect(h.snap().whisper?.rule).toBe("interruption");
  });

  it("does not whisper an interruption when Bob started while the learner was speaking", async () => {
    const h = await started();
    h.at(5000);
    h.controller.speechStarted(5000);
    h.at(5200);
    h.speaker.say("Well.");
    h.at(5900);
    h.controller.tick();
    expect(h.snap().whisper).toBeNull();
  });

  it("whispers when the learner speaks soon after a deflection", async () => {
    const h = await started();
    h.turns.push({ sentences: ["It's in the report."], nodeId: 41, deflection: true });
    await say(h, 5000, "what changed");
    h.at(9000);
    h.speaker.end();
    h.controller.speechStarted(9800);
    expect(h.snap().whisper?.rule).toBe("no_pause");
  });

  it("whispers after 30 seconds of speech with no question", async () => {
    const h = await started();
    h.controller.speechStarted(3000);
    h.at(32_000);
    h.controller.tick();
    expect(h.snap().whisper).toBeNull();
    h.at(33_100);
    h.controller.tick();
    expect(h.snap().whisper?.rule).toBe("monologue");
    expect(h.snap().whisper!.triggerMs).toBe(33_000);
  });
});
