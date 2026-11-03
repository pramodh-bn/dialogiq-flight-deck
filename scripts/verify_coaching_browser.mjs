// Drives the Arena's coach UI in headless Edge against a real frontend and backend.
//
//   node scripts/verify_coaching_browser.mjs --env-file <path to .env> [options]
//
//   --coach injected   Serve the coach routes from this script (default). Works before
//                      the backend has them. Proves client behaviour only.
//   --coach real       Use the backend's coach routes, and so the Meta API if configured.
//   --coach stub       Real backend and browser, with a slow stand-in for the Meta provider
//                      (scripts/run_backend_stub_coach.py), to prove waits past the 30s
//                      leases over real HTTP without paid calls. Needs --demo-wait.
//   --demo-wait        Set COACH_DEMO_WAIT=1 and VITE_COACH_DEMO_WAIT=1. With --coach
//                      injected, adds delayed browser checks past 15s and 30s.
//   --out <dir>        Report and screenshots. Default: a new temp directory.
//   --python <path>    Default: backend/.venv's interpreter.
//   --backend-runner <path>  Optional live-backend entry point (e.g. a capped verifier).
//   --edge <path>      Default: the standard Windows Edge install.
//   --journey lost-response
//                      Drop responses after the server commits, with a stand-in persona that
//                      counts its calls. Needs no provider, spends nothing and ignores --coach.
//   --journey recorder-failure
//                      Fail the Recorder's scenario request, then let it recover, with the same
//                      stand-in persona. Needs no provider, spends nothing and ignores --coach.
//   --journey graph-navigation
//                      Walk a long branched tree across canvas zoom and browser magnification
//                      with the stand-in persona. Needs no provider and spends nothing.
//   --journey bob      Run the --cases step lists against Bob instead of the full journey.
//                      Needs --coach real. Saves each hint beside the public dialogue it
//                      answered. Case text is never printed, so a held-out file stays out
//                      of the console; its report does contain the text.
//   --cases <path>     Default: scripts/cases/bob_capture_cases.json.
//   --frontend <mode>  dev (default) or production: a built client served by a local Worker.
//   --bind <address>   Default 127.0.0.1. Use 127.0.0.2 to run beside a held demo.
//
// Needs ports 8080 and 5173 free, and stops if they are not. It starts both servers on a
// new disposable SQLite database and removes that database afterwards. Persona turns use
// live Baseten, so a run spends about ten of them. Failures are always injected at the
// browser, whatever the mode, and each check is tagged with the evidence it really gives:
// injected, real-http or live-meta. Key values are never read or printed here.

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  denominators,
  effectiveSettings,
  followRecord,
  forbiddenKeys,
  hintRecord,
  selectedPath,
} from "./coach_evidence.mjs";

const { values: args } = parseArgs({
  options: {
    "env-file": { type: "string" },
    coach: { type: "string", default: "injected" },
    "demo-wait": { type: "boolean", default: false },
    out: { type: "string" },
    python: { type: "string" },
    "backend-runner": { type: "string", default: "scripts/run_backend.py" },
    edge: { type: "string" },
    journey: { type: "string", default: "full" },
    cases: { type: "string" },
    frontend: { type: "string", default: "dev" },
    bind: { type: "string", default: "127.0.0.1" },
  },
});

if (!["injected", "real", "stub"].includes(args.coach)) {
  throw new Error("--coach: injected, real or stub");
}
if (args.coach === "stub" && !args["demo-wait"]) throw new Error("--coach stub needs --demo-wait");
if (
  !args["env-file"] &&
  !["lost-response", "recorder-failure", "graph-navigation", "bob-stance"].includes(args.journey)
) {
  throw new Error("--env-file is required: persona turns need Baseten");
}
const JOURNEYS = ["full", "bob", "lost-response", "recorder-failure", "graph-navigation", "bob-stance"];
if (!JOURNEYS.includes(args.journey)) throw new Error(`--journey: ${JOURNEYS.join(", ")}`);
const LOST = args.journey === "lost-response";
const RECORDER_FAILURE = args.journey === "recorder-failure";
const GRAPH = args.journey === "graph-navigation";
const STANCE = args.journey === "bob-stance";
const STAND_IN = LOST || RECORDER_FAILURE || GRAPH || STANCE;
if (!["dev", "production"].includes(args.frontend)) {
  throw new Error("--frontend: dev or production");
}
if (args.journey === "bob" && args.coach !== "real") throw new Error("--journey bob: --coach real");

const ROOT = resolve(import.meta.dirname, "..");
const BIND = args.bind;
const WEB = `http://${BIND}:5173`;
const API = `http://${BIND}:8080`;
const DEBUG_PORT = 9334;
const STUB = args.coach === "stub";
const STUB_DELAY_S = 35;
// Older Wrangler bundles a Workerd that refuses the build's compatibility date (CS-C360).
const WRANGLER_VERSION = "4.156.2";
const REAL = args.coach !== "injected";
const DEMO = args["demo-wait"];
// With no cutoff in demo waiting, a live hint can take far longer than the usual bound.
const HINT_WAIT_MS = DEMO ? 300_000 : 20_000;
const OUT = resolve(args.out ?? mkdtempSync(join(tmpdir(), "coach-browser-")));
const PYTHON = args.python ?? join(ROOT, "backend", ".venv", "Scripts", "python.exe");
const EDGE = args.edge ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SCRATCH = mkdtempSync(join(tmpdir(), "coach-browser-db-"));
const STUB_CALLS = join(SCRATCH, "stub-calls.txt");
const PERSONA_CALLS = join(SCRATCH, "persona-calls.txt");
const TELEMETRY = join(OUT, "coach-telemetry.jsonl");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hintEvidence = STUB ? "stub-provider" : REAL ? "live-provider" : "injected";
const uiEvidence = REAL ? "real-http" : "injected";

// ---- Results ---------------------------------------------------------------------------

const results = [];
const timings = [];
const hintPairs = [];
const savedHints = [];
const n1Pairs = [];

function check(name, passed, evidence, detail = "") {
  results.push({ name, status: passed ? "pass" : "FAIL", evidence, detail: String(detail) });
  console.log(`${passed ? "PASS" : "FAIL"} [${evidence}] ${name}${detail ? ` (${detail})` : ""}`);
}

function notExercised(name, evidence, why) {
  results.push({ name, status: "not exercised", evidence, detail: why });
  console.log(`SKIP [${evidence}] ${name} (${why})`);
}

// ---- Servers ---------------------------------------------------------------------------

const portFree = (port) =>
  new Promise((done) => {
    const socket = createConnection({ port, host: BIND });
    socket.once("connect", () => (socket.destroy(), done(false)));
    socket.once("error", () => done(true));
  });

async function waitForUrl(url, label) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  throw new Error(`${label} did not start; see ${OUT}`);
}

const children = [];

