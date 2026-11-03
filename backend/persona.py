"""Baseten Muse Spark dynamic persona client (CS-32).

Live persona backend for DialogIQ Sprint 1, funded by the $100 Baseten
credit allocation. It synthesizes the practice character's replies in
the persona's voice, with psychological resistance driven by live
session state (revealed nodes, resistance level).

Configuration is env-only (mirrors V1 CS-10/CS-11):

- ``BASETEN_API_KEY``: required. Distinct from ``META_MODEL_API_KEY``;
  this client never reads the Meta key.
- ``BASETEN_API_BASE``: default ``https://inference.baseten.co/v1``.
- ``BASETEN_MODEL``: default ``meta-models/muse-spark-open-1026``. The
  hackathon key works only with this exact model name.

Inert without a key: construction never crashes and ``respond()``
raises ``RuntimeError`` before any network call. Tests use mocked
responses only; there are no live calls in the test suite.

Briefing vs. leaking: the hidden need graph briefs THIS persona model
(it must know what it is guarding to roleplay resistance at all), and
it is always wrapped in explicit non-disclosure instructions. The
coach/whisper path is a separate client and must never receive
unrevealed text or gates.

Sprint 2 (CS-39, contract R2 04af9aa) adds ``newly_revealed_titles``
(candidate labeling), ``timeout`` forwarding, and ``PersonaError``
typed failures mapped from the SDK surface.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    OpenAI,
    OpenAIError,
)

DEFAULT_BASE_URL = "https://inference.baseten.co/v1"
DEFAULT_MODEL = "meta-models/muse-spark-open-1026"

RESISTANCE_GUARDED = "guarded"
RESISTANCE_WARMING = "warming"
RESISTANCE_OPEN = "open"


class PersonaError(Exception):
    """Base class for persona provider and configuration failures.

    Routes catch these types (Sprint 2 contract R2); messages carry no
    prompts, raw responses, or credentials.
    """


class PersonaUnavailableError(PersonaError, RuntimeError):
    """Missing config, connection failure, upstream 401/403/429/5xx."""


class PersonaTimeoutError(PersonaError, RuntimeError):
    """Upstream request exceeded its timeout (HTTP 408/504 included)."""


class PersonaInvalidResponseError(PersonaError, RuntimeError):
    """Empty/malformed result, context rejection, other 4xx/failure."""


@dataclass(frozen=True)
class PersonaBrief:
    """Static character brief, typically mapped from a Scenario row."""

    character_name: str
    role: str
    persona_traits: str = ""
    hidden_need: str = ""
    system_prompt: str = ""


def resistance_instruction(level: str) -> str:
    """Return the resistance-direction block for a RESISTANCE_* level."""
    if level == RESISTANCE_GUARDED:
        return (
            "You are guarded: deflect personal questions, keep replies "
            "short, and do not volunteer feelings. Only a genuinely open, "
            "non-leading question earns a slightly fuller answer."
        )
    if level == RESISTANCE_WARMING:
        return (
            "You are warming up: answer open questions honestly but "
            "briefly, and still deflect closed or leading questions."
        )
    if level == RESISTANCE_OPEN:
        return (
            "You are open: speak freely about what has already come up, "
            "with concrete detail and feeling."
        )
    raise ValueError(f"unknown resistance level: {level!r}")


# CS-79, contract s4-bob-r1: Bob-only persona variant. Selected only by the
# session's pinned behavior_revision; legacy Bob and other personas keep the
# original resistance block byte for byte.
BEHAVIOR_REVISION_BOB = "s4-bob-r1"

_BOB_STANCE = {
    RESISTANCE_GUARDED: (
        "You are guarded: keep replies short and careful and do not volunteer "
        "feelings. You still answer a practical or direct point plainly, and a "
        "credible answer, offer of help or repair can earn a slightly fuller, "
        "still cautious reply, even if it is not a question."
    ),
    RESISTANCE_WARMING: (
        "You are warming up: answer honestly and say a little more about what "
        "concerns you, in a few sentences. Respond to what the manager actually "
        "offered, whether it is a question, an answer, help or an apology. "
        "Keep any condition or doubt you still have."
    ),
    RESISTANCE_OPEN: (
        "You are fairly open: talk candidly, with concrete detail and feeling, "
        "about what has already come up. Being open is not agreeing: you can "
        "still disagree, ask for something, or say what you need to see first."
    ),
}

# What the manager's latest wording did, as recognized by the public stance
# heuristic (backend/stance.py). Tells Bob how to react believably to it.
_BOB_SIGNAL = {
    "clarity": (
        "The manager just gave a concrete clarification or commitment. React to "
        "it directly; if it settles something for you, say so, and if it only "
        "partly does, say what is still unclear."
    ),
    "support": (
        "The manager just offered practical help. Take it at face value and say "
        "whether and how it would help, without gushing."
    ),
    "acknowledgment": (
        "The manager just acknowledged a specific concern of yours. You may let "
        "a little more show about that concern."
    ),
    "repair": (
        "The manager just took responsibility or withdrew something unfair. Note "
        "it briefly; it eases things, but one apology does not erase the issue."
    ),
    "pressure": (
        "The manager just pressed or blamed you. React the way a real employee "
        "would: shorter, more defensive or quieter. Do not escalate or insult."
    ),
    "boundary": (
        "The manager just respected your wish to pause. Accept it simply and "
        "do not reopen the topic yourself."
    ),
}

_BOB_ETIQUETTE = (
    "Reveal etiquette: voice newly permitted topics as tentative possibilities, "
    "never as decided outcomes. Never reveal anything that is not already out "
    "in the open or newly permitted. Do not suddenly change personality: move "
    "gradually, consistent with your earlier replies. A friendlier tone is not "
    "agreement: never promise, consent, or agree just because the manager was "
    "kind or a topic came up, and keep any unresolved condition or "
    "disagreement until it is actually addressed."
)


def bob_stance_instruction(level: str, signal: str | None = None) -> str:
    """Return the s4-bob-r1 stance block, plus a reaction to the latest signal."""
    if level not in _BOB_STANCE:
        raise ValueError(f"unknown resistance level: {level!r}")
    reaction = _BOB_SIGNAL.get(signal or "")
    return _BOB_STANCE[level] + (" " + reaction if reaction else "")


def build_persona_system_prompt(
    brief: PersonaBrief,
    *,
    revealed_titles: list[str] | tuple[str, ...] = (),
    newly_revealed_titles: list[str] | tuple[str, ...] = (),
    resistance: str = RESISTANCE_GUARDED,
    behavior_revision: str | None = None,
    stance_signal: str | None = None,
) -> str:
    """Compose the system prompt for one persona turn.

    ``revealed_titles`` holds previously committed selected-branch titles;
    ``newly_revealed_titles`` holds zero or one judge-authorized candidate.
    The route guarantees both disjoint and within the scenario brief.

    ``behavior_revision="s4-bob-r1"`` (CS-79) swaps the resistance block for
    the Bob stance block (reacting to ``stance_signal``) and the reveal
    etiquette for a no-forced-agreement version. Omitted or unknown
    revisions return the original bytes exactly.
    """
    bob = behavior_revision == BEHAVIOR_REVISION_BOB
    parts = []
    if brief.system_prompt:
        parts.append(brief.system_prompt.strip())
    identity = f"You are {brief.character_name}, {brief.role}."
    if brief.persona_traits:
        identity += f" Persona: {brief.persona_traits.strip()}"
    parts.append(identity)
    if brief.hidden_need:
        parts.append(
            "Private character brief (never state this outright, and "
            "never confirm it when asked directly; only let it show "
            "indirectly as trust builds): " + brief.hidden_need.strip()
        )
    parts.append(
        bob_stance_instruction(resistance, stance_signal)
        if bob
        else resistance_instruction(resistance)
    )
    if revealed_titles:
        parts.append("Topics already out in the open: " + ", ".join(revealed_titles))
    else:
        parts.append("Nothing personal has come up yet in this session.")
    if newly_revealed_titles:
        parts.append(
            "Newly permitted this reply (you may speak to this now): "
            + ", ".join(newly_revealed_titles)
        )
    else:
        parts.append("Nothing new is permitted this reply.")
    if bob:
        parts.append(_BOB_ETIQUETTE)
        return "\n\n".join(parts)
    parts.append(
        "Reveal etiquette: voice newly permitted topics as tentative "
        "possibilities, never as decided outcomes. A revealed category is "
        "not proof of agreement: never promise, consent, or agree solely "
        "because a category was revealed. Keep the resistance level above "
        "regardless of what was revealed."
    )
    return "\n\n".join(parts)


def _status_error(model: str, exc: APIStatusError) -> PersonaError:
    """Map an upstream HTTP status failure to a typed persona error."""
    code = exc.status_code
    if code in (408, 504):
        return PersonaTimeoutError(
            f"BasetenPersonaClient timed out (upstream status {code}) "
            f"for model {model}."
        )
    if code in (401, 403, 429) or (
        isinstance(code, int) and code >= 500 and code != 504
    ):
        return PersonaUnavailableError(
            f"BasetenPersonaClient is unavailable (upstream status {code}) "
            f"for model {model}."
        )
    return PersonaInvalidResponseError(
        f"BasetenPersonaClient received upstream status {code} for model {model}."
    )


class BasetenPersonaClient:
    """OpenAI-compatible chat client for the Baseten persona backend.

    Explicit constructor arguments win; otherwise env vars only. The
    key has no fallback: when ``BASETEN_API_KEY`` is absent the client
    stays inert even if ``META_MODEL_API_KEY`` is set.
    """

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (
            base_url
            if base_url is not None
            else os.environ.get("BASETEN_API_BASE", DEFAULT_BASE_URL)
        )
        self.model = (
            model
            if model is not None
            else os.environ.get("BASETEN_MODEL", DEFAULT_MODEL)
        )
        # Passing "" (not None) stops any fallback to another backend's
        # key when no Baseten key is set.
        self.api_key = (
            api_key if api_key is not None else os.environ.get("BASETEN_API_KEY", "")
        )

    @property
    def configured(self) -> bool:
        """True when a live call could be attempted."""
        return bool(self.api_key and self.base_url)

    def respond(
        self,
        *,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        timeout: float = 30.0,
    ) -> str:
        """Return the persona's reply for one turn via chat completions.

        ``messages`` is the turn history as ``{"role", "content"}``
        dicts, ending with the latest user turn. Raises ``RuntimeError``
        before any network call when unconfigured, and when the backend
        returns an empty reply.
        """
        if not self.api_key:
            raise PersonaUnavailableError(
                "BasetenPersonaClient needs BASETEN_API_KEY to be set; "
                "no key is configured, so no request was made."
            )
        if not self.base_url:
            raise PersonaUnavailableError(
                "BasetenPersonaClient needs BASETEN_API_BASE to be set; "
                "no base URL is configured, so no request was made."
            )
        # Built only after the checks above, so an unconfigured client
        # never reaches the library (which would otherwise raise, or
        # fall back to OPENAI_API_KEY). max_retries=0 keeps one request
        # per call.
        client = OpenAI(base_url=self.base_url, api_key=self.api_key, max_retries=0)
        try:
            completion = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system_prompt}]
                + list(messages),
                temperature=temperature,
                timeout=timeout,
            )
        except APITimeoutError as exc:
            raise PersonaTimeoutError(
                f"BasetenPersonaClient timed out after {timeout:g} seconds "
                f"waiting for model {self.model}."
            ) from exc
        except APIConnectionError as exc:
            raise PersonaUnavailableError(
                f"BasetenPersonaClient could not reach {self.base_url}."
            ) from exc
        except APIStatusError as exc:
            raise _status_error(self.model, exc) from exc
        except OpenAIError as exc:
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient request to model {self.model} failed."
            ) from exc
        try:
            choices = completion.choices
        except AttributeError:
            choices = None
        if not choices:
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received a malformed reply from model {self.model}."
            )
        try:
            first_choice = choices[0]
        except (IndexError, KeyError, TypeError):
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received a malformed reply from model {self.model}."
            ) from None
        message = getattr(first_choice, "message", None)
        if message is None or not hasattr(message, "content"):
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received a malformed reply from model {self.model}."
            )
        content = message.content
        if content is None:
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received an empty reply from model {self.model}."
            )
        if not isinstance(content, str):
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received a malformed reply from model {self.model}."
            )
        if not content.strip():
            raise PersonaInvalidResponseError(
                f"BasetenPersonaClient received an empty reply from model {self.model}."
            )
        return content.strip()


def generate_persona_reply(
    client: BasetenPersonaClient,
    brief: PersonaBrief,
    user_text: str,
    *,
    revealed_titles: list[str] | tuple[str, ...] = (),
    newly_revealed_titles: list[str] | tuple[str, ...] = (),
    resistance: str = RESISTANCE_GUARDED,
    history: list[dict] | None = None,
    temperature: float = 0.7,
    timeout: float = 30.0,
    behavior_revision: str | None = None,
    stance_signal: str | None = None,
) -> str:
    """Build the system prompt from live state and get one reply.

    ``history`` passes through verbatim (route-assembled, branch-local);
    ``timeout`` forwards to the provider call (contract: 30 seconds).
    ``behavior_revision``/``stance_signal`` select the CS-79 Bob variant.
    """
    system_prompt = build_persona_system_prompt(
        brief,
        revealed_titles=revealed_titles,
        newly_revealed_titles=newly_revealed_titles,
        resistance=resistance,
        behavior_revision=behavior_revision,
        stance_signal=stance_signal,
    )
    messages = list(history or []) + [{"role": "user", "content": user_text}]
    return client.respond(
        system_prompt=system_prompt,
        messages=messages,
        temperature=temperature,
        timeout=timeout,
    )
