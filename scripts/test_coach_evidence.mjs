// Synthetic capture regression: no servers, no browser and no model calls.
//
//   node --test scripts/test_coach_evidence.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  denominators,
  effectiveSettings,
  followRecord,
  forbiddenKeys,
  hintRecord,
  providerPriorHints,
  publicTurn,
  selectedPath,
} from "./coach_evidence.mjs";

const node = (id, parent_id, user_text, extra = {}) => ({
  id,
  parent_id,
  session_id: 1,
  turn_number: 1,
  user_text,
  character_text: `Reply to ${user_text}`,
  score: 0,
  resistance: "guarded",
  coaching: { question_type: "statement", empathy: false, leading: false, outcome: "neutral" },
  ...extra,
});

// Root line 1 -> 2, then a fork from 1 to 3.
const nodes = [node(1, null, "first"), node(2, 1, "source branch"), node(3, 1, "fork branch")];

const hint = (id, attempt, over = {}) => ({
  id,
  attempt,
  approach: `Approach ${attempt}`,
  example: `Example ${attempt}`,
  reason: `Reason ${attempt}`,
  source: "meta",
  fallback_reason: null,
  latency_ms: 10_000,
  ...over,
});

const identity = { case_id: "c1", session_id: 1, branch_id: 2 };

test("the transcript follows the selected branch only", () => {
  const texts = selectedPath(nodes, 3).map((n) => n.user_text);
  assert.deepEqual(texts, ["first", "fork branch"]);
  assert.deepEqual(
    selectedPath(nodes, 2).map((n) => n.user_text),
    ["first", "source branch"],
  );
});

test("an unknown head fails instead of giving a short transcript", () => {
  assert.throws(() => selectedPath(nodes, 99), /not in the tree/);
});

test("a root hint has an empty transcript and keeps the opening", () => {
  const first = hint(1, 1);
  const record = hintRecord({
    identity,
    opening: "Opening line",
    nodes,
    headNodeId: null,
    entries: [{ head_node_id: null, hint: first }],
    hint: first,
  });
  assert.deepEqual(record.transcript, []);
  assert.equal(record.opening, "Opening line");
});

test("a second hint carries the first as prior context, and the first carries none", () => {
  const [first, second] = [hint(1, 1), hint(2, 2)];
  const entries = [second, first].map((h) => ({ head_node_id: 2, hint: h }));
  const base = { identity, opening: "O", nodes, headNodeId: 2, entries };
  assert.deepEqual(hintRecord({ ...base, hint: first }).prior_hints, []);
  const record = hintRecord({ ...base, hint: second });
  assert.deepEqual(
    record.prior_hints.map((p) => p.id),
    [1],
  );
  assert.equal(record.transcript.at(-1).persona, "Reply to source branch");
});

// A straight run of three turns, with node 4 forked from node 1.
const chain = [
  { id: 1, parent_id: null },
  { id: 2, parent_id: 1 },
  { id: 3, parent_id: 2 },
  { id: 4, parent_id: 1 },
];
const on = (head, id, attempt) => ({ head_node_id: head, hint: hint(id, attempt) });
const priorIds = (headNodeId, entries, target) =>
  providerPriorHints({ nodes: chain, headNodeId, entries, hint: target }).map((e) => e.hint.id);

test("a first hint on a later turn receives ancestor hints", () => {
  const entries = [on(1, 1, 1), on(2, 2, 1), on(3, 3, 1)];
  assert.deepEqual(priorIds(3, entries, hint(3, 1)), [1, 2]);
});

test("root hints count as ancestors, and a root hint has none", () => {
  const entries = [on(null, 1, 1), on(1, 2, 1), on(2, 3, 1)];
  assert.deepEqual(priorIds(2, entries, hint(3, 1)), [1, 2]);
  assert.deepEqual(priorIds(null, entries, hint(1, 1)), []);
});

test("only the latest two reach the provider, ordered root first", () => {
  const entries = [on(null, 1, 1), on(1, 2, 1), on(1, 3, 2), on(2, 4, 1), on(3, 5, 1), on(3, 6, 2)];
  assert.deepEqual(priorIds(3, entries, hint(6, 2)), [4, 5]);
  assert.deepEqual(priorIds(3, entries, hint(5, 1)), [3, 4]);
});

test("a second hint ends with its own first attempt", () => {
  const entries = [on(1, 1, 1), on(2, 2, 1), on(2, 3, 2)];
  assert.deepEqual(priorIds(2, entries, hint(3, 2)), [1, 2]);
});