function startLogged(name, command, commandArgs, options) {
  const child = spawn(command, commandArgs, { cwd: ROOT, ...options });
  const log = createWriteStream(join(OUT, `${name}.log`));
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

// ---- Browser ---------------------------------------------------------------------------

let ws;
let seq = 0;
const waiting = new Map();
const problems = [];

function send(method, params = {}) {
  return new Promise((done) => {
    const id = ++seq;
    waiting.set(id, done);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const { result } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? "";
    throw new Error(`${result.exceptionDetails.text} ${detail.split("\n")[0]} in: ${expression.slice(0, 80)}`);
  }
  return result?.result?.value;
}

async function waitFor(what, predicate, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const pageText = () => evaluate("document.body.innerText");
// Case-insensitive, because innerText reflects CSS uppercasing.
const has = async (text) => (await pageText()).toLowerCase().includes(text.toLowerCase());
const buttonState = (label) =>
  evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
    return b ? (b.disabled ? "disabled" : "enabled") : "absent";
  })()`);

async function click(label) {
  const state = await waitFor(`${label} enabled`, async () => {
    const value = await buttonState(label);
    return value === "enabled" && value;
  });
  await evaluate(`[...document.querySelectorAll("button")]
    .find((x) => x.innerText.trim() === ${JSON.stringify(label)}).click()`);
  return state;
}

async function screenshot(name) {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  if (result?.data) writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
}

async function press(key, code, virtualKey, text) {
  const base = { key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  if (text) await send("Input.dispatchKeyEvent", { type: "char", text, ...base });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// ---- Coach routes, as seen by the browser ------------------------------------------------

const coachPosts = [];
const coachGets = [];
const script = []; // Applied in order to POSTs; each entry is one scripted response.
const store = new Map();
let nextHintId = 9000;

const CORS = [
  { name: "Content-Type", value: "application/json" },
  { name: "Access-Control-Allow-Origin", value: WEB },
];

const envelope = (code, retryable) => ({
  detail: { code, message: code, retryable },
});

function fulfill(requestId, status, body) {
  return send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: CORS,
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
}

function injectedHint(req, over = {}) {
  return {
    id: nextHintId++,
    contract_revision: "s3-coach-r2",
    attempt: req.attempt,
    approach: `Injected approach ${req.attempt} for head ${req.head_node_id ?? "root"}`,
    example: "Injected example line.",
    reason: "Injected reason.",
    source: "meta",
    fallback_reason: null,
    latency_ms: 25,
    ...over,
  };
}

const sessionIdFrom = (url) => Number(/sessions\/(\d+)\//.exec(url)?.[1]);

function respondHint(requestId, req, url, over) {
  const session_id = sessionIdFrom(url);
  const slot = `${req.branch_id}:${req.head_node_id}:${req.attempt}`;
  const hint = store.get(slot) ?? injectedHint(req, over);
  store.set(slot, hint);
  return fulfill(requestId, 200, {
    session_id,
    branch_id: req.branch_id,
    head_node_id: req.head_node_id,
    revision: req.expected_revision,
    hint,
  });
}

async function onPaused({ requestId, request, responseStatusCode }) {
  const { method, url, postData, headers } = request;
  if (method === "OPTIONS") return send("Fetch.continueRequest", { requestId });
  if (LOST) return onMutation({ requestId, request, responseStatusCode });
  if (RECORDER_FAILURE) return onScenarioRequest(requestId);

  if (method === "GET") {
    coachGets.push(url);
    if (REAL) return send("Fetch.continueRequest", { requestId });
    const branchId = Number(/branches\/(\d+)\//.exec(url)?.[1]);
    const hints = [...store.entries()]
      .filter(([slot]) => Number(slot.split(":")[0]) === branchId)
      .map(([slot, hint]) => {
        const head = slot.split(":")[1];
        return { head_node_id: head === "null" ? null : Number(head), hint };
      });
    return fulfill(requestId, 200, {
      session_id: sessionIdFrom(url),
      branch_id: branchId,
      head_node_id: null,
      revision: 0,
      hints,
    });
  }

  const body = JSON.parse(postData);
  const key = Object.entries(headers).find(([k]) => k.toLowerCase() === "idempotency-key")?.[1];
  const step = script.shift();
  // A timing-only step answers nothing, so a real run still reaches the backend.
  const passes = REAL && Object.keys(step ?? {}).every((k) => k === "delayMs");
  coachPosts.push({ body, key, at: Date.now(), injected: Boolean(step) && !passes });

  if (passes) {
    if (step?.delayMs) await sleep(step.delayMs);
    return send("Fetch.continueRequest", { requestId });
  }
  if (!step) return respondHint(requestId, body, url);
  if (step.delayMs) await sleep(step.delayMs);
  if (step.network) {
    return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
  }
  if (step.status) return fulfill(requestId, step.status, step.body);
  return respondHint(requestId, body, url, step.hint);
}

// ---- Steps -------------------------------------------------------------------------------

const getJson = async (path) => (await fetch(`${API}${path}`)).json();

async function tree(sessionId) {
  return getJson(`/api/sessions/${sessionId}/tree`);
}

function headOf(data) {
  const branch = data.branches.find((b) => b.id === data.active_branch_id);
  return branch.head_node_id;
}

async function sendTurn(sessionId, text) {
  const before = (await tree(sessionId)).revision;
  await evaluate(`document.querySelector("textarea").focus()`);
  await send("Input.insertText", { text });
  await click("Send Response");
  await waitFor("the turn to save", async () => (await tree(sessionId)).revision > before, 60_000);
  const data = await tree(sessionId);
  const head = data.nodes.find((n) => n.id === headOf(data));
  const parent = data.nodes.find((n) => n.id === head.parent_id);
  return { data, head, stalled: head.score === (parent?.score ?? 0) && head.score < 7 };
}

async function hintShown(text, timeoutMs = 20_000) {
  const start = Date.now();
  await waitFor(`hint "${text}"`, () => has(text), timeoutMs);
  return Date.now() - start;
}

const approachFor = (head, attempt) => `Injected approach ${attempt} for head ${head ?? "root"}`;

// In real mode the text is unknown, so wait on the label a saved hint always carries.
async function waitForHint(head, attempt) {
  const start = Date.now();
  const label = attempt === 2 ? "Two approaches saved for this turn" : "Try another approach";
  await waitFor(`attempt ${attempt} on screen`, () => has(label), HINT_WAIT_MS);
  if (!REAL) await hintShown(approachFor(head, attempt), 2_000);
  const elapsed = Date.now() - start;
  timings.push({ attempt, head, browser_ms: elapsed });
  return elapsed;
}

// A live timeout is the contract working, so real mode checks that the label tells the truth
// about what was saved, and the report carries how often the provider actually answered.
async function checkLabel(sessionId, branchId, head, attempt) {
  const listed = await getJson(`/api/sessions/${sessionId}/branches/${branchId}/coach-hints`);
  const hint = listed.hints.find(
    (h) => h.head_node_id === head && h.hint.attempt === attempt,
  )?.hint;
  check(
    `attempt ${attempt} on head ${head ?? "root"} is labelled for its source`,
    Boolean(hint) && (await has(hint.source === "meta" ? "AI coach" : "Basic hint")),
    hintEvidence,
    hint ? `${hint.source} ${hint.fallback_reason ?? ""} ${hint.latency_ms}ms` : "not saved",
  );
}

async function openMayaSession() {
  await send("Page.navigate", { url: WEB });
  await waitFor("the hub", () => has("New Session"), 30_000);
  await evaluate(`(() => {
    const card = [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "New Session");
    const maya = card.find((b) => (b.closest("div[class*=bento], article, li")?.innerText ?? "").includes("Maya")
      || (b.parentElement?.parentElement?.innerText ?? "").includes("Homework"));
    (maya ?? card[0]).click();
  })()`);
  await waitFor("the Arena", () => evaluate(`location.pathname === "/arena"`), 20_000);
  await waitFor("the Maya session", () => has("Your situation"), 20_000);
  return Number(new URL(await evaluate("location.href")).searchParams.get("sessionId"));
}

// The stalled-dialogue case from the reviewed cases. The second hint has to be a different
// move on the same turn, which a person judges from the saved pair; root pairs do not count.
const N1_LINES = [
  "Hey. How was school?",
  "Anything happen?",
  "Your teacher emailed me about the homework.",
  "So are you going to tell me what's going on?",
  "I just want to help you.",
];

async function runN1() {
  for (let round = 1; round <= 3 && !n1Pairs.some((p) => p.both_provider); round++) {
    const sessionId = await openMayaSession();
    let turn;
    for (const line of N1_LINES) turn = await sendTurn(sessionId, line);
    const branch = turn.data.active_branch_id;
    const saved = async () => {
      const path = `/api/sessions/${sessionId}/branches/${branch}/coach-hints`;
      return (await getJson(path)).hints;
    };
    const atHead = async () =>
      (await saved()).filter((h) => h.head_node_id === turn.head.id).map((h) => h.hint);
    if (!turn.stalled) await click("Get a hint");
    const firstPost = () => coachPosts.find((p) => p.body.head_node_id === turn.head.id);
    await waitFor("the N1 first hint", async () => (await atHead()).length === 1, HINT_WAIT_MS);
    const firstElapsed = Date.now() - (firstPost()?.at ?? Date.now());
    await waitFor(
      "the N1 second action",
      async () => (await buttonState("Try another approach")) === "enabled",
      5_000,
    );
    const secondStart = Date.now();
    await click("Try another approach");
    await waitFor("the N1 second hint", async () => (await atHead()).length === 2, HINT_WAIT_MS);
    const secondElapsed = Date.now() - secondStart;
    await sleep(500);
    await screenshot(`6-n1-round-${round}`);
    const hints = await atHead();
    n1Pairs.push({
      session_id: sessionId,
      head_node_id: turn.head.id,
      last_turn_stalled: turn.stalled,
      both_provider: hints.every((h) => h.source === "meta"),
      elapsed_ms: [firstElapsed, secondElapsed],
      hints,
    });
    savedHints.push(
      ...(await saved()).map((h) => ({
        session_id: sessionId,
        branch_id: branch,
        head: h.head_node_id,
        ...h.hint,
      })),
    );
  }
  if (n1Pairs.some((p) => p.both_provider)) {
    check("N1 pair was generated by the provider", true, hintEvidence);
  } else {
    notExercised("N1 provider pair", hintEvidence, "three rounds each hit a fallback");
  }
}

// Demo waiting: the coach stays pending past the normal budget and past the 30s lease, and
// leaving the position still keeps a late result off the screen. The delays are injected.
async function runDemoWait() {
  const sessionId = await openMayaSession();
  script.push({ delayMs: 31_000 });
  const start = Date.now();
  await click("Get a hint");
  await sleep(16_000);
  check("demo: still pending past 15s", await has("Getting a hint"), "injected");
  check(
    "demo: no retry offered while waiting",
    (await buttonState("Try again")) === "absent",
    "injected",
  );
  await waitForHint(null, 1);
  check(
    "demo: a 31s hint arrives",
    Date.now() - start >= 30_000,
    "injected",
    `${Date.now() - start}ms`,
  );
  check(
    "demo: one POST for the wait",
    coachPosts.filter((p) => p.at >= start).length === 1,
    "injected",
  );

  script.push({ delayMs: 18_000, hint: { approach: "LATE DEMO MARKER" } });
  const turn = await sendTurn(sessionId, "Did you finish your homework?");
  if (turn.stalled) {
    await waitFor("the delayed demo POST", () => has("Getting a hint"), 10_000);
    await sendTurn(sessionId, "Okay.");
    await sleep(20_000);
    check("demo: moving on keeps the late hint out", !(await has("LATE DEMO MARKER")), "injected");
  } else {
    script.length = 0;
    notExercised("demo: late result protection", "injected", "the turn was not stalled");
  }
}

// Waits past both 30s leases, over real HTTP, with a stand-in provider that sleeps. Competing
// requests have to observe the running generation, and only one provider call may happen.
const stubCalls = () => {
  try {
    return readFileSync(STUB_CALLS, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

async function competitor(sessionId, post, key) {
  const res = await fetch(`${API}/api/sessions/${sessionId}/coach-hints`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(post.body),
  });
  const body = await res.json();
  return { status: res.status, code: body.detail?.code ?? null, hint: body.hint ?? null };
}

async function runLongWait() {
  const sessionId = await openMayaSession();
  const hintsOn = async (branch, head) => {
    const path = `/api/sessions/${sessionId}/branches/${branch}/coach-hints`;
    return (await getJson(path)).hints.filter((h) => h.head_node_id === head).map((h) => h.hint);
  };

  const start = Date.now();
  await click("Get a hint");
  await waitFor("the coach POST", () => coachPosts.length === 1, 5_000);
  const post = coachPosts[0];
  await sleep(16_000);
  check("still pending past 15s", await has("Getting a hint"), "stub-provider");
  await sleep(Math.max(0, start + 32_000 - Date.now()));
  check("still pending past the 30s leases", await has("Getting a hint"), "stub-provider");

  const sameKey = await competitor(sessionId, post, post.key);
  check(
    "same-key competitor past 30s sees it running",
    sameKey.status === 409 && sameKey.code === "request_in_progress",
    "stub-provider",
    `${sameKey.status} ${sameKey.code}`,
  );
  const otherKey = await competitor(sessionId, post, crypto.randomUUID());
  check(
    "different-key competitor past 30s sees it running",
    otherKey.status === 409 && otherKey.code === "request_in_progress",
    "stub-provider",
    `${otherKey.status} ${otherKey.code}`,
  );

  await waitFor("the long hint", () => has("Try another approach"), 60_000);
  const elapsed = Date.now() - start;
  timings.push({ attempt: 1, head: null, browser_ms: elapsed });
  check(
    "a hint past 30s arrives",
    elapsed >= STUB_DELAY_S * 1_000,
    "stub-provider",
    `${elapsed}ms`,
  );
  check(
    "the long wait made one provider call",
    stubCalls() === 1,
    "stub-provider",
    `${stubCalls()}`,
  );
  const branch = post.body.branch_id;
  const saved = await hintsOn(branch, null);
  check("the long wait saved one hint", saved.length === 1, "stub-provider");
  check(
    "latency_ms saturates at 10000",
    saved[0]?.latency_ms === 10_000,
    "stub-provider",
    `${saved[0]?.latency_ms}ms against ${elapsed}ms in the browser`,
  );
  const replay = await competitor(sessionId, post, post.key);
  check(
    "same-key replay returns the saved hint",
    replay.status === 200 && replay.hint?.id === saved[0]?.id && stubCalls() === 1,
    "stub-provider",
    `${replay.status}`,
  );

  // A reload mid-wait loses the page's key, so a new key has to wait on the same generation.
  const stalled = await sendTurn(sessionId, "Did you finish your homework?");
  if (stalled.stalled) {
    await waitFor("the automatic hint call", () => stubCalls() === 2, 10_000);
    await sleep(3_000);
    const before = coachPosts.length;
    await send("Page.reload");
    await waitFor("a new POST after reload", () => coachPosts.length > before, 20_000);
    await waitFor("the hint after reload", () => has("Try another approach"), 60_000);
    check(
      "reload mid-wait costs no second call",
      stubCalls() === 2,
      "stub-provider",
      `${stubCalls()}`,
    );
    check(
      "reload mid-wait uses paced 409s",
      coachPosts.slice(before).length > 1,
      "stub-provider",
      `${coachPosts.slice(before).length} POSTs`,
    );
    const atHead = await hintsOn(stalled.data.active_branch_id, stalled.head.id);
    check("reload mid-wait saved one hint", atHead.length === 1, "stub-provider");
  } else {
    notExercised("reload mid-wait", "stub-provider", "the turn was not stalled");
  }

  // Moving on: the abandoned call may finish, but its hint is neither saved nor shown.
  const moved = await sendTurn(sessionId, "Okay.");
  if (moved.stalled) {
    const number = stubCalls();
    await waitFor("the next automatic call", () => stubCalls() === 3, 10_000);
    await waitFor("the pending hint", () => has("Getting a hint"), 10_000);
    await sendTurn(sessionId, "Fine.");
    await sleep((STUB_DELAY_S + 4) * 1_000);
    check(
      "a result from the old turn is not shown",
      !(await has(`Stub approach ${number + 1}.`)),
      "stub-provider",
    );
    const old = await hintsOn(moved.data.active_branch_id, moved.head.id);
    check("a result from the old turn is not saved", old.length === 0, "stub-provider");
  } else {
    notExercised("moving on mid-wait", "stub-provider", "the turn was not stalled");
  }
  await screenshot("long-wait-end");
}

// ---- Lost responses --------------------------------------------------------------------
//
// Faults happen at the browser with the real backend behind it. `after-commit` lets the
// server finish and drops its response, which is the case a learner cannot tell apart from
// a failed send. `before-send` drops the request, so nothing commits.

const mutations = [];
let fault = null;

const armFault = (stage, then = "fail") => {
  fault = { stage, then };
};

async function onMutation({ requestId, request, responseStatusCode }) {
  const responded = responseStatusCode !== undefined;
  const key = Object.entries(request.headers).find(
    ([k]) => k.toLowerCase() === "idempotency-key",
  )?.[1];
  if (request.method !== "GET" && !responded) {
    mutations.push({ url: request.url, key, body: request.postData, status: null });
  }
  if (responded && request.method !== "GET") {
    const record = mutations.findLast((m) => m.key === key && m.status === null);
    if (record) record.status = responseStatusCode;
  }
  if (fault?.stage === "before-send" && !responded) {
    fault = null;
    return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
  }
  if (fault?.stage === "after-commit" && responded) {
    const { then } = fault;
    fault = null;
    if (then === "reload") return void send("Page.reload");
    return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
  }
  return send("Fetch.continueRequest", { requestId });
}

const personaCalls = () => {
  try {
    return readFileSync(PERSONA_CALLS, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

const draft = () => evaluate(`document.querySelector("textarea")?.value ?? ""`);

async function typeAndSend(text) {
  await evaluate(`document.querySelector("textarea").focus()`);
  await send("Input.insertText", { text });
  await click("Send Response");
}

const nodeCount = async (id) => (await tree(id)).nodes.length;

async function waitForNodes(id, count) {
  await waitFor(`${count} turns saved`, async () => (await nodeCount(id)) >= count, 15_000);
}

// The replay runs after the tree settles, so wait on the draft and on what was sent.
async function settled(id, nodes) {
  await waitForNodes(id, nodes);
  await waitFor("the composer to settle", async () => (await buttonState("Send Response")) !== "absent", 15_000);
  await sleep(1_500);
}

function sameRequest(posts) {
  return (
    posts.length >= 2 &&
    new Set(posts.map((p) => p.key)).size === 1 &&
    new Set(posts.map((p) => p.body)).size === 1
  );
}

async function openRecorderAt(id, nodeId) {
  await clickLink("End Simulation");
  await waitFor(
    "the Flight Recorder",
    () => evaluate(`location.pathname === "/flight-recorder"`),
    15_000,
  );
  await clickTreeNode(nodeId);
}

async function runLostResponse() {
  const evidence = "real-http";
  const id = await openBobSession();
  await waitFor("the composer", () => evaluate(`Boolean(document.querySelector("textarea"))`));

  // A committed turn whose response is lost comes back through its exact replay.
  let start = mutations.length;
  armFault("after-commit");
  await typeAndSend("First line.");
  await settled(id, 1);
  let posts = mutations.slice(start);
  check("lost turn: one turn saved", (await nodeCount(id)) === 1, evidence, `${await nodeCount(id)}`);
  check("lost turn: one persona call", personaCalls() === 1, evidence, `${personaCalls()}`);
  check("lost turn: replay used the same key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);
  check("lost turn: the replay succeeded", posts.at(-1)?.status === 200, evidence, `${posts.at(-1)?.status}`);
  check("lost turn: no draft left behind", (await draft()) === "", evidence);
  check("lost turn: the reply is on screen", await has("Stand-in reply 1."), evidence);

  // The same words again are a new action.
  start = mutations.length;
  await typeAndSend("First line.");
  await settled(id, 2);
  posts = mutations.slice(start);
  check("identical line: a second turn saved", (await nodeCount(id)) === 2, evidence);
  check("identical line: a second persona call", personaCalls() === 2, evidence, `${personaCalls()}`);
  check(
    "identical line: a new key",
    posts.length === 1 && !mutations.slice(0, start).some((m) => m.key === posts[0].key),
    evidence,
  );

  // A reload while the outcome is unknown: storage carries the action across it.
  start = mutations.length;
  armFault("after-commit", "reload");
  await typeAndSend("Third line.");
  await waitForNodes(id, 3);
  await waitFor("the Arena after reload", () => has("Your situation"), 20_000);
  await waitFor(
    "the replay after reload",
    () => mutations.slice(start).some((m) => m.status === 200),
    15_000,
  );
  await sleep(1_500);
  posts = mutations.slice(start);
  check("reload: one turn saved", (await nodeCount(id)) === 3, evidence, `${await nodeCount(id)}`);
  check("reload: one persona call", personaCalls() === 3, evidence, `${personaCalls()}`);
  check("reload: replay used the same key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);
  check("reload: no draft left behind", (await draft()) === "", evidence);

  // A request that never arrived stays a draft, and sending it again commits once.
  start = mutations.length;
  armFault("before-send");
  await typeAndSend("Fourth line.");
  await waitFor("the restored draft", async () => (await draft()) === "Fourth line.", 15_000);
  check("not sent: nothing saved", (await nodeCount(id)) === 3, evidence);
  check("not sent: no persona call", personaCalls() === 3, evidence, `${personaCalls()}`);
  await click("Send Response");
  await settled(id, 4);
  posts = mutations.slice(start);
  check("not sent: the resend committed once", (await nodeCount(id)) === 4, evidence);
  check("not sent: one persona call", personaCalls() === 4, evidence, `${personaCalls()}`);
  check("not sent: the resend kept its key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);

  // Another tab moved on while the draft waited: the old request is refused, not duplicated.
  armFault("before-send");
  await typeAndSend("Fifth line.");
  await waitFor("the restored draft", async () => (await draft()) === "Fifth line.", 15_000);
  const data = await tree(id);
  const other = await fetch(`${API}/api/chat/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      session_id: id,
      branch_id: data.active_branch_id,
      parent_node_id: headOf(data),
      expected_revision: data.revision,
      user_message: "From another tab.",
    }),
  });
  check("stale: the other tab's turn saved", other.status === 200, evidence, `${other.status}`);
  start = mutations.length;
  await sleep(500);
  await click("Send Response");
  await waitFor("the stale refusal", () => mutations.slice(start).some((m) => m.status === 409), 15_000);
  await sleep(1_500);
  check("stale: nothing duplicated", (await nodeCount(id)) === 5, evidence, `${await nodeCount(id)}`);
  check("stale: the draft is kept", (await draft()) === "Fifth line.", evidence);
  start = mutations.length;
  const staleKey = mutations.at(-1).key;
  await waitFor("the composer", async () => (await buttonState("Send Response")) === "enabled", 15_000);
  await click("Send Response");
  await settled(id, 6);
  check("stale: sending again commits once", (await nodeCount(id)) === 6, evidence);
  check(
    "stale: the new send has a new key",
    mutations.slice(start).length === 1 &&
      mutations.slice(start)[0].status === 200 &&
      mutations.slice(start)[0].key !== staleKey,
    evidence,
  );

  // Rewind whose response is lost: one branch, and the learner still lands on it.
  const before = await tree(id);
  const callsBefore = personaCalls();
  const nodeId = selectedPath(before.nodes, headOf(before))[1].id;
  await openRecorderAt(id, nodeId);
  start = mutations.length;
  armFault("after-commit");
  await click("Branch from here");
  await waitFor("the Arena on the new branch", () => evaluate(`location.pathname === "/arena"`), 15_000);
  await sleep(1_000);
  let after = await tree(id);
  posts = mutations.slice(start);
  check("lost rewind: one branch", after.branches.length === before.branches.length + 1, evidence, `${after.branches.length}`);
  check("lost rewind: replay used the same key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);
  check("lost rewind: no turn or persona call added", after.nodes.length === before.nodes.length && personaCalls() === callsBefore, evidence, `${callsBefore} to ${personaCalls()}`);

  // Rewind with a reload while unknown.
  const mid = after;
  await openRecorderAt(id, selectedPath(mid.nodes, headOf(mid))[0].id);
  start = mutations.length;
  armFault("after-commit", "reload");
  await click("Branch from here");
  await waitFor("the Arena after reload", () => evaluate(`location.pathname === "/arena"`), 25_000);
  await sleep(1_000);
  after = await tree(id);
  posts = mutations.slice(start);
  check("reloaded rewind: one branch", after.branches.length === mid.branches.length + 1, evidence, `${after.branches.length}`);
  check("reloaded rewind: replay used the same key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);

  // Resuming a branch whose response is lost.
  const source = before.active_branch_id;
  const resumed = selectedPath(after.nodes, before.branches.find((b) => b.id === source).head_node_id).at(-1);
  await openRecorderAt(id, resumed.id);
  start = mutations.length;
  armFault("after-commit");
  await click("Resume this branch");
  await waitFor("the Arena on the resumed branch", () => evaluate(`location.pathname === "/arena"`), 15_000);
  await sleep(1_000);
  const finalTree = await tree(id);
  posts = mutations.slice(start);
  check("lost resume: the branch is active", finalTree.active_branch_id === source, evidence);
  check("lost resume: replay used the same key and body", sameRequest(posts), evidence, `${posts.length} POSTs`);
  check("lost resume: no branch added", finalTree.branches.length === after.branches.length, evidence);

  check("no console errors or exceptions", problems.length === 0, evidence, problems.slice(0, 3).join(" | "));
}

// ---- Recorder scenario failure -----------------------------------------------------------

let scenarioFault = null;
let scenarioRequests = 0;

function onScenarioRequest(requestId) {
  scenarioRequests += 1;
  if (scenarioFault === "network") {
    return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
  }
  if (scenarioFault === "503") {
    return send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 503,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Access-Control-Allow-Origin", value: new URL(WEB).origin },
      ],
      body: Buffer.from('{"detail":"unavailable"}').toString("base64"),
    });
  }
  return send("Fetch.continueRequest", { requestId });
}

