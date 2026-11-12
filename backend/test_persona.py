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
from types import SimpleNamespace
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
        if kwargs.get("stream"):
            return FakeOpenAI.stream_chunks()
        if FakeOpenAI.completion is not None:
            return FakeOpenAI.completion
        return _FakeCompletion(self._reply)


class _FakeChat:
    def __init__(self, reply):
        self.completions = _FakeCompletionsEndpoint(reply)


class FakeOpenAI:
    """Stand-in for openai.OpenAI: records construction and calls."""

    instances: ClassVar[list] = []
    reply = "Mocked persona reply."
    error = None
    completion = None
    deltas: ClassVar[list] = []
    stream_error = None

    stream_closed: ClassVar[list] = []

    @staticmethod
    def stream_chunks():
        """Return an SDK-shaped stream: iterable, with a recorded close()."""
        return _FakeStream()

    def __init__(self, base_url=None, api_key=None, max_retries=None):
        self.base_url = base_url
        self.api_key = api_key
        self.max_retries = max_retries
        self.chat = _FakeChat(FakeOpenAI.reply)
        FakeOpenAI.instances.append(self)


class _FakeStream:
    def __iter__(self):
        for piece in FakeOpenAI.deltas:
            if piece is None:
                yield SimpleNamespace(choices=[])
                continue
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))]
            )
        if FakeOpenAI.stream_error is not None:
            raise FakeOpenAI.stream_error

    def close(self):
        FakeOpenAI.stream_closed.append(True)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    """Clear API env vars and reset fakes for every test."""
    for var in (
        "BASETEN_API_KEY",
        "BASETEN_API_BASE",
        "BASETEN_MODEL",
        "META_MODEL_API_KEY",
        "PERSONA_PROVIDER",
        "PERSONA_MODEL",
        "PERSONA_REASONING_EFFORT",
        "FIREWORKS_API_KEY",
        "FIREWORKS_API_BASE",
        "FIREWORKS_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)
    FakeOpenAI.instances.clear()
    FakeOpenAI.reply = "Mocked persona reply."
    FakeOpenAI.error = None
    FakeOpenAI.completion = None
    FakeOpenAI.deltas = []
    FakeOpenAI.stream_error = None
    FakeOpenAI.stream_closed = []
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


def _raw_completion(*, choices):
    return SimpleNamespace(choices=choices)


def _raw_message(content):
    return SimpleNamespace(message=SimpleNamespace(content=content))


@pytest.mark.parametrize(
    "completion,match",
    [
        (_raw_completion(choices=[]), "malformed reply"),
        (_raw_completion(choices=None), "malformed reply"),
        (_raw_completion(choices=[SimpleNamespace(message=None)]), "malformed reply"),
        (_raw_completion(choices=[_raw_message(None)]), "empty reply"),
        (_raw_completion(choices=[_raw_message(42)]), "malformed reply"),
        (_raw_completion(choices=[_raw_message("   ")]), "empty reply"),
    ],
)
def test_malformed_completion_shapes_raise_typed_invalid(completion, match):
    FakeOpenAI.completion = completion
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaInvalidResponseError, match=match):
        client.respond(system_prompt="s", messages=[])


def test_valid_completion_still_returns_stripped_reply():
    FakeOpenAI.completion = _raw_completion(
        choices=[_raw_message("  A complete persona reply.  ")]
    )
    client = BasetenPersonaClient(api_key="test-key")
    assert client.respond(system_prompt="s", messages=[]) == "A complete persona reply."


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


# CS-79: s4-bob-r1 persona variant. Prompt-only checks, zero network.
def test_bob_variant_absent_keeps_original_bytes() -> None:
    for level in (RESISTANCE_GUARDED, RESISTANCE_WARMING, RESISTANCE_OPEN):
        original = build_persona_system_prompt(_brief(), resistance=level)
        assert (
            build_persona_system_prompt(
                _brief(),
                resistance=level,
                behavior_revision=None,
                stance_signal="support",
            )
            == original
        )
        assert (
            build_persona_system_prompt(
                _brief(), resistance=level, behavior_revision="unknown-r9"
            )
            == original
        )


