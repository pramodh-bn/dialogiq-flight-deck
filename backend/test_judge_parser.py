"""CS-71: dash clauses work without changing pinned historical scoring."""

import pytest

from judge import RULESET_REVISION, classify, evaluate
from schemas import State

BOB_EXAMPLES = [
    (
        "Got it you sent the status doc last night - "
        "how do you see the Q3 timeline right now?"
    ),
    (
        "Makes sense you're trying to keep it moving with the redesigns pushing "
        "things — what is making that hardest right now?"
    ),
    (
        "That overlap sounds tough with redoing work while the deadlines didn't "
        "shift — what would help with the logistics on your end?"
    ),
]


@pytest.fixture
def facts() -> list[dict[str, str]]:
    return [
        {"id": f"n{number}", "title": f"Need {number}", "description": "Test fact"}
        for number in range(1, 8)
    ]


def test_new_fresh_catalog_default_has_its_own_revision() -> None:
    assert RULESET_REVISION == "s2-r2.2"


@pytest.mark.parametrize("message", BOB_EXAMPLES)
def test_actual_bob_acknowledgment_questions_are_open(message: str) -> None:
    assert classify(message)[0] == "open"


@pytest.mark.parametrize("separator", [" - ", " -- ", " — ", "—", " – ", "–"])
def test_open_question_after_dash_clause(separator: str) -> None:
    assert classify(f"I hear you{separator}what has been difficult?")[0] == "open"


@pytest.mark.parametrize(
    "message",
    [
        "The what-if analysis is ready.",
        "I wrote a how-to guide.",
        "The follow-up note is ready.",
        "I hear you-what has been difficult?",
    ],
)
def test_unspaced_ascii_compounds_do_not_create_question_segments(
    message: str,
) -> None:
    assert classify(message)[0] == "statement"


@pytest.mark.parametrize("revision", ["s2-r2", "s2-r2.1"])
@pytest.mark.parametrize("message", BOB_EXAMPLES)
def test_pinned_legacy_dash_classification_is_preserved(
    revision: str, message: str
) -> None:
    assert classify(message, revision)[0] == "statement"


@pytest.mark.parametrize(
    "message",
    [
        "You should stop complaining — what would help?",
        "It is your fault - how is the pressure affecting you?",
        "You never listen–what has been difficult?",
    ],
)
def test_dash_question_does_not_bypass_whole_turn_leading_filter(
    message: str, facts: list[dict[str, str]]
) -> None:
    state, coaching, newly_revealed = evaluate(message, State().model_dump(), facts)
    assert coaching["question_type"] == "open"
    assert coaching["leading"] is True
    assert newly_revealed == []
    assert state["score"] == 0


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Thanks for explaining — could we look at it?", "closed"),
        ("Could we pause — what would work better?", "open"),
    ],
)
def test_question_precedence_is_retained(message: str, expected: str) -> None:
    assert classify(message)[0] == expected


@pytest.mark.parametrize(
    ("revision", "expected_score"),
    [("s2-r2", 2), ("s2-r2.1", 1), ("s2-r2.2", 1)],
)
@pytest.mark.parametrize("word", ["next", "first"])
def test_default_revision_bump_does_not_change_legacy_reveal_stems(
    revision: str,
    expected_score: int,
    word: str,
    facts: list[dict[str, str]],
) -> None:
    prior = State(score=1, revealed_needs=[facts[0]]).model_dump()
    state, _, _ = evaluate(f"What happens {word}?", prior, facts, revision)
    assert state["score"] == expected_score
    assert prior["score"] == 1