async function runRecorderFailure() {
  const evidence = "real-http";
  const recorder = (id) => new URL(`/flight-recorder?sessionId=${id}`, WEB).href;
  const failed = "Couldn't load this scenario";
  const loading = "Loading session";

  const id = await openBobSession();
  await waitFor("the composer", () => evaluate(`Boolean(document.querySelector("textarea"))`));
  await typeAndSend("First line.");
  await settled(id, 1);
  await typeAndSend("Second line.");
  await settled(id, 2);
  const before = await tree(id);

  // A full navigation empties the query cache, so the scenario must be fetched again.
  scenarioFault = "503";
  await send("Page.navigate", { url: recorder(id) });
  await waitFor("loading while the query is pending", () => has(loading), 15_000);
  check("pending: loading is shown", true, evidence);
  await waitFor("the scenario failure", () => has(failed), 20_000);
  check("503: the failure is explicit", await has("Your recorded turns are safe"), evidence);
  check("503: loading has stopped", !(await has(loading)), evidence);
  check("503: retry is offered", (await buttonState("Try again")) === "enabled", evidence);

  // A retry that also fails returns to the same state, with the button usable.
  scenarioFault = "network";
  let start = scenarioRequests;
  await click("Try again");
  await waitFor("the retry request", () => scenarioRequests > start, 10_000);
  await waitFor("the retry to finish", async () => (await buttonState("Try again")) === "enabled", 20_000);
  check("still failing: the retry refetched the scenario", scenarioRequests > start, evidence, `${scenarioRequests - start} requests`);
  check("still failing: the failure stays explicit", (await has(failed)) && !(await has(loading)), evidence);

  // Recovery lands on the same session and branch.
  scenarioFault = null;
  start = scenarioRequests;
  await click("Try again");
  const nodeId = selectedPath(before.nodes, headOf(before))[0].id;
  await clickTreeNode(nodeId);
  check("recovered: the scenario was refetched", scenarioRequests > start, evidence, `${scenarioRequests - start} requests`);
  check("recovered: the failure is gone", !(await has(failed)) && !(await has(loading)), evidence);
  check(
    "recovered: same session in the URL",
    await evaluate(`new URLSearchParams(location.search).get("sessionId") === "${id}"`),
    evidence,
  );
  const after = await tree(id);
  check("recovered: same active branch", after.active_branch_id === before.active_branch_id, evidence);
  check("recovered: same revision", after.revision === before.revision, evidence, `${after.revision}`);
  check("recovered: same turns", after.nodes.length === before.nodes.length, evidence, `${after.nodes.length}`);

  // The recovered screen works, not only renders.
  await click("Branch from here");
  await waitFor("the Arena on the new branch", () => evaluate(`location.pathname === "/arena"`), 15_000);
  await sleep(1_000);
  const branched = await tree(id);
  check("recovered: a branch can be made", branched.branches.length === before.branches.length + 1, evidence, `${branched.branches.length}`);

  // A missing session stays a different failure from a missing scenario.
  await send("Page.navigate", { url: recorder(999_999) });
  await waitFor("the missing session", () => has("Couldn't load this session"), 20_000);
  check("missing session: told apart from a scenario failure", !(await has(failed)) && !(await has(loading)), evidence);

  check("no console errors or exceptions", problems.length === 0, evidence, problems.slice(0, 3).join(" | "));
}