def test_bob_variant_replaces_open_question_rule_and_etiquette() -> None:
    prompt = build_persona_system_prompt(
        _brief(),
        resistance=RESISTANCE_GUARDED,
        behavior_revision="s4-bob-r1",
        stance_signal="clarity",
    )
    assert resistance_instruction(RESISTANCE_GUARDED) not in prompt
    assert "Only a genuinely open" not in prompt
    assert "even if it is not a question" in prompt
    assert "concrete clarification" in prompt
    assert "A friendlier tone is not agreement" in prompt
    assert "Never reveal anything that is not already out" in prompt
    # Private brief and reveal authorization lines are unchanged.
    assert "never state this outright" in prompt
    assert "Nothing new is permitted this reply." in prompt


def test_bob_variant_levels_and_signals() -> None:
    from persona import bob_stance_instruction

    levels = {
        bob_stance_instruction(level)
        for level in (RESISTANCE_GUARDED, RESISTANCE_WARMING, RESISTANCE_OPEN)
    }
    assert len(levels) == 3
    assert "Being open is not agreeing" in bob_stance_instruction(RESISTANCE_OPEN)
    assert "pressed or blamed" in bob_stance_instruction(RESISTANCE_GUARDED, "pressure")
    # Signals with no reaction add nothing.
    for quiet in (None, "none", "initial"):
        assert bob_stance_instruction(RESISTANCE_WARMING, quiet) == (
            bob_stance_instruction(RESISTANCE_WARMING)
        )
    with pytest.raises(ValueError, match="unknown resistance level"):
        bob_stance_instruction("spicy")


# --- CS-91: provider selection and sentence streaming -----------------------


def test_default_provider_is_baseten_and_request_is_unchanged():
    client = persona.persona_client()
    assert type(client) is BasetenPersonaClient
    assert client.reasoning_effort is None
    BasetenPersonaClient(api_key="test-key").respond(system_prompt="s", messages=[])
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert set(call) == {"model", "messages", "temperature", "timeout"}


def test_fireworks_provider_uses_only_fireworks_settings(monkeypatch):
    monkeypatch.setenv("PERSONA_PROVIDER", " Fireworks ")
    monkeypatch.setenv("FIREWORKS_API_KEY", "fw-test-key")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-key")
    monkeypatch.setenv("BASETEN_MODEL", "baseten-only-model")
    monkeypatch.setenv("FIREWORKS_MODEL", "coach-only-model")
    client = persona.persona_client()
    assert type(client) is persona.FireworksPersonaClient
    assert client.api_key == "fw-test-key"
    assert client.base_url == "https://api.fireworks.ai/inference/v1"
    assert client.model == "accounts/fireworks/models/muse-spark-open"
    assert client.respond(system_prompt="s", messages=[]) == "Mocked persona reply."
    fake = FakeOpenAI.instances[0]
    assert fake.api_key == "fw-test-key"
    (call,) = fake.chat.completions.calls
    assert call["model"] == "accounts/fireworks/models/muse-spark-open"
    assert call["reasoning_effort"] == "low"


def test_fireworks_model_and_reasoning_overrides(monkeypatch):
    monkeypatch.setenv("PERSONA_PROVIDER", "fireworks")
    monkeypatch.setenv("FIREWORKS_API_KEY", "fw-test-key")
    monkeypatch.setenv("FIREWORKS_API_BASE", "https://relay.example/v1")
    monkeypatch.setenv("PERSONA_MODEL", "accounts/fireworks/models/ember-1")
    monkeypatch.setenv("PERSONA_REASONING_EFFORT", "medium")
    client = persona.persona_client()
    client.respond(system_prompt="s", messages=[])
    fake = FakeOpenAI.instances[0]
    assert fake.base_url == "https://relay.example/v1"
    (call,) = fake.chat.completions.calls
    assert call["model"] == "accounts/fireworks/models/ember-1"
    assert call["reasoning_effort"] == "medium"


def test_fireworks_provider_never_borrows_another_key(monkeypatch):
    monkeypatch.setenv("PERSONA_PROVIDER", "fireworks")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-key")
    monkeypatch.setenv("META_MODEL_API_KEY", "meta-test-key")
    client = persona.persona_client()
    assert client.configured is False
    with pytest.raises(PersonaUnavailableError, match="FIREWORKS_API_KEY"):
        client.respond(system_prompt="s", messages=[])
    assert FakeOpenAI.instances == []


def test_unknown_provider_fails_closed_without_a_request(monkeypatch):
    monkeypatch.setenv("PERSONA_PROVIDER", "elsewhere")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-key")
    with pytest.raises(PersonaUnavailableError, match="PERSONA_PROVIDER"):
        persona.persona_client()
    assert FakeOpenAI.instances == []


