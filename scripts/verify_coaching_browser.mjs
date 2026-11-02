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
//   --edge <path>      Default: the standard Windows Edge install.
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
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "env-file": { type: "string" },
    coach: { type: "string", default: "injected" },
    "demo-wait": { type: "boolean", default: false },
    out: { type: "string" },
    python: { type: "string" },
    edge: { type: "string" },
  },
});

if (!["injected", "real", "stub"].includes(args.coach)) {
  throw new Error("--coach: injected, real or stub");
}
if (args.coach === "stub" && !args["demo-wait"]) throw new Error("--coach stub needs --demo-wait");
if (!args["env-file"]) throw new Error("--env-file is required: persona turns need Baseten");

const ROOT = resolve(import.meta.dirname, "..");
const WEB = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8080";
const DEBUG_PORT = 9334;
const STUB = args.coach === "stub";
const STUB_DELAY_S = 35;
const REAL = args.coach !== "injected";
const DEMO = args["demo-wait"];
// With no cutoff in demo waiting, a live hint can take far longer than the usual bound.
const HINT_WAIT_MS = DEMO ? 300_000 : 20_000;
const OUT = resolve(args.out ?? mkdtempSync(join(tmpdir(), "coach-browser-")));
const PYTHON = args.python ?? join(ROOT, "backend", ".venv", "Scripts", "python.exe");
const EDGE = args.edge ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SCRATCH = mkdtempSync(join(tmpdir(), "coach-browser-db-"));
const STUB_CALLS = join(SCRATCH, "stub-calls.txt");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hintEvidence = STUB ? "stub-provider" : REAL ? "live-meta" : "injected";
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
    const socket = createConnection({ port, host: "127.0.0.1" });
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
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
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

async function onPaused({ requestId, request }) {
  const { method, url, postData, headers } = request;
  if (method === "OPTIONS") return send("Fetch.continueRequest", { requestId });

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

async function run() {
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
  const revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  const database = join(SCRATCH, "coach-browser.db");

  startLogged(
    "backend",
    PYTHON,
    STUB
      ? [
          "scripts/run_backend_stub_coach.py",
          "--env-file",
          resolve(args["env-file"]),
          "--delay",
          String(STUB_DELAY_S),
          "--calls-file",
          STUB_CALLS,
        ]
      : ["scripts/run_backend.py", "--env-file", resolve(args["env-file"])],
    {
      env: {
        ...process.env,
        DIALOGIQ_DB_PATH: database,
        ...(DEMO ? { COACH_DEMO_WAIT: "1" } : {}),
      },
    },
  );
  await waitForUrl(`${API}/api/scenarios`, "backend");
  startLogged(
    "frontend",
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        VITE_API_BASE_URL: API,
        ...(DEMO ? { VITE_COACH_DEMO_WAIT: "1" } : {}),
      },
    },
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
      if (!/ERR_FAILED|ConnectionFailed|status of (409|500)/.test(line))
        problems.push(line.slice(0, 200));
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*coach-hints*" }] });

  let crashed = null;
  try {
    await run();
  } catch (error) {
    crashed = error;
    check("run completed", false, "harness", error.message);
    await screenshot("crash").catch(() => {});
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const report = {
    coach_mode: args.coach,
    demo_wait: DEMO,
    wire_contract: "s3-coach-r2",
    provider_delta: REAL ? "s3-coach-r2.token-2048.1" : null,
    source_revision: revision.stdout.trim(),
    uncommitted_changes: dirty.stdout.trim().length > 0,
    database: "disposable, removed after this run",
    persona: "live Baseten",
    coach_posts: coachPosts.length,
    injected_posts: coachPosts.filter((p) => p.injected).length,
    timings,
    hint_pairs: hintPairs,
    n1_pairs: n1Pairs,
    live_hint_stats: REAL ? liveHintStats() : undefined,
    saved_hints: savedHints,
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
