// Pure helpers that turn API responses into reviewable coach evidence.
//
// Every record is built from an explicit allowlist of public fields, so a new private field
// on the wire cannot reach a report by accident. Nothing here makes a request.

const FORBIDDEN_KEY =
  /api[_-]?key|authorization|secret|token|persona_traits|need_catalog|private|reasoning|system_prompt|stems?$/i;

// The learner-visible turns from the root to `headNodeId`. Sibling branches are excluded by
// walking parent links, which is the same selection the coach context uses.
export function selectedPath(nodes, headNodeId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path = [];
  const seen = new Set();
  for (let id = headNodeId; id != null; id = byId.get(id)?.parent_id ?? null) {
    if (seen.has(id)) throw new Error(`cycle at node ${id}`);
    seen.add(id);
    const node = byId.get(id);
    if (!node) throw new Error(`node ${id} is not in the tree`);
    path.unshift(node);
  }
  return path;
}

export function publicTurn(node) {
  return {
    node_id: node.id,
    parent_id: node.parent_id,
    turn_number: node.turn_number,
    learner: node.user_text,
    persona: node.character_text,
    score: node.score,
    resistance: node.resistance,
    question_type: node.coaching?.question_type ?? null,
    empathy: node.coaching?.empathy ?? null,
    leading: node.coaching?.leading ?? null,
    outcome: node.coaching?.outcome ?? null,
  };
}

export function publicHint(hint) {
  return {
    id: hint.id,
    attempt: hint.attempt,
    approach: hint.approach,
    example: hint.example,
    reason: hint.reason,
    source: hint.source,
    fallback_reason: hint.fallback_reason ?? null,
    latency_ms_wire: hint.latency_ms,
  };
}

// How many earlier hints the provider receives. Mirrors `earlier[-2:]` in coach_service.py.
const PROVIDER_PRIOR_HINTS = 2;

// The hints the provider received for `hint`, mirroring _earlier_hint_rows: strict ancestors
// of the head on this branch, root included, plus the same head's first attempt when writing
// the second. Root first, then attempt, then id, keeping the latest two. A hint saved after
// this one did not exist yet, so a lower id is required. `entries` are one branch's listing,
// because the backend scopes the same way.
export function providerPriorHints({ nodes, headNodeId, entries, hint }) {
  const positions = new Map([[null, 0]]);
  if (headNodeId != null) {
    selectedPath(nodes, headNodeId).forEach((node, index) => positions.set(node.id, index + 1));
  }
  const eligible = entries.filter(({ head_node_id: head, hint: other }) => {
    if (other.id >= hint.id || !positions.has(head)) return false;
    return head === headNodeId ? hint.attempt === 2 && other.attempt === 1 : true;
  });
  return eligible
    .sort(
      (a, b) =>
        positions.get(a.head_node_id) - positions.get(b.head_node_id) ||
        a.hint.attempt - b.hint.attempt ||
        a.hint.id - b.hint.id,
    )
    .slice(-PROVIDER_PRIOR_HINTS);
}

// One saved hint with everything needed to judge it: the dialogue it answered, and the hints
// it was told not to repeat. `timing` holds true elapsed times; wire latency saturates.
export function hintRecord({ identity, opening, nodes, headNodeId, entries, hint, timing }) {
  const prior = providerPriorHints({ nodes, headNodeId, entries, hint }).map((entry) => ({
    head_node_id: entry.head_node_id,
    ...publicHint(entry.hint),
  }));
  return {
    ...identity,
    head_node_id: headNodeId,
    attempt: hint.attempt,
    hint_id: hint.id,
    opening,
    transcript: headNodeId == null ? [] : selectedPath(nodes, headNodeId).map(publicTurn),
    prior_hints: prior,
    hint: publicHint(hint),
    timing: timing ?? null,
  };
}

