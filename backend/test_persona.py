"""Mocked unit tests for the Baseten persona client (CS-32, CS-39).

No live calls: the OpenAI library class is replaced with fakes, prompt
builders are pure functions, and Baseten/Meta env vars are cleared for
every test. Run: pytest backend/test_persona.py
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import ClassVar

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import httpx2
import openai
import pytest

import persona
from persona import (
    RESISTANCE_GUARDED,
    RESISTANCE_OPEN,
    RESISTANCE_WARMING,
    BasetenPersonaClient,
    PersonaBrief,
    PersonaError,
    PersonaInvalidResponseError,
    PersonaTimeoutError,
    PersonaUnavailableError,
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
        if FakeOpenAI.error is not None:
            raise FakeOpenAI.error
        return _FakeCompletion(self._reply)


class _FakeChat:
    def __init__(self, reply):
        self.completions = _FakeCompletionsEndpoint(reply)


class FakeOpenAI:
    """Stand-in for openai.OpenAI: records construction and calls."""

    instances: ClassVar[list] = []
    reply = "Mocked persona reply."
    error = None

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
    FakeOpenAI.error = None
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
    assert client.respond(system_prompt="s", messages=[]) == ("Mocked persona reply.")


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


FIXTURE_PATH = Path(persona.__file__).resolve().parent / "persona_fixtures.json"

# Pinned copy of the CS-36 R2 stem table. Update only on a recorded contract
# revision; R2.1 only removes next/first, so this stays conservative.
CONTRACT_STEMS = (
    "hard",
    "difficult",
    "challeng",
    "pressure",
    "tough",
    "struggl",
    "stress",
    "feel",
    "felt",
    "worr",
    "afraid",
    "scared",
    "impact",
    "affect",
    "cost",
    "consequence",
    "toll",
    "need",
    "matter",
    "important",
    "value",
    "fair",
    "support",
    "help",
    "change",
    "different",
    "option",
    "next",
    "step",
    "plan",
    "agree",
    "try",
    "first",
)

# Pinned copy of the CS-36 R2 fixed need titles. Fixture public strings must
# not quote them.
CONTRACT_NEED_TITLES = (
    "Quarter experience",
    "Conflicting priorities",
    "Fear of judgment",
    "Confidence impact",
    "Clear priorities",
    "Practical support",
    "Evening experience",
    "Homework pressure",
    "Fear of dismissal",
    "Trust impact",
    "Autonomy and trust",
    "Shared boundaries",
    "Work experience",
    "Workload pressure",
    "Fear of weakness",
    "Health impact",
    "Sustainable expectations",
    "Concrete support",
    "Negotiation experience",
    "Delivery pressure",
    "Fear of distrust",
    "Partnership impact",
    "Fair terms",
    "Flexible options",
    "Agreed next step",
)

SEED_TITLES = (
    "Bob: Defensive Team Member",
    "Teenage Daughter: Homework Friction",
    "Priya: Burnout Disclosure",
    "Vendor: Contract Pushback",
)


def _sdk_request() -> httpx2.Request:
    return httpx2.Request("POST", "https://inference.baseten.co/v1")


def _status_error(status: int) -> openai.APIStatusError:
    response = httpx2.Response(status, request=_sdk_request())
    return openai.APIStatusError("upstream failure", response=response, body=None)


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _public_strings(scenario: dict) -> list[str]:
    details = scenario["persona"]
    strings = [
        details["name"],
        details["role"],
        details["initials"],
        details["opening_message"],
        details["public_context"],
    ]
    strings.extend(details["tags"])
    strings.extend(details["practice_hints"])
    return strings


def test_newly_revealed_labeled_separately():
    prompt = build_persona_system_prompt(
        _brief(),
        revealed_titles=["Q3 deadlines"],
        newly_revealed_titles=["Design churn"],
        resistance=RESISTANCE_GUARDED,
    )
    assert "Topics already out in the open: Q3 deadlines" in prompt
    assert "Newly permitted this reply (you may speak to this now):" in prompt
    assert "Design churn" in prompt
    assert "never state this outright" in prompt


def test_no_newly_revealed_states_nothing_permitted():
    prompt = build_persona_system_prompt(_brief(), revealed_titles=["Q3 deadlines"])
    assert "Nothing new is permitted this reply." in prompt


def test_reveal_etiquette_guard_present():
    prompt = build_persona_system_prompt(_brief())
    assert "A revealed category is not proof of agreement" in prompt
    assert "never promise, consent, or agree solely" in prompt
    assert "Keep the resistance level above" in prompt


def test_early_n7_case_keeps_guarded_resistance():
    """CS-A22 case: n7 permitted at score 1 must not flip the persona open."""
    prompt = build_persona_system_prompt(
        _brief(),
        newly_revealed_titles=["Agreed next step"],
        resistance=RESISTANCE_GUARDED,
    )
    assert "Newly permitted this reply" in prompt
    assert "Agreed next step" in prompt
    assert resistance_instruction(RESISTANCE_GUARDED) in prompt
    assert "never promise, consent, or agree solely" in prompt


def test_timeout_defaults_to_thirty_and_forwards():
    client = BasetenPersonaClient(api_key="test-key")
    generate_persona_reply(client, _brief(), "What happened?")
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert call["timeout"] == 30.0


def test_timeout_override_forwards():
    client = BasetenPersonaClient(api_key="test-key")
    generate_persona_reply(client, _brief(), "What happened?", timeout=5.0)
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert call["timeout"] == 5.0


def test_old_call_shape_still_works():
    """Pre-Sprint-2 callers pass neither new keyword."""
    client = BasetenPersonaClient(api_key="test-key")
    reply = generate_persona_reply(
        client, _brief(), "What happened?", revealed_titles=["Q3 deadlines"]
    )
    assert reply == "Mocked persona reply."


def test_unconfigured_raises_typed_unavailable():
    client = BasetenPersonaClient()
    with pytest.raises(PersonaUnavailableError, match="BASETEN_API_KEY"):
        client.respond(system_prompt="s", messages=[])
    assert FakeOpenAI.instances == []
    keyless = BasetenPersonaClient(api_key="k", base_url="")
    with pytest.raises(PersonaUnavailableError, match="BASETEN_API_BASE"):
        keyless.respond(system_prompt="s", messages=[])


def test_typed_errors_keep_runtime_compatibility():
    assert issubclass(PersonaUnavailableError, (PersonaError, RuntimeError))
    assert issubclass(PersonaTimeoutError, (PersonaError, RuntimeError))
    assert issubclass(PersonaInvalidResponseError, (PersonaError, RuntimeError))


def test_empty_reply_raises_typed_invalid():
    FakeOpenAI.reply = "   "
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaInvalidResponseError, match="empty reply"):
        client.respond(system_prompt="s", messages=[])


def test_sdk_timeout_maps_to_persona_timeout():
    FakeOpenAI.error = openai.APITimeoutError(request=_sdk_request())
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaTimeoutError, match="timed out after 30 seconds"):
        client.respond(system_prompt="s", messages=[])


@pytest.mark.parametrize("status", [401, 403, 429, 500, 502, 503])
def test_status_unavailable(status):
    FakeOpenAI.error = _status_error(status)
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaUnavailableError, match=f"upstream status {status}"):
        client.respond(system_prompt="s", messages=[])


@pytest.mark.parametrize("status", [408, 504])
def test_status_timeout(status):
    FakeOpenAI.error = _status_error(status)
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaTimeoutError, match="timed out"):
        client.respond(system_prompt="s", messages=[])


@pytest.mark.parametrize("status", [400, 404, 422])
def test_status_invalid(status):
    FakeOpenAI.error = _status_error(status)
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaInvalidResponseError, match=f"upstream status {status}"):
        client.respond(system_prompt="s", messages=[])


def test_connection_error_maps_to_unavailable():
    FakeOpenAI.error = openai.APIConnectionError(request=_sdk_request())
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaUnavailableError, match="could not reach"):
        client.respond(system_prompt="s", messages=[])


def test_other_openai_error_maps_to_invalid():
    FakeOpenAI.error = openai.OpenAIError("boom")
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaInvalidResponseError, match="request .* failed"):
        client.respond(system_prompt="s", messages=[])


def test_non_sdk_errors_propagate_unwrapped():
    FakeOpenAI.error = ValueError("programming bug")
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(ValueError, match="programming bug"):
        client.respond(system_prompt="s", messages=[])


def test_error_messages_are_fixed_templates():
    """Mapped messages carry status codes only, never payloads or keys."""
    FakeOpenAI.error = _status_error(503)
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaUnavailableError) as excinfo:
        client.respond(system_prompt="sk-secret system", messages=[])
    assert str(excinfo.value) == (
        "BasetenPersonaClient is unavailable (upstream status 503) "
        "for model meta-models/muse-spark-open-1026."
    )
    assert "sk-secret" not in str(excinfo.value)


def test_history_passes_through_verbatim():
    """persona.py neither adds nor removes route-assembled history entries."""
    client = BasetenPersonaClient(api_key="test-key")
    history = [
        {"role": "assistant", "content": "You wanted to see me?"},
        {"role": "user", "content": "What happened?"},
        {"role": "assistant", "content": "Rough quarter."},
    ]
    generate_persona_reply(client, _brief(), "Tell me more.", history=history)
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert call["messages"][0]["role"] == "system"
    assert call["messages"][1:] == history + [
        {"role": "user", "content": "Tell me more."}
    ]


def test_fixture_schema_and_coverage():
    data = _load_fixture()
    assert set(data) == {"revision", "scenarios"}
    assert isinstance(data["revision"], str) and data["revision"].strip()
    assert len(data["scenarios"]) == 4
    assert sorted(s["scenario_title"] for s in data["scenarios"]) == sorted(SEED_TITLES)
    for scenario in data["scenarios"]:
        assert set(scenario) == {
            "scenario_title",
            "persona",
            "persona_traits",
            "system_prompt",
        }
        assert set(scenario["persona"]) == {
            "name",
            "role",
            "initials",
            "opening_message",
            "public_context",
            "tags",
            "practice_hints",
        }
        assert scenario["persona_traits"].strip()
        assert scenario["system_prompt"].strip()
        assert all(t.strip() for t in scenario["persona"]["tags"])
        assert all(h.strip() for h in scenario["persona"]["practice_hints"])


def test_fixture_public_strings_have_no_stems():
    data = _load_fixture()
    for scenario in data["scenarios"]:
        for text in _public_strings(scenario):
            tokens = re.findall(r"[a-z]+", text.lower())
            hits = [t for t in tokens for s in CONTRACT_STEMS if t.startswith(s)]
            assert not hits, (scenario["scenario_title"], text, hits)


def test_fixture_public_strings_have_no_need_titles():
    data = _load_fixture()
    for scenario in data["scenarios"]:
        joined = "\n".join(_public_strings(scenario)).lower()
        for title in CONTRACT_NEED_TITLES:
            assert title.lower() not in joined, (scenario["scenario_title"], title)
