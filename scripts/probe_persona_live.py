"""Manual live probe for the Baseten persona client (CS-39 follow-up).

MANUAL USE ONLY. Never imported by pytest: --live spends real Baseten credit
(one request per run). Without --live this makes no network calls: it only
resolves config, builds the system prompt from persona_fixtures.json, and
prints what WOULD be sent.

Setup (keys are never committed; root .gitignore covers .env everywhere):
  1. Create backend/.env (or pass --env-file):
       BASETEN_API_KEY=<key from the one-time link>
       # optional overrides:
       # BASETEN_API_BASE=https://inference.baseten.co/v1
       # BASETEN_MODEL=meta-models/muse-spark-open-1026
  2. From the repo root, with the project venv:
       backend/.venv/Scripts/python.exe scripts/probe_persona_live.py --live
         --scenario "Bob: Defensive Team Member"
         --message "What has this quarter been like for you?"

Values from --env-file never print; only SET/MISSING is shown. Shell
variables win over the env file (dotenv override=False semantics).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from persona import (
    RESISTANCE_GUARDED,
    RESISTANCE_OPEN,
    RESISTANCE_WARMING,
    BasetenPersonaClient,
    PersonaBrief,
    PersonaError,
    build_persona_system_prompt,
    generate_persona_reply,
)

ENV_KEYS = ("BASETEN_API_KEY", "BASETEN_API_BASE", "BASETEN_MODEL")
RESISTANCES = (RESISTANCE_GUARDED, RESISTANCE_WARMING, RESISTANCE_OPEN)

DEFAULT_HIDDEN_NEED = (
    "Probe brief (not a real scenario): the speaker is guarded about workload "
    "pressure and needs explicit agreement on priorities before committing."
)


def parse_env_file(path: Path) -> dict[str, str]:
    """Read KEY=VALUE lines; skip blanks/comments; strip matching quotes."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, raw = stripped.partition("=")
        key, raw = key.strip(), raw.strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
            raw = raw[1:-1]
        if key:
            values[key] = raw
    return values


def load_brief(scenario_title: str, hidden_need: str) -> PersonaBrief:
    """Build the brief from persona_fixtures.json plus an explicit need text."""
    fixture_path = REPO_ROOT / "backend" / "persona_fixtures.json"
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    for scenario in data["scenarios"]:
        if scenario["scenario_title"] == scenario_title:
            details = scenario["persona"]
            return PersonaBrief(
                character_name=details["name"],
                role=details["role"],
                persona_traits=scenario["persona_traits"],
                hidden_need=hidden_need,
                system_prompt=scenario["system_prompt"],
            )
    known = [s["scenario_title"] for s in data["scenarios"]]
    raise SystemExit(f"unknown scenario {scenario_title!r}; known: {known}")


def split_list(raw: str) -> list[str]:
    """Split a comma-separated CLI list, dropping empties."""
    return [item.strip() for item in raw.split(",") if item.strip()]


def resolve_env_file(explicit: str | None) -> Path | None:
    """Return the env file to read, or None for process environment only."""
    if explicit:
        return Path(explicit)
    for candidate in (REPO_ROOT / "backend" / ".env", REPO_ROOT / ".env"):
        if candidate.exists():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    """Run the probe; return a process exit code (0 ok, 2 usage/provider)."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=None, help="env file to load")
    parser.add_argument(
        "--scenario", default="Bob: Defensive Team Member", help="exact title"
    )
    parser.add_argument(
        "--message",
        default="What has this quarter been like for you?",
        help="user turn to send",
    )
    parser.add_argument("--revealed", default="", help="comma-separated titles")
    parser.add_argument("--newly", default="", help="candidate title, if any")
    parser.add_argument(
        "--resistance", default=RESISTANCE_GUARDED, choices=list(RESISTANCES)
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--hidden-need", default=DEFAULT_HIDDEN_NEED)
    parser.add_argument("--history-file", default=None, help="JSON message array")
    parser.add_argument(
        "--live", action="store_true", help="spend one real Baseten call"
    )
    args = parser.parse_args(argv)

    env_path = resolve_env_file(args.env_file)
    if args.env_file and (env_path is None or not env_path.exists()):
        print(f"env file not found: {args.env_file}", file=sys.stderr)
        return 2
    if env_path is not None:
        for key, value in parse_env_file(env_path).items():
            if key in ENV_KEYS and key not in os.environ:
                os.environ[key] = value
    print(f"env file: {env_path if env_path else '(none; process env only)'}")
    for key in ENV_KEYS:
        print(f"{key}: {'SET' if os.environ.get(key) else 'MISSING'}")

    brief = load_brief(args.scenario, args.hidden_need)
    print(f"persona: {brief.character_name} ({brief.role})")
    history: list[dict] = []
    if args.history_file:
        history = json.loads(Path(args.history_file).read_text(encoding="utf-8"))
    prompt = build_persona_system_prompt(
        brief,
        revealed_titles=split_list(args.revealed),
        newly_revealed_titles=split_list(args.newly),
        resistance=args.resistance,
    )
    print("--- system prompt (brief text, no secrets) ---")
    print(prompt)
    print("--- end prompt ---")
    if not args.live:
        print("DRY RUN: no network call made. Re-run with --live to spend one call.")
        return 0
    client = BasetenPersonaClient()
    started = time.perf_counter()
    try:
        reply = generate_persona_reply(
            client,
            brief,
            args.message,
            revealed_titles=split_list(args.revealed),
            newly_revealed_titles=split_list(args.newly),
            resistance=args.resistance,
            history=history,
            temperature=args.temperature,
            timeout=args.timeout,
        )
    except PersonaError as exc:
        print(f"{type(exc).__name__}: {exc}")
        return 2
    elapsed = time.perf_counter() - started
    print(f"--- reply ({elapsed:.1f}s) ---")
    print(reply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
