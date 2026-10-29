"""Verify the real Sprint 1 API and TypeScript HTTP adapter without paid calls.

Run from the repository root using backend/.venv/Scripts/python.exe.
Pass --node with the Node executable path. Requires npm ci first.
The server uses this checkout's backend/dialogiq.db; run in your own worktree.
"""

import argparse
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def verify(node: str) -> None:
    root = Path(__file__).resolve().parents[1]
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=root / "backend",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(100):
            try:
                with urlopen(f"{base}/health", timeout=1) as response:
                    assert response.status == 200
                break
            except (URLError, TimeoutError):
                if server.poll() is not None:
                    raise RuntimeError("uvicorn exited before readiness")
                time.sleep(0.1)
        else:
            raise RuntimeError("uvicorn did not become ready")

        preflight = Request(
            f"{base}/api/chat/turn",
            method="OPTIONS",
            headers={
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        with urlopen(preflight, timeout=5) as response:
            assert response.status == 200
            assert (
                response.headers["access-control-allow-origin"]
                == "http://localhost:8080"
            )

        # Compile the delivered TS adapter, then exercise it against real FastAPI.
        source = root / "src/lib/api/http.ts"
        compiler = root / "node_modules/typescript/lib/typescript.js"
        script = """
const fs = require('node:fs');
const ts = require(process.argv[1]);
const js = ts.transpileModule(fs.readFileSync(process.argv[2], 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}
}).outputText;
fs.writeFileSync(process.argv[3], js);
"""
        with tempfile.TemporaryDirectory(prefix="dialogiq-demo-") as folder:
            adapter = Path(folder) / "http.mjs"
            subprocess.run(
                [node, "-e", script, str(compiler), str(source), str(adapter)],
                check=True,
            )
            runner = Path(folder) / "verify.mjs"
            runner.write_text(
                """
import assert from 'node:assert/strict';
import {createHttpApi} from './http.mjs';
const api = createHttpApi(process.argv[2]);
const scenarios = await api.listScenarios();
assert.equal(scenarios.length, 4);
for (const scenario of scenarios) {
  assert.deepEqual(Object.keys(scenario).sort(), ['description', 'id', 'title']);
}
const selected = scenarios.find(s => s.title.startsWith('Teenage Daughter:'));
assert.ok(selected);
const session = await api.createSession({scenario_id: selected.id});
assert.equal(session.scenario_id, selected.id);
assert.equal(session.score, 0);
const reply = await api.sendTurn({session_id: session.id, user_message: 'What matters most?'});
assert.equal(typeof reply.character_response, 'string');
assert.equal(reply.turn_id, 1);
assert.equal(reply.revealed_node_score, 3); // Declared Sprint 1 stub.
await assert.rejects(api.createSession({scenario_id: 999999}), {status: 404});
await assert.rejects(api.sendTurn({session_id: session.id, user_message: ''}), {status: 422});
console.log(JSON.stringify({health: 'passed', cors8080: 'passed', scenarios: scenarios.length,
  selectedScenario: selected.title, session: 'created', httpAdapter: 'passed',
  privateScenarioFields: 'excluded', unknownScenario: 404, emptyMessage: 422,
  chat: 'fixed placeholder; no model call'}));
""",
                encoding="utf-8",
            )
            subprocess.run([node, str(runner), base], check=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node")
    verify(parser.parse_args().node)