// ---- Graph navigation --------------------------------------------------------------------
//
// Browser magnification is emulated: at 200 percent a 1400x900 window lays out as 700x450
// CSS pixels, drawn at twice the density. Canvas zoom uses the graph's own buttons.

const VIEWPORTS = [
  { name: "browser-100", width: 1400, height: 900, scale: 1 },
  { name: "browser-125", width: 1120, height: 720, scale: 1.25 },
  { name: "browser-150", width: 933, height: 600, scale: 1.5 },
  { name: "browser-200", width: 700, height: 450, scale: 2 },
  { name: "short-window", width: 1280, height: 420, scale: 1 },
  { name: "narrow-phone", width: 390, height: 844, scale: 1 },
];
const graphRows = [];

const readScale = () =>
  evaluate(`(() => {
    const m = /scale\\(([0-9.]+)\\)/.exec(document.querySelector(".react-flow__viewport")?.style.transform ?? "");
    return m ? Number(m[1]) : null;
  })()`);

const readTransform = () =>
  evaluate(`document.querySelector(".react-flow__viewport")?.style.transform ?? ""`);

const graphLayout = () =>
  evaluate(`(() => {
    const size = (s) => {
      const b = document.querySelector(s)?.getBoundingClientRect();
      return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
    };
    const page = document.scrollingElement;
    return {
      header: size("header"),
      canvas: size(".react-flow"),
      controls: size(".react-flow__controls"),
      page_scroll: page.scrollHeight - innerHeight,
      inner: { w: innerWidth, h: innerHeight },
    };
  })()`);

// Visible means the point at the node's centre lands on that node: inside the canvas and
// not under the header, legend, controls or drawer.
const nodeSeen = (id) =>
  evaluate(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="${id}"]');
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    const box = node?.getBoundingClientRect();
    if (!box || !canvas || !canvas.height) return { seen: false, x: 0, y: 0, cx: 0, cy: 0, w: 0, h: 0 };
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
    // The legend ignores the pointer, so hit testing alone would see through it.
    const legend = [...document.querySelectorAll("div.pointer-events-none")].find((d) => d.innerText.includes("Dead-end"))?.getBoundingClientRect();
    const underLegend = Boolean(legend && x >= legend.left && x <= legend.right && y >= legend.top && y <= legend.bottom);
    return {
      seen: Boolean(hit && node.contains(hit)) && !underLegend,
      blocked_by: underLegend ? "LEGEND" : hit && !node.contains(hit) ? (hit.closest("aside,header,.react-flow__controls") ?? hit).tagName : null,
      x, y,
      cx: canvas.x + canvas.width / 2,
      cy: canvas.y + canvas.height / 2,
      w: canvas.width,
      h: canvas.height,
    };
  })()`);

const freePanePoint = (dx, dy) =>
  evaluate(`(() => {
    const c = document.querySelector(".react-flow").getBoundingClientRect();
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const x = c.x + (c.width * i) / 12;
      const y = c.y + (c.height * j) / 12;
      const a = document.elementFromPoint(x, y);
      if (!a?.classList.contains("react-flow__pane")) continue;
      const tx = x + ${dx}, ty = y + ${dy};
      if (tx > c.x + 2 && ty > c.y + 2 && tx < c.right - 2 && ty < c.bottom - 2) return { x, y };
    }
    return null;
  })()`);

async function dragBy(dx, dy) {
  const start = await freePanePoint(dx, dy);
  if (!start) return false;
  const press = { x: start.x, y: start.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...press });
  for (let step = 1; step <= 5; step++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + (dx * step) / 5,
      y: start.y + (dy * step) / 5,
      button: "left",
      buttons: 1,
    });
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start.x + dx,
    y: start.y + dy,
    button: "left",
    clickCount: 1,
  });
  await sleep(80);
  return true;
}

async function reachByDrag(id) {
  for (let drags = 0; drags <= 30; drags++) {
    const state = await nodeSeen(id);
    if (state.seen) return { reached: true, drags };
    if (!state.h) return { reached: false, drags, why: "no canvas height" };
    const limit = (size, value) => Math.max(-size * 0.4, Math.min(size * 0.4, value));
    const moved = await dragBy(limit(state.w, state.cx - state.x), limit(state.h, state.cy - state.y));
    if (!moved) return { reached: false, drags, why: "no free pane to drag", blocked_by: state.blocked_by };
  }
  return { reached: false, drags: 30, why: "still hidden after 30 drags", blocked_by: (await nodeSeen(id)).blocked_by };
}

const controlButton = (name) =>
  evaluate(`(() => {
    const b = document.querySelector(".react-flow__controls-${name}");
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);

async function setCanvasZoom(target) {
  await controlButton("fitview");
  await sleep(350);
  if (target === "fit") return;
  for (let i = 0; i < 16 && (await controlButton(target === "max" ? "zoomin" : "zoomout")); i++) {
    await sleep(260);
    const scale = await readScale();
    if (target === "min" && scale <= 0.305) break;
    if (target === "max" && scale >= 1.99) break;
  }
  if (target === "default") {
    for (let i = 0; i < 16 && (await controlButton("zoomout")); i++) await sleep(260);
    for (let i = 0; i < 16 && (await readScale()) < 0.95; i++) {
      await controlButton("zoomin");
      await sleep(260);
    }
  }
}

async function runGraphNavigation() {
  const evidence = "injected-viewport";
  const id = await openBobSession();
  await waitFor("the composer", () => evaluate(`Boolean(document.querySelector("textarea"))`));

  // 12 turns, then branches from turns 4 and 8.
  const add = async (count, label) => {
    for (let i = 1; i <= count; i++) {
      const data = await tree(id);
      const response = await fetch(`${API}/api/chat/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          session_id: id,
          branch_id: data.active_branch_id,
          parent_node_id: headOf(data),
          expected_revision: data.revision,
          user_message: `${label} line ${i}.`,
        }),
      });
      if (!response.ok) throw new Error(`turn failed: ${response.status}`);
    }
  };
  const branchFrom = async (index) => {
    const data = await tree(id);
    const node = selectedPath(data.nodes, headOf(data))[index];
    const response = await fetch(`${API}/api/sessions/${id}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        source_branch_id: data.active_branch_id,
        rewind_to_node_id: node.id,
        expected_revision: data.revision,
      }),
    });
    if (!response.ok) throw new Error(`branch failed: ${response.status}`);
  };
  await add(12, "Main");
  await branchFrom(3);
  await add(4, "Second");
  const data = await tree(id);
  await branchFrom(1);
  await add(2, "Third");
  const before = await tree(id);
  const ordered = [...before.nodes].sort((a, b) => a.id - b.id);
  const deepest = ordered.reduce((a, b) => (b.turn_number > a.turn_number ? b : a));
  const targets = { first: ordered[0].id, last: deepest.id };
  check("tree: long and branched", before.nodes.length >= 18 && before.branches.length >= 3, "real-http", `${before.nodes.length} turns, ${before.branches.length} branches, ${data.nodes.length} before last`);

  const url = new URL(`/flight-recorder?sessionId=${id}`, WEB).href;
  for (const view of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: view.width,
      height: view.height,
      deviceScaleFactor: view.scale,
      mobile: false,
    });
    await send("Page.navigate", { url });
    await waitFor("the graph", () => evaluate(`document.querySelectorAll(".react-flow__node").length > 5`), 20_000);
    await sleep(800);
    const layout = await graphLayout();
    await screenshot(`graph-${view.name}-fit`);

    // What the wheel does over the canvas.
    const scaleBefore = await readScale();
    const transformBefore = await readTransform();
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: view.width / 2,
      y: Math.min(view.height - 20, (layout.canvas?.y ?? 0) + (layout.canvas?.h ?? 0) / 2),
      deltaX: 0,
      deltaY: 200,
    });
    await sleep(450);
    const wheel =
      (await readScale()) !== scaleBefore
        ? "zooms"
        : (await readTransform()) !== transformBefore
          ? "pans"
          : "nothing";

    check(`${view.name}: the wheel moves the canvas`, wheel === "pans", evidence, wheel);
    const row = { viewport: view, layout, wheel, zooms: {} };
    for (const zoom of ["fit", "min", "default", "max"]) {
      await setCanvasZoom(zoom);
      const entry = { scale: await readScale() };
      for (const [name, nodeId] of Object.entries(targets)) {
        await setCanvasZoom(zoom);
        entry[name] = await reachByDrag(nodeId);
        check(`${view.name} ${zoom}: ${name} node reachable`, entry[name].reached, evidence, `${entry[name].drags} drags ${entry[name].why ?? ""}`);
      }
      graphStep: if (zoom === "max" && entry.last.reached) {
        await screenshot(`graph-${view.name}-max-last`);
        const point = await nodeSeen(targets.last);
        await clickTreeNode(targets.last);
        await sleep(450);
        const opened = await nodeSeen(targets.last);
        entry.drawer = { node_visible: opened.seen, blocked_by: opened.blocked_by ?? null };
        await screenshot(`graph-${view.name}-max-drawer`);
        const fills = view.width - 384 < 120;
        if (!fills) {
          check(`${view.name} max: selected node stays visible beside the drawer`, opened.seen, evidence, opened.blocked_by ?? "");
        }
        const closed = await evaluate(`(() => { const b = document.querySelector('[aria-label="Close"]'); if (!b) return false; b.click(); return true; })()`);
        await sleep(450);
        entry.drawer.closed = closed;
        const shown = await nodeSeen(targets.last);
        check(`${view.name} max: node visible after closing the drawer`, closed && shown.seen, evidence, shown.blocked_by ?? "");
        if (!point) break graphStep;
      }
      row.zooms[zoom] = entry;
    }
    await sleep(350);
    await setCanvasZoom("fit");
    const hidden = [];
    for (const node of before.nodes) {
      if (!(await nodeSeen(node.id)).seen) hidden.push(node.id);
    }
    row.fit_hidden = hidden.length;
    row.fit_recovers = hidden.length === 0;
    check(`${view.name}: Fit view shows every node`, hidden.length === 0, evidence, `${hidden.length} of ${before.nodes.length} hidden`);
    graphRows.push(row);
    console.log(
      `${view.name}: canvas ${layout.canvas?.w}x${layout.canvas?.h} of ${view.width}x${view.height}, header ${layout.header?.h}, page scroll ${layout.page_scroll}, wheel ${wheel}`,
    );
  }

  const after = await tree(id);
  check("state: revision unchanged by navigation", after.revision === before.revision, "real-http", `${after.revision}`);
  check("state: active branch unchanged", after.active_branch_id === before.active_branch_id, "real-http");
  check("no console errors or exceptions", problems.length === 0, evidence, problems.slice(0, 3).join(" | "));
}

