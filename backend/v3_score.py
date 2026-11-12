"""Deterministic V3 voice-rep scorecard, ruleset ``v3-score-r1`` (no model).

A pure function of a rep's timing events and turns, as defined in
``docs/v3/voice-rep-contract.md``. Nothing here reads a database, a clock or a
provider, so a stored rep can always be rescored and gives the same result.
"""

from __future__ import annotations

import re
from typing import Any

from judge import (
    BOB_FEEDBACK_REVISION,
    CLOSED_PREFIXES,
    FILLERS,
    OPEN_PREFIXES,
    _bob_feedback_flags,
    normalize,
)

RULESET = "v3-score-r1"
WAIT_MS = 2000
INTERRUPTION_OVERLAP_MS = 500
STANCE_RANK = {"guarded": 0, "warming": 1, "open": 2}

# Sounds speech recognition writes down that carry no words.
_DISFLUENCY = re.compile(r"(?<![a-z0-9'])(?:um+|uh+|erm+|er|hm+|mm+)(?![a-z0-9'])")
_CLAUSE_BREAK = re.compile(r"[.!?,;:–—]+|(?<=\s)--?(?=\s)")
_WORD = re.compile(r"[a-z]+")
MEANING_STEMS = (
    "hard",
    "difficult",
    "challeng",
    "struggl",
    "tough",
    "feel",
    "felt",
    "worr",
    "impact",
    "affect",
    "matter",
    "important",
    "need",
    "support",
    "help",
)
MEANING_PHRASES = ("for you", "to you", "from your side", "on your side")


def spoken_text(text: str) -> str:
    """Normalize a transcript and remove written-down hesitation sounds."""
    value = " ".join(_DISFLUENCY.sub(" ", normalize(text)).split())
    # A removed sound leaves its comma behind: ", her" or "well, , okay".
    value = re.sub(r"\s+([,;:])", r"\1", value)
    value = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", value)
    return value.lstrip(",;: ")


def _clauses(value: str) -> list[str]:
    """Split into clauses and strip every leading filler word from each."""
    clauses = []
    for segment in _CLAUSE_BREAK.split(value):
        clause = segment.strip(" \"'“”‘’")
        stripped = True
        while stripped:
            stripped = False
            for filler in FILLERS:
                if re.match(re.escape(filler) + r"(?![a-z0-9'])", clause):
                    clause = clause[len(filler) :].lstrip(" \"'")
                    stripped = True
                    break
        if clause:
            clauses.append(clause)
    return clauses


def classify_spoken(text: str) -> dict[str, Any]:
    """Classify one spoken learner turn: type, leading, and meaning question.

    The opening words of each clause decide the type, as in the Sprint 2
    judge, so no question mark is needed. Unlike the judge, repeated fillers
    ("okay so um what...") are all removed first.
    """
    value = spoken_text(text)
    clauses = _clauses(value)

    def starts_with(prefixes: tuple[str, ...]) -> bool:
        return any(
            re.match(re.escape(prefix) + r"(?![a-z0-9])", clause)
            for clause in clauses
            for prefix in prefixes
        )

    if starts_with(OPEN_PREFIXES):
        question_type = "open"
    elif starts_with(CLOSED_PREFIXES):
        question_type = "closed"
    else:
        question_type = "statement"
    _acknowledgment, leading = _bob_feedback_flags(value)
    about_them = any(
        word.startswith(stem) for word in _WORD.findall(value) for stem in MEANING_STEMS
    ) or any(
        re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", value)
        for phrase in MEANING_PHRASES
    )
    return {
        "type": question_type,
        "leading": leading,
        "meaning": question_type == "open" and not leading and about_them,
        "ruleset": f"{RULESET}/{BOB_FEEDBACK_REVISION}",
    }


