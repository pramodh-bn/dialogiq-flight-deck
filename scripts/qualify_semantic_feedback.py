"""Bounded evaluator-only qualifications; never changes saved sessions."""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import coach
import semantic_feedback as feedback
from probe_persona_live import parse_env_file
from run_backend import record_coach_calls
from run_bounded_verification_backend import CallBudget, bounded_feedback_client


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--prior-report", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--max-calls", type=int, choices=(1, 2, 3, 4, 5, 6), default=4)
    parser.add_argument(
        "--provider", choices=("fireworks", "baseten"), default="fireworks"
    )
    parser.add_argument("--model")
    parser.add_argument(
        "--case-indices",
        help="Comma-separated1-based case indices for a matched comparison.",
    )
    args = parser.parse_args()
    if args.out.exists():
        raise ValueError("Refusing to replace prior evidence.")
    values = parse_env_file(args.env_file)
    for key in coach.COACH_ENV_KEYS + ("BASETEN_API_KEY", "BASETEN_API_BASE"):
        if key in values:
            os.environ[key] = values[key]
    os.environ["FEEDBACK_PROVIDER"] = args.provider
    os.environ.pop("FEEDBACK_MODEL", None)
    if args.model:
        os.environ["FEEDBACK_MODEL"] = args.model
    config = feedback.selected_client()
    args.out.mkdir(parents=True)
    budget = CallBudget(
        {"feedback": args.max_calls, "coach": 0}, args.out / "budget.jsonl"
    )
    coach.MetaCoachClient.respond = bounded_feedback_client(
        coach.MetaCoachClient.respond, budget
    )
    record_coach_calls(str(args.out / "telemetry.jsonl"))
    prior = json.loads(args.prior_report.read_text(encoding="utf-8"))["cases"][0]
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        raw = db.execute(
            "select scenario_config from sessions where id=?", (prior["session_id"],)
        ).fetchone()[0]
        rubric = json.loads(raw)["needs"]
    history = [{"role": "assistant", "content": prior["opening"]}]
    contexts = []
    for turn in prior["turns"]:
        node = turn["node"]
        contexts.append(
            {
                "history": list(history),
                "learner": node["user_text"],
                "persona": node["character_text"],
                "rubric": rubric,
                "revealed_ids": [],
            }
        )
        history.extend(
            [
                {"role": "user", "content": node["user_text"]},
                {"role": "assistant", "content": node["character_text"]},
            ]
        )
    for learner, persona in [
        ("Thanks, Bob.", "Okay. What did you want to discuss?"),
        (
            "I can't help with the review, and I won't ask anyone else.",
            "Then I still don't see how this gets done.",
        ),
    ]:
        contexts.append(
            {
                "history": [{"role": "assistant", "content": prior["opening"]}],
                "learner": learner,
                "persona": persona,
                "rubric": rubric,
                "revealed_ids": [],
            }
        )
    authored = json.loads((ROOT / "docs/semantic-feedback-cases.json").read_text())
    for item in authored["cases"]:
        if item["id"] in ("acknowledgment", "closed-question"):
            contexts.append(
                {
                    "history": [{"role": "assistant", "content": prior["opening"]}],
                    "learner": item["learner"],
                    "persona": item["persona"],
                    "rubric": rubric,
                    "revealed_ids": [],
                }
            )
    report = {
        "source": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "provider": config.provider,
        "model": config.model,
        "revision": feedback.REVISION,
        "scope": "small authored qualification, not independent or unseen",
        "cases": [],
    }
    failures = 0
    indices = (
        [int(value) - 1 for value in args.case_indices.split(",")]
        if args.case_indices
        else list(range(len(contexts)))
    )
    if (
        not indices
        or len(set(indices)) != len(indices)
        or any(i < 0 or i >= len(contexts) for i in indices)
    ):
        raise ValueError("Choose unique case indices1through6.")
    for index in indices[: args.max_calls]:
        context = contexts[index]
        started = time.monotonic()
        row = {
            "case": index + 1,
            "learner": context["learner"],
            "persona": context["persona"],
            "history": context["history"],
        }
        try:
            result = feedback.bounded(
                feedback.real_provider, context, feedback.TIMEOUT_SECONDS
            )
            row["decision"] = result.model_dump()
            row["status"] = "validated"
        except Exception as error:  # noqa: BLE001 - preserve finite probe failure
            row.update(status="failed", error=type(error).__name__)
            row["validation_code"] = feedback.validation_failure_code(error)
            failures += 1
        row["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        report["cases"].append(row)
        (args.out / "report.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "case": index + 1,
                    "status": row["status"],
                    "elapsed_ms": row["elapsed_ms"],
                }
            ),
            flush=True,
        )
        if failures >= 2:
            break


if __name__ == "__main__":
    main()
