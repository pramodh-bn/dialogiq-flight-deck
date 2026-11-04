// Finite paid journey using the actual frontend HTTP adapter in Node.
// This proves real client/HTTP behavior, not DOM rendering or browser usability.
// Backend must use the capped runner:4 coach /4 persona /4 feedback calls.
// Usage: node scripts/capture_coach_journey.mjs <base-url> <new-report-path>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const [baseUrl, output] = process.argv.slice(2);
assert(baseUrl && output, "Pass the API base URL and a new report path.");
assert(!existsSync(output), "Never overwrite a paid run.");
const source = readFileSync(resolve("src/lib/api/http.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { createHttpApi } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const api = createHttpApi(baseUrl);
const report = {
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  scope: "Codex synthetic evolving dialogue, actual frontend adapter in Node; not a browser",
  expected_prompt_revision: "bob-next-move-r2",
  limits: { coach: 4, persona: 4, feedback: 4 },
  turns: [],
  hints: [],
};
mkdirSync(dirname(resolve(output)), { recursive: true });
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
const bob = (await api.listScenarios()).find((s) => s.persona.name === "Bob");
assert(bob?.feedback_revisions.includes("semantic-r1"));
let session = await api.createSession(
  {
    scenario_id: bob.id,
    behavior_revision: "s4-bob-r1",
    feedback_revision: "semantic-r1",
  },
  crypto.randomUUID(),
);
report.session_id = session.id;
report.branch_id = session.active_branch_id;
report.opening = session.persona.opening_message;
report.public_context = session.persona.public_context;
save();

async function hint(attempt) {
  const started = performance.now();
  const result = await api.requestCoachHint(
    session.id,
    {
      branch_id: session.active_branch_id,
      head_node_id: session.active_head_node_id,
      expected_revision: session.revision,
      trigger: "requested",
      attempt,
    },
    crypto.randomUUID(),
    null,
  );
  report.hints.push({ response: result, elapsed_ms: Math.round(performance.now() - started) });
  save();
  assert.equal(result.hint.source, "meta", "Fallback retained; stop before following it.");
  return result.hint.example;
}

let nextLine = "Bob, could you walk me through what's making this deadline difficult?";
try {
  for (let index = 0; index < 4; index += 1) {
    const started = performance.now();
    const result = await api.sendTurn(
      {
        session_id: session.id,
        branch_id: session.active_branch_id,
        parent_node_id: session.active_head_node_id,
        expected_revision: session.revision,
        user_message: nextLine,
      },
      crypto.randomUUID(),
    );
    session = result.session;
    report.turns.push({
      node: result.node,
      revision: session.revision,
      elapsed_ms: Math.round(performance.now() - started),
    });
    save();
    console.log(
      JSON.stringify({
        turn: index + 1,
        feedback: result.node.feedback?.status,
        score: result.node.score,
        stance: result.node.resistance,
      }),
    );
    if (index < 3) {
      nextLine = await hint(1);
      // Keep the first suggestion for follow-through; second hint receives it
      // as a suggestion, not an alleged utterance or intervening event.
      if (index === 0) await hint(2);
    }
  }
  const resumed = await api.getSession(session.id);
  const tree = await api.getTree(session.id);
  const savedHints = await api.listCoachHints(session.id, session.active_branch_id, null);
  assert.equal(resumed.revision, 4);
  assert.equal(tree.nodes.length, 4);
  assert.equal(savedHints.hints.length, 4);
  assert.deepEqual(
    tree.nodes.map((n) => n.id),
    report.turns.map((t) => t.node.id),
  );
  for (let i = 1; i < 4; i += 1) {
    const firstAtPrevious = report.hints.find(
      (h) =>
        h.response.head_node_id === report.turns[i - 1].node.id && h.response.hint.attempt === 1,
    );
    assert.equal(report.turns[i].node.user_text, firstAtPrevious.response.hint.example);
  }
  report.complete = true;
  report.reload_verified = true;
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  save();
}