test("a fork does not see a sibling's hints", () => {
  const entries = [on(1, 1, 1), on(2, 2, 1), on(3, 3, 1), on(4, 4, 1)];
  assert.deepEqual(priorIds(4, entries, hint(4, 1)), [1]);
});

test("a hint saved later was not context for an earlier one", () => {
  const entries = [on(1, 5, 2), on(1, 1, 1), on(2, 3, 1)];
  assert.deepEqual(priorIds(2, entries, hint(3, 1)), [1]);
});

test("private fields on the wire do not reach a record", () => {
  const leaky = node(9, null, "line", {
    private_cot: "hidden",
    coaching: {
      question_type: "open",
      empathy: false,
      leading: false,
      outcome: "neutral",
      alternatives: ["internal"],
    },
  });
  const turn = publicTurn(leaky);
  assert.equal(JSON.stringify(turn).includes("hidden"), false);
  assert.equal(JSON.stringify(turn).includes("internal"), false);
});

test("follow-through records whether the exact line was sent", () => {
  const sent = node(4, 2, "Example 1", { score: 1, resistance: "warming" });
  const record = followRecord({
    identity,
    hint: hint(1, 1),
    node: sent,
    before: nodes[1],
  });
  assert.equal(record.sent_verbatim, true);
  assert.equal(record.score_after, 1);
  assert.equal(record.resistance_after, "warming");
  const altered = followRecord({
    identity,
    hint: hint(1, 1),
    node: { ...sent, user_text: "Edited" },
    before: nodes[1],
  });
  assert.equal(altered.sent_verbatim, false);
});

test("denominators keep fallbacks and hints that were never saved", () => {
  const records = [
    { attempt: 1, hint: { source: "meta", fallback_reason: null }, timing: { hint_wait_ms: 6000 } },
    {
      attempt: 1,
      hint: { source: "deterministic", fallback_reason: "timeout" },
      timing: { hint_wait_ms: 12000 },
    },
    { attempt: 2, hint: { source: "meta", fallback_reason: null }, timing: { hint_wait_ms: 8000 } },
  ];
  const summary = denominators(records, [{ attempt: 2, reason: "harness timeout" }]);
  assert.equal(summary.attempt_1.planned, 2);
  assert.equal(summary.attempt_1.provider, 1);
  assert.deepEqual(summary.attempt_1.fallback_reasons, { timeout: 1 });
  assert.equal(summary.attempt_1.hint_wait_ms_median, 9000);
  assert.equal(summary.attempt_2.planned, 2);
  assert.equal(summary.attempt_2.not_saved, 1);
});

const source = {
  model_default: "muse-spark-1.3",
  temperature: 0.3,
  max_tokens: 2048,
  demo_max_tokens: 16384,
  demo_reasoning_effort: "low",
  timeout_seconds: 8,
};

test("settings follow the mode instead of a fixed label", () => {
  assert.equal(effectiveSettings(source, true).declared.max_tokens, 16384);
  assert.equal(effectiveSettings(source, true).declared.reasoning_effort, "low");
  assert.equal(effectiveSettings(source, true).declared.timeout_seconds, null);
  assert.equal(effectiveSettings(source, false).declared.max_tokens, 2048);
  assert.equal(effectiveSettings(source, false).declared.reasoning_effort, null);
});

test("emitted values stay separate and say when they were not captured", () => {
  assert.equal(effectiveSettings(source, true).emitted.label, "not captured in this run");
  const { emitted } = effectiveSettings(source, true, [
    {
      ok: true,
      finish: "stop",
      max_tokens: 16384,
      timeout: null,
      reasoning_effort: "low",
      completion_tokens: 1200,
      seconds: 6,
    },
    { ok: false, finish: "length", max_tokens: 16384, timeout: null, seconds: 9 },
  ]);
  assert.equal(emitted.calls, 2);
  assert.equal(emitted.failed, 1);
  assert.deepEqual(emitted.finish_reasons, { stop: 1, length: 1 });
  assert.deepEqual(emitted.max_tokens, [16384]);
  assert.equal(emitted.completion_tokens_max, 1200);
});

test("the report check flags private keys and allows telemetry counts", () => {
  assert.deepEqual(forbiddenKeys({ a: [{ persona_traits: 1 }], api_key: "x" }).sort(), [
    "$.a[0].persona_traits",
    "$.api_key",
  ]);
  assert.deepEqual(forbiddenKeys({ max_tokens: 1, completion_tokens_max: 2 }), []);
  assert.deepEqual(forbiddenKeys({ reasoning: "text" }), ["$.reasoning"]);
});