def test_fireworks_status_errors_name_the_fireworks_client():
    FakeOpenAI.error = _status_error(503)
    client = persona.FireworksPersonaClient(api_key="fw-test-key")
    with pytest.raises(PersonaUnavailableError, match="FireworksPersonaClient"):
        client.respond(system_prompt="s", messages=[])


def test_stream_yields_sentences_as_they_complete():
    FakeOpenAI.deltas = [
        "It\u2019s mostly",
        " shifting specs. ",
        None,
        "I flagged it",
        " in July! Nobody",
        " listened",
    ]
    client = persona.FireworksPersonaClient(api_key="fw-test-key")
    sentences = list(
        client.respond_stream(
            system_prompt="You are Bob.",
            messages=[{"role": "user", "content": "What blocked you?"}],
            timeout=12.0,
        )
    )
    assert sentences == [
        "It\u2019s mostly shifting specs.",
        "I flagged it in July!",
        "Nobody listened",
    ]
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert call["stream"] is True
    assert call["timeout"] == 12.0
    assert call["messages"][0] == {"role": "system", "content": "You are Bob."}


def test_stream_keeps_closing_quote_and_mid_sentence_ellipsis_together():
    FakeOpenAI.deltas = ['He said "fine." Then\u2026 nothing. ', "Q3 slipped."]
    client = BasetenPersonaClient(api_key="test-key")
    assert list(client.respond_stream(system_prompt="s", messages=[])) == [
        'He said "fine."',
        "Then\u2026 nothing.",
        "Q3 slipped.",
    ]


def test_stream_with_no_text_raises_typed_invalid():
    FakeOpenAI.deltas = [None, "", "   "]
    client = BasetenPersonaClient(api_key="test-key")
    with pytest.raises(PersonaInvalidResponseError, match="empty reply"):
        list(client.respond_stream(system_prompt="s", messages=[]))


def test_stream_inert_without_key():
    client = persona.FireworksPersonaClient()
    with pytest.raises(PersonaUnavailableError, match="FIREWORKS_API_KEY"):
        list(client.respond_stream(system_prompt="s", messages=[]))
    assert FakeOpenAI.instances == []


def test_stream_failure_after_a_sentence_raises_typed_error():
    FakeOpenAI.deltas = ["First sentence. ", "Second"]
    FakeOpenAI.stream_error = _status_error(503)
    client = persona.FireworksPersonaClient(api_key="fw-test-key")
    stream = client.respond_stream(system_prompt="s", messages=[])
    assert next(stream) == "First sentence."
    with pytest.raises(PersonaUnavailableError, match="upstream status 503"):
        next(stream)


def test_generate_stream_builds_the_same_prompt_as_generate():
    FakeOpenAI.deltas = ["Fine. "]
    client = BasetenPersonaClient(api_key="test-key")
    history = [{"role": "assistant", "content": "You wanted to see me?"}]
    kwargs = {
        "revealed_titles": ["Q3 deadlines"],
        "history": history,
        "behavior_revision": "s4-bob-r1",
        "stance_signal": "support",
    }
    assert list(
        persona.generate_persona_reply_stream(client, _brief(), "How so?", **kwargs)
    ) == ["Fine."]
    generate_persona_reply(client, _brief(), "How so?", **kwargs)
    streamed, plain = (i.chat.completions.calls[0] for i in FakeOpenAI.instances)
    assert streamed["messages"] == plain["messages"]


# --- CS-91 fixes after independent validation -------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("I asked Dr. Smith about it. Then I left.", 2),
        ("Mr. Lee vs. the plan, etc. and so on. Fine.", 2),
        ("Use tools, e.g. this one. Done.", 2),
        ("The U.S. team slipped. Twice.", 2),
        ("Meet at 9 a.m. tomorrow. Bring notes.", 2),
        ("J. K. Rowling wrote it. Not me.", 2),
        ("Two things: 1. specs moved. 2. Nobody listened.", 2),
        ("It went... okay-ish, given the changes. Deadlines moved.", 2),
        ("It took 3.5 days on v2.1. Too long.", 2),
        ('"Really?" he asked. "Yes."', 2),
        ("Wait... What changed? Everything!", 3),
        (". Hello. ... ", 1),
        ("no terminator at all", 1),
    ],
)
def test_split_sentences_does_not_break_inside_a_sentence(text, expected):
    sentences, rest = persona.split_sentences(text, final=True)
    assert rest == ""
    assert len(sentences) == expected
    assert all(any(c.isalnum() for c in sentence) for sentence in sentences)


