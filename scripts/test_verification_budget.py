"""Zero-network checks of the verification hard stop, including concurrent hints."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock

import pytest
from run_bounded_verification_backend import CallBudget, bounded, required_cap


def test_concurrent_attempts_cannot_exceed_caps(tmp_path: Path) -> None:
    path = tmp_path / "budget.jsonl"
    budget = CallBudget({"coach": 7, "persona": 2}, path)
    original = Mock(return_value="reply")
    limited = bounded(original, budget, "coach", RuntimeError)

    def attempt(_: int) -> bool:
        try:
            return limited() == "reply"
        except RuntimeError:
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        assert sum(pool.map(attempt, range(50))) == 7
    assert original.call_count == 7
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(rows) == 51
    assert rows[-1]["attempts_admitted"] == {"coach": 7, "persona": 0}
    assert rows[-1]["attempts_blocked"]["coach"] == 43


def test_zero_budget_blocks_before_provider_and_failures_count(tmp_path: Path) -> None:
    budget = CallBudget({"coach": 0, "persona": 1}, tmp_path / "budget.jsonl")
    original = Mock(side_effect=ValueError("provider failure"))
    coach = bounded(original, budget, "coach", RuntimeError)
    persona = bounded(original, budget, "persona", RuntimeError)
    with pytest.raises(RuntimeError, match="attempt cap reached"):
        coach()
    original.assert_not_called()
    with pytest.raises(ValueError, match="provider failure"):
        persona()
    with pytest.raises(RuntimeError, match="attempt cap reached"):
        persona()
    assert original.call_count == 1


def test_budget_requires_new_evidence_file(tmp_path: Path) -> None:
    path = tmp_path / "budget.jsonl"
    CallBudget({"coach": 1}, path)
    with pytest.raises(FileExistsError):
        CallBudget({"coach": 1}, path)


@pytest.mark.parametrize("value", [None, "", "-1", "1.5", "unbounded"])
def test_invalid_or_missing_cap_is_rejected(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    if value is None:
        monkeypatch.delenv("VERIFY_MAX_COACH_CALLS", raising=False)
    else:
        monkeypatch.setenv("VERIFY_MAX_COACH_CALLS", value)
    with pytest.raises(ValueError, match="VERIFY_MAX_COACH_CALLS"):
        required_cap("VERIFY_MAX_COACH_CALLS")
