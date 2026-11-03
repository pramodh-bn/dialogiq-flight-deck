"""Start the real API with a stand-in persona that counts its calls.

For fault runs that must prove one logical action made one model call, without paid calls.
Only BasetenPersonaClient.respond is replaced; routes, judge, storage and idempotent replay
stay real. No environment file is read, so the coach is unconfigured and saves its
deterministic fallback. Each persona call appends one line to --calls-file.
"""

import argparse
import sys
from pathlib import Path

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calls-file", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

    import persona

    calls = Path(args.calls_file)

    def counted_respond(self: object, **_kwargs: object) -> str:
        with calls.open("a", encoding="utf-8") as log:
            log.write("call\n")
        number = len(calls.read_text(encoding="utf-8").splitlines())
        return f"Stand-in reply {number}."

    persona.BasetenPersonaClient.respond = counted_respond  # type: ignore[method-assign]
    uvicorn.run("main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
