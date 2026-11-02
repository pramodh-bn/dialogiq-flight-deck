"""Start the real API with a slow stand-in for the Meta coach provider.

For waits past the 30s leases over real HTTP without paid or unpredictable
provider calls. Only MetaCoachClient.respond is replaced; the routes, service,
leases and persona stay real. Each call appends one line to --calls-file.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import uvicorn
from probe_persona_live import ENV_KEYS, parse_env_file
from run_backend import COACH_DEMO_ENV_KEYS, META_ENV_KEYS


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--delay", type=float, required=True)
    parser.add_argument("--calls-file", required=True)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    values = parse_env_file(Path(args.env_file))
    for key in ENV_KEYS + META_ENV_KEYS + COACH_DEMO_ENV_KEYS:
        if key in values:
            os.environ.setdefault(key, values[key])
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

    import coach

    calls = Path(args.calls_file)

    def slow_respond(self, **_kwargs):  # type: ignore[no-untyped-def]
        with calls.open("a", encoding="utf-8") as log:
            log.write("call\n")
        number = len(calls.read_text(encoding="utf-8").splitlines())
        time.sleep(args.delay)
        content = {
            "approach": f"Stub approach {number}.",
            "example": "This line comes from the slow stand-in provider.",
            "reason": "It proves a long wait, and says nothing about hint quality.",
        }
        return coach.CoachCompletion(content=json.dumps(content), finish_reason="stop")

    coach.MetaCoachClient.respond = slow_respond  # type: ignore[method-assign]
    uvicorn.run("main:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
