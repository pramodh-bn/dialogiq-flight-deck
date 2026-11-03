"""Bob's simulated stance for behavior revision s4-bob-r1 (CS-76), separate from score.

A deliberately small lexical heuristic over the learner's public wording only. It never
reads needs, stems, scores or reveals and makes no model call. The contract's
precedence table decides the signal; a bounded ledger in each node's stored state
decides the stance. Nothing here measures trust or proves a promise was kept.
"""

import re

from judge import BOB_FEEDBACK_REVISION, classify, normalize

BEHAVIOR_REVISION = "s4-bob-r1"
LEDGER_KEY = "stance_ledger"
POSITIVE = ("repair", "clarity", "support", "acknowledgment")

EXPLANATIONS = {
    "initial": "This is Bob's simulated starting stance, not a measure of trust.",
    "clarity": "Your wording offered a concrete clarification.",
    "support": "Your wording offered practical support.",
    "acknowledgment": "Your wording acknowledged a specific concern.",
    "repair": "Your wording took responsibility or withdrew a comparison.",
    "pressure": "Your wording included pressure or blame.",
    "boundary": "Your wording respected a request for space.",
    "none": "No clear stance signal was recognized in this wording.",
}

# Finite expression lists, published per the contract. Each phrase is matched on
# normalized text at word boundaries; affirmative forms only, so "I can't help" or
# "I'm not going to arrange" match nothing.
COMPARISON_OR_BLAME = (
    "everyone else",
    "everybody else",
    "everyone here",
    "everybody here",
    "the others",
    "the rest of the team",
    "the rest of us",
    "we're all",
    "we are all",
    "we've all",
    "still hit their",
    "keep up with",
    "you're the reason",
    "you are the reason",
    "your fault",
    "your problem",
    "because you didn't",
    "because you did not",
    "you make everything",
    "you always",
    "you never",
    "you're slow",
    "you are slow",
    "who is slow",
    "excuses",
    "all this fuss",
    "isn't hard",
    "isn't that hard",
    "not that hard",
    "just finish it",
    "poor you",
    "must be nice",
    "had it that tough",
    "had it that hard",
    "sorry you feel",
    "if that upset you",
)
# A comparison the learner is quoting in order to withdraw it is not fresh blame.
WITHDRAWN = re.compile(
    r"\b(?:said|saying|called you|comparing you with|compared you)\b[^.,;!?]*"
)
PRESSURE = (
    "tell me what's really",
    "tell me what is really",
    "i'm not leaving until",
    "i am not leaving until",
    "you need to tell me",
    "you have to tell me",
    "just answer",
    "but first tell me",
    "first tell me why",
)
REPAIR = (
    "i take it back",
    "i take that back",
    "that was unfair",
    "that wasn't fair of me",
    "i was wrong to",
    "i was wrong about",
    "that one's on me",
    "that's on me",
    "that is on me",
    "my mistake",
    "a mistake on my part",
    "i shouldn't have",
    "i should not have",
    "i apologize for",
    "i'm sorry i",
    "was out of line",
)
BOUNDARY = (
    "let's stop here",
    "we can stop",
    "let's leave it",
    "leave it for today",
    "pick it up later",
    "pick it up whenever",
    "come back to this",
    "another time",
    "whenever works for you",
    "when you're ready",
)
CLARITY = (
    "i'll check",
    "i will check",
    "let me check",
    "i'll find out",
    "i will find out",
    "i'll confirm",
    "i need to check",
    "write down what",
    "let's write down",
    "let's agree what",
    "what has to work",
    "counts as a pass",
    "i can commit to",
    "i can hold",
    "i'll decide",
    "i will decide",
    "comes first",
)
SUPPORT = (
    "i can sit with you",
    "i'll sit with you",
    "i can help you",
    "i'll help you",
    "i will help you",
    "i'll arrange",
    "i can arrange",
    "i'll set up",
    "i can set up",
    "i'll sort out",
    "i'll tell the team",
    "i'll talk to",
    "i will talk to",
    "i'll take that off",
    "i can get you",
    "i'll get you",
    "i'll make sure you",
)
FEELING = re.compile(
    r"\b(?:sounds?|sounded|must have been|must be|felt|feels|seems)\s+(?:really\s+|so\s+)?"
    r"(?:exhausting|hard|tough|difficult|frustrating|risky|draining|unfair|stressful|"
    r"miserable|awful|rough|lonely|discouraging)\b"
)
ACKNOWLEDGMENT = (
    "isn't easy",
    "is not easy",
    "nobody should have to",
    "no one should have to",
    "would wear anyone down",
    "matters to you",
    "you care about",
    "makes sense that you",
    "makes sense you",
    "i don't blame you for",
    "that's a lot to carry",
    "a lot to carry",
)
NEGATED = re.compile(r"\b(?:not|never|no)\b|n't\b")


def _has(value: str, phrases: tuple[str, ...]) -> bool:
    return any(
        re.search(rf"(?<![a-z']){re.escape(p)}(?![a-z'])", value) for p in phrases
    )


def signal_for(text: str) -> str:
    """Return the first applicable signal in the contract's precedence order."""
    value = normalize(text)
    _, empathy, leading = classify(text, BOB_FEEDBACK_REVISION)
    repaired = _has(value, REPAIR)
    fresh = WITHDRAWN.sub(" ", value)
    blamed = _has(fresh, COMPARISON_OR_BLAME) or (leading and not repaired)
    if _has(value, PRESSURE) or blamed:
        return "pressure"
    if repaired:
        return "repair"
    if _has(value, BOUNDARY) and "?" not in value:
        return "boundary"
    if _has(value, CLARITY):
        return "clarity"
    if _has(value, SUPPORT):
        return "support"
    if empathy or _has(value, ACKNOWLEDGMENT) or FEELING.search(value):
        return "acknowledgment"
    return "none"


def initial_ledger() -> dict:
    return {"balance": 0, "last_positive": None}


def stance_for(balance: int) -> str:
    return "open" if balance >= 2 else ("warming" if balance == 1 else "guarded")


def advance(ledger: dict, signal: str) -> dict:
    """Apply one turn: at most one step, bounded -2..2, per the contract's table."""
    balance, last = ledger["balance"], ledger["last_positive"]
    if signal == "pressure":
        return {"balance": max(balance - 1, -2), "last_positive": None}
    if signal not in POSITIVE or signal == last:
        return dict(ledger)
    ceiling = (
        1 if signal == "repair" else 2
    )  # Repair cannot reach open on its own turn.
    return {"balance": max(balance, min(balance + 1, ceiling)), "last_positive": signal}


def progress(ledger: dict, signal: str) -> dict:
    return {
        "behavior_revision": BEHAVIOR_REVISION,
        "stance": stance_for(ledger["balance"]),
        "last_signal": signal,
        "explanation": EXPLANATIONS[signal],
    }


def initial_state_fields() -> dict:
    """Stored fields for a new-Bob branch with no turns."""
    ledger = initial_ledger()
    return {
        "resistance": stance_for(0),
        "conversation_progress": progress(ledger, "initial"),
        LEDGER_KEY: ledger,
    }


def apply_turn(state: dict, previous: dict, text: str) -> dict:
    """Overwrite score-based resistance with the stance a new-Bob turn earns."""
    signal = signal_for(text)
    ledger = advance(previous.get(LEDGER_KEY) or initial_ledger(), signal)
    return {
        **state,
        "resistance": stance_for(ledger["balance"]),
        "conversation_progress": progress(ledger, signal),
        LEDGER_KEY: ledger,
    }
