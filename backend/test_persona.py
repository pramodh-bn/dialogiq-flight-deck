"""Mocked unit tests for the Baseten persona client (CS-32).

No live calls: the OpenAI library class is replaced with fakes, prompt
builders are pure functions, and Baseten/Meta env vars are cleared for
every test. Run: pytest backend/test_persona.py
"""
import os
import sys
from typing import ClassVar

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import pytest

import persona
from persona import (
    RESISTANCE_GUARDED,
    RESISTANCE_OPEN,
    RESISTANCE_WARMING,
    BasetenPersonaClient,
    PersonaBrief,
    build_persona_system_prompt,
    generate_persona_reply,
    resistance_instruction,
)


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeCompletion:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeCompletionsEndpoint:
    def __init__(self, reply):
        self._reply = reply
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeCompletion(self._reply)


class _FakeChat:
    def __init__(self, reply):
        self.completions = _FakeCompletionsEndpoint(reply)


class FakeOpenAI:
    """Stand-in for openai.OpenAI: records construction and calls."""

    instances: ClassVar[list] = []
    reply = "Mocked persona reply."

    def __init__(self, base_url=None, api_key=None, max_retries=None):
        self.base_url = base_url
        self.api_key = api_key
        self.max_retries = max_retries
        self.chat = _FakeChat(FakeOpenAI.reply)
        FakeOpenAI.instances.append(self)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    """Clear API env vars and reset fakes for every test."""
    for var in (
        "BASETEN_API_KEY",
        "BASETEN_API_BASE",
        "BASETEN_MODEL",
        "META_MODEL_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    FakeOpenAI.instances.clear()
    FakeOpenAI.reply = "Mocked persona reply."
    monkeypatch.setattr(persona, "OpenAI", FakeOpenAI)


def _brief(**overrides):
    fields = {
        "character_name": "Bob",
        "role": "defensive team member",
        "persona_traits": "Avoidant, high resistance.",
        "hidden_need": "Needs assurance the timeline will hold.",
    }
    fields.update(overrides)
    return PersonaBrief(**fields)


def test_resistance_levels_are_distinct_and_nonempty():
    texts = {
        resistance_instruction(RESISTANCE_GUARDED),
        resistance_instruction(RESISTANCE_WARMING),
        resistance_instruction(RESISTANCE_OPEN),
    }
    assert len(texts) == 3
    assert all(t.strip() for t in texts)


def test_resistance_rejects_unknown_level():
    with pytest.raises(ValueError, match="unknown resistance level"):
        resistance_instruction("spicy")


def test_prompt_contains_brief_resistance_and_revealed_state():
    prompt = build_persona_system_prompt(
        _brief(),
        revealed_titles=["Q3 deadlines", "design churn"],
        resistance=RESISTANCE_WARMING,
    )
    assert "Bob" in prompt
    assert "defensive team member" in prompt
    assert "Avoidant, high resistance." in prompt
    # The hidden need briefs the persona model, wrapped in a gag order.
    assert "Needs assurance the timeline will hold." in prompt
    assert "never state this outright" in prompt
    assert resistance_instruction(RESISTANCE_WARMING) in prompt
    assert "Q3 deadlines, design churn" in prompt


def test_prompt_with_nothing_revealed_yet():
    prompt = build_persona_system_prompt(_brief())
    assert "Nothing personal has come up yet" in prompt
    assert "Needs assurance the timeline will hold." in prompt


def test_prompt_prefers_authorial_system_prompt_first():
    prompt = build_persona_system_prompt(
        _brief(system_prompt="Speak plainly, a bit tired, never corporate.")
    )
    assert prompt.startswith("Speak plainly, a bit tired, never corporate.")


def test_client_defaults_and_unconfigured_without_key():
    client = BasetenPersonaClient()
    assert client.base_url == "https://inference.baseten.co/v1"
    assert client.model == "meta-models/muse-spark-open-1026"
    assert client.api_key == ""
    assert client.configured is False


def test_client_env_overrides(monkeypatch):
    monkeypatch.setenv("BASETEN_API_KEY", "test-key")
    monkeypatch.setenv("BASETEN_API_BASE", "https://relay.example/v1")
    monkeypatch.setenv("BASETEN_MODEL", "custom-persona-1")
    client = BasetenPersonaClient()
    assert client.api_key == "test-key"
    assert client.base_url == "https://relay.example/v1"
    assert client.model == "custom-persona-1"
    assert client.configured is True


def test_respond_request_shape_and_reply():
    client = BasetenPersonaClient(api_key="test-key")
    reply = client.respond(
        system_prompt="You are Bob.",
        messages=[{"role": "user", "content": "What blocked you?"}],
        temperature=0.5,
        timeout=12.0,
    )
    assert reply == "Mocked persona reply."
    assert len(FakeOpenAI.instances) == 1
    fake = FakeOpenAI.instances[0]
    assert fake.base_url == "https://inference.baseten.co/v1"
    assert fake.api_key == "test-key"
    assert fake.max_retries == 0
    (call,) = fake.chat.completions.calls
    assert call["model"] == "meta-models/muse-spark-open-1026"
    assert call["temperature"] == 0.5
    assert call["timeout"] == 12.0
    assert call["messages"] == [
        {"role": "system", "content": "You are Bob."},
        {"role": "user", "content": "What blocked you?"},
    ]


def test_respond_strips_reply():
    FakeOpenAI.reply = "\n  Mocked persona reply.  \n"
    client = BasetenPersonaClient(api_key="test-key")
    assert client.respond(system_prompt="s", messages=[]) == (
        "Mocked persona reply."
    )


def test_respond_inert_without_key():
    client = BasetenPersonaClient()
    with pytest.raises(RuntimeError, match="BASETEN_API_KEY"):
        client.respond(system_prompt="s", messages=[])
    assert FakeOpenAI.instances == []


def test_respond_inert_without_base_url():
    client = BasetenPersonaClient(api_key="test-key", base_url="")
    with pytest.raises(RuntimeError, match="BASETEN_API_BASE"):
        client.respond(system_prompt="s", messages=[])
    assert FakeOpenAI.instances == []


def test_no_meta_key_fallback(monkeypatch):
    monkeypatch.setenv("META_MODEL_API_KEY", "meta-key")
    client = BasetenPersonaClient()
    assert client.api_key == ""
    with pytest.raises(RuntimeError, match="BASETEN_API_KEY"):
        client.respond(system_prompt="s", messages=[])
    assert FakeOpenAI.instances == []


def test_empty_reply_raises():
    FakeOpenAI.reply = "   "
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(RuntimeError, match="empty reply"):
        client.respond(system_prompt="s", messages=[])


def test_generate_persona_reply_wires_prompt_and_history():
    client = BasetenPersonaClient(api_key="test-key")
    history = [
        {"role": "user", "content": "Did you miss the deadline?"},
        {"role": "assistant", "content": "I sent the update."},
    ]
    reply = generate_persona_reply(
        client,
        _brief(),
        "What has been getting in the way?",
        revealed_titles=["Q3 deadlines"],
        resistance=RESISTANCE_GUARDED,
        history=history,
    )
    assert reply == "Mocked persona reply."
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert "Avoidant, high resistance." in call["messages"][0]["content"]
    assert "Q3 deadlines" in call["messages"][0]["content"]
    assert call["messages"][0]["role"] == "system"
    assert call["messages"][1:] == history + [
        {"role": "user", "content": "What has been getting in the way?"}
    ]
