"""Meta Muse Spark coaching client (CS-43, contract s3-coach-r2).

Live coaching backend for DialogIQ Sprint 3. It produces one structured
hint (approach/example/reason) for a stalled or requesting learner, using
only the allowlisted public context assembled by ``coach_context``.

Configuration is env-only (mirrors the persona client pattern):

- ``META_MODEL_API_KEY``: required, no fallback to any other backend's key.
- ``META_MODEL_API_BASE``: required, no default; must be plain https.
- ``META_MODEL_API_MODEL``: default ``muse-spark-1.3`` (existing default).

Fixed candidate parameters per the accepted contract: temperature 0.3,
max_tokens 512, one 8-second non-streaming chat.completions call with
max_retries=0. Changing these requires a contract delta review. Approved
experimental re-probes may pass a different ``max_tokens`` at call time;
the constant below always keeps the contract value until a versioned
delta adopts a change.

Inert without valid config: construction never crashes and ``respond()``
raises ``CoachNotConfiguredError`` before any network call. Tests use
mocked completions only; there are no live calls in the test suite.
The whole trimmed content must parse as one JSON object; no fence
stripping, substring extraction, coercion, or repair call.
"""

from __future__ import annotations

import json
import os
import urllib.parse
from dataclasses import dataclass

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    OpenAI,
    OpenAIError,
)

DEFAULT_MODEL = "muse-spark-1.3"

COACH_TEMPERATURE = 0.3
COACH_MAX_TOKENS = 512
COACH_TIMEOUT_SECONDS = 8.0

APPROACH_MAX_CHARS = 240
EXAMPLE_MAX_CHARS = 320
REASON_MAX_CHARS = 360

ENV_KEY = "META_MODEL_API_KEY"
ENV_BASE = "META_MODEL_API_BASE"
ENV_MODEL = "META_MODEL_API_MODEL"


class CoachError(Exception):
    """Base class for coach provider and configuration failures.

    Routes and the coach service catch these types; messages carry no
    prompts, raw responses, or credentials.
    """

    def __init__(
        self,
        message: str,
        *,
        finish_reason: str | None = None,
        completion_tokens: int | None = None,
        reasoning_tokens: int | None = None,
    ) -> None:
        """Carry provider evidence (never prompts, content, or secrets)."""
        super().__init__(message)
        self.finish_reason = finish_reason
        self.completion_tokens = completion_tokens
        self.reasoning_tokens = reasoning_tokens


class CoachNotConfiguredError(CoachError, RuntimeError):
    """Missing/blank config or a non-plain-https base URL; zero network."""


class CoachUnavailableError(CoachError, RuntimeError):
    """Connection failure, upstream 401/403/429/5xx."""


class CoachTimeoutError(CoachError, RuntimeError):
    """Upstream request exceeded its timeout (HTTP 408/504 included)."""


class CoachInvalidResponseError(CoachError, RuntimeError):
    """Empty/malformed/non-JSON result, wrong-type content, other 4xx."""


@dataclass(frozen=True)
class CoachCompletion:
    """One raw provider reply with content, finish reason, and usage."""

    content: str
    finish_reason: str | None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None


def base_url_valid(base_url: str) -> bool:
    """True for a plain https base with no userinfo, query, or fragment."""
    if not base_url:
        return False
    try:
        parts = urllib.parse.urlsplit(base_url)
    except ValueError:
        return False
    return bool(
        parts.scheme == "https"
        and parts.hostname
        and not parts.username
        and not parts.query
        and not parts.fragment
    )


def parse_coach_output(content: str) -> dict[str, str]:
    """Validate whole trimmed content as exactly approach/example/reason.

    Raises ``CoachInvalidResponseError`` for empty, malformed, unknown-field,
    wrong-type, or overlong content. Bounds count Unicode code points.
    """
    try:
        parsed = json.loads(content.strip())
    except (json.JSONDecodeError, ValueError) as exc:
        raise CoachInvalidResponseError(
            "Coach provider returned content that is not one JSON object."
        ) from exc
    if not isinstance(parsed, dict):
        raise CoachInvalidResponseError(
            "Coach provider returned a JSON value that is not an object."
        )
    expected = {"approach", "example", "reason"}
    if set(parsed) != expected:
        raise CoachInvalidResponseError(
            "Coach provider JSON must hold exactly approach, example, reason."
        )
    bounds = {
        "approach": APPROACH_MAX_CHARS,
        "example": EXAMPLE_MAX_CHARS,
        "reason": REASON_MAX_CHARS,
    }
    cleaned: dict[str, str] = {}
    for key, limit in bounds.items():
        value = parsed[key]
        if not isinstance(value, str):
            raise CoachInvalidResponseError(
                f"Coach provider field {key!r} must be a string."
            )
        trimmed = value.strip()
        if not trimmed or len(trimmed) > limit:
            raise CoachInvalidResponseError(
                f"Coach provider field {key!r} is empty or overlong."
            )
        cleaned[key] = trimmed
    return cleaned


