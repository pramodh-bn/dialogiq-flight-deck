"""Compare legacy prompt bytes with the frozen accepted repository source; zero calls."""

import itertools
import json
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCEPTED = "730a3dc819a0b424e6084417bce872fd1fa6f85f"


def main() -> None:
    sys.path.insert(0, str(ROOT / "backend"))
    import persona

    baseline = types.ModuleType("_cs82_accepted_persona")
    sys.modules[baseline.__name__] = baseline
    source = subprocess.check_output(
        ["git", "show", f"{ACCEPTED}:backend/persona.py"], cwd=ROOT, text=True
    )
    # Exact trusted repository revision, never user-supplied code or downloads.
    exec(compile(source, "accepted-persona.py", "exec"), baseline.__dict__)  # noqa: S102
    brief = persona.PersonaBrief(
        character_name="Bob",
        role="Engineer",
        persona_traits="Cautious",
        hidden_need="Private fixture",
        system_prompt="Stay in role.",
    )
    count = 0
    for level, signal, topics, revision in itertools.product(
        ("guarded", "warming", "open"),
        (
            None,
            "clarity",
            "support",
            "acknowledgment",
            "repair",
            "pressure",
            "boundary",
            "none",
        ),
        (((), ()), (("Context",), ()), (("Context",), ("Support",))),
        (None, "s4-bob-r1"),
    ):
        kwargs = {
            "resistance": level,
            "stance_signal": signal,
            "revealed_titles": topics[0],
            "newly_revealed_titles": topics[1],
            "behavior_revision": revision,
        }
        assert persona.build_persona_system_prompt(
            brief, **kwargs
        ) == baseline.build_persona_system_prompt(brief, **kwargs)
        count += 1
    print(
        json.dumps(
            {
                "accepted_source": ACCEPTED,
                "current_source": subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
                ).strip(),
                "exact_prompt_comparisons": count,
                "passed": True,
                "paid_calls": 0,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
