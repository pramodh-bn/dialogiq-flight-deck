"""Finite manual comparison: <=16 coach and4 fixture-persona calls, no retries.

Only synthetic public context and validated hint text enter the report. This is
an authored development sample, not independent or sealed held-out evaluation.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from coach import (
    COACH_DEMO_MAX_TOKENS,
    COACH_ENV_KEYS,
    CoachError,
    MetaCoachClient,
    parse_coach_output,
)
from coach_context import (
    NEXT_MOVE_REVISION,
    build_coach_context,
    build_coach_system_prompt,
    serialize_coach_context,
)
from persona import BasetenPersonaClient, PersonaError, generate_persona_reply
from probe_persona_live import ENV_KEYS, load_brief, parse_env_file


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument(
        "--case-ids", help="Comma-separated subset for a recorded checkpoint."
    )
    parser.add_argument("--candidate-only", action="store_true")
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit("Use a new report path; never overwrite a paid run.")
    cases = json.loads((ROOT / "docs/coach-next-move-cases.json").read_text())
    if args.case_ids:
        selected = set(args.case_ids.split(","))
        if selected - {case["id"] for case in cases["cases"]}:
            raise SystemExit("Unknown case ID; no paid calls made.")
        cases["cases"] = [case for case in cases["cases"] if case["id"] in selected]
    if not args.live:
        print("Plan: at most16 coach and4 persona calls. Add --live to execute.")
        return
    env = parse_env_file(args.env_file)
    for key in COACH_ENV_KEYS + ENV_KEYS:
        if key in env:
            os.environ.setdefault(key, env[key])
    os.environ["COACH_PROVIDER"] = "fireworks"
    client = MetaCoachClient()
    persona = BasetenPersonaClient()
    if not client.configured or not persona.configured:
        raise SystemExit("Required server-only provider configuration is missing.")
    report = {
        "source": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "scope": cases["authorship"],
        "provider": client.provider,
        "model": client.model,
        "settings": {
            "temperature": 0.3,
            "max_tokens": 16384,
            "reasoning_effort": "low",
            "timeout": None,
            "retries": 0,
        },
        "attempts": {"coach": 0, "persona": 0},
        "limits": {"coach": 16, "persona": 4},
        "rows": [],
        "failures": 0,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)

    def save() -> None:
        args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    def reserve(kind: str) -> None:
        if report["attempts"][kind] >= report["limits"][kind]:
            raise RuntimeError("Finite provider attempt cap reached.")
        report["attempts"][kind] += 1
        save()

    follow_cases = {
        "answered-cause",
        "help-concern",
        "priority-request",
        "planned-list",
    }
    for case in cases["cases"]:
        previous = []
        variants = (
            ["previous", "candidate"]
            if case.get("compare") and not args.candidate_only
            else ["candidate"]
        )
        for variant in variants:
            for attempt in range(1, 3 if case.get("second") else 2):
                context = build_coach_context(
                    persona_name="Bob",
                    persona_role="Team member",
                    opening_message=cases["opening"],
                    learner_situation="You are meeting to discuss missed deadlines.",
                    turns=case["turns"],
                    previous_hints=previous if attempt == 2 else [],
                )
                row = {
                    "case": case["id"],
                    "variant": variant,
                    "attempt": attempt,
                    "context": context,
                    "review_criterion": case["review"],
                }
                report["rows"].append(row)
                reserve("coach")
                start = time.monotonic()
                try:
                    completion = client.respond(
                        system_prompt=build_coach_system_prompt(
                            "Bob",
                            "Team member",
                            behavior_revision="s4-bob-r1",
                            coach_prompt_revision=NEXT_MOVE_REVISION
                            if variant == "candidate"
                            else None,
                        ),
                        context_json=serialize_coach_context(context),
                        max_tokens=COACH_DEMO_MAX_TOKENS,
                        timeout=None,
                        reasoning_effort="low",
                    )
                    # Capture usage before parsing: invalid JSON still consumed tokens.
                    row.update(
                        finish=completion.finish_reason,
                        completion_tokens=completion.completion_tokens,
                        reasoning_tokens=completion.reasoning_tokens,
                    )
                    row["hint"] = parse_coach_output(completion.content)
                    row["words"] = len(row["hint"]["example"].split())
                    row["ok"] = True
                    if variant == "candidate":
                        previous.append(row["hint"])
                except CoachError as error:
                    report["failures"] += 1
                    row.update(ok=False, error=type(error).__name__)
                    for field in (
                        "finish_reason",
                        "completion_tokens",
                        "reasoning_tokens",
                    ):
                        if field not in row:
                            row[field] = getattr(error, field, None)
                finally:
                    row["elapsed_ms"] = round((time.monotonic() - start) * 1000)
                    save()
                print(
                    json.dumps(
                        {
                            key: row.get(key)
                            for key in (
                                "case",
                                "variant",
                                "attempt",
                                "ok",
                                "elapsed_ms",
                                "words",
                            )
                        }
                    ),
                    flush=True,
                )
                if report["failures"] >= 2:
                    raise SystemExit("Stopped after two provider/validation failures.")
                if (
                    row["ok"]
                    and variant == "candidate"
                    and attempt == 1
                    and case["id"] in follow_cases
                ):
                    history = [{"role": "assistant", "content": cases["opening"]}]
                    for learner, reply in case["turns"]:
                        history.extend(
                            [
                                {"role": "user", "content": learner},
                                {"role": "assistant", "content": reply},
                            ]
                        )
                    reserve("persona")
                    start = time.monotonic()
                    try:
                        row["persona_reply"] = generate_persona_reply(
                            persona,
                            load_brief("Bob: Defensive Team Member", ""),
                            row["hint"]["example"],
                            history=history,
                            resistance="warming",
                            behavior_revision="s4-bob-r1",
                            feedback_revision="semantic-r1",
                        )
                    except PersonaError as error:
                        row["persona_error"] = type(error).__name__
                        report["failures"] += 1
                    finally:
                        row["persona_elapsed_ms"] = round(
                            (time.monotonic() - start) * 1000
                        )
                        save()
                    if report["failures"] >= 2:
                        raise SystemExit(
                            "Stopped after two provider/validation failures."
                        )
    report["complete"] = True
    save()


if __name__ == "__main__":
    main()
