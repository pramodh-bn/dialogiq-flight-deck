"""Scorecard ruleset v3-score-r1 against the fixtures authored before the code."""

import copy
import json
from pathlib import Path

import pytest

import v3_score

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[1] / "docs/v3/score-fixtures.json").read_text(
        encoding="utf-8"
    )
)


def test_fixture_file_names_this_ruleset():
    assert FIXTURES["ruleset"] == v3_score.RULESET == "v3-score-r1"


@pytest.mark.parametrize("case", FIXTURES["utterances"], ids=lambda case: case["id"])
def test_utterance_classification(case):
    result = v3_score.classify_spoken(case["text"])
    assert {"type": result["type"], "meaning": result["meaning"]} == case["rule"]


@pytest.mark.parametrize("case", FIXTURES["timelines"], ids=lambda case: case["id"])
def test_timeline_scorecard(case):
    scorecard = v3_score.score_rep(
        events=case["events"],
        turns=case["turns"],
        rewinds=case["rewinds"],
        duration_ms=case["duration_ms"],
    )
    assert scorecard == case["expected"]


def test_scoring_is_repeatable_and_ignores_event_order():
    case = FIXTURES["timelines"][2]
    kwargs = {
        "turns": case["turns"],
        "rewinds": case["rewinds"],
        "duration_ms": case["duration_ms"],
    }
    snapshot = copy.deepcopy(case["events"])
    first = v3_score.score_rep(events=case["events"], **kwargs)
    shuffled = v3_score.score_rep(events=list(reversed(case["events"])), **kwargs)
    assert first == shuffled == case["expected"]
    assert case["events"] == snapshot  # inputs are not mutated


def test_hesitation_sounds_and_stacked_fillers_do_not_hide_a_question():
    for text in (
        "um what do you need",
        "okay so um what do you need",
        "well, uh, okay what do you need",
    ):
        assert v3_score.classify_spoken(text)["type"] == "open", text
    # "umbrella" and "her" are words, not hesitation sounds.
    assert v3_score.spoken_text("Um, her umbrella uh broke") == "her umbrella broke"


def test_leading_question_is_never_a_meaning_question():
    result = v3_score.classify_spoken("why didn't you tell me it was hard for you")
    assert result == {
        "type": "open",
        "leading": True,
        "meaning": False,
        "ruleset": "v3-score-r1/s2-r2.3-bob",
    }


def test_duplicate_and_stray_events_are_tolerated():
    events = [
        {"seq": 1, "t_ms": 100, "kind": "learner_speech_end"},
        {"seq": 2, "t_ms": 200, "kind": "learner_speech_start"},
        {"seq": 3, "t_ms": 300, "kind": "learner_speech_start"},
        {"seq": 4, "t_ms": 700, "kind": "learner_speech_end"},
        {"seq": 5, "t_ms": 800, "kind": "bob_audio_end", "node_id": 9},
        {"seq": 6, "t_ms": 900, "kind": "whisper_shown", "rule": "x", "trigger_ms": 1},
    ]
    scorecard = v3_score.score_rep(
        events=events, turns=[], rewinds=[], duration_ms=1000
    )
    assert scorecard["talk"] == {"learner_ms": 500, "bob_ms": 0, "learner_ratio": 1.0}


def test_deflection_without_bob_audio_is_not_counted():
    turns = [
        {
            "node_id": 1,
            "text": "is it late",
            "revealed_new": False,
            "stance_after": "guarded",
        }
    ]
    scorecard = v3_score.score_rep(events=[], turns=turns, rewinds=[], duration_ms=1000)
    assert scorecard["pause_after_deflection"] == {
        "deflections": 0,
        "waited": 0,
        "median_gap_ms": None,
    }
    assert scorecard["questions"]["closed"] == 1