def _status_error(model: str, exc: APIStatusError) -> CoachError:
    """Map an upstream HTTP status failure to a typed coach error."""
    code = exc.status_code
    if code in (408, 504):
        return CoachTimeoutError(
            f"MetaCoachClient timed out (upstream status {code}) for model {model}."
        )
    if code in (401, 403, 429) or (
        isinstance(code, int) and code >= 500 and code != 504
    ):
        return CoachUnavailableError(
            f"MetaCoachClient is unavailable (upstream status {code}) "
            f"for model {model}."
        )
    return CoachInvalidResponseError(
        f"MetaCoachClient received upstream status {code} for model {model}."
    )


class MetaCoachClient:
    """OpenAI-compatible chat client for the Meta coaching backend.

    Explicit constructor arguments win; otherwise env vars only. The key
    and base URL have no fallback: when unset the client stays inert even
    if Baseten or OpenAI keys are set.
    """

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (
            base_url if base_url is not None else os.environ.get(ENV_BASE, "")
        )
        self.model = (
            model if model is not None else os.environ.get(ENV_MODEL, DEFAULT_MODEL)
        )
        # Passing "" (not None) stops any fallback to another backend's
        # key when no Meta key is set.
        self.api_key = api_key if api_key is not None else os.environ.get(ENV_KEY, "")

    @property
    def configured(self) -> bool:
        """True when a live call could be attempted."""
        return bool(self.api_key and self.model and base_url_valid(self.base_url))

    def respond(
        self,
        *,
        system_prompt: str,
        context_json: str,
        temperature: float = COACH_TEMPERATURE,
        max_tokens: int = COACH_MAX_TOKENS,
        timeout: float = COACH_TIMEOUT_SECONDS,
    ) -> CoachCompletion:
        """Return one raw completion for serialized coach context.

        Raises ``CoachNotConfiguredError`` before any network call when
        config is missing or the base URL is not plain https. Finish
        reason and usage ride on both the success value and the raised
        error, so probes record provider evidence on every path.
        """
        if not self.api_key or not self.model:
            raise CoachNotConfiguredError(
                "MetaCoachClient needs META_MODEL_API_KEY and "
                "META_MODEL_API_MODEL to be set; no request was made."
            )
        if not base_url_valid(self.base_url):
            raise CoachNotConfiguredError(
                "MetaCoachClient needs META_MODEL_API_BASE to be a plain "
                "https URL; no request was made."
            )
        # Built only after the checks above, so an unconfigured client
        # never reaches the library (which would otherwise raise, or
        # fall back to OPENAI_API_KEY). max_retries=0 keeps one request
        # per call.
        client = OpenAI(base_url=self.base_url, api_key=self.api_key, max_retries=0)
        try:
            completion = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": context_json},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
                stream=False,
            )
        except APITimeoutError as exc:
            raise CoachTimeoutError(
                f"MetaCoachClient timed out after {timeout:g} seconds "
                f"waiting for model {self.model}."
            ) from exc
        except APIConnectionError as exc:
            raise CoachUnavailableError(
                "MetaCoachClient could not reach its configured base URL."
            ) from exc
        except APIStatusError as exc:
            raise _status_error(self.model, exc) from exc
        except OpenAIError as exc:
            raise CoachInvalidResponseError(
                f"MetaCoachClient request to model {self.model} failed."
            ) from exc
        choice = completion.choices[0]
        usage = completion.usage
        completion_tokens = getattr(usage, "completion_tokens", None)
        details = getattr(usage, "completion_tokens_details", None)
        reasoning_tokens = getattr(details, "reasoning_tokens", None)
        content = choice.message.content
        if not content or not content.strip():
            raise CoachInvalidResponseError(
                f"MetaCoachClient received an empty reply from model {self.model}.",
                finish_reason=choice.finish_reason,
                completion_tokens=completion_tokens,
                reasoning_tokens=reasoning_tokens,
            )
        return CoachCompletion(
            content=content.strip(),
            finish_reason=choice.finish_reason,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
        )


def generate_coach_hint(
    client: MetaCoachClient,
    *,
    system_prompt: str,
    context_json: str,
    temperature: float = COACH_TEMPERATURE,
    max_tokens: int = COACH_MAX_TOKENS,
    timeout: float = COACH_TIMEOUT_SECONDS,
) -> tuple[dict[str, str], str | None]:
    """Run one provider call and return the validated hint plus finish reason.

    ``context_json`` passes through verbatim (assembled, allowlisted, and
    serialized by ``coach_context``). Raises the typed ``CoachError``
    subclasses above; never returns partial or unvalidated output.
    """
    completion = client.respond(
        system_prompt=system_prompt,
        context_json=context_json,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    return parse_coach_output(completion.content), completion.finish_reason