// A learner sending a suggested line, and what came back. The reply is the follow-through.
export function followRecord({ identity, hint, node, before }) {
  return {
    ...identity,
    hint_id: hint.id,
    attempt: hint.attempt,
    sent: hint.example,
    sent_verbatim: node.user_text === hint.example,
    reply: node.character_text,
    node_id: node.id,
    question_type: node.coaching?.question_type ?? null,
    score_before: before?.score ?? 0,
    score_after: node.score,
    resistance_before: before?.resistance ?? "guarded",
    resistance_after: node.resistance,
  };
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

// `planned` counts every hint a case asked for, so a hint that was never saved still lands in
// the denominator instead of quietly disappearing.
export function denominators(records, missing = []) {
  const summary = {};
  for (const attempt of [1, 2]) {
    const saved = records.filter((r) => r.attempt === attempt);
    const absent = missing.filter((m) => m.attempt === attempt);
    const reasons = {};
    for (const record of saved) {
      const reason = record.hint.fallback_reason;
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    const waits = saved.map((r) => r.timing?.hint_wait_ms).filter((v) => v != null);
    summary[`attempt_${attempt}`] = {
      planned: saved.length + absent.length,
      saved: saved.length,
      provider: saved.filter((r) => r.hint.source === "meta").length,
      fallback: saved.filter((r) => r.hint.source !== "meta").length,
      fallback_reasons: reasons,
      not_saved: absent.length,
      hint_wait_ms_median: median(waits),
      hint_wait_ms_max: waits.length ? Math.max(...waits) : null,
    };
  }
  return summary;
}

// Declared settings come from source. Emitted values come from the telemetry file, and each
// stays labelled so a reader never mistakes one for the other.
export function effectiveSettings(source, demo, telemetry) {
  const declared = {
    label: "source-derived, not observed",
    mode: demo ? "demo" : "normal",
    model_default: source.model_default,
    provider_model_defaults: source.provider_model_defaults ?? null,
    temperature: source.temperature,
    max_tokens: demo ? source.demo_max_tokens : source.max_tokens,
    timeout_seconds: demo ? null : source.timeout_seconds,
    reasoning_effort: demo ? source.demo_reasoning_effort : null,
  };
  const calls = telemetry ?? [];
  const finishes = {};
  for (const call of calls) {
    const key = call.finish ?? "none";
    finishes[key] = (finishes[key] ?? 0) + 1;
  }
  const tokens = calls.map((c) => c.completion_tokens).filter((v) => v != null);
  const seconds = calls.map((c) => c.seconds).filter((v) => v != null);
  return {
    declared,
    emitted: {
      label: telemetry ? "observed at the coach client" : "not captured in this run",
      calls: calls.length,
      failed: calls.filter((c) => !c.ok).length,
      providers: [...new Set(calls.map((c) => c.provider ?? null))],
      models: [...new Set(calls.map((c) => c.model ?? null))],
      max_tokens: [...new Set(calls.map((c) => c.max_tokens))],
      timeout: [...new Set(calls.map((c) => c.timeout))],
      reasoning_effort: [...new Set(calls.map((c) => c.reasoning_effort ?? null))],
      finish_reasons: finishes,
      completion_tokens_max: tokens.length ? Math.max(...tokens) : null,
      seconds_median: seconds.length ? median(seconds) : null,
      seconds_max: seconds.length ? Math.max(...seconds) : null,
    },
  };
}

// Run on the finished report as a backstop to the allowlists. Key names only: scanning values
// would need the secrets themselves, which this script must never read.
export function forbiddenKeys(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenKeys(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(FORBIDDEN_KEY.test(key) && !ALLOWED_KEY.has(key) ? [`${path}.${key}`] : []),
      ...forbiddenKeys(item, `${path}.${key}`),
    ]);
  }
  return [];
}

// Telemetry counts and the declared setting names, none of which carry a credential or text.
const ALLOWED_KEY = new Set([
  "max_tokens",
  "reasoning_effort",
  "demo_reasoning_effort",
  "completion_tokens",
  "completion_tokens_max",
  "reasoning_tokens",
]);
