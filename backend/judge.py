"""Deterministic, deliberately lexical Sprint 2 judge; no model is involved."""

import copy
import re
import unicodedata

from schemas import State

RULESET_REVISION = "s2-r2.1"
OPEN_PREFIXES = (
    "what",
    "how",
    "why",
    "tell me",
    "help me",
    "walk me",
    "describe",
    "in what",
)
CLOSED_PREFIXES = (
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
LEADING_PHRASES = (
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
STEMS = {
    "n2": ("hard", "difficult", "challeng", "pressure", "tough", "struggl", "stress"),
    "n3": ("feel", "felt", "worr", "afraid", "scared"),
    "n4": ("impact", "affect", "cost", "consequence", "toll"),
    "n5": ("need", "matter", "important", "value", "fair"),
    "n6": ("support", "help", "change", "different", "option"),
    "n7": ("step", "plan", "agree", "try"),
}
EMPATHY = (
    "understand",
    "sounds like",
    "i hear",
    "feel",
    "frustrat",
    "appreciate",
    "makes sense",
    "tough",
    "hard",
)


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).lower()
    return " ".join(value.replace("’", "'").replace("‘", "'").split())


def classify(
    text: str, ruleset_revision: str = RULESET_REVISION
) -> tuple[str, bool, bool]:
    """Classify public user text, including contractions and acknowledgments."""
    value = normalize(text)
    if ruleset_revision not in {"s2-r2", "s2-r2.1"}:
        raise ValueError("Unsupported pinned scoring ruleset.")
    legacy = ruleset_revision == "s2-r2"
    sentences = []
    for segment in re.split(r"[.!?]+" if legacy else r"[.!?,;:]+", value):
        sentence = segment.lstrip(" \"'“”‘’")
        for filler in () if legacy else FILLERS:
            if re.match(re.escape(filler) + r"(?![a-z0-9])", sentence):
                sentence = sentence[len(filler) :].lstrip(" \"'“”‘’")
                break
        if sentence:
            sentences.append(sentence)

    def matches(prefixes: tuple[str, ...]) -> bool:
        return any(
            re.match(re.escape(prefix) + r"(?![a-z0-9])", sentence)
            for sentence in sentences
            for prefix in prefixes
        )

    question_type = (
        "open"
        if matches(OPEN_PREFIXES)
        else ("closed" if matches(CLOSED_PREFIXES) else "statement")
    )
    leading = any(
        re.search(r"(?<![a-z0-9'])" + re.escape(p) + r"(?![a-z0-9'])", value)
        for p in (LEADING_PHRASES[:7] if legacy else LEADING_PHRASES)
    )
    return question_type, any(marker in value for marker in EMPATHY), leading


def coach_public_text(text: str, ruleset_revision: str = RULESET_REVISION) -> dict:
    """Coach boundary accepts only public text, never needs or a private brief."""
    question_type, empathy, leading = classify(text, ruleset_revision)
    base = {
        "open": ("good", "Open invitation: leave room for their perspective."),
        "closed": ("warn", "Closed question detected. Try an open invitation."),
        "statement": (
            "tip",
            "Follow up with a question that invites their perspective.",
        ),
    }
    kind, message = base[question_type]
    whispers = [{"kind": kind, "text": message}]
    if empathy:
        whispers.append(
            {"kind": "good", "text": "You acknowledged emotion or difficulty."}
        )
    if leading:
        whispers.append(
            {
                "kind": "warn",
                "text": "Try a question without blame or an assumed answer.",
            }
        )
    alternatives = {
        "open": "What else would you like to share?",
        "closed": "What would you like me to understand?",
        "statement": "How has this been for you?",
    }
    return {
        "source": "deterministic",
        "question_type": question_type,
        "empathy": empathy,
        "leading": leading,
        "outcome": "deadend" if leading or question_type == "closed" else "neutral",
        "alternatives": [
            "How are you seeing this situation?"
            if leading
            else alternatives[question_type]
        ],
        "whispers": whispers,
    }


def evaluate(
    text: str,
    previous: dict,
    needs: list[dict],
    ruleset_revision: str = RULESET_REVISION,
) -> tuple[dict, dict, list[str]]:
    """Return a candidate State, public feedback and zero/one permitted title."""
    state = copy.deepcopy(previous or State().model_dump())
    coaching = coach_public_text(text, ruleset_revision)
    revealed = {need["id"] for need in state["revealed_needs"]}
    candidate = None
    if coaching["question_type"] == "open" and not coaching["leading"]:
        if "n1" not in revealed:
            candidate = "n1"
        else:
            tokens = re.findall(r"[a-z]+", normalize(text))
            rules = (
                STEMS
                if ruleset_revision == RULESET_REVISION
                else {
                    **STEMS,
                    "n7": ("next", "step", "plan", "agree", "try", "first"),
                }
            )
            candidate = next(
                (
                    need
                    for need, stems in rules.items()
                    if need not in revealed
                    and any(
                        token.startswith(stem) for token in tokens for stem in stems
                    )
                ),
                None,
            )
    newly_revealed = []
    if candidate:
        fact = next(need for need in needs if need["id"] == candidate)
        state["revealed_needs"].append(copy.deepcopy(fact))
        state["revealed_needs"].sort(key=lambda need: need["id"])
        newly_revealed = [fact["title"]]
        coaching["outcome"] = "breakthrough"
    state["score"] = len(state["revealed_needs"])
    state["resistance"] = (
        "guarded"
        if state["score"] < 3
        else ("warming" if state["score"] < 6 else "open")
    )
    metrics = state["metrics"]
    metrics["turns"] += 1
    metrics["open_questions"] += int(coaching["question_type"] == "open")
    metrics["closed_questions"] += int(coaching["question_type"] == "closed")
    metrics["empathy_turns"] += int(coaching["empathy"])
    questions = metrics["open_questions"] + metrics["closed_questions"]
    metrics["open_question_ratio"] = (
        metrics["open_questions"] / questions if questions else 0.0
    )
    return state, coaching, newly_revealed
