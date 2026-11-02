"""Start the real API; optional env data is read without printing credentials."""

import argparse
import os
import sys
from pathlib import Path

import uvicorn
from probe_persona_live import ENV_KEYS, parse_env_file

META_ENV_KEYS = ("META_MODEL_API_KEY", "META_MODEL_API_BASE", "META_MODEL_API_MODEL")
COACH_DEMO_ENV_KEYS = ("COACH_DEMO_WAIT",)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.env_file:
        values = parse_env_file(Path(args.env_file))
        for key in ENV_KEYS + META_ENV_KEYS + COACH_DEMO_ENV_KEYS:
            if key in values:
                os.environ.setdefault(key, values[key])
    sys.path.insert(0, str(root / "backend"))
    uvicorn.run("main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
