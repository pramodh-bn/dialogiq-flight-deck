"""Interpret CS-36 draft rules against contract examples, not runtime code.

The stem table is read from the document. Regression fixtures are independent
examples with explicit expected classifications/reveals; this checker does not
certify an implemented judge, model, database or UI.
"""

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

OPEN = ("what", "how", "why", "tell me", "help me", "walk me", "describe", "in what")
CLOSED = (
    "do",
    "does",
    "did",
    "is",
    "are",
    "was",
    "were",
    "can",
    "could",
    "will",
    "would",
    "should",
    "have",
    "has",
    "had",
    "won't",
    "don't",
    "isn't",
    "aren't",
)
LEADING = (
    "don't you",
    "isn't it",
    "you should",
    "you must",
    "your fault",
    "just admit",
    "obviously",
    "why did you",
    "why didn't you",
    "why can't you",
    "why do you always",
    "how could you",
    "what were you thinking",
    "what's wrong with you",
    "you always",
    "you never",
)
FILLERS = (
    "so",
    "and",
    "but",
    "okay",
    "ok",
    "well",
    "um",
    "uh",
    "hey",
    "then",
    "alright",
    "right",
    "now",
)


@dataclass(frozen=True)
class Decision:
    """One reference decision before any provider/persistence operation."""

    question_type: str
    leading: bool
    new_need: str | None
    outcome: str


def normalize(text: str) -> str:
    """Apply the contract's text normalization only for judging."""
    value = unicodedata.normalize("NFKC", text).lower()
    value = value.replace("’", "'").replace("‘", "'")
    return " ".join(value.split())


def starts_with(sentence: str, prefixes: tuple[str, ...]) -> bool:
    """Allow contractions without matching prefixes inside longer words."""
    return any(re.match(re.escape(p) + r"(?![a-z0-9])", sentence) for p in prefixes)


def decide(text: str, revealed: set[str], stems: dict[str, list[str]]) -> Decision:
    """Apply the document's rules independently of the future backend judge."""
    value = normalize(text)
    sentences = []
    for segment in re.split(r"[.!?,;:]+", value):
        sentence = segment.lstrip(" \"'“”‘’")
        for filler in FILLERS:
            if re.match(re.escape(filler) + r"(?![a-z0-9])", sentence):
                sentence = sentence[len(filler) :].lstrip(" \"'“”‘’")
                break
        if sentence:
            sentences.append(sentence)
    if any(starts_with(sentence, OPEN) for sentence in sentences):
        question_type = "open"
    elif any(starts_with(sentence, CLOSED) for sentence in sentences):
        question_type = "closed"
    else:
        question_type = "statement"
    leading = any(
        re.search(r"(?<![a-z0-9'])" + re.escape(p) + r"(?![a-z0-9'])", value)
        for p in LEADING
    )
    new_need = None
    if question_type == "open" and not leading:
        if "n1" not in revealed:
            new_need = "n1"
        else:
            tokens = re.findall(r"[a-z]+", value)
            new_need = next(
                (
                    need
                    for need, cues in stems.items()
                    if need not in revealed
                    and any(token.startswith(cue) for token in tokens for cue in cues)
                ),
                None,
            )
    outcome = (
        "breakthrough"
        if new_need
        else ("deadend" if question_type == "closed" or leading else "neutral")
    )
    return Decision(question_type, leading, new_need, outcome)


def check() -> None:
    """Validate document JSON and all independently specified fixture turns."""
    root = Path(__file__).resolve().parents[1]
    document = (root / "docs/api_contract.md").read_text(encoding="utf-8")
    examples = [
        json.loads(s) for s in re.findall(r"```json\n(.*?)\n```", document, re.DOTALL)
    ]
    scenario = next(e for e in examples if isinstance(e, dict) and "persona" in e)
    assert isinstance(scenario["persona"]["tags"], list)
    reply = next(e for e in examples if isinstance(e, dict) and "turn_id" in e)
    assert reply["turn_id"] == reply["node"]["id"]
    assert reply["turn_id"] == reply["session"]["active_head_node_id"]
    assert reply["character_response"] == reply["node"]["character_text"]
    assert reply["revealed_node_score"] == reply["node"]["score"]
    assert reply["node"]["score"] == reply["session"]["score"]
    assert reply["node"]["metrics"] == reply["session"]["metrics"]
    assert reply["node"]["coaching"]["outcome"] == "breakthrough"
    assert reply["node"]["coaching"]["leading"] is False
    assert reply["node"]["coaching"]["alternatives"] == [
        "What else would you like to share?"
    ]
    table = document.split("| Need | Matching stems", 1)[1].split(
        "The seven fixed private seed needs", 1
    )[0]
    stems = {}
    for row in table.splitlines():
        match = re.match(r"\|\s*(n[2-7])\s*\|([^|]+)\|", row)
        if match:
            stems[match[1]] = re.findall(r"`([^`]+)`", match[2])
    assert list(stems) == [f"n{i}" for i in range(2, 8)]
    fixtures = json.loads(
        (root / "docs/cs36-judge-fixtures.json").read_text(encoding="utf-8")
    )
    natural_scores = {}
    turn_count = 0
    for case in fixtures["cases"]:
        revealed = set(case.get("initial_revealed", []))
        for index, turn in enumerate(case["turns"], start=1):
            result = decide(turn["text"], revealed, stems)
            label = f"{case['name']} turn {index}: {turn['text']}"
            assert result.question_type == turn["question_type"], (label, result)
            assert result.leading == turn["leading"], (label, result)
            assert result.new_need == turn["new_need"], (label, result)
            if result.new_need:
                revealed.add(result.new_need)
            assert len(revealed) <= 7
            turn_count += 1
        if case["name"].startswith("natural-"):
            natural_scores[case["scenario"]] = len(revealed)
    assert set(natural_scores) == {"Bob", "Daughter", "Priya", "Vendor"}
    print(
        json.dumps(
            {
                "json_examples": len(examples),
                "fixture_cases": len(fixtures["cases"]),
                "fixture_turns": turn_count,
                "natural_scores": natural_scores,
                "scope": "draft reference rules, not runtime or calibration",
            }
        )
    )


if __name__ == "__main__":
    check()