def test_split_sentences_waits_for_the_next_character():
    assert persona.split_sentences("It went... ") == ([], "It went... ")
    assert persona.split_sentences("It went... okay. ") == ([], "It went... okay. ")
    assert persona.split_sentences("Fine. N") == (["Fine."], "N")
    assert persona.split_sentences("See Dr. ") == ([], "See Dr. ")


def test_stream_splits_when_whitespace_arrives_in_a_later_delta():
    FakeOpenAI.deltas = ["Hello.", " World.", " 3.", "5 days."]
    client = BasetenPersonaClient(api_key="test-key")
    assert list(client.respond_stream(system_prompt="s", messages=[])) == [
        "Hello.",
        "World.",
        "3.5 days.",
    ]


def test_stream_is_closed_after_full_and_after_early_stop():
    FakeOpenAI.deltas = ["One. ", "Two. ", "Three."]
    client = BasetenPersonaClient(api_key="test-key")
    assert len(list(client.respond_stream(system_prompt="s", messages=[]))) == 3
    assert FakeOpenAI.stream_closed == [True]
    stream = client.respond_stream(system_prompt="s", messages=[])
    assert next(stream) == "One."
    stream.close()
    assert FakeOpenAI.stream_closed == [True, True]


def test_stream_malformed_event_raises_typed_invalid_and_closes():
    FakeOpenAI.deltas = ["First sentence. ", "Second"]
    FakeOpenAI.stream_error = json.JSONDecodeError("bad event", "{", 0)
    client = BasetenPersonaClient(api_key="test-key")
    stream = client.respond_stream(system_prompt="s", messages=[])
    assert next(stream) == "First sentence."
    with pytest.raises(PersonaInvalidResponseError, match="malformed reply"):
        next(stream)
    assert FakeOpenAI.stream_closed == [True]


def test_stream_error_at_create_is_typed():
    FakeOpenAI.error = openai.APITimeoutError(
        request=httpx2.Request("POST", "https://example.invalid/v1")
    )
    client = persona.FireworksPersonaClient(api_key="fw-test-key")
    with pytest.raises(PersonaTimeoutError, match="FireworksPersonaClient"):
        next(client.respond_stream(system_prompt="s", messages=[], timeout=5.0))


def test_reasoning_setting_never_reaches_baseten(monkeypatch):
    monkeypatch.setenv("PERSONA_REASONING_EFFORT", "medium")
    monkeypatch.setenv("PERSONA_MODEL", "accounts/fireworks/models/ember-1")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-test-key")
    client = persona.persona_client()
    assert type(client) is BasetenPersonaClient
    client.respond(system_prompt="s", messages=[])
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert set(call) == {"model", "messages", "temperature", "timeout"}
    assert call["model"] == "meta-models/muse-spark-open-1026"


@pytest.mark.parametrize("value", ["off", "none", " OFF "])
def test_fireworks_reasoning_can_be_switched_off(monkeypatch, value):
    monkeypatch.setenv("PERSONA_REASONING_EFFORT", value)
    client = persona.FireworksPersonaClient(api_key="fw-test-key")
    client.respond(system_prompt="s", messages=[])
    (call,) = FakeOpenAI.instances[0].chat.completions.calls
    assert "reasoning_effort" not in call


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_provider_means_baseten(monkeypatch, value):
    monkeypatch.setenv("PERSONA_PROVIDER", value)
    assert type(persona.persona_client()) is BasetenPersonaClient


def test_practice_providers_follow_the_selected_provider(monkeypatch):
    import practice

    monkeypatch.setenv("PERSONA_PROVIDER", "fireworks")
    monkeypatch.setenv("FIREWORKS_API_KEY", "fw-test-key")
    FakeOpenAI.deltas = ["Fine. "]
    assert practice.real_persona(brief=_brief(), user_text="Hi") == (
        "Mocked persona reply."
    )
    assert list(practice.real_persona_stream(brief=_brief(), user_text="Hi")) == [
        "Fine."
    ]
    assert [i.base_url for i in FakeOpenAI.instances] == [
        "https://api.fireworks.ai/inference/v1"
    ] * 2
