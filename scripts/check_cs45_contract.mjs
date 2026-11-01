// Documentation consistency only: this does not verify any running API or model.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fixtures = JSON.parse(read("docs/cs45-coaching-fixtures.json"));
const revision = "s3-coach-r1";
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const identifier = (value) => assert(Number.isSafeInteger(value) && value > 0);
const head = (value) => value === null || identifier(value);
const nonnegative = (value) => assert(Number.isSafeInteger(value) && value >= 0);
const text = (value, max) => {
  assert.equal(typeof value, "string");
  assert(value.trim() === value && value.length > 0);
  assert([...value].length <= max);
};

function hint(value) {
  keys(value, [
    "id",
    "contract_revision",
    "approach",
    "example",
    "reason",
    "source",
    "fallback_reason",
    "latency_ms",
  ]);
  identifier(value.id);
  assert.equal(value.contract_revision, revision);
  text(value.approach, 240);
  text(value.example, 320);
  text(value.reason, 360);
  nonnegative(value.latency_ms);
  assert(value.latency_ms <= 10000);
  assert(["meta", "deterministic"].includes(value.source));
  if (value.source === "meta") assert.equal(value.fallback_reason, null);
  else
    assert(
      ["not_configured", "timeout", "unavailable", "invalid_response"].includes(
        value.fallback_reason,
      ),
    );
}

assert.equal(fixtures.contract_revision, revision);
assert.equal(fixtures.status, "draft");
for (const req of [fixtures.request, fixtures.requested_root]) {
  keys(req, ["branch_id", "head_node_id", "expected_revision", "trigger"]);
  identifier(req.branch_id);
  head(req.head_node_id);
  nonnegative(req.expected_revision);
  assert(["automatic", "requested"].includes(req.trigger));
}
for (const response of [fixtures.success, fixtures.fallback]) {
  keys(response, ["session_id", "branch_id", "head_node_id", "revision", "hint"]);
  identifier(response.session_id);
  identifier(response.branch_id);
  head(response.head_node_id);
  nonnegative(response.revision);
  hint(response.hint);
}
for (const error of fixtures.errors) {
  assert([404, 409, 422].includes(error.status));
  keys(error.body, ["detail"]);
  keys(error.body.detail, ["code", "message", "retryable"]);
  assert.equal(typeof error.body.detail.retryable, "boolean");
}
keys(fixtures.public_context, [
  "contract_revision",
  "persona",
  "turns",
  "omitted_turns",
  "truncated",
  "previous_hints",
]);
keys(fixtures.public_context.persona, ["name", "role", "public_context", "opening_message"]);
for (const turn of fixtures.public_context.turns) keys(turn, ["user_text", "character_text"]);
assert.equal(
  new Set(fixtures.acceptance_cases.map((item) => item.id)).size,
  fixtures.acceptance_cases.length,
);
assert.equal(fixtures.independent_review.status, "requested_not_received");
assert.equal(fixtures.independent_review.received_cases.length, 0);

const markdown = read("docs/cs45-coaching-contract.md");
const examples = [...markdown.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) =>
  JSON.parse(match[1]),
);
assert.equal(examples.length, 4);
assert.deepEqual(examples[0], fixtures.request);
assert.deepEqual(examples[1], fixtures.success);
assert.deepEqual(examples[2], {
  session_id: 12,
  branch_id: 31,
  head_node_id: 103,
  revision: 4,
  hints: [{ head_node_id: 103, hint: fixtures.success.hint }],
});
assert.deepEqual(examples[3], fixtures.public_context);
for (const [field, value] of Object.entries(fixtures.fallback.hint)) {
  if (["approach", "example", "reason"].includes(field)) assert(markdown.includes(value));
}
let links = 0;
for (const path of [
  "docs/api_contract.md",
  "docs/cs45-coaching-contract.md",
  "docs/codex-cs45-journal.md",
]) {
  for (const match of read(path).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    assert(
      existsSync(resolve(root, dirname(path), match[1].split("#")[0])),
      `Missing link: ${match[1]}`,
    );
    links++;
  }
}
console.log(
  `PASS: ${examples.length} JSON examples match fixtures; 2 requests, 2 hints, ${fixtures.errors.length} errors, ${fixtures.acceptance_cases.length} unique acceptance cases, ${links} local links. Reviewer cases still pending; no runtime/live checks.`,
);