// ---- Bob evidence ------------------------------------------------------------------------
//
// Each case is a list of steps, so an independent runner can supply unseen cases:
//   { "say": "text" }         the learner sends a line
//   { "hints": true }         first and second hints on the current turn
//   { "follow": 1 }           send that attempt's example line, verbatim
//   { "reload": true }        reload, then compare saved hints
//   { "fork_to_turn": 2 }     rewind to that turn on a new branch
//
// A hint that fails to arrive is recorded and the case goes on. Only a failure the learner
// could not get past ends a case, and that failure stays in the report.

const bob = {
  cases: [],
  hints: [],
  missing: [],
  follow_through: [],
  transcripts: [],
  reloads: [],
  forks: [],
  persona_turns_attempted: 0,
};

async function openBobSession() {
  await send("Page.navigate", { url: WEB });
  await waitFor("the hub", () => has("New Session"), 30_000);
  const clicked = await evaluate(`(() => {
    const starts = [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "New Session");
    for (const start of starts) {
      for (let box = start.parentElement; box; box = box.parentElement) {
        const inside = starts.filter((b) => box.contains(b)).length;
        if (inside > 1) break;
        if (box.innerText.includes("Bob")) return start.click(), true;
      }
    }
    return false;
  })()`);
  if (!clicked) throw new Error("no Bob card on the hub");
  await waitFor("the Arena", () => evaluate(`location.pathname === "/arena"`), 20_000);
  await waitFor("the Bob session", () => has("Your situation"), 20_000);
  return Number(new URL(await evaluate("location.href")).searchParams.get("sessionId"));
}

const hintsOnBranch = async (ctx, branch) =>
  (await getJson(`/api/sessions/${ctx.sessionId}/branches/${branch}/coach-hints`)).hints;

const hintsHere = async (ctx) =>
  (await hintsOnBranch(ctx, ctx.branch))
    .filter((h) => h.head_node_id === ctx.head)
    .map((h) => h.hint);

const slotOf = (ctx, attempt) => `${ctx.branch}:${ctx.head}:${attempt}`;

// Times are what the learner waited, measured here. latency_ms on the wire saturates at 10s.
async function awaitHint(ctx, attempt, startedAt, turnMs, trigger) {
  try {
    await waitFor(
      `attempt ${attempt}`,
      async () => (await hintsHere(ctx)).some((h) => h.attempt === attempt),
      HINT_WAIT_MS,
    );
  } catch (error) {
    bob.missing.push({ case_id: ctx.caseId, slot: slotOf(ctx, attempt), attempt, why: error.message });
    return false;
  }
  const waited = Date.now() - startedAt;
  const earlier = attempt === 1 ? (turnMs ?? 0) : (ctx.timing.get(slotOf(ctx, 1))?.stalled_total_ms ?? 0);
  ctx.timing.set(slotOf(ctx, attempt), {
    trigger,
    turn_ms: turnMs,
    hint_wait_ms: waited,
    stalled_total_ms: earlier + waited,
  });
  return true;
}

// Whether a turn drew automatic help is the app's decision, so watch for its POST. Waiting
// also keeps a pending hint from being abandoned, which would spend a call for nothing.
async function settleAutomaticHint(ctx, turnMs) {
  const startedAt = Date.now();
  const posted = await waitFor(
    "an automatic hint",
    () =>
      coachPosts.some(
        (p) => p.body.branch_id === ctx.branch && p.body.head_node_id === ctx.head,
      ),
    6_000,
  ).catch(() => false);
  if (posted) await awaitHint(ctx, 1, startedAt, turnMs, "automatic");
}

async function bobSay(ctx, text) {
  const data = await tree(ctx.sessionId);
  const before = data.nodes.find((n) => n.id === ctx.head);
  const startedAt = Date.now();
  bob.persona_turns_attempted += 1;
  const turn = await sendTurn(ctx.sessionId, text);
  ctx.turnMs = Date.now() - startedAt;
  ctx.branch = turn.data.active_branch_id;
  ctx.head = turn.head.id;
  await settleAutomaticHint(ctx, ctx.turnMs);
  return { turn, before };
}

async function bobHints(ctx) {
  if ((await hintsHere(ctx)).length === 0) {
    const startedAt = Date.now();
    await click("Get a hint");
    if (!(await awaitHint(ctx, 1, startedAt, ctx.turnMs, "requested"))) {
      bob.missing.push({ case_id: ctx.caseId, slot: slotOf(ctx, 2), attempt: 2, why: "no first hint" });
      return;
    }
  }
  const startedAt = Date.now();
  await click("Try another approach");
  await awaitHint(ctx, 2, startedAt, null, "requested");
}

async function bobFollow(ctx, attempt) {
  const hint = (await hintsHere(ctx)).find((h) => h.attempt === attempt);
  if (!hint) {
    bob.follow_through.push({ case_id: ctx.caseId, attempt, skipped: "no saved hint to send" });
    return;
  }
  const identity = { case_id: ctx.caseId, session_id: ctx.sessionId, branch_id: ctx.branch };
  const { turn, before } = await bobSay(ctx, hint.example);
  bob.follow_through.push(followRecord({ identity, hint, node: turn.head, before }));
}

async function bobReload(ctx) {
  const ids = async () => (await hintsHere(ctx)).map((h) => h.id).sort((a, b) => a - b);
  const before = await ids();
  const posts = coachPosts.length;
  await send("Page.reload");
  await waitFor("the Arena after reload", () => has("Your situation"), 20_000);
  await sleep(1_500);
  const after = await ids();
  const latest = (await hintsHere(ctx)).sort((a, b) => b.attempt - a.attempt)[0];
  const record = {
    case_id: ctx.caseId,
    session_id: ctx.sessionId,
    branch_id: ctx.branch,
    head_node_id: ctx.head,
    hint_ids_before: before,
    hint_ids_after: after,
    posts_added: coachPosts.length - posts,
    latest_hint_visible: latest ? await has(latest.approach) : null,
  };
  bob.reloads.push(record);
  if (before.length === 0) {
    notExercised(`${ctx.caseId}: reload`, "real-http", "no saved hint on this turn to restore");
    return;
  }
  check(
    `${ctx.caseId}: reload keeps saved hints and makes no POST`,
    JSON.stringify(before) === JSON.stringify(after) && record.posts_added === 0,
    "real-http",
  );
}

