"""Paired Bob coach evaluation: chained first and second hints on fixed dialogue.

Run from a task worktree with the backend venv. The coach prompt comes from the source
checked out there, so a current and a candidate commit see the same cases:

    backend/.venv/Scripts/python.exe scripts/evaluate_bob.py \
        --env-file ../dialogiq-flight-deck/.env --cases docs/sprint4/bob_review_cases.json \
        --reps 3 --max-calls 78 --out <report.json>

Calls the provider directly with demo settings, on a fixed transcript. It does not touch
the database, Baseten or a browser. Each hint's text goes to the report for review; case
text is not printed, so an unseen file stays off the console. Stops at --max-calls.

For a paired run, take the baseline without --behavior-revision, then run the candidate
from the same source with both of these, so its second hints follow the same first hints:

    --behavior-revision s4-bob-r1 --prior-hints-from <baseline-report.json>
"""

import argparse
import hashlib
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from probe_coach_live import ENV_KEYS, parse_env_file

BOB_TITLE = "Bob: Defensive Team Member"

if TYPE_CHECKING:
    from coach import MetaCoachClient


def load_bob_public() -> dict[str, str]:
    """Return only Bob's public fields; needs and traits are never read from the fixture."""
    data = json.loads(
        (ROOT / "backend" / "persona_fixtures.json").read_text(encoding="utf-8")
    )
    for scenario in data["scenarios"]:
        if scenario["scenario_title"] == BOB_TITLE:
            persona = scenario["persona"]
            return {
                "name": persona["name"],
                "role": persona["role"],
                "opening_message": persona["opening_message"],
                "learner_situation": persona["public_context"],
            }
    raise SystemExit("Bob scenario missing")


def git_output(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def one_hint(
    client: "MetaCoachClient",
    system: str,
    context: str,
    previous: list[dict[str, str]],
    settings: dict[str, Any],
) -> dict:
    from coach import parse_coach_output

    start = time.monotonic()
    row: dict = {"attempt": len(previous) + 1}
    try:
        out = client.respond(
            system_prompt=system,
            context_json=context,
            max_tokens=settings["max_tokens"],
            timeout=None,
            reasoning_effort=settings["reasoning_effort"],
        )
        row.update(
            finish=out.finish_reason,
            completion_tokens=out.completion_tokens,
            hint=parse_coach_output(out.content),
        )
    except Exception as error:  # noqa: BLE001 - every provider failure is a result to record
        row.update(
            hint=None,
            error=type(error).__name__,
            finish=getattr(error, "finish_reason", None),
            completion_tokens=getattr(error, "completion_tokens", None),
        )
    row["seconds"] = round(time.monotonic() - start, 2)
    return row


def load_prior_hints(path: Path) -> dict[tuple[str, int], dict[str, str]]:
    """Return each case and rep's first hint from an earlier report."""
    rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
    return {
        (row["case"], row["rep"]): row["hint"]
        for row in rows
        if row["attempt"] == 1 and row["hint"]
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--max-calls", type=int, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--behavior-revision")
    parser.add_argument("--prior-hints-from")
    args = parser.parse_args()

    for key, value in parse_env_file(Path(args.env_file)).items():
        if key in ENV_KEYS:
            os.environ.setdefault(key, value)

    from coach import (
        COACH_DEMO_MAX_TOKENS,
        COACH_DEMO_REASONING_EFFORT,
        MetaCoachClient,
    )
    from coach_context import (
        build_coach_context,
        build_coach_system_prompt,
        serialize_coach_context,
    )

    settings = {
        "max_tokens": COACH_DEMO_MAX_TOKENS,
        "reasoning_effort": COACH_DEMO_REASONING_EFFORT,
    }
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    bob = load_bob_public()
    variant = (
        {"behavior_revision": args.behavior_revision} if args.behavior_revision else {}
    )
    system = build_coach_system_prompt(bob["name"], bob["role"], **variant)
    prior_path = Path(args.prior_hints_from) if args.prior_hints_from else None
    prior_hints = load_prior_hints(prior_path) if prior_path else None
    client = MetaCoachClient()

    rows: list[dict] = []
    calls = 0
    stopped = None
    for case in cases:
        for rep in range(1, args.reps + 1):
            previous: list[dict[str, str]] = []
            for _attempt in (1, 2):
                if calls >= args.max_calls:
                    stopped = f"--max-calls {args.max_calls} reached"
                    break
                context = serialize_coach_context(
                    build_coach_context(
                        persona_name=bob["name"],
                        persona_role=bob["role"],
                        opening_message=bob["opening_message"],
                        learner_situation=bob["learner_situation"],
                        turns=[tuple(turn) for turn in case["turns"]],
                        previous_hints=previous,
                    )
                )
                calls += 1
                row = one_hint(client, system, context, previous, settings)
                rows.append({"case": case["id"], "rep": rep, **row})
                print(
                    case["id"],
                    rep,
                    row["attempt"],
                    row["seconds"],
                    row["finish"],
                    flush=True,
                )
                prior = (
                    row["hint"]
                    if prior_hints is None
                    else prior_hints.get((case["id"], rep))
                )
                if prior is None:
                    break
                previous.append(prior)

    seconds = [r["seconds"] for r in rows]
    valid = [r for r in rows if r["hint"]]
    report = {
        "source_revision": git_output("rev-parse", "HEAD"),
        "uncommitted_changes": bool(git_output("status", "--porcelain")),
        "scope": "coach only, fixed reviewer-authored dialogue, no persona or browser",
        "provider": getattr(client, "provider", "meta"),
        "model": client.model,
        "settings": {**settings, "timeout": None, "temperature": "client default"},
        "cases_file": Path(args.cases).name,
        "behavior_revision": args.behavior_revision,
        "prior_hints_sha256": (
            hashlib.sha256(prior_path.read_bytes()).hexdigest() if prior_path else None
        ),
        "reps": args.reps,
        "calls": calls,
        "stopped": stopped,
        "valid": len(valid),
        "invalid": len(rows) - len(valid),
        "seconds_median": statistics.median(seconds) if seconds else None,
        "seconds_max": max(seconds) if seconds else None,
        "rows": rows,
    }
    Path(args.out).write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("saved", len(rows), "calls", calls, "valid", len(valid), "stopped", stopped)


if __name__ == "__main__":
    main()
