"""Disposable CS72 UI probe: real routes/judge, fixture persona, no paid calls.

The new judge is explicitly selected only in a fresh temporary probe catalog.
This is not the production opt-in implementation owned by CS56/76.
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path

import uvicorn
from sqlalchemy import select
from sqlalchemy.orm import Session


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.2")
    parser.add_argument("--calls-file", required=True)
    args = parser.parse_args()
    probe_db = Path(os.environ["DIALOGIQ_DB_PATH"]).resolve()
    if not probe_db.is_relative_to(Path(tempfile.gettempdir()).resolve()):
        raise SystemExit(
            "Probe requires a disposable database under the temp directory."
        )
    if probe_db.exists():
        raise SystemExit("Refusing to modify an existing database.")
    for key in ("META_MODEL_API_KEY", "BASETEN_API_KEY"):
        os.environ.pop(key, None)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from database import engine
    from judge import BOB_FEEDBACK_REVISION
    from main import create_app
    from migrations import initialize_database
    from models import Scenario

    initialize_database(engine)
    with Session(engine) as db:
        bob = db.scalar(
            select(Scenario).where(Scenario.title == "Bob: Defensive Team Member")
        )
        if bob is None:
            raise SystemExit("Probe Bob scenario missing.")
        suffix = bob.config_revision.split(":", 1)[1]
        bob.config_revision = f"{BOB_FEEDBACK_REVISION}:{suffix}"
        db.commit()
    calls = Path(args.calls_file)

    def persona_reply(**_kwargs: object) -> str:
        with calls.open("a", encoding="utf-8") as stream:
            stream.write("fixture\n")
        return "Stand-in reply: the changing deadlines have been difficult."

    print(f"Disposable probe judge: {BOB_FEEDBACK_REVISION}; providers disabled.")
    uvicorn.run(create_app(provider=persona_reply), host=args.host, port=8080)


if __name__ == "__main__":
    main()