async function bobFork(ctx, turnNumber) {
  const data = await tree(ctx.sessionId);
  const target = selectedPath(data.nodes, ctx.head).find((n) => n.turn_number === turnNumber);
  if (!target) throw new Error(`no turn ${turnNumber} on the selected branch`);
  const source = data.active_branch_id;
  await clickLink("End Simulation");
  await waitFor(
    "the Flight Recorder",
    () => evaluate(`location.pathname === "/flight-recorder"`),
    15_000,
  );
  await clickTreeNode(target.id);
  await click("Branch from here");
  await waitFor(
    "the Arena on the new branch",
    () => evaluate(`location.pathname === "/arena"`),
    15_000,
  );
  await waitFor(
    "the new branch's state",
    async () => (await tree(ctx.sessionId)).active_branch_id !== source,
    15_000,
  );
  const forked = await tree(ctx.sessionId);
  ctx.branch = forked.active_branch_id;
  ctx.head = target.id;
  ctx.turnMs = null;
  await settleAutomaticHint(ctx, null);
  bob.forks.push({
    case_id: ctx.caseId,
    session_id: ctx.sessionId,
    source_branch_id: source,
    fork_branch_id: forked.active_branch_id,
    fork_node_id: target.id,
    source_branch_kept: forked.branches.some((b) => b.id === source),
    nodes_before: data.nodes.length,
    nodes_after: forked.nodes.length,
  });
  check(
    `${ctx.caseId}: fork keeps the source branch and its turns`,
    forked.branches.some((b) => b.id === source) && forked.nodes.length === data.nodes.length,
    "real-http",
  );
}

// Everything saved, on every branch, so a hint the steps never asked for is still on record.
async function harvestCase(ctx) {
  const data = await tree(ctx.sessionId);
  const session = await getJson(`/api/sessions/${ctx.sessionId}`);
  const scenario = await getJson(`/api/scenarios/${session.scenario_id}`);
  const opening = scenario.persona.opening_message;
  for (const branch of data.branches) {
    const listed = await hintsOnBranch(ctx, branch.id);
    bob.transcripts.push({
      case_id: ctx.caseId,
      session_id: ctx.sessionId,
      branch_id: branch.id,
      head_node_id: branch.head_node_id,
      fork_node_id: branch.fork_node_id,
      opening,
      turns:
        branch.head_node_id == null
          ? []
          : selectedPath(data.nodes, branch.head_node_id).map((n) => ({
              node_id: n.id,
              turn_number: n.turn_number,
              learner: n.user_text,
              persona: n.character_text,
              score: n.score,
              resistance: n.resistance,
              question_type: n.coaching?.question_type ?? null,
            })),
    });
    for (const { head_node_id: head, hint } of listed) {
      bob.hints.push(
        hintRecord({
          identity: { case_id: ctx.caseId, session_id: ctx.sessionId, branch_id: branch.id },
          opening,
          nodes: data.nodes,
          headNodeId: head,
          entries: listed,
          hint,
          timing: ctx.timing.get(`${branch.id}:${head}:${hint.attempt}`),
        }),
      );
    }
  }
}

function loadCases() {
  const path = resolve(args.cases ?? join(ROOT, "scripts", "cases", "bob_capture_cases.json"));
  const cases = JSON.parse(readFileSync(path, "utf8")).cases;
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("--cases: no cases");
  const steps = new Set(["say", "hints", "follow", "reload", "fork_to_turn"]);
  for (const item of cases) {
    const unknown = item.steps.flatMap(Object.keys).filter((key) => !steps.has(key));
    if (!item.id || unknown.length) throw new Error(`--cases: bad case ${item.id ?? "?"}`);
  }
  return cases;
}

async function runBob() {
  for (const item of loadCases()) {
    const ctx = { caseId: item.id, timing: new Map(), head: null, turnMs: null };
    bob.cases.push({ id: item.id, kind: item.kind ?? null, steps: item.steps.length });
    let failure = null;
    try {
      ctx.sessionId = await openBobSession();
      ctx.branch = (await tree(ctx.sessionId)).active_branch_id;
      for (const step of item.steps) {
        if ("say" in step) await bobSay(ctx, step.say);
        else if ("hints" in step) await bobHints(ctx);
        else if ("follow" in step) await bobFollow(ctx, step.follow);
        else if ("reload" in step) await bobReload(ctx);
        else await bobFork(ctx, step.fork_to_turn);
      }
    } catch (error) {
      failure = error.message;
      await screenshot(`case-${item.id}-failed`).catch(() => {});
    }
    if (ctx.sessionId) await harvestCase(ctx);
    bob.cases.at(-1).failure = failure;
    check(`case ${item.id} completed`, !failure, "live-provider", failure ?? "");
    await screenshot(`case-${item.id}`).catch(() => {});
  }
  check(
    "no console errors or exceptions",
    problems.length === 0,
    "real-http",
    problems.slice(0, 3).join(" | "),
  );
}

// Declared settings, read from the source under test rather than copied into this script.
function sourceSettings() {
  const code = [
    "import json, sys",
    "sys.path.insert(0, 'backend')",
    "import coach as c",
    "print(json.dumps({'model_default': c.DEFAULT_MODEL, 'temperature': c.COACH_TEMPERATURE,",
    "  'provider_model_defaults': {k: v.default_model for k, v in getattr(c, 'PROVIDERS', {}).items()},",
    "  'max_tokens': c.COACH_MAX_TOKENS, 'demo_max_tokens': c.COACH_DEMO_MAX_TOKENS,",
    "  'demo_reasoning_effort': c.COACH_DEMO_REASONING_EFFORT,",
    "  'timeout_seconds': c.COACH_TIMEOUT_SECONDS}))",
  ].join("\n");
  const result = spawnSync(PYTHON, ["-c", code], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not read coach settings from source");
  return JSON.parse(result.stdout);
}

function readTelemetry() {
  try {
    return readFileSync(TELEMETRY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return undefined;
  }
}

function liveHintStats() {
  const provider = savedHints.filter((h) => h.source === "meta");
  const reasons = {};
  for (const h of savedHints) {
    if (h.fallback_reason) reasons[h.fallback_reason] = (reasons[h.fallback_reason] ?? 0) + 1;
  }
  const latencies = provider.map((h) => h.latency_ms).sort((a, b) => a - b);
  return {
    saved: savedHints.length,
    provider: provider.length,
    fallback_reasons: reasons,
    provider_latency_ms: latencies,
  };
}

// ---- Bob stance (CS-77) ------------------------------------------------------------------
//
// Stand-in persona and injected coach: zero paid calls. Checks the Hub opts in to s4-bob-r1,
// the Arena shows the simulated stance and its change, and the Recorder shows both.

const stanceText = () => evaluate(`document.querySelector('[data-testid="stance"]')?.innerText ?? ""`);
const noSideScroll = () =>
  evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`);

async function runBobStance() {
  const evidence = "real-http";
  await send("Page.navigate", { url: WEB });
  await waitFor("the hub", () => has("New Session"), 30_000);
  check("hub: Bob's card counts needs uncovered", await has("needs uncovered"), evidence);
  check("hub: other cards keep Breakthrough", await has("Breakthrough"), evidence);

  const id = await openBobSession();
  const created = await getJson(`/api/sessions/${id}`);
  check(
    "hub: the session opted in to s4-bob-r1",
    created.conversation_progress?.behavior_revision === "s4-bob-r1",
    evidence,
  );
  let panel = await stanceText();
  check("arena: stance panel shown", /simulated stance/i.test(panel) && /guarded/i.test(panel), evidence, panel);
  check("arena: says it is not a measure of trust", /not a measure of trust/i.test(panel), evidence);
  check("arena: no resistance meter", !(await has("'s Resistance")), evidence);
  check("arena: no Live label", !(await has("· Live")), evidence);

  await typeAndSend("Three redesigns in a month sounds exhausting.");
  await settled(id, 1);
  panel = await stanceText();
  check("turn 1: warming", /warming/i.test(panel), evidence, panel);
  check("turn 1: less guarded than before", panel.includes("Less guarded than the turn before."), evidence);
  check("turn 1: names the acknowledgment", panel.includes("acknowledged a specific concern"), evidence);
  await screenshot("stance-warming");

  await typeAndSend("Everyone else stayed late. You are slow.");
  await settled(id, 2);
  panel = await stanceText();
  check("turn 2: guarded again", /guarded/i.test(panel), evidence, panel);
  check("turn 2: more guarded than before", panel.includes("More guarded than the turn before."), evidence);
  check("turn 2: names the blame", panel.includes("pressure or blame"), evidence);

  await send("Page.reload");
  await waitFor("the stance after reload", async () => /simulated stance/i.test(await stanceText()), 20_000);
  check("reload: same stance and change", (await stanceText()) === panel, evidence);

  // Narrow and magnified layouts keep the panel readable without side scrolling.
  for (const view of [
    { name: "narrow-phone", width: 390, height: 844, scale: 1 },
    { name: "browser-200", width: 700, height: 450, scale: 2 },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: view.width,
      height: view.height,
      deviceScaleFactor: view.scale,
      mobile: false,
    });
    await sleep(800);
    const box = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="stance"]');
      if (!el) return null;
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, vw: innerWidth };
    })()`);
    check(
      `${view.name}: stance panel inside the viewport`,
      Boolean(box) && box.left >= 0 && box.right <= box.vw + 1 && box.width > 100,
      evidence,
      JSON.stringify(box),
    );
    check(`${view.name}: no side scroll`, await noSideScroll(), evidence);
    await screenshot(`stance-${view.name}`);
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(500);

  // Keyboard: the composer is still reachable and sends with the panel present.
  await evaluate(`document.activeElement?.blur()`);
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await press("Tab", "Tab", 9);
    reached = await evaluate(`document.activeElement?.tagName === "TEXTAREA"`);
  }
  check("keyboard: Tab reaches the composer", reached, evidence);

  const data = await tree(id);
  const first = data.nodes.find((n) => n.turn_number === 1);
  await send("Page.navigate", { url: new URL(`/flight-recorder?sessionId=${id}`, WEB).href });
  await waitFor("the graph", () => evaluate(`document.querySelectorAll(".react-flow__node").length >= 2`), 20_000);
  check("recorder: Needs uncovered label", await has("Needs uncovered"), evidence);
  check("recorder: no Breakthrough score label", !(await has("Breakthrough score")), evidence);
  await clickTreeNode(first.id);
  await waitFor("the turn drawer", () => has("simulated stance"), 15_000);
  const drawer = await pageText();
  check("recorder: drawer shows the stance at that turn", /simulated stance\s*\n?\s*warming/i.test(drawer), evidence);
  check("recorder: drawer shows the explanation", drawer.includes("acknowledged a specific concern"), evidence);
  await screenshot("stance-recorder");
  check("no ledger in the public tree", !JSON.stringify(data).includes("stance_ledger"), evidence);

  // Resume stored legacy Bob and another persona without applying the new opt-in.
  // Session creation uses the real API; viewing/reloading uses the real client.
  const scenarios = await getJson("/api/scenarios");
  for (const name of ["Bob", "Maya"]) {
    const scenario = scenarios.find((item) => item.persona.name === name);
    if (!scenario) throw new Error(`no ${name} scenario for legacy check`);
    const response = await fetch(`${API}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ scenario_id: scenario.id }),
    });
    check(`${name} legacy: session created without opt-in`, response.status === 201, evidence);
    if (response.status !== 201) throw new Error(`legacy session returned ${response.status}`);
    const legacy = await response.json();
    check(`${name} legacy: null progress`, legacy.conversation_progress === null, evidence);
    await send("Page.navigate", {
      url: new URL(`/arena?sessionId=${legacy.id}&scenarioId=${scenario.id}`, WEB).href,
    });
    await waitFor(`${name} legacy Arena`, () => has("Your situation"), 20_000);
    check(`${name} legacy: no Bob stance panel`, (await stanceText()) === "", evidence);
    check(`${name} legacy: original resistance display`, await has(`${name}'s Resistance`), evidence);
    await send("Page.reload");
    await waitFor(`${name} legacy after reload`, () => has("Your situation"), 20_000);
    const reloaded = await getJson(`/api/sessions/${legacy.id}`);
    check(
      `${name} legacy: reload keeps the pinned session`,
      reloaded.conversation_progress === null &&
        reloaded.revision === legacy.revision &&
        reloaded.active_head_node_id === legacy.active_head_node_id,
      evidence,
    );
    await screenshot(`legacy-${name.toLowerCase()}`);
  }
  check("stand-in persona only", personaCalls() === 2, evidence, `${personaCalls()} calls`);
  check("no console errors or exceptions", problems.length === 0, evidence, problems.slice(0, 3).join(" | "));
}

