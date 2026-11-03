"""CS72: versioned public feedback, not a measurement of psychological empathy."""

import pytest

from judge import RULESET_REVISION, classify, coach_public_text, evaluate
from schemas import State

BOB_REVISION = "s2-r2.3-bob"
REPRODUCTION = "but it is you who is slow, everyone is working extra hard"


@pytest.mark.parametrize("revision", ["s2-r2", "s2-r2.1", "s2-r2.2"])
def test_historical_false_positive_is_not_silently_rescored(revision: str) -> None:
    assert classify(REPRODUCTION, revision) == ("statement", True, False)
    assert RULESET_REVISION == "s2-r2.2"


@pytest.mark.parametrize(
    "message",
    [
        REPRODUCTION,
        "Everyone else stayed late. It is you who is slow.",  # CS74 B09
        "I understand, but you are lazy.",
        "That sounds hard, but it's your fault.",
        "I hear you. You never listen.",
    ],
)
def test_blame_is_not_praised_as_empathy(message: str) -> None:
    feedback = coach_public_text(message, BOB_REVISION)
    assert feedback["leading"] is True
    assert feedback["empathy"] is False
    assert not any(
        item["text"] == "You acknowledged emotion or difficulty."
        for item in feedback["whispers"]
    )


@pytest.mark.parametrize(
    "message",
    [
        "It sounds like a hard week.",
        "I hear how tough the overlap has been for you.",
        "I understand that the changing deadlines have been difficult.",
        "That makes sense with the extra redesigns.",
        "I know the redesigns landed on you with no warning.",  # CS74 B12
    ],
)
def test_specific_supportive_acknowledgment_is_preserved(message: str) -> None:
    _, empathy, leading = classify(message, BOB_REVISION)
    assert empathy is True
    assert leading is False


@pytest.mark.parametrize(
    "message",
    [
        "Everyone is working hard.",
        "The hard deadline is Thursday.",
        "I understand the build system.",
        "You need to understand how hard this is for everyone else.",
    ],
)
def test_difficulty_words_alone_do_not_earn_empathy(message: str) -> None:
    assert classify(message, BOB_REVISION)[1] is False


def test_withdrawn_quoted_blame_is_not_fresh_pressure() -> None:
    message = "I shouldn't have said 'you never listen'. That was unfair."
    assert classify(message, BOB_REVISION)[2] is False


def test_withdrawal_does_not_hide_fresh_blame() -> None:
    message = "I take back 'you never listen', but you are lazy."
    assert classify(message, BOB_REVISION)[1:] == (False, True)


def test_new_revision_keeps_question_segmentation_and_reveal_limits() -> None:
    facts = [
        {"id": f"n{i}", "title": f"Need {i}", "description": "Test fact"}
        for i in range(1, 8)
    ]
    before = State().model_dump()
    state, feedback, newly = evaluate(
        "I hear you - what has been difficult?", before, facts, BOB_REVISION
    )
    assert feedback["question_type"] == "open"
    assert state["score"] == 1
    assert newly == ["Need 1"]
    assert before == State().model_dump()


def test_pressure_blocks_reveal_and_empathy_metric() -> None:
    facts = [
        {"id": f"n{i}", "title": f"Need {i}", "description": "Test fact"}
        for i in range(1, 8)
    ]
    state, feedback, newly = evaluate(
        f"{REPRODUCTION} - what would help?", State().model_dump(), facts, BOB_REVISION
    )
    assert feedback["question_type"] == "open"
    assert state["metrics"]["empathy_turns"] == 0
    assert state["score"] == 0
    assert newly == []
