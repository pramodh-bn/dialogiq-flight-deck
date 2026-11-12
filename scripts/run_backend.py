"""Start the real API; optional env data is read without printing credentials."""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import uvicorn
from probe_persona_live import ENV_KEYS, parse_env_file

# CS-80: coach env for either provider (see backend/coach.py COACH_ENV_KEYS).
META_ENV_KEYS = (
    "META_MODEL_API_KEY",
    "META_MODEL_API_BASE",
    "META_MODEL_API_MODEL",
    "COACH_PROVIDER",
    "FIREWORKS_API_KEY",
    "FIREWORKS_API_BASE",
    "FIREWORKS_MODEL",
)
# CS-91: persona provider choice; FIREWORKS_* keys are already listed above.
PERSONA_ENV_KEYS = ("PERSONA_PROVIDER", "PERSONA_MODEL", "PERSONA_REASONING_EFFORT")
COACH_DEMO_ENV_KEYS = (
    "COACH_DEMO_WAIT",
    "FEEDBACK_ENABLED",
    "FEEDBACK_MODEL",
    "FEEDBACK_PROVIDER",
    "COACH_NEXT_MOVE_ENABLED",
)


def record_coach_calls(log_path: str) -> None:
    """Append what each coach call really sent and got back, without any of its text."""
    import coach
    from semantic_feedback import SYSTEM_PROMPT

    original = coach.MetaCoachClient.respond

    def respond(self: coach.MetaCoachClient, **kwargs: Any) -> Any:
        start = time.monotonic()
        row = {
            "purpose": "feedback"
            if kwargs.get("system_prompt") == SYSTEM_PROMPT
            else "coach",
            # CS-80: which provider and model this call actually used (never keys).
            "provider": getattr(self, "provider", None),
            "model": getattr(self, "model", None),
            "max_tokens": kwargs.get("max_tokens"),
            "timeout": kwargs.get("timeout", "default"),
            "reasoning_effort": kwargs.get("reasoning_effort"),
        }
        try:
            out = original(self, **kwargs)
            row.update(
                ok=True,
                finish=out.finish_reason,
                completion_tokens=out.completion_tokens,
                reasoning_tokens=out.reasoning_tokens,
            )
            return out
        except Exception as error:
            row.update(
                ok=False,
                error=type(error).__name__,
                upstream_status=getattr(error.__cause__, "status_code", None),
                finish=getattr(error, "finish_reason", None),
                completion_tokens=getattr(error, "completion_tokens", None),
                reasoning_tokens=getattr(error, "reasoning_tokens", None),
            )
            raise
        finally:
            row["seconds"] = round(time.monotonic() - start, 2)
            with open(log_path, "a", encoding="utf-8") as log:
                log.write(json.dumps(row) + "\n")

    coach.MetaCoachClient.respond = respond


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.env_file:
        values = parse_env_file(Path(args.env_file))
        for key in ENV_KEYS + META_ENV_KEYS + PERSONA_ENV_KEYS + COACH_DEMO_ENV_KEYS:
            if key in values:
                os.environ.setdefault(key, values[key])
    sys.path.insert(0, str(root / "backend"))
    if log_path := os.environ.get("COACH_TELEMETRY_FILE"):
        record_coach_calls(log_path)
    uvicorn.run("main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