async function run() {
  if (STANCE) return runBobStance();
  if (LOST) return runLostResponse();
  if (RECORDER_FAILURE) return runRecorderFailure();
  if (GRAPH) return runGraphNavigation();
  if (args.journey === "bob") return runBob();
  if (STUB) {
    await runLongWait();
    check(
      "no console errors or exceptions",
      problems.length === 0,
      "real-http",
      problems.join(" | "),
    );
    return;
  }
  const sessionId = await openMayaSession();

  // The panel.
  const text = await pageText();
  check("panel is headed Conversation coach", text.includes("Conversation coach"), uiEvidence);
  check("old Live AI Coach heading is gone", !/live ai coach/i.test(text), uiEvidence);
  check("learner situation is a separate line", text.includes("Your situation"), uiEvidence);
  check("Maya's real opening is shown", text.includes("What do you want?"), uiEvidence, "Maya");
  check(
    "Get a hint is offered at the opening",
    (await buttonState("Get a hint")) === "enabled",
    uiEvidence,
  );
  await sleep(600);
  check("no automatic request at the opening", coachPosts.length === 0, uiEvidence);

  // Requested help at the root.
  script.push({ delayMs: REAL ? 0 : 800 });
  await click("Get a hint");
  if (!REAL) {
    await waitFor("the pending state", () => has("Getting a hint"), 2_000);
    check(
      "the pending state is announced",
      await evaluate(
        `document.querySelector("[role=status]").innerText.includes("Getting a hint")`,
      ),
      uiEvidence,
    );
    check(
      "hint actions are disabled while pending",
      (await buttonState("Getting a hint…")) === "disabled",
      uiEvidence,
    );
  }
  await waitForHint(null, 1);
  const rootPost = coachPosts.at(-1);
  if (REAL) await checkLabel(sessionId, rootPost.body.branch_id, null, 1);
  check(
    "requested root help is one attempt 1 POST",
    coachPosts.length === 1 &&
      rootPost.body.trigger === "requested" &&
      rootPost.body.attempt === 1 &&
      rootPost.body.head_node_id === null,
    uiEvidence,
  );
  await screenshot("1-root-hint");

  // A stalled turn asks automatically, once.
  script.push({ delayMs: REAL ? 0 : 1200 });
  const closed = await sendTurn(sessionId, "Did you finish your homework?");
  if (closed.stalled) {
    await waitFor("the automatic POST", () => coachPosts.length === 2, 15_000);
    if (!REAL) {
      check(
        "earlier hint is labelled while the next loads",
        await has("From the opening"),
        uiEvidence,
      );
    }
    await waitForHint(closed.head.id, 1);
    await sleep(1500);
    const post = coachPosts.at(-1);
    check(
      "stalled turn sends exactly one automatic POST",
      coachPosts.length === 2 &&
        post.body.trigger === "automatic" &&
        post.body.attempt === 1 &&
        post.body.head_node_id === closed.head.id,
      uiEvidence,
    );
    check("Turn feedback shows", await has("Turn feedback"), uiEvidence);
    if (REAL) await checkLabel(sessionId, post.body.branch_id, closed.head.id, 1);
  } else {
    notExercised("stalled automatic help", uiEvidence, "the judge scored the closed question");
  }
  await screenshot("2-stalled-hint");

  // The one extra attempt.
  await click("Try another approach");
  await waitForHint(closed.head.id, 2);
  const second = coachPosts.at(-1);
  check(
    "second approach is requested attempt 2",
    second.body.trigger === "requested" && second.body.attempt === 2,
    uiEvidence,
  );
  check(
    "further generation is disabled at two",
    (await buttonState("Two approaches saved for this turn")) === "disabled",
    uiEvidence,
  );
  check("first approach stays reachable", await has("First approach"), uiEvidence);
  await screenshot("3-two-approaches");

  // The saved pair for the person reading the evidence. Differing text is the floor;
  // whether the second hint is a different move is a human judgment.
  if (REAL) {
    const listed = await fetch(
      `${API}/api/sessions/${sessionId}/branches/${second.body.branch_id}/coach-hints`,
    ).then((r) => r.json());
    const pair = listed.hints.filter((h) => h.head_node_id === closed.head.id).map((h) => h.hint);
    hintPairs.push({ head_node_id: closed.head.id, hints: pair });
    check(
      "the two saved hints differ",
      pair.length === 2 && pair[0].approach !== pair[1].approach,
      hintEvidence,
      pair.map((h) => `${h.attempt}:${h.source}`).join(" "),
    );
  }

  // Reload restores from GET and spends nothing.
  const postsBeforeReload = coachPosts.length;
  await send("Page.reload");
  await waitFor("the Arena after reload", () => has("Two approaches saved for this turn"), 20_000);
  await sleep(1500);
  check("reload restores both saved hints", await has("First approach"), uiEvidence);
  check("reload makes no POST", coachPosts.length === postsBeforeReload, uiEvidence);

  // A turn that reveals something does not trigger help.
  const open = await sendTurn(sessionId, "What has been the hardest part of this week for you?");
  await sleep(1500);
  if (open.stalled) {
    notExercised("no automatic help after progress", "real-http", "this turn revealed nothing");
    await waitFor("the automatic hint", () => has("Try another approach"), HINT_WAIT_MS);
  } else {
    check("no automatic POST after progress", coachPosts.length === postsBeforeReload, "real-http");
    check(
      "Get a hint is offered after progress",
      (await buttonState("Get a hint")) === "enabled",
      uiEvidence,
    );

    // Another generation is running: the same key is retried, with no manual retry shown.
    script.push(
      { status: 409, body: envelope("request_in_progress", true) },
      { status: 409, body: envelope("request_in_progress", true) },
    );
    const start = coachPosts.length;
    await click("Get a hint");
    let flashed = false;
    await waitFor(
      "the hint after 409s",
      async () => {
        flashed ||= (await buttonState("Try again")) !== "absent";
        return has("Try another approach");
      },
      20_000,
    );
    const posts = coachPosts.slice(start);
    check(
      "409 retries keep the same key",
      posts.length === 3 && new Set(posts.map((p) => p.key)).size === 1,
      "injected",
    );
    check(
      "409 retries wait about two seconds",
      posts.slice(1).every((p, i) => p.at - posts[i].at >= 1_800),
      "injected",
    );
    check("transient 409s never flash manual retry", !flashed, "injected");
  }

  // A late result must not appear after the conversation moves on. The composer stays usable.
  script.push({ delayMs: 7_000, hint: { approach: "LATE RESULT MARKER" } });
  const firstLate = await sendTurn(sessionId, "Okay.");
  if (firstLate.stalled) {
    await waitFor("the delayed POST", () => has("Getting a hint"), 10_000);
    const composer = await evaluate(`!document.querySelector("textarea").disabled`);
    check("composer stays usable while a hint is pending", composer, "injected");
    await sendTurn(sessionId, "Fine.");
    await sleep(8_000);
    check(
      "late hint never appears on the newer turn",
      !(await has("LATE RESULT MARKER")),
      "injected",
    );
  } else {
    script.length = 0;
    notExercised("late result protection", "injected", "the turn was not stalled");
  }

  // A lost response offers a manual retry on the same key.
  script.push({ network: true });
  const lost = await sendTurn(sessionId, "Right.");
  if (lost.stalled) {
    await waitFor(
      "manual retry",
      async () => (await buttonState("Try again")) === "enabled",
      15_000,
    );
    const failed = coachPosts.at(-1);
    await click("Try again");
    await waitFor("the retried hint", () => has("Try another approach"), HINT_WAIT_MS);
    check("manual retry keeps the same key", coachPosts.at(-1).key === failed.key, "injected");
  } else {
    script.length = 0;
    notExercised("network retry", "injected", "the turn was not stalled");
  }

  // A server error is reported, and the conversation survives it. Retrying then gets a
  // fallback, which has to say so, and any markup in a hint stays text.
  // Only the error is injected in real mode: a hint the backend never saved would be replaced
  // by the next GET, so the fallback text and markup checks belong to the injected suite.
  script.push({ status: 500, body: {} });
  if (!REAL) {
    script.push({
      hint: {
        source: "deterministic",
        fallback_reason: "timeout",
        approach: `<img src=x onerror="window.hacked=1"> Markup check`,
      },
    });
  }
  const broken = await sendTurn(sessionId, "Sure.");
  if (broken.stalled) {
    await waitFor("the failure note", () => has("Couldn't get a hint right now"), 15_000);
    check("failure keeps the transcript", await has("Sure."), "injected");
    await click("Get a hint");
    if (REAL) {
      await waitForHint(broken.head.id, 1);
      await checkLabel(sessionId, coachPosts.at(-1).body.branch_id, broken.head.id, 1);
      await screenshot("4-after-error");
    } else {
      await waitFor("the fallback", () => has("Basic hint"), 15_000);
      check("fallback is labelled Basic hint", true, "injected");
      check(
        "markup in a hint stays text",
        await evaluate(`!document.querySelector("aside img") && !window.hacked`),
        "injected",
      );
      await screenshot("4-fallback");
    }
  } else {
    script.length = 0;
    notExercised("server error and fallback label", "injected", "the turn was not stalled");
  }

  // Keyboard: from the composer, Tab reaches the action and Enter runs it.
  const canAct = (await buttonState("Try another approach")) === "enabled";
  if (canAct) {
    await evaluate(`document.querySelector("textarea").focus()`);
    await press("Tab", "Tab", 9);
    const focused = await evaluate(`document.activeElement.innerText.trim()`);
    check(
      "Tab moves from composer to the hint action",
      focused === "Try another approach",
      uiEvidence,
      focused,
    );
    const before = coachPosts.length;
    await press("Enter", "Enter", 13, "\r");
    await waitFor("a keyboard request", () => coachPosts.length > before, 5_000);
    check("Enter runs the hint action", true, uiEvidence);
    await waitFor("two saved", () => has("Two approaches saved for this turn"), HINT_WAIT_MS);
  } else {
    notExercised("keyboard operation", uiEvidence, "no hint action was available");
  }

  // Rewind: a new branch shares no hints with its source, and the source survives.
  const original = await tree(sessionId);
  const sourceNodes = original.nodes.length;
  const sourceBranch = original.active_branch_id;
  await clickLink("End Simulation");
  await waitFor(
    "the Flight Recorder",
    () => evaluate(`location.pathname === "/flight-recorder"`),
    15_000,
  );
  await waitFor("the tree", () => has("Did you finish your homework?"), 15_000);
  await clickTreeNode(closed.head.id);
  const rewindPosts = coachPosts.length;
  await click("Branch from here");
  await waitFor(
    "the Arena on the new branch",
    () => evaluate(`location.pathname === "/arena"`),
    15_000,
  );
  await waitFor(
    "the new branch's state",
    async () => (await tree(sessionId)).active_branch_id !== sourceBranch,
    15_000,
  );
  await sleep(2_000);
  const forked = await tree(sessionId);
  const onFork = coachPosts.slice(rewindPosts);
  check(
    "rewind keeps the original branch and turns",
    forked.branches.some((b) => b.id === sourceBranch) && forked.nodes.length === sourceNodes,
    "real-http",
  );
  check(
    "requests on the fork name the fork",
    onFork.every((p) => p.body.branch_id === forked.active_branch_id),
    uiEvidence,
    `${onFork.length} request(s)`,
  );
  check(
    "fork does not show the source branch's second approach",
    !(await has("Two approaches saved for this turn")),
    uiEvidence,
  );
  await screenshot("5-fork");

  // Every saved hint on every branch, so latency and fallback reasons are on the record.
  if (REAL) {
    for (const branch of forked.branches) {
      const listed = await getJson(`/api/sessions/${sessionId}/branches/${branch.id}/coach-hints`);
      savedHints.push(
        ...listed.hints.map((h) => ({ branch_id: branch.id, head: h.head_node_id, ...h.hint })),
      );
    }
    await runN1();
  }

  if (DEMO && !REAL) await runDemoWait();

  check(
    "no console errors or exceptions",
    problems.length === 0,
    uiEvidence,
    problems.slice(0, 3).join(" | "),
  );
}

