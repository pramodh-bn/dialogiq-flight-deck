"""No-network tests for scripts/probe_coach_live.py (CS-62).

Covers per-call evidence capture when a provider call fails outside the
typed CoachError paths, and the --timeout selector for no-cutoff
demo-wait measurement runs. Stub clients and dry runs only: these tests
never touch the network and never spend Meta credit.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT / "backend"))

import probe_coach_live

from coach import CoachCompletion

VALID_HINT = (
    '{"approach": "Ask what part feels worst", '
    '"example": "What part of tonight feels the worst?", '
    '"reason": "It names one concrete next question."}'
)


class _ExplodingClient:
    """Stub whose respond fails outside every typed CoachError path."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    def respond(self, **kwargs):  # type: ignore[no-untyped-def]
        raise self._error


class _RecordingClient:
    """Stub serving one canned completion while recording the call."""

    def __init__(self, completion: CoachCompletion) -> None:
        self._completion = completion
        self.calls: list[dict] = []

    def respond(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        return self._completion


def test_run_once_records_unexpected_error_without_raising() -> None:
    record = probe_coach_live.run_once(
        _ExplodingClient(ValueError("boom")),
        "system",
        "{}",
        2048,
    )
    assert record["parse_ok"] is False
    assert record["content"] is None
    assert record["finish_reason"] is None
    assert record["completion_tokens"] is None
    assert record["reasoning_tokens"] is None
    assert record["error"] == "ValueError: boom"
    assert record["elapsed_s"] >= 0


def test_run_once_passes_none_timeout_explicitly() -> None:
    client = _RecordingClient(
        CoachCompletion(
            content=VALID_HINT,
            finish_reason="stop",
            completion_tokens=1730,
            reasoning_tokens=1597,
        )
    )
    record = probe_coach_live.run_once(client, "system", "{}", 2048, timeout=None)
    assert record["parse_ok"] is True
    assert record["finish_reason"] == "stop"
    assert len(client.calls) == 1
    assert "timeout" in client.calls[0]
    assert client.calls[0]["timeout"] is None


def test_main_default_timeout_stays_eight_seconds(capsys) -> None:  # type: ignore[no-untyped-def]
    assert probe_coach_live.main([]) == 0
    assert "timeout=8s" in capsys.readouterr().out


def test_main_timeout_none_dry_run(capsys) -> None:  # type: ignore[no-untyped-def]
    assert probe_coach_live.main(["--timeout", "none"]) == 0
    assert "timeout=none" in capsys.readouterr().out


def test_main_rejects_unparsable_timeout() -> None:
    try:
        probe_coach_live.main(["--timeout", "soon"])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("expected SystemExit(2) for --timeout soon")