def _segments(
    events: list[dict], duration_ms: int
) -> tuple[list[tuple[int, int]], list[tuple[int, int, Any]]]:
    """Pair start and end events into learner and Bob (start, end[, node]) spans."""
    ordered = sorted(events, key=lambda e: (e["t_ms"], e.get("seq", 0)))
    learner: list[tuple[int, int]] = []
    bob: list[tuple[int, int, Any]] = []
    learner_open: int | None = None
    bob_open: dict[Any, int] = {}
    for event in ordered:
        kind, at = event["kind"], event["t_ms"]
        if kind == "learner_speech_start" and learner_open is None:
            learner_open = at
        elif kind == "learner_speech_end" and learner_open is not None:
            learner.append((learner_open, max(at, learner_open)))
            learner_open = None
        elif kind == "bob_audio_start":
            bob_open.setdefault(event.get("node_id"), at)
        elif kind == "bob_audio_end" and event.get("node_id") in bob_open:
            start = bob_open.pop(event.get("node_id"))
            bob.append((start, max(at, start), event.get("node_id")))
    if learner_open is not None:
        learner.append((learner_open, max(duration_ms, learner_open)))
    bob.extend(
        (start, max(duration_ms, start), node) for node, start in bob_open.items()
    )
    return learner, sorted(bob)


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle] + 1) // 2  # round half up


def score_rep(
    *,
    events: list[dict],
    turns: list[dict],
    rewinds: list[dict],
    duration_ms: int,
) -> dict:
    """Return the scorecard for one rep.

    ``turns`` items: ``node_id``, ``text``, ``revealed_new``, ``stance_after``
    and optional ``selected`` (false for a turn off the selected branch).
    ``rewinds`` items: ``original_node_id`` and ``retry_node_id``.
    """
    learner, bob = _segments(events, duration_ms)
    learner_ms = sum(end - start for start, end in learner)
    bob_ms = sum(end - start for start, end, _node in bob)
    total = learner_ms + bob_ms

    selected = [turn for turn in turns if turn.get("selected", True)]
    counts = {"closed": 0, "open": 0, "meaning": 0, "statements": 0}
    for turn in selected:
        result = classify_spoken(turn["text"])
        key = "statements" if result["type"] == "statement" else result["type"]
        counts[key] += 1
        counts["meaning"] += int(result["meaning"])

    audio: dict[Any, tuple[int, int]] = {}
    for start, end, node in bob:
        first, last = audio.get(node, (start, end))
        audio[node] = (min(first, start), max(last, end))
    starts = sorted(start for start, _end in learner)
    gaps = []
    for turn in selected:
        deflected = not turn["revealed_new"] and turn["stance_after"] == "guarded"
        if not deflected or turn["node_id"] not in audio:
            continue
        audio_start, audio_end = audio[turn["node_id"]]
        following = next((s for s in starts if s >= audio_start), None)
        if following is not None:
            gaps.append(max(0, following - audio_end))

    interruptions = sum(
        1
        for start, end in learner
        if any(
            bob_start < start < bob_end
            and min(end, bob_end) - start >= INTERRUPTION_OVERLAP_MS
            for bob_start, bob_end, _node in bob
        )
    )

    by_id = {turn["node_id"]: turn for turn in turns}
    recovered = 0
    for pair in rewinds:
        original = by_id[pair["original_node_id"]]
        retry = by_id[pair["retry_node_id"]]
        gained_need = retry["revealed_new"] and not original["revealed_new"]
        warmer = (
            STANCE_RANK[retry["stance_after"]] > STANCE_RANK[original["stance_after"]]
        )
        recovered += int(gained_need or warmer)

    return {
        "ruleset": RULESET,
        "talk": {
            "learner_ms": learner_ms,
            "bob_ms": bob_ms,
            "learner_ratio": round(learner_ms / total, 2) if total else None,
        },
        "questions": counts,
        "pause_after_deflection": {
            "deflections": len(gaps),
            "waited": sum(1 for gap in gaps if gap >= WAIT_MS),
            "median_gap_ms": _median(gaps),
        },
        "interruptions": interruptions,
        "rewind_recovery": {"rewinds": len(rewinds), "recovered": recovered},
    }