// React Flow listens for real pointer events, so a synthetic click does nothing.
async function clickTreeNode(nodeId) {
  const point = await waitFor("the tree node", () =>
    evaluate(`(() => {
      const box = document.querySelector('.react-flow__node[data-id="${nodeId}"]')?.getBoundingClientRect();
      return box && box.width ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    })()`),
  );
  const mouse = { ...point, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
}

async function clickLink(prefix) {
  await evaluate(`[...document.querySelectorAll("a")]
    .find((a) => a.innerText.trim().startsWith(${JSON.stringify(prefix)})).click()`);
}

// ---- Run ---------------------------------------------------------------------------------

async function main() {
  for (const port of [8080, 5173]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  const database = join(SCRATCH, "coach-browser.db");

  startLogged(
    "backend",
    PYTHON,
    STAND_IN
      ? ["scripts/run_backend_stub_persona.py", "--calls-file", PERSONA_CALLS, "--host", BIND]
      : STUB
      ? [
          "scripts/run_backend_stub_coach.py",
          "--env-file",
          resolve(args["env-file"]),
          "--delay",
          String(STUB_DELAY_S),
          "--calls-file",
          STUB_CALLS,
        ]
      : [args["backend-runner"], "--env-file", resolve(args["env-file"]), "--host", BIND],
    {
      env: {
        ...process.env,
        DIALOGIQ_DB_PATH: database,
        ...(REAL && !STUB ? { COACH_TELEMETRY_FILE: TELEMETRY } : {}),
        // Only a run on another address needs this; the default origins stay as they are.
        ...(BIND === "127.0.0.1" ? {} : { DIALOGIQ_CORS_ORIGINS: WEB }),
        ...(DEMO ? { COACH_DEMO_WAIT: "1" } : {}),
      },
    },
  );
  await waitForUrl(`${API}/api/scenarios`, "backend");
  const clientEnv = {
    ...process.env,
    VITE_API_BASE_URL: API,
    ...(DEMO ? { VITE_COACH_DEMO_WAIT: "1" } : {}),
  };
  if (args.frontend === "production") {
    const built = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
      cwd: ROOT,
      env: clientEnv,
      encoding: "utf8",
    });
    writeFileSync(join(OUT, "build.log"), `${built.stdout}\n${built.stderr}`);
    if (built.status !== 0) throw new Error(`production build failed; see ${OUT}`);
  }
  startLogged(
    "frontend",
    process.execPath,
    args.frontend === "production"
      ? [
          join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
          "exec",
          "--yes",
          `--package=wrangler@${WRANGLER_VERSION}`,
          "--",
          "wrangler",
          "dev",
          "--config",
          ".output/server/wrangler.json",
          "--local",
          "--ip",
          BIND,
          "--port",
          "5173",
          "--inspector-port",
          "9335",
          "--show-interactive-dev-session=false",
        ]
      : ["node_modules/vite/bin/vite.js", "dev", "--host", BIND, "--port", "5173", "--strictPort"],
    { env: clientEnv },
  );
  await waitForUrl(WEB, "frontend");

  const profile = join(SCRATCH, "profile");
  children.push(
    spawn(
      EDGE,
      [
        "--headless=new",
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--disable-extensions",
        "--window-size=1400,900",
        "about:blank",
      ],
      { stdio: "ignore" },
    ),
  );

  const target = await waitFor("Edge", async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      return pages.find((p) => p.type === "page");
    } catch {
      return undefined;
    }
  });
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done) => (ws.onopen = done));
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) return waiting.get(message.id)?.(message);
    if (message.method === "Fetch.requestPaused") return void onPaused(message.params);
    if (message.method === "Runtime.exceptionThrown") {
      problems.push(message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const line = message.params.args.map((a) => a.value ?? a.description).join(" ");
      // Injected failures make the browser log them; those are the point of the check.
      if (!/ERR_FAILED|ConnectionFailed|status of (404|409|500|503)/.test(line))
        problems.push(line.slice(0, 200));
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", {
    patterns: LOST
      ? ["*/api/chat/turn", "*/branches", "*/active-branch"].flatMap((urlPattern) => [
          { urlPattern, requestStage: "Request" },
          { urlPattern, requestStage: "Response" },
        ])
      : RECORDER_FAILURE
        ? [{ urlPattern: "*/api/scenarios/*" }]
        : [{ urlPattern: "*coach-hints*" }],
  });

  let crashed = null;
  try {
    await run();
  } catch (error) {
    crashed = error;
    check("run completed", false, "harness", error.message);
    await screenshot("crash").catch(() => {});
  }

  const telemetry = readTelemetry();
  const providerSettings = REAL ? effectiveSettings(sourceSettings(), DEMO, telemetry) : null;
  const bobEvidence =
    args.journey === "bob"
      ? {
          scope: "public selected-branch dialogue only",
          cases: bob.cases,
          denominators: denominators(bob.hints, bob.missing),
          hints: bob.hints,
          missing_hints: bob.missing,
          follow_through: bob.follow_through,
          transcripts: bob.transcripts,
          reloads: bob.reloads,
          forks: bob.forks,
          persona_turns_attempted: bob.persona_turns_attempted,
        }
      : undefined;
  if (bobEvidence) {
    const leaks = forbiddenKeys({ bobEvidence, providerSettings });
    check("report holds no private field names", leaks.length === 0, "harness", leaks.join(" "));
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const report = {
    journey: args.journey,
    coach_mode: args.coach,
    demo_wait: DEMO,
    frontend: args.frontend,
    bind: BIND,
    wire_contract: "s3-coach-r2",
    provider_settings: providerSettings,
    coach_calls_observed: telemetry?.length ?? null,
    hint_source_note:
      "hint.source 'meta' is the s3-coach-r2 wire value for any provider-generated hint, " +
      "not proof of upstream identity; provider_settings.emitted names the provider and model called",
    source_revision: revision.stdout.trim(),
    uncommitted_changes: dirty.stdout.trim().length > 0,
    database: "disposable, removed after this run",
    persona: STAND_IN ? "stand-in" : "live Baseten",
    coach_posts: coachPosts.length,
    injected_posts: coachPosts.filter((p) => p.injected).length,
    timings,
    hint_pairs: hintPairs,
    n1_pairs: n1Pairs,
    live_hint_stats: REAL ? liveHintStats() : undefined,
    saved_hints: savedHints,
    bob: bobEvidence,
    graph_navigation: GRAPH ? graphRows : undefined,
    recorder_failure: RECORDER_FAILURE
      ? { scenario_requests: scenarioRequests, persona_calls: personaCalls() }
      : undefined,
    lost_response: LOST
      ? {
          persona: "stand-in, counted, no provider call",
          persona_calls: personaCalls(),
          mutations: mutations.map(({ url, key, status }) => ({
            route: new URL(url).pathname,
            key,
            status,
          })),
        }
      : undefined,
    summary: {
      passed: results.filter((r) => r.status === "pass").length,
      failed,
      not_exercised: results.filter((r) => r.status === "not exercised").length,
    },
    results,
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    `\n${JSON.stringify(report.summary)} mode=${args.coach} rev=${report.source_revision}`,
  );
  console.log(`report: ${join(OUT, "report.json")}`);
  return crashed || failed ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} finally {
  ws?.close();
  stopAll();
  await sleep(500);
  rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(code);
