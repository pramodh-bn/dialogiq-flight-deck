"""Real 8080/5173 HTTP proof using Claude's committed TypeScript adapter.

Default explicitly injects a fixture provider; never a production fallback.
--live uses production Baseten wiring and makes exactly one adapter turn call.
No browser interaction is claimed. Uses a disposable private SQLite database.
"""

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def ready(url: str, process: subprocess.Popen[bytes]) -> bytes:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Owned server exited before readiness: {url}")
        try:
            with urlopen(url, timeout=1) as response:
                return response.read()
        except (URLError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError(f"Readiness timed out: {url}")


def stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def run(node: str, client_ref: str, live: bool, env_file: str | None) -> None:
    root = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    if live and env_file:
        # Reuse Muse's safe data-only parser; never print keys or copy .env files.
        from probe_persona_live import ENV_KEYS, parse_env_file

        values = parse_env_file(Path(env_file))
        for key in ENV_KEYS:
            if key in values and key not in environment:
                environment[key] = values[key]
    if live and not environment.get("BASETEN_API_KEY"):
        raise RuntimeError("Live verification requires BASETEN_API_KEY; no call made.")
    for port in (8080, 5173):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    environment["VITE_API_BASE_URL"] = "http://127.0.0.1:8080"
    environment["DIALOGIQ_CORS_ORIGINS"] = "http://127.0.0.1:5173,http://localhost:5173"
    source = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={root.as_posix()}",
            "show",
            f"{client_ref}:src/lib/api/http.ts",
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    with tempfile.TemporaryDirectory(prefix="cs42-http-") as folder:
        scratch = Path(folder)
        environment["DIALOGIQ_DB_PATH"] = str(scratch / "practice.db")
        adapter_ts = scratch / "http.ts"
        adapter_ts.write_text(source, encoding="utf-8")
        adapter = scratch / "http.mjs"
        subprocess.run(
            [
                node,
                "-e",
                """
const fs = require('node:fs'), ts = require(process.argv[1]);
fs.writeFileSync(process.argv[3], ts.transpileModule(fs.readFileSync(process.argv[2], 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}
}).outputText);
""",
                str(root / "node_modules/typescript/lib/typescript.js"),
                str(adapter_ts),
                str(adapter),
            ],
            check=True,
        )
        runner = scratch / "runner.mjs"
        runner.write_text(
            """
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createHttpApi} from './http.mjs';
const api = createHttpApi('http://127.0.0.1:8080', (url, init = {}) =>
  fetch(url, {...init, headers: {...init.headers, Origin: 'http://127.0.0.1:5173'}}));
const statePath = process.argv[2], phase = process.argv[3], live = process.argv[4] === 'live';
if (phase === 'reload') {
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(await api.getSession(saved.session.id), saved.session);
  assert.deepEqual(await api.getTree(saved.session.id), saved.tree);
  console.log(JSON.stringify({restartPersistence: 'passed', sessionId: saved.session.id,
    nodeCount: saved.tree.nodes.length, provider: live ? 'Baseten live' : 'explicit fixture'}));
  process.exit(0);
}
const scenarios = await api.listScenarios();
assert.equal(scenarios.length, 4);
const scenario = scenarios.find(s => s.title.startsWith('Teenage Daughter:'));
assert.equal(scenario.persona.name, 'Maya');
assert.ok(Array.isArray(scenario.persona.tags));
assert.equal((await api.getScenario(scenario.id)).id, scenario.id);
const createKey = randomUUID();
let session = await api.createSession({scenario_id: scenario.id}, createKey);
assert.deepEqual(await api.createSession({scenario_id: scenario.id}, createKey), session);
assert.equal((await api.listSessions(scenario.id))[0].id, session.id);
assert.equal((await api.getTree(session.id)).nodes.length, 0);
const questions = live ? ['What has this situation been like for you?'] : [
 'What has this situation been like for you?', 'What has been hardest?', 'How have you felt?',
 'How has that affected you?', 'What matters most?', 'How could I help?', 'What step could we agree on?'];
let first, lastResult;
for (const [index, message] of questions.entries()) {
  const body = {session_id:session.id, branch_id:session.active_branch_id,
    parent_node_id:session.active_head_node_id, expected_revision:session.revision, user_message:message};
  const key = randomUUID(), result = await api.sendTurn(body, key);
  assert.equal(result.node.score, index + 1);
  assert.ok(result.character_response.trim());
  assert.deepEqual(await api.sendTurn(body, key), result); // No second provider call.
  first ??= result.node;
  lastResult = result;
  session = result.session;
}
const original = session;
let tree = await api.getTree(session.id);
assert.equal(tree.nodes.length, questions.length);
const created = await api.createBranch(session.id, {source_branch_id:session.active_branch_id,
  rewind_to_node_id:first.id, expected_revision:session.revision}, randomUUID());
session = created.session;
assert.equal(session.score, 1);
if (!live) {
  const alternate = await api.sendTurn({session_id:session.id, branch_id:session.active_branch_id,
    parent_node_id:session.active_head_node_id, expected_revision:session.revision,
    user_message:'Did the work get done?'}, randomUUID());
  session = alternate.session;
  assert.equal(session.score, 1);
}
session = await api.selectBranch(session.id, {branch_id:original.active_branch_id,
  expected_revision:session.revision}, randomUUID());
assert.equal(session.score, questions.length);
await assert.rejects(api.sendTurn({session_id:session.id, branch_id:session.active_branch_id,
  parent_node_id:session.active_head_node_id, expected_revision:0, user_message:'What?'}, randomUUID()),
  error => error.status === 409 && error.code === 'stale_revision');
await assert.rejects(api.createSession({scenario_id:999999}, randomUUID()), {status:404});
await assert.rejects(api.sendTurn({session_id:session.id, branch_id:session.active_branch_id,
  parent_node_id:session.active_head_node_id, expected_revision:session.revision,
  user_message:'   '}, randomUUID()), {status:422});
tree = await api.getTree(session.id);
fs.writeFileSync(statePath, JSON.stringify({session,tree}));
console.log(JSON.stringify({backend:8080, servedFrontend:5173, clientAdapterRef:process.argv[5],
  provider:live ? 'Baseten live' : 'explicit fixture', paidCalls:live ? 1 : 0,
  scenarios:4, score:session.score, branches:tree.branches.length, nodes:tree.nodes.length,
  realAdapter:'passed', replay:'passed', rewindAndOriginal:'passed', stale409:'passed',
  missing404:'passed', invalid422:'passed', replyCharacters:lastResult.character_response.length,
  visualBrowserCheck:false}));
""",
            encoding="utf-8",
        )
        backend_code = (
            """
import uvicorn
from main import create_app
"""
            + (
                "app = create_app()\n"
                if live
                else """
def fixture(**kwargs):
    return 'Fixture response for ' + kwargs['brief'].character_name + '.'
app = create_app(provider=fixture)
"""
            )
            + "uvicorn.run(app, host='127.0.0.1', port=8080, log_level='warning')\n"
        )
        with (scratch / "servers.log").open("wb") as log:
            processes = []
            try:

                def start_backend() -> subprocess.Popen[bytes]:
                    process = subprocess.Popen(
                        [sys.executable, "-c", backend_code],
                        cwd=root / "backend",
                        env=environment,
                        stdout=log,
                        stderr=log,
                    )
                    processes.append(process)
                    ready("http://127.0.0.1:8080/health", process)
                    return process

                backend = start_backend()
                frontend = subprocess.Popen(
                    [
                        node,
                        str(root / "node_modules/vite/bin/vite.js"),
                        "dev",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "5173",
                        "--strictPort",
                    ],
                    cwd=root,
                    env=environment,
                    stdout=log,
                    stderr=log,
                )
                processes.append(frontend)
                assert b"<html" in ready("http://127.0.0.1:5173", frontend).lower()
                preflight = Request(
                    "http://127.0.0.1:8080/api/chat/turn",
                    method="OPTIONS",
                    headers={
                        "Origin": "http://127.0.0.1:5173",
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "content-type,idempotency-key",
                    },
                )
                with urlopen(preflight, timeout=5) as response:
                    assert response.status == 200
                    assert (
                        response.headers["access-control-allow-origin"]
                        == "http://127.0.0.1:5173"
                    )
                state_path = scratch / "state.json"
                mode = "live" if live else "fixture"
                subprocess.run(
                    [node, str(runner), str(state_path), "practice", mode, client_ref],
                    check=True,
                )
                stop(backend)
                start_backend()
                subprocess.run(
                    [node, str(runner), str(state_path), "reload", mode, client_ref],
                    check=True,
                )
            finally:
                for process in reversed(processes):
                    stop(process)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--client-ref", default="84f436c")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--env-file")
    args = parser.parse_args()
    run(args.node, args.client_ref, args.live, args.env_file)
