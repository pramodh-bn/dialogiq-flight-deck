"""Real-8080 coach HTTP proof with a disposable database (CS-43).

Default (mocked) mode strips Meta credentials from the server process, so
every hint falls back deterministically with zero network calls, while
validation, replay, rotation, and GET ordering run over real sockets.
--live passes --env-file to run_backend.py and makes exactly two paid Meta
calls (requested root attempt1 + attempt2), printing both hints so a human
can judge distinctness. No secrets are printed, only SET/MISSING per name.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

META_ENV_KEYS = ("META_MODEL_API_KEY", "META_MODEL_API_BASE", "META_MODEL_API_MODEL")


def check_port_free(port: int) -> None:
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(
                f"Port {port} is occupied; stop the other server first."
            ) from exc


def start_server(
    root: Path,
    port: int,
    db_path: Path,
    env_file: str | None,
    live: bool,
    log: object,
    log_path: Path,
) -> subprocess.Popen[bytes]:
    environment = os.environ.copy()
    if live:
        for key in META_ENV_KEYS:
            print(f"{key}: {'SET' if environment.get(key) else 'from-env-file'}")
    else:
        for key in META_ENV_KEYS:
            environment.pop(key, None)
        print("Meta credentials stripped from server env (mocked mode).")
    environment["DIALOGIQ_DB_PATH"] = str(db_path)
    command = [
        sys.executable,
        str(root / "scripts" / "run_backend.py"),
        "--port",
        str(port),
    ]
    if env_file:
        command += ["--env-file", env_file]
    process = subprocess.Popen(
        command, cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT
    )
    deadline = time.monotonic() + 45
    url = f"http://127.0.0.1:{port}/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited before readiness; see {log_path}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                response.read()
                print(f"server ready: {url} (db {db_path.name})")
                return process
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    stop_server(process)
    raise RuntimeError(f"Readiness timed out: {url}; see {log_path}")


def stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


def remove_tree(path: Path) -> None:
    """Best-effort temp cleanup; Windows may briefly lock a fresh DB file."""
    for _ in range(10):
        try:
            shutil.rmtree(path)
            return
        except OSError:
            time.sleep(0.5)
    print(f"kept temp dir (still locked): {path}")


def call(
    method: str, url: str, payload: dict | None = None, key: str | None = None
) -> tuple[int, dict, float]:
    data = None
    request_headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    if key is not None:
        request_headers["Idempotency-Key"] = key
    request = urllib.request.Request(
        url, data=data, headers=request_headers, method=method
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            elapsed = time.monotonic() - started
            return (
                response.status,
                json.loads(response.read().decode("utf-8")),
                elapsed,
            )
    except urllib.error.HTTPError as error:
        elapsed = time.monotonic() - started
        return (
            error.code,
            json.loads(error.read().decode("utf-8")),
            elapsed,
        )


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"COACH-HTTP-{'PASS' if condition else 'FAIL'} {name} {detail}".rstrip())
    if not condition:
        raise RuntimeError(f"coach HTTP check failed: {name} {detail}".rstrip())


def run_mocked(base: str) -> None:
    status, scenarios, _ = call("GET", f"{base}/api/scenarios")
    check("scenarios", status == 200 and len(scenarios) == 4, f"status={status}")
    maya = next(s for s in scenarios if s["title"].startswith("Teenage Daughter:"))
    status, session, _ = call(
        "POST",
        f"{base}/api/sessions",
        {"scenario_id": maya["id"]},
        str(uuid4()),
    )
    check("session", status == 201, f"status={status}")
    branch_id = session["active_branch_id"]
    path = f"{base}/api/sessions/{session['id']}/coach-hints"

    def hint_body(attempt: int, **overrides: object) -> dict:
        body = {
            "branch_id": branch_id,
            "head_node_id": None,
            "expected_revision": 0,
            "trigger": "requested",
            "attempt": attempt,
        }
        body.update(overrides)
        return body

    status, first, elapsed1 = call("POST", path, hint_body(1), str(uuid4()))
    hint1 = first.get("hint", {})
    check(
        "fallback-not-configured",
        status == 200
        and hint1.get("source") == "deterministic"
        and hint1.get("fallback_reason") == "not_configured"
        and hint1.get("approach") == "Start with a low-pressure invitation.",
        f"status={status} http_s={elapsed1:.2f}",
    )
    check(
        "fallback-latency-bounded",
        isinstance(hint1.get("latency_ms"), int) and hint1["latency_ms"] <= 10000,
        f"latency_ms={hint1.get('latency_ms')}",
    )
    status, second, _ = call("POST", path, hint_body(2), str(uuid4()))
    check(
        "root-attempt2-rotates",
        status == 200
        and second["hint"]["approach"] == "Ask permission for one small question.",
        f"status={status}",
    )
    key = str(uuid4())
    status, original, _ = call("POST", path, hint_body(1), key)
    status2, replayed, _ = call("POST", path, hint_body(1), key)
    check(
        "idempotent-replay",
        status == 200 and status2 == 200 and replayed == original,
        f"status={status}/{status2}",
    )
    status, conflict, _ = call("POST", path, hint_body(2), key)
    check(
        "fingerprint-conflict",
        status == 409 and conflict["detail"]["code"] == "idempotency_conflict",
        f"status={status}",
    )
    for name, body, code in (
        ("attempt3", hint_body(3), "validation_error"),
        ("automatic2", hint_body(2, trigger="automatic"), "validation_error"),
        ("automatic-root", hint_body(1, trigger="automatic"), "hint_not_eligible"),
    ):
        status, error, _ = call("POST", path, body, str(uuid4()))
        check(
            f"reject-{name}",
            error.get("detail", {}).get("code") == code,
            f"status={status}",
        )
    status, error, _ = call("POST", path, hint_body(1), None)
    check(
        "reject-missing-key",
        status == 422 and error["detail"]["code"] == "validation_error",
        f"status={status}",
    )
    get_path = f"{base}/api/sessions/{session['id']}/branches/{branch_id}/coach-hints"
    status, listing, _ = call("GET", get_path)
    attempts = [(h["head_node_id"], h["hint"]["attempt"]) for h in listing["hints"]]
    check(
        "get-ordered",
        status == 200 and attempts == [(None, 1), (None, 2)],
        f"status={status} hints={attempts}",
    )
    status, _, _ = call("GET", get_path + "?x=1")
    check("get-rejects-query", status == 422, f"status={status}")


def run_live(base: str) -> None:
    status, scenarios, _ = call("GET", f"{base}/api/scenarios")
    check("scenarios", status == 200, f"status={status}")
    maya = next(s for s in scenarios if s["title"].startswith("Teenage Daughter:"))
    status, session, _ = call(
        "POST",
        f"{base}/api/sessions",
        {"scenario_id": maya["id"]},
        str(uuid4()),
    )
    check("session", status == 201, f"status={status}")
    path = f"{base}/api/sessions/{session['id']}/coach-hints"

    def hint_body(attempt: int) -> dict:
        return {
            "branch_id": session["active_branch_id"],
            "head_node_id": None,
            "expected_revision": 0,
            "trigger": "requested",
            "attempt": attempt,
        }

    status, first, elapsed1 = call("POST", path, hint_body(1), str(uuid4()))
    hint1 = first.get("hint", {})
    check(
        "live-attempt1-meta",
        status == 200 and hint1.get("source") == "meta",
        f"status={status} http_s={elapsed1:.2f} latency_ms={hint1.get('latency_ms')}",
    )
    status, second, elapsed2 = call("POST", path, hint_body(2), str(uuid4()))
    hint2 = second.get("hint", {})
    check(
        "live-attempt2-meta",
        status == 200 and hint2.get("source") == "meta",
        f"status={status} http_s={elapsed2:.2f} latency_ms={hint2.get('latency_ms')}",
    )
    print("LIVE-HINT-1 " + json.dumps(hint1, ensure_ascii=False))
    print("LIVE-HINT-2 " + json.dumps(hint2, ensure_ascii=False))
    print("MANUAL-JUDGMENT-REQUIRED distinct second approach vs hint 1")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--env-file", default=None)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    if args.live and not args.env_file:
        raise RuntimeError("--live requires --env-file; no call made.")
    root = Path(__file__).resolve().parents[1]
    revision = subprocess.run(
        ["git", "-c", "safe.directory=*", "rev-parse", "--short", "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    print(f"source revision: {revision} python: {sys.version.split()[0]}")
    check_port_free(args.port)
    # Outside the temp dir: Windows cannot unlink it while the child runs.
    log_path = Path(tempfile.gettempdir()) / f"cs43-coach-uvicorn-{os.getpid()}.log"
    with open(log_path, "wb") as log:
        folder = tempfile.mkdtemp(prefix="cs43-coach-http-")
        try:
            db_path = Path(folder) / "coach-http.db"
            process = start_server(
                root, args.port, db_path, args.env_file, args.live, log, log_path
            )
            try:
                base = f"http://127.0.0.1:{args.port}"
                if args.live:
                    run_live(base)
                else:
                    run_mocked(base)
            except RuntimeError:
                tail = log_path.read_bytes().decode("utf-8", errors="replace")
                print("".join(f"UVICORN| {line}" for line in tail.splitlines()[-20:]))
                raise
            finally:
                stop_server(process)
        finally:
            remove_tree(Path(folder))
    try:
        log_path.unlink()
    except OSError:
        print(f"kept server log: {log_path}")
    print(f"COACH-HTTP-DONE mode={'live' if args.live else 'mocked'}")


if __name__ == "__main__":
    main()
