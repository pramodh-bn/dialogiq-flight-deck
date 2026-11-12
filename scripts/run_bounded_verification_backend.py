"""Run the real API with verification-only provider attempt caps.

Requires VERIFY_MAX_COACH_CALLS, VERIFY_MAX_PERSONA_CALLS and VERIFY_BUDGET_LOG.
Semantic-feedback verification additionally requires VERIFY_MAX_FEEDBACK_CALLS.
Every attempt reserves capacity before entering the SDK client. This includes
automatic hints and failed calls. SDK retries remain disabled by the clients.
No credentials, prompts or conversation text enter the budget log.
All other arguments and configuration follow scripts/run_backend.py.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any


class CallBudget:
    """Atomically reserve attempts; never admit more than either hard cap."""

    def __init__(self, limits: dict[str, int], log_path: Path) -> None:
        if not limits or any(value < 0 for value in limits.values()):
            raise ValueError("Verification call caps must be nonnegative.")
        self.limits = dict(limits)
        self.counts = dict.fromkeys(limits, 0)
        self.blocked = dict.fromkeys(limits, 0)
        self.log_path = log_path
        self.lock = threading.Lock()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        # Refuse to mix a new process's counters with an older run.
        with log_path.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(self.snapshot("startup", False)) + "\n")

    def snapshot(self, kind: str, admitted: bool) -> dict[str, Any]:
        return {
            "kind": kind,
            "admitted": admitted,
            "limits": dict(self.limits),
            "attempts_admitted": dict(self.counts),
            "attempts_blocked": dict(self.blocked),
        }

    def reserve(self, kind: str) -> bool:
        """Log the reservation before allowing a provider call to start."""
        with self.lock:
            admitted = self.counts[kind] < self.limits[kind]
            if admitted:
                self.counts[kind] += 1
            else:
                self.blocked[kind] += 1
            # A log failure prevents the call too; it never silently drops evidence.
            with self.log_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(self.snapshot(kind, admitted)) + "\n")
            return admitted


def bounded(
    original: Callable[..., Any],
    budget: CallBudget,
    kind: str,
    error_type: type[Exception],
) -> Callable[..., Any]:
    """Wrap a provider entry point, retaining its public error boundary."""

    @wraps(original)
    def respond(*args: Any, **kwargs: Any) -> Any:
        if not budget.reserve(kind):
            raise error_type("Verification provider attempt cap reached.")
        return original(*args, **kwargs)

    return respond


def required_cap(name: str) -> int:
    """Reject absent/invalid caps before the server can make any paid call."""
    value = os.environ.get(name, "")
    if not value.isascii() or not value.isdecimal():
        raise ValueError(f"Set {name} to a nonnegative integer.")
    return int(value)


def bounded_feedback_client(
    original: Callable[..., Any],
    budget: CallBudget,
) -> Callable[..., Any]:
    """Separate evaluator and coach capacity before their shared SDK boundary."""
    from coach import CoachUnavailableError
    from semantic_feedback import SYSTEM_PROMPT

    @wraps(original)
    def respond(*args: Any, **kwargs: Any) -> Any:
        kind = "feedback" if kwargs.get("system_prompt") == SYSTEM_PROMPT else "coach"
        if kind not in budget.limits:
            raise CoachUnavailableError(
                "No verification budget for this provider role."
            )
        if not budget.reserve(kind):
            raise CoachUnavailableError("Verification provider attempt cap reached.")
        return original(*args, **kwargs)

    return respond


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "backend"))
    import coach
    import persona
    import run_backend

    limits = {
        "coach": required_cap("VERIFY_MAX_COACH_CALLS"),
        "persona": required_cap("VERIFY_MAX_PERSONA_CALLS"),
    }
    if os.environ.get("FEEDBACK_ENABLED") == "1":
        limits["feedback"] = required_cap("VERIFY_MAX_FEEDBACK_CALLS")
    log_path = os.environ.get("VERIFY_BUDGET_LOG")
    if not log_path:
        raise ValueError("Set VERIFY_BUDGET_LOG to a new verification log path.")
    budget = CallBudget(limits, Path(log_path))
    coach.MetaCoachClient.respond = bounded_feedback_client(
        coach.MetaCoachClient.respond, budget
    )
    persona.BasetenPersonaClient.respond = bounded(
        persona.BasetenPersonaClient.respond,
        budget,
        "persona",
        persona.PersonaUnavailableError,
    )
    # CS-91: a streamed reply is one persona call and spends the same budget.
    persona.BasetenPersonaClient.respond_stream = bounded(
        persona.BasetenPersonaClient.respond_stream,
        budget,
        "persona",
        persona.PersonaUnavailableError,
    )
    run_backend.main()


if __name__ == "__main__":
    main()
