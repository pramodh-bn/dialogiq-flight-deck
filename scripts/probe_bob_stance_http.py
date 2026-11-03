"""CS-76 real-HTTP probe: start the real backend with a stand-in persona, then drive it.

Zero paid calls. Uses a disposable database and its own host, never the held demo.

    backend/.venv/Scripts/python.exe scripts/probe_bob_stance_http.py --host 127.0.0.4
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def call(base: str, method: str, path: str, body: dict | None = None) -> tuple:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if method == "POST":
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.4")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--out")
    args = parser.parse_args()
    base = f"http://{args.host}:{args.port}"
    work = Path(tempfile.mkdtemp(prefix="cs76-probe-"))
    env = {
        **os.environ,
        "DIALOGIQ_DB_PATH": str(work / "probe.db"),
        "BASETEN_API_KEY": "probe-not-a-secret",
    }
    server = subprocess.Popen(
        [
            sys.executable,
            str(ROOT / "scripts/run_backend_stub_persona.py"),
            "--calls-file",
            str(work / "calls.txt"),
            "--host",
            args.host,
            "--port",
            str(args.port),
        ],
        cwd=ROOT / "backend",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    checks: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        checks.append((name, ok))
        print("PASS" if ok else "FAIL", "[real-http]", name)

    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/health", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        _, scenarios = call(base, "GET", "/api/scenarios")
        bob = next(s for s in scenarios if s["title"].startswith("Bob:"))
        other = next(s for s in scenarios if not s["title"].startswith("Bob:"))
        check("Bob lists s4-bob-r1", bob["behavior_revisions"] == ["s4-bob-r1"])
        check("others list nothing", other["behavior_revisions"] == [])
        status, _ = call(
            base,
            "POST",
            "/api/sessions",
            {"scenario_id": other["id"], "behavior_revision": "s4-bob-r1"},
        )
        check("non-Bob opt-in is 422", status == 422)
        _, legacy = call(base, "POST", "/api/sessions", {"scenario_id": bob["id"]})
        check("legacy Bob has null progress", legacy["conversation_progress"] is None)
        _, session = call(
            base,
            "POST",
            "/api/sessions",
            {"scenario_id": bob["id"], "behavior_revision": "s4-bob-r1"},
        )
        progress = session["conversation_progress"]
        check("new Bob starts guarded/initial", progress["last_signal"] == "initial")

        def turn(state: dict, text: str) -> dict:
            status, body = call(
                base,
                "POST",
                "/api/chat/turn",
                {
                    "session_id": state["id"],
                    "branch_id": state["active_branch_id"],
                    "parent_node_id": state["active_head_node_id"],
                    "expected_revision": state["revision"],
                    "user_message": text,
                },
            )
            assert status == 200, body
            return body

        first = turn(session, "Three redesigns in a month sounds exhausting.")
        check(
            "acknowledgment warms without a reveal",
            first["node"]["conversation_progress"]["stance"] == "warming"
            and first["node"]["score"] == 0,
        )
        second = turn(first["session"], "Everyone else stayed late. You are slow.")
        check(
            "blame steps back",
            second["node"]["conversation_progress"]["last_signal"] == "pressure"
            and second["session"]["resistance"] == "guarded",
        )
        _, reloaded = call(base, "GET", f"/api/sessions/{session['id']}")
        check(
            "reload keeps the stance",
            reloaded["conversation_progress"]
            == second["session"]["conversation_progress"],
        )
        status, forked = call(
            base,
            "POST",
            f"/api/sessions/{session['id']}/branches",
            {
                "source_branch_id": second["session"]["active_branch_id"],
                "rewind_to_node_id": first["node"]["id"],
                "expected_revision": second["session"]["revision"],
            },
        )
        check(
            "rewind restores warming",
            status == 201
            and forked["session"]["conversation_progress"]["stance"] == "warming",
        )
        _, tree = call(base, "GET", f"/api/sessions/{session['id']}/tree")
        check("no ledger in public tree", "stance_ledger" not in json.dumps(tree))
        calls = (work / "calls.txt").read_text().splitlines()
        check("stand-in persona called twice", len(calls) == 2)
    finally:
        server.terminate()
        server.wait(10)
    passed = sum(ok for _, ok in checks)
    summary = {"passed": passed, "failed": len(checks) - passed, "host": args.host}
    print(json.dumps(summary))
    if args.out:
        Path(args.out).write_text(
            json.dumps({"summary": summary, "checks": checks}, indent=1),
            encoding="utf-8",
        )
    sys.exit(0 if passed == len(checks) else 1)


if __name__ == "__main__":
    main()
