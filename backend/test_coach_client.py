"""Mocked tests for the Meta coach client (CS-43).

No live calls: the OpenAI client is stubbed per test. Covers config
inertness, the request shape, whole-JSON validation, and the
finish/usage evidence carried on both paths (re-probe condition 2).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import coach
from coach import (
    CoachInvalidResponseError,
    CoachNotConfiguredError,
    MetaCoachClient,
    parse_coach_output,
)

VALID_HINT = (
    '{"approach": "Ask what part feels worst", '
    '"example": "What part of tonight feels the worst?", '
    '"reason": "It names one concrete next question."}'
)


class _FakeMessage:
    def __init__(self, content: str | None) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str | None, finish_reason: str | None) -> None:
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason


class _FakeDetails:
    def __init__(self, reasoning_tokens: int | None) -> None:
        self.reasoning_tokens = reasoning_tokens


class _FakeUsage:
    def __init__(
        self, completion_tokens: int | None, reasoning_tokens: int | None
    ) -> None:
        self.completion_tokens = completion_tokens
        self.completion_tokens_details = _FakeDetails(reasoning_tokens)


class _FakeCompletion:
    def __init__(
        self,
        content: str | None,
        finish_reason: str | None,
        completion_tokens: int | None = None,
        reasoning_tokens: int | None = None,
    ) -> None:
        self.choices = [_FakeChoice(content, finish_reason)]
        self.usage = _FakeUsage(completion_tokens, reasoning_tokens)


class _FakeCompletions:
    def __init__(self, result: _FakeCompletion) -> None:
        self._result = result
        self.calls: list[dict] = []

    def create(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        return self._result


class _FakeChat:
    def __init__(self, completions: _FakeCompletions) -> None:
        self.completions = completions


def _install_fake(monkeypatch, result):  # type: ignore[no-untyped-def]
    """Replace coach.OpenAI with a stub serving one canned completion."""
    completions = _FakeCompletions(result)

    class _FakeOpenAI:
        def __init__(self, base_url=None, api_key=None, max_retries=None):  # type: ignore[no-untyped-def]
            self.chat = _FakeChat(completions)

    monkeypatch.setattr(coach, "OpenAI", _FakeOpenAI)
    return completions


def _client() -> MetaCoachClient:
    return MetaCoachClient(
        base_url="https://meta.example/v1",
        model="muse-spark-1.3",
        api_key="test-key",
    )


def test_inert_without_key() -> None:
    client = MetaCoachClient(base_url="https://meta.example/v1", api_key="")
    assert not client.configured
    try:
        client.respond(system_prompt="s", context_json="{}")
    except CoachNotConfiguredError:
        pass
    else:
        raise AssertionError("expected CoachNotConfiguredError")


def test_plain_http_base_rejected() -> None:
    client = MetaCoachClient(base_url="http://meta.example/v1", api_key="test-key")
    assert not client.configured


def test_request_shape_single_nonstreaming_call(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    result = _FakeCompletion(VALID_HINT, "stop", 1730, 1597)
    completions = _install_fake(monkeypatch, result)
    completion = _client().respond(system_prompt="s", context_json="{}")
    assert completion.content == VALID_HINT
    assert len(completions.calls) == 1
    sent = completions.calls[0]
    assert sent["model"] == "muse-spark-1.3"
    assert sent["temperature"] == 0.3
    assert sent["max_tokens"] == 2048
    assert sent["timeout"] == 8.0
    assert sent["stream"] is False
    assert [m["role"] for m in sent["messages"]] == ["system", "user"]


def test_success_carries_finish_and_usage(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    result = _FakeCompletion(VALID_HINT, "stop", 1730, 1597)
    _install_fake(monkeypatch, result)
    completion = _client().respond(system_prompt="s", context_json="{}")
    assert completion.finish_reason == "stop"
    assert completion.completion_tokens == 1730
    assert completion.reasoning_tokens == 1597


def test_empty_content_error_carries_provider_evidence(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    result = _FakeCompletion(None, "length", 512, 510)
    _install_fake(monkeypatch, result)
    try:
        _client().respond(system_prompt="s", context_json="{}")
    except CoachInvalidResponseError as exc:
        assert exc.finish_reason == "length"
        assert exc.completion_tokens == 512
        assert exc.reasoning_tokens == 510
    else:
        raise AssertionError("expected CoachInvalidResponseError")


def test_parse_rejects_fenced_json() -> None:
    try:
        parse_coach_output("```json\n" + VALID_HINT + "\n```")
    except CoachInvalidResponseError:
        pass
    else:
        raise AssertionError("expected CoachInvalidResponseError")


class _EmptyCompletion:
    def __init__(self) -> None:
        self.choices: list = []
        self.usage = _FakeUsage(None, None)


def test_empty_choices_raise_typed_error(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _install_fake(monkeypatch, _EmptyCompletion())
    try:
        _client().respond(system_prompt="s", context_json="{}")
    except CoachInvalidResponseError as exc:
        assert exc.finish_reason is None
    else:
        raise AssertionError("expected CoachInvalidResponseError")


def test_blank_config_never_constructs_client(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    constructed: list = []

    class _RecordingOpenAI:
        def __init__(self, **kwargs):  # type: ignore[no-untyped-def]
            constructed.append(kwargs)

    monkeypatch.setattr(coach, "OpenAI", _RecordingOpenAI)
    blanked = [
        {"api_key": "   "},
        {"model": "  "},
        {"base_url": "  "},
    ]
    for override in blanked:
        kwargs = {
            "base_url": "https://meta.example/v1",
            "model": "muse-spark-1.3",
            "api_key": "test-key",
        }
        kwargs.update(override)
        client = MetaCoachClient(**kwargs)  # type: ignore[arg-type]
        assert not client.configured
        try:
            client.respond(system_prompt="s", context_json="{}")
        except CoachNotConfiguredError:
            pass
        else:
            raise AssertionError("expected CoachNotConfiguredError")
    assert constructed == []


def test_finish_length_valid_json_rejected(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    result = _FakeCompletion(VALID_HINT, "length", 2048, 1973)
    _install_fake(monkeypatch, result)
    try:
        _client().respond(system_prompt="s", context_json="{}")
    except CoachInvalidResponseError as exc:
        assert exc.finish_reason == "length"
        assert exc.completion_tokens == 2048
        assert exc.reasoning_tokens == 1973
    else:
        raise AssertionError("expected CoachInvalidResponseError")
