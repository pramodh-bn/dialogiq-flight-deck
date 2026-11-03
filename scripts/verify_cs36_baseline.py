"""Check the pre-Sprint-2 HTTP baseline at backend 8080 / frontend 5173.

Uses this worktree's real server, served frontend and actual TS HTTP adapter.
No browser interaction or model calls. Requires a fresh checkout database.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def wait_ready(url: str, process: subprocess.Popen[bytes]) -> bytes:
    """Use bounded readiness attempts for a server owned by this check."""
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError(f"Owned server exited before readiness: {url}")
        try:
            with urlopen(url, timeout=1) as response:
                return response.read()
        except (URLError, TimeoutError):
            time.sleep(0.25)
    raise RuntimeError(f"Server did not become ready: {url}")


def verify(node: str) -> None:
    """Run the baseline without changing application source or shared data."""
    root = Path(__file__).resolve().parents[1]
    if (root / "backend/dialogiq.db").exists():
        raise RuntimeError(
            "Use a fresh worktree database; existing data is not deleted."
        )
    for port in (8080, 5173):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    environment = os.environ.copy()
    environment["VITE_API_BASE_URL"] = "http://127.0.0.1:8080"
    environment["DIALOGIQ_CORS_ORIGINS"] = "http://127.0.0.1:5173,http://localhost:5173"
    processes: list[subprocess.Popen[bytes]] = []
    with tempfile.TemporaryDirectory(prefix="cs36-baseline-") as folder:
        scratch = Path(folder)
        with (scratch / "servers.log").open("wb") as log:
            try:
                processes.append(
                    subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "uvicorn",
                            "main:app",
                            "--host",
                            "127.0.0.1",
                            "--port",
                            "8080",
                        ],
                        cwd=root / "backend",
                        env=environment,
                        stdout=log,
                        stderr=log,
                    )
                )
                health = json.loads(
                    wait_ready("http://127.0.0.1:8080/health", processes[0])
                )
                assert health["status"] == "healthy"
                processes.append(
                    subprocess.Popen(
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
                )
                page = wait_ready("http://127.0.0.1:5173", processes[1])
                assert b"<html" in page.lower()
                request = Request(
                    "http://127.0.0.1:8080/api/chat/turn",
                    method="OPTIONS",
                    headers={
                        "Origin": "http://127.0.0.1:5173",
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "content-type",
                    },
                )
                with urlopen(request, timeout=5) as response:
                    assert response.status == 200
                    assert response.headers["access-control-allow-origin"] == (
                        "http://127.0.0.1:5173"
                    )
                compiler = root / "node_modules/typescript/lib/typescript.js"
                adapter = scratch / "http.mjs"
                subprocess.run(
                    [
                        node,
                        "-e",
                        """
const fs = require('node:fs');
const ts = require(process.argv[1]);
fs.writeFileSync(process.argv[3], ts.transpileModule(
  fs.readFileSync(process.argv[2], 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext}
  }).outputText);
""",
                        str(compiler),
                        str(root / "src/lib/api/http.ts"),
                        str(adapter),
                    ],
                    check=True,
                )
                runner = scratch / "runner.mjs"
                runner.write_text(
                    """
import assert from 'node:assert/strict';
import {createHttpApi} from './http.mjs';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => nativeFetch(url, {...init,
  headers: {...init.headers, Origin: 'http://127.0.0.1:5173'}});
const api = createHttpApi('http://127.0.0.1:8080');
const scenarios = await api.listScenarios();
assert.equal(scenarios.length, 4);
for (const s of scenarios) {
  assert.deepEqual(Object.keys(s).sort(), ['description', 'id', 'title']);
}
const scenario = scenarios.find(s => s.title.startsWith('Teenage Daughter:'));
assert.ok(scenario);
const session = await api.createSession({scenario_id: scenario.id});
assert.equal(session.scenario_id, scenario.id);
assert.equal(session.score, 0);
const reply = await api.sendTurn({session_id: session.id,
  user_message: 'What matters most?'});
assert.equal(reply.turn_id, 1);
assert.equal(reply.revealed_node_score, 3);
assert.ok(reply.character_response.includes('delivery timeline'));
await assert.rejects(api.createSession({scenario_id: 999999}), {status: 404});
await assert.rejects(api.sendTurn({session_id: session.id, user_message: ''}),
  {status: 422});
console.log(JSON.stringify({backend: 8080, servedFrontend: 5173,
  corsOrigin: 'http://127.0.0.1:5173', actualTsHttpAdapter: 'passed',
  scenarios: scenarios.length, session: 'created', unknownScenario: 404,
  emptyMessage: 422, reply: 'fixed baseline placeholder', modelCalls: 0,
  visualBrowserCheck: false}));
""",
                    encoding="utf-8",
                )
                subprocess.run([node, str(runner)], check=True)
            except Exception:
                log.flush()
                # Server logs are local baseline logs; no provider is invoked.
                print(
                    (scratch / "servers.log").read_text(
                        encoding="utf-8", errors="replace"
                    ),
                    file=sys.stderr,
                )
                raise
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    verify(parser.parse_args().node)
