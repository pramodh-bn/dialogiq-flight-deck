"""Time Bob's streamed reply with the real persona prompt on several models.

Runs one fixed three-turn spoken journey per model against Fireworks, using the
same prompt, judge and stance code as the turn route. Prints and saves timings
and the public synthetic dialogue; never prints keys or the private brief.

usage: python scripts/v3/measure_persona_stream.py <env-file> <out.json> [model ...]
"""

import json
import os
import pathlib
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

MODELS = (
    "accounts/fireworks/models/muse-spark-open",
    "accounts/fireworks/models/ember-1",
    "accounts/fireworks/models/gpt-oss-120b",
)
REASONING = "low"
JOURNEY = (
    "Thanks for coming in. I want to understand how Q3 went from your side.",
    "What made the deadlines hard to hit?",
    "That sounds frustrating. What would help you most this quarter?",
)


def load_env(path: str) -> None:
    """Load only the Fireworks settings, without printing them."""
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() in ("FIREWORKS_API_KEY", "FIREWORKS_API_BASE"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def bob_config() -> dict:
    """Seed a throwaway database and return Bob's pinned s4-bob-r1 config."""
    os.environ["DIALOGIQ_DB_PATH"] = str(
        pathlib.Path(tempfile.mkdtemp(prefix="dialogiq-v3-")) / "measure.db"
    )
    from database import SessionLocal, engine
    from migrations import initialize_database
    from models import Scenario
    from seed import pin_scenario

    initialize_database(engine)
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.title.like("Bob:%")).one()
        return pin_scenario(scenario, "s4-bob-r1")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    load_env(sys.argv[1])
    models = tuple(sys.argv[3:]) or MODELS
    out = pathlib.Path(sys.argv[2])
    config = bob_config()

    import stance
    from judge import evaluate
    from persona import (
        FireworksPersonaClient,
        PersonaBrief,
        PersonaError,
        generate_persona_reply_stream,
    )
    from schemas import State

    brief = PersonaBrief(
        character_name=config["persona"]["name"],
        role=config["persona"]["role"],
        persona_traits=config["persona_traits"],
        system_prompt=config["system_prompt"],
        hidden_need=json.dumps(config["needs"], ensure_ascii=False, sort_keys=True),
    )
    ruleset = config["revision"].split(":", 1)[0]
    rows = []
    calls = 0
    for model in models:
        client = FireworksPersonaClient(model=model, reasoning_effort=REASONING)
        previous = {**State().model_dump(), **stance.initial_state_fields()}
        history = [
            {"role": "assistant", "content": config["persona"]["opening_message"]}
        ]
        for turn, line in enumerate(JOURNEY, start=1):
            calls += 1
            state, _coaching, newly = evaluate(line, previous, config["needs"], ruleset)
            state = stance.apply_turn(state, previous, line)
            start = time.perf_counter()
            first = None
            sentences: list[str] = []
            error = None
            try:
                for sentence in generate_persona_reply_stream(
                    client,
                    brief,
                    line,
                    history=history,
                    revealed_titles=[n["title"] for n in previous["revealed_needs"]],
                    newly_revealed_titles=newly,
                    resistance=state["resistance"],
                    behavior_revision=config["behavior_revision"],
                    stance_signal=state["conversation_progress"]["last_signal"],
                ):
                    if first is None:
                        first = time.perf_counter() - start
                    sentences.append(sentence)
            except PersonaError as exc:
                error = type(exc).__name__
            total = time.perf_counter() - start
            reply = " ".join(sentences)
            row = {
                "model": model,
                "reasoning_effort": REASONING,
                "turn": turn,
                "first_sentence_s": round(first, 2) if first is not None else None,
                "total_s": round(total, 2),
                "sentences": len(sentences),
                "stance": state["resistance"],
                "learner": line,
                "bob": reply,
                "error": error,
            }
            rows.append(row)
            # Saved after every call so a crash cannot lose paid results.
            out.write_text(
                json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8"
            )
            print(json.dumps(row, ensure_ascii=False), flush=True)
            if error:
                break
            history += [
                {"role": "user", "content": line},
                {"role": "assistant", "content": reply},
            ]
            previous = state
    print("calls:", calls)


if __name__ == "__main__":
    main()
