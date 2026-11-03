// Reuse the reviewed real-client launcher without editing Claude's shared harness.
// node scripts/verify_bob_feedback.mjs --bind 127.0.0.2 --frontend production --out <dir>
// Real HTTP/judge/storage and real built UI; fixture persona, no paid provider calls.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
let source = readFileSync(join(root, "scripts/verify_coaching_browser.mjs"), "utf8");
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error(`Harness boundary changed: ${before}`);
  source = source.replace(before, after);
}
replaceOnce(
  'const ROOT = resolve(import.meta.dirname, "..");',
  `const ROOT = ${JSON.stringify(root)};`,
);
replaceOnce(
  '"./coach_evidence.mjs"',
  JSON.stringify(pathToFileURL(join(root, "scripts/coach_evidence.mjs")).href),
);
replaceOnce('"scripts/run_backend_stub_persona.py"', '"scripts/run_backend_bob_feedback_probe.py"');
replaceOnce(
  "async function runLostResponse() {",
  `async function runLostResponse() {
  {
    const evidence = "real-http";
    const id = await openBobSession();
    await waitFor("the composer", () => evaluate('Boolean(document.querySelector("textarea"))'));
    await typeAndSend("but it is you who is slow, everyone is working extra hard");
    await settled(id, 1);
    let data = await tree(id);
    let head = data.nodes.find(n => n.id === headOf(data));
    check("blame: flagged by real API", head.coaching.leading === true, evidence);
    check("blame: no empathy metric", head.metrics.empathy_turns === 0, evidence);
    check("blame: no empathy praise displayed", !(await has("You acknowledged emotion or difficulty.")), evidence);
    check("blame: warning displayed", await has("Try a question without blame or an assumed answer."), evidence);
    await screenshot("cs72-blame-feedback");
    await typeAndSend("It sounds like a hard week.");
    await settled(id, 2);
    data = await tree(id);
    head = data.nodes.find(n => n.id === headOf(data));
    check("support: genuine acknowledgment retained", head.coaching.empathy && !head.coaching.leading, evidence);
    check("support: empathy metric increments once", head.metrics.empathy_turns === 1, evidence);
    check("support: acknowledgment displayed", await has("You acknowledged emotion or difficulty."), evidence);
    await screenshot("cs72-support-feedback");
    await typeAndSend("I hear you, but you are lazy - what would help?");
    await settled(id, 3);
    data = await tree(id);
    head = data.nodes.find(n => n.id === headOf(data));
    check("mixed blame: remains open but leading", head.coaching.question_type === "open" && head.coaching.leading, evidence);
    check("mixed blame: no new empathy credit", head.metrics.empathy_turns === 1 && !head.coaching.empathy, evidence);
    check("mixed blame: no need reveal", head.score === 0, evidence);
    check("mixed blame: no positive empathy displayed", !(await has("You acknowledged emotion or difficulty.")), evidence);
    await send("Page.reload");
    await waitFor("reload restores feedback", () => has("Try a question without blame or an assumed answer."));
    check("reload: same branch/head", headOf(await tree(id)) === head.id, evidence);
    check("reload: no duplicate fixture call", personaCalls() === 3, evidence);
    check("reload: no false praise", !(await has("You acknowledged emotion or difficulty.")), evidence);
    await screenshot("cs72-restored-feedback");
    return;
  }
`,
);
const generated = join(mkdtempSync(join(tmpdir(), "cs72-browser-")), "probe.mjs");
writeFileSync(generated, source);
const result = spawnSync(
  process.execPath,
  [generated, "--journey", "lost-response", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
