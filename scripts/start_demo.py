"""Check or launch the real demo; user interactions can incur provider charges."""

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], env: dict[str, str]) -> None:
    """Run a foreground process without interpreting shell text."""
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def require_free_port(port: int) -> None:
    """Refuse an occupied listener without changing its owning process."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as error:
            raise RuntimeError(
                f"Port {port} is occupied or unavailable; stop its owner explicitly."
            ) from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode", choices=("check", "backend", "frontend"), default="check"
    )
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--database", type=Path, default=ROOT / "demo.local/demo.db")
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--npm-cli", type=Path)
    args = parser.parse_args()
    env = dict(os.environ)

    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Run this script with your Python 3.12 backend venv.")
    # Import only the native dependency, not the app or either provider client.
    import jiter  # noqa: F401

    if not args.node:
        raise RuntimeError("Pass --node with the intended node.exe path.")
    node = Path(args.node).resolve()
    npm_cli = args.npm_cli or node.parent / "node_modules/npm/bin/npm-cli.js"
    if not npm_cli.is_file():
        raise RuntimeError("Pass --npm-cli with npm's node_modules/npm/bin/npm-cli.js.")
    print(f"Python {sys.version.split()[0]}; jiter imported", flush=True)
    run([str(node), "--version"], env)
    run([str(node), str(npm_cli), "--version"], env)
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    if args.mode == "check":
        print("Preflight passed. No servers started and no paid requests made.")
        return 0

    if args.mode == "backend":
        require_free_port(8080)
        if not args.env_file or not args.env_file.is_file():
            raise RuntimeError("Pass --env-file with the server-only provider config.")
        database = args.database.resolve()
        database.parent.mkdir(parents=True, exist_ok=True)
        env.update(
            DIALOGIQ_DB_PATH=str(database),
            DIALOGIQ_CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173",
            COACH_PROVIDER="fireworks",
            COACH_DEMO_WAIT="1",
        )
        print(f"Demo database: {database} (retained across restarts)", flush=True)
        run(
            [
                sys.executable,
                str(ROOT / "scripts/run_backend.py"),
                "--env-file",
                str(args.env_file.resolve()),
                "--host",
                "127.0.0.1",
                "--port",
                "8080",
            ],
            env,
        )
    else:
        require_free_port(5173)
        if not (ROOT / "node_modules").is_dir():
            raise RuntimeError("Run npm ci --ignore-scripts in this worktree first.")
        env.update(VITE_API_BASE_URL="http://127.0.0.1:8080", VITE_COACH_DEMO_WAIT="1")
        run(
            [
                str(node),
                str(npm_cli),
                "run",
                "dev",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                "5173",
                "--strictPort",
            ],
            env,
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (RuntimeError, OSError, ImportError, subprocess.CalledProcessError) as error:
        print(f"Demo launcher: {error}", file=sys.stderr)
        sys.exit(1)
