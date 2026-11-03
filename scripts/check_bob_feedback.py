"""Grade public empathy praise on reviewer-authored contrasts, with no model calls."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from judge import BOB_FEEDBACK_REVISION, classify


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8-sig"))
    rows = []
    for group in cases["groups"]:
        for case in group["lines"]:
            old = classify(case["learner"], "s2-r2.2")
            new = classify(case["learner"], BOB_FEEDBACK_REVISION)
            old_praise = old[1]  # Current UI renders the empathy whisper independently.
            new_praise = new[1]
            expected = case["praise"]
            met = expected == "either" or new_praise == (expected == "yes")
            rows.append(
                {
                    "id": case["id"],
                    "expected": expected,
                    "legacy_praise": old_praise,
                    "candidate_praise": new_praise,
                    "candidate_leading": new[2],
                    "met": met,
                    "worsened": expected == "yes" and old_praise and not new_praise,
                }
            )
    report = {"ruleset": BOB_FEEDBACK_REVISION, "rows": rows}
    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"cases": len(rows), "met": sum(r["met"] for r in rows)}))
    print("failed:", ",".join(r["id"] for r in rows if not r["met"]))
    print("worsened:", ",".join(r["id"] for r in rows if r["worsened"]))


if __name__ == "__main__":
    main()
