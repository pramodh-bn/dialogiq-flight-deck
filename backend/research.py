"""Conversation-prep research brief: a research agent that brings its sources.

Before a hard conversation the learner says who they will speak with, what
happened and what they want. The agent plans public research questions, searches
the live web (Tavily), reads the sources and writes a brief (Nebius Token
Factory). Contract: ``docs/research-brief-contract.md`` (research-r1).

A model's word is never taken for a citation. Every finding must carry a
verbatim quote, and ``check_finding`` keeps it only if that quote is in the
fetched source text and every figure in the claim is in the quote. Advice in the
brief may only point at findings that passed. What fails is reported, not hidden.
"""

import json
import logging
import os
import re
import time
import unicodedata
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from api_errors import ApiError, not_found
from models import ResearchBrief
from schemas import WireModel

logger = logging.getLogger("dialogiq.research")

CONTRACT_REVISION = "research-r1"
NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
NEBIUS_DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
LLM_TIMEOUT_S = 90.0
SEARCH_TIMEOUT_S = 30.0

MIN_QUESTIONS = 2
MAX_QUESTIONS = 5
RESULTS_PER_SEARCH = 5
MAX_FINDINGS_PER_QUESTION = 6
SOURCE_STORE_CHARS = 40_000  # text kept for checking quotes
SOURCE_PROMPT_CHARS = 5_000  # text shown to the model per source
MIN_QUOTE_WORDS = 5
MAX_QUOTE_CHARS = 400
LIST_LIMIT = 20


class ResearchError(Exception):
    """A research run that cannot continue; ``code`` is safe to show."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class LlmReply:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


# (system prompt, user prompt) -> reply. Injected so tests never call a provider.
LlmCall = Callable[[str, str], LlmReply]
# query -> Tavily-shaped results: title, url, content, raw_content, published_date.
SearchCall = Callable[[str], list[dict]]


class BriefRequest(WireModel):
    counterpart: str = Field(min_length=3, max_length=200)
    situation: str = Field(min_length=20, max_length=2000)
    goal: str = Field(min_length=5, max_length=500)
    constraints: str = Field(default="", max_length=1000)

    @field_validator("counterpart", "situation", "goal", "constraints", mode="before")
    @classmethod
    def trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


# --- Real providers -------------------------------------------------------


def nebius_llm(system: str, user: str) -> LlmReply:
    """One chat completion on Nebius Token Factory (OpenAI-compatible)."""
    api_key = os.environ.get("NEBIUS_API_KEY", "")
    if not api_key:
        raise ResearchError(
            "research_not_configured", "NEBIUS_API_KEY is not set on the server."
        )
    base = os.environ.get("NEBIUS_API_BASE", NEBIUS_BASE_URL).rstrip("/")
    model = os.environ.get("NEBIUS_MODEL", NEBIUS_DEFAULT_MODEL)
    try:
        response = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
                "max_tokens": 2500,
            },
            timeout=LLM_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        raise ResearchError(
            "research_model_timeout", "The model timed out.", retryable=True
        ) from None
    except httpx.HTTPError:
        raise ResearchError(
            "research_model_unavailable",
            "The model could not be reached.",
            retryable=True,
        ) from None
    if response.status_code in (401, 403):
        raise ResearchError(
            "research_not_configured", "Nebius Token Factory refused the key or model."
        )
    if response.status_code >= 400:
        logger.error("Nebius answered %s", response.status_code)
        raise ResearchError(
            "research_model_unavailable",
            f"The model answered {response.status_code}.",
            retryable=response.status_code in (408, 429) or response.status_code >= 500,
        )
    try:
        body = response.json()
        text = body["choices"][0]["message"]["content"] or ""
        usage = body.get("usage") or {}
    except (ValueError, KeyError, IndexError, TypeError):
        raise ResearchError(
            "research_model_invalid", "The model reply was not readable."
        ) from None
    return LlmReply(
        text=text,
        model=str(body.get("model") or model),
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
    )


def tavily_search(query: str) -> list[dict]:
    """One advanced Tavily search with page text, so quotes can be checked."""
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        raise ResearchError(
            "research_not_configured", "TAVILY_API_KEY is not set on the server."
        )
    try:
        response = httpx.post(
            TAVILY_SEARCH_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "query": query,
                "search_depth": "advanced",
                "max_results": RESULTS_PER_SEARCH,
                "include_raw_content": "markdown",
                "include_answer": False,
            },
            timeout=SEARCH_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        raise ResearchError(
            "research_search_timeout", "Web search timed out.", retryable=True
        ) from None
    except httpx.HTTPError:
        raise ResearchError(
            "research_search_unavailable",
            "Web search could not be reached.",
            retryable=True,
        ) from None
    if response.status_code == 401:
        raise ResearchError("research_not_configured", "Tavily refused the key.")
    if response.status_code in (432, 433):
        raise ResearchError(
            "research_search_quota", "The Tavily plan or credit limit is used up."
        )
    if response.status_code >= 400:
        logger.error("Tavily answered %s", response.status_code)
        raise ResearchError(
            "research_search_unavailable",
            f"Web search answered {response.status_code}.",
            retryable=response.status_code == 429 or response.status_code >= 500,
        )
    try:
        results = response.json()["results"]
    except (ValueError, KeyError, TypeError):
        raise ResearchError(
            "research_search_invalid", "The search reply was not readable."
        ) from None
    return results if isinstance(results, list) else []


# --- Checking a finding against its source --------------------------------

ELLIPSIS = re.compile(r"\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…")
NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def normalize(text: str) -> str:
    """Words and digits only, single-spaced, so markup and spacing do not matter."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", folded).split())


def numbers_in(text: str) -> set[str]:
    return {
        match.replace(",", "").rstrip(".")
        for match in NUMBER.findall(unicodedata.normalize("NFKC", text))
    }


def quote_in_source(quote: str, source_text: str) -> bool:
    """True when the quote's words appear in the source, in order, word for word.

    An ellipsis in the quote may skip source text; each part must still be found
    after the one before it.
    """
    haystack = f" {normalize(source_text)} "
    parts = [normalize(part) for part in ELLIPSIS.split(quote)]
    parts = [part for part in parts if part]
    if sum(len(part.split()) for part in parts) < MIN_QUOTE_WORDS:
        return False
    position = 0
    for part in parts:
        found = haystack.find(f" {part} ", position)
        if found < 0:
            return False
        position = found + len(part) + 1
    return True


def check_finding(claim: str, quote: str, source_text: str | None) -> str | None:
    """Why a finding is rejected, or None when its citation holds."""
    if source_text is None:
        return "unknown_source"
    if not claim or not quote or len(quote) > MAX_QUOTE_CHARS:
        return "malformed"
    if not quote_in_source(quote, source_text):
        return "quote_not_in_source"
    if not numbers_in(claim) <= numbers_in(quote):
        return "figure_not_in_quote"
    return None


# --- Model output ---------------------------------------------------------

THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


def parse_json_object(text: str) -> dict:
    """The JSON object in a model reply; reasoning blocks and fences are ignored."""
    cleaned = THINK_BLOCK.sub("", text)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object")
    value = json.loads(cleaned[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("not an object")  # noqa: TRY004 - one error type for callers
    return value


def strings(value: object, limit: int, max_chars: int = 400) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [" ".join(item.split()) for item in value if isinstance(item, str)]
    return [item[:max_chars] for item in items if item][:limit]


PLAN_SYSTEM = """You plan public web research that helps someone prepare for a \
difficult conversation. Reply with one JSON object and nothing else.

Rules:
- Write 3 to 5 research questions whose answers are public facts: prices, market \
rates, published policies, laws and regulations, standard practice, alternatives, \
public statements by organisations, well-evidenced guidance.
- Never research a private individual. Do not put a private person's name in a \
query. Research the organisation, product, role, market or practice instead.
- Each query is a short web search (under 15 words), specific enough to find a \
primary or reputable source.
- "learner_said" lists facts the person stated themselves. Copy them faithfully; \
do not add to them.
- "assumptions" lists things the person appears to be assuming about the other \
side that they have not verified. These are guesses to test, not facts.

Shape:
{"questions": [{"question": "...", "query": "...", "why": "how the answer helps \
in the conversation"}], "learner_said": ["..."], "assumptions": ["..."]}"""

EXTRACT_SYSTEM = """You read web sources and report only what they say. Reply \
with one JSON object and nothing else.

For the research question, list findings that the sources state. For each finding:
- "claim": one plain sentence, faithful to the source, no more specific than it.
- "source": the id of the source, for example "S3".
- "quote": the sentence or phrase from that source that supports the claim, \
copied word for word, at most 300 characters. Every figure in the claim must \
appear in the quote. Do not paraphrase the quote and do not join text from \
different places unless you mark the gap with "...".

Use only the sources given. If they do not answer the question, return an empty \
list. Do not use what you know from elsewhere. At most 6 findings; prefer the \
most useful for the question, and prefer primary and recent sources.

Shape:
{"findings": [{"claim": "...", "source": "S1", "quote": "..."}]}"""

FOLLOWUP_SYSTEM = """A web search did not answer some research questions. Write \
one better web search query for each: different words, a more specific source \
type, or a narrower scope. Never include a private individual's name. Reply with \
one JSON object and nothing else.

Shape:
{"queries": [{"id": "Q2", "query": "..."}]}"""

SYNTH_SYSTEM = """You help someone prepare for a difficult conversation using \
only verified research findings. Reply with one JSON object and nothing else.

- "talking_points": 3 to 6 things worth knowing or saying going in. Each must \
rest on the findings and list their ids in "facts". State nothing as fact that \
the listed findings do not say, and use no figure that is not in them. Say what \
it means for this conversation.
- "questions_to_ask": 3 to 5 open questions to ask the other person, to learn \
what research cannot tell: their view, constraints and priorities. Do not claim \
to know what the other person thinks or wants.
- "open_questions": what remains unknown after this research and is worth \
finding out before or during the conversation.

Shape:
{"talking_points": [{"text": "...", "facts": ["F1", "F3"]}], \
"questions_to_ask": ["..."], "open_questions": ["..."]}"""


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


class Run:
    """One research run: holds what has been found and counts what it cost."""

    def __init__(self, request: BriefRequest, llm: LlmCall, search: SearchCall) -> None:
        self.request = request
        self.llm = llm
        self.search = search
        self.started = time.monotonic()
        self.questions: list[dict] = []
        self.sources: list[dict] = []
        self.source_text: dict[str, str] = {}
        self.by_url: dict[str, str] = {}
        self.facts: list[dict] = []
        self.rejected: list[dict] = []
        self.learner_said: list[str] = []
        self.assumptions: list[str] = []
        self.model = ""
        self.llm_calls = 0
        self.search_calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0

    def situation(self) -> str:
        request = self.request
        return (
            f"Who they will speak with: {request.counterpart}\n"
            f"What happened: {request.situation}\n"
            f"What they want from the conversation: {request.goal}\n"
            f"Constraints: {request.constraints or '(none given)'}"
        )

    def ask(self, system: str, user: str) -> dict:
        """A model call that must return a JSON object; one retry on bad output."""
        for attempt in (1, 2):
            reply = self.llm(system, user)
            self.llm_calls += 1
            self.model = reply.model or self.model
            self.prompt_tokens += reply.prompt_tokens
            self.completion_tokens += reply.completion_tokens
            try:
                return parse_json_object(reply.text)
            except ValueError:
                logger.warning("Model reply was not JSON (attempt %s)", attempt)
        raise ResearchError(
            "research_model_invalid", "The model did not return usable output."
        )

    # -- steps --

    def plan(self) -> None:
        data = self.ask(PLAN_SYSTEM, self.situation())
        for item in data.get("questions") or []:
            if not isinstance(item, dict):
                continue
            question = " ".join(str(item.get("question") or "").split())
            query = " ".join(str(item.get("query") or "").split())
            if not question or not query:
                continue
            self.questions.append(
                {
                    "id": f"Q{len(self.questions) + 1}",
                    "question": question[:300],
                    "why": " ".join(str(item.get("why") or "").split())[:300],
                    "queries": [query[:200]],
                    "answered": False,
                }
            )
            if len(self.questions) == MAX_QUESTIONS:
                break
        if len(self.questions) < MIN_QUESTIONS:
            raise ResearchError(
                "research_no_plan",
                "No public research questions could be planned for this situation.",
            )
        self.learner_said = strings(data.get("learner_said"), 8)
        self.assumptions = strings(data.get("assumptions"), 6)

    def gather(self, query: str) -> list[dict]:
        """Search, and register each result once as a numbered source."""
        results = self.search(query)
        self.search_calls += 1
        found = []
        for item in results:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            if not url.startswith(("http://", "https://")):
                continue
            text = str(item.get("raw_content") or item.get("content") or "").strip()
            if not text:
                continue
            source_id = self.by_url.get(url)
            if source_id is None:
                source_id = f"S{len(self.sources) + 1}"
                self.by_url[url] = source_id
                self.source_text[source_id] = text[:SOURCE_STORE_CHARS]
                published = item.get("published_date")
                self.sources.append(
                    {
                        "id": source_id,
                        "title": " ".join(str(item.get("title") or url).split())[:200],
                        "url": url,
                        "published_date": published
                        if isinstance(published, str)
                        else None,
                        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
                        "cited": False,
                    }
                )
            found.append(next(s for s in self.sources if s["id"] == source_id))
        return found

    def extract(self, question: dict, sources: list[dict]) -> Iterator[dict]:
        """Ask for findings on one question and check each against its source."""
        if not sources:
            return
        blocks = "\n\n".join(
            f"[{source['id']}] {source['title']}\n{source['url']}\n"
            f"{self.source_text[source['id']][:SOURCE_PROMPT_CHARS]}"
            for source in sources
        )
        data = self.ask(
            EXTRACT_SYSTEM,
            f"Research question: {question['question']}\n\nSources:\n\n{blocks}",
        )
        offered = {source["id"] for source in sources}
        items = data.get("findings") or []
        for item in (
            items[:MAX_FINDINGS_PER_QUESTION] if isinstance(items, list) else []
        ):
            if not isinstance(item, dict):
                continue
            claim = " ".join(str(item.get("claim") or "").split())[:500]
            quote = " ".join(str(item.get("quote") or "").split())
            source_id = str(item.get("source") or "").strip().strip("[]")
            text = self.source_text.get(source_id) if source_id in offered else None
            reason = check_finding(claim, quote, text)
            if reason is None and any(
                fact["source_id"] == source_id
                and normalize(fact["quote"]) == normalize(quote)
                for fact in self.facts
            ):
                continue  # the same passage, already kept
            if reason is not None:
                rejected = {
                    "question_id": question["id"],
                    "claim": claim,
                    "source_id": source_id if text is not None else None,
                    "reason": reason,
                }
                self.rejected.append(rejected)
                yield {"verified": False, **rejected}
                continue
            fact = {
                "id": f"F{len(self.facts) + 1}",
                "question_id": question["id"],
                "claim": claim,
                "source_id": source_id,
                "quote": quote,
            }
            self.facts.append(fact)
            question["answered"] = True
            next(s for s in self.sources if s["id"] == source_id)["cited"] = True
            yield {"verified": True, **fact}

    def follow_up_queries(self, unanswered: list[dict]) -> dict[str, str]:
        listing = "\n".join(
            f"{q['id']}: {q['question']} (tried: {q['queries'][-1]})"
            for q in unanswered
        )
        try:
            data = self.ask(FOLLOWUP_SYSTEM, listing)
        except ResearchError:
            return {}
        wanted = {q["id"] for q in unanswered}
        queries: dict[str, str] = {}
        for item in data.get("queries") or []:
            if not isinstance(item, dict):
                continue
            question_id = str(item.get("id") or "").strip()
            query = " ".join(str(item.get("query") or "").split())[:200]
            if question_id in wanted and query:
                queries.setdefault(question_id, query)
        return queries

    def synthesize(self) -> dict:
        """Advice that may only point at verified findings; the rest is dropped."""
        if not self.facts:
            return {
                "talking_points": [],
                "questions_to_ask": [],
                "open_questions": [q["question"] for q in self.questions],
                "dropped_points": 0,
            }
        fact_lines = "\n".join(
            f'{fact["id"]}: {fact["claim"]} (source says: "{fact["quote"]}")'
            for fact in self.facts
        )
        unanswered = [q["question"] for q in self.questions if not q["answered"]]
        data = self.ask(
            SYNTH_SYSTEM,
            f"{self.situation()}\n\nVerified findings:\n{fact_lines}\n\n"
            "Research questions with no verified answer:\n"
            + ("\n".join(f"- {q}" for q in unanswered) or "(none)"),
        )
        by_id = {fact["id"]: fact for fact in self.facts}
        points, dropped = [], 0
        for item in data.get("talking_points") or []:
            if not isinstance(item, dict):
                continue
            text = " ".join(str(item.get("text") or "").split())[:500]
            cited = [
                fact_id
                for fact_id in dict.fromkeys(strings(item.get("facts"), 6, 8))
                if fact_id in by_id
            ]
            support = " ".join(
                f"{by_id[i]['claim']} {by_id[i]['quote']}" for i in cited
            )
            if not text or not cited or not numbers_in(text) <= numbers_in(support):
                dropped += 1
                continue
            points.append({"text": text, "facts": cited})
        open_questions = strings(data.get("open_questions"), 6)
        for question in unanswered:
            if question not in open_questions:
                open_questions.append(question)
        return {
            "talking_points": points[:6],
            "questions_to_ask": strings(data.get("questions_to_ask"), 5),
            "open_questions": open_questions,
            "dropped_points": dropped,
        }

    def result(self, advice: dict) -> dict:
        return {
            "contract_revision": CONTRACT_REVISION,
            "request": self.request.model_dump(),
            "questions": self.questions,
            "sources": self.sources,
            "facts": self.facts,
            "rejected": self.rejected,
            "learner_said": self.learner_said,
            "assumptions": self.assumptions,
            **advice,
            "run": {
                "model": self.model,
                "llm_provider": "Nebius Token Factory",
                "search_provider": "Tavily",
                "llm_calls": self.llm_calls,
                "search_calls": self.search_calls,
                "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens,
                "seconds": round(time.monotonic() - self.started, 1),
            },
        }


def research(run: Run) -> Iterator[tuple[str, dict]]:
    """The agent loop, as (event, data) pairs; the last pair is the brief."""
    yield "step", {"stage": "plan", "message": "Planning what is worth looking up"}
    run.plan()
    yield (
        "plan",
        {
            "questions": run.questions,
            "learner_said": run.learner_said,
            "assumptions": run.assumptions,
        },
    )

    def look_up(question: dict, query: str) -> Iterator[tuple[str, dict]]:
        yield "step", {"stage": "search", "question_id": question["id"], "query": query}
        sources = run.gather(query)
        yield (
            "sources",
            {
                "question_id": question["id"],
                "query": query,
                "sources": [
                    {key: source[key] for key in ("id", "title", "url")}
                    for source in sources
                ],
            },
        )
        yield "step", {"stage": "read", "question_id": question["id"]}
        for finding in run.extract(question, sources):
            yield "finding", finding

    for question in run.questions:
        yield from look_up(question, question["queries"][0])

    unanswered = [q for q in run.questions if not q["answered"]]
    if unanswered:
        yield (
            "step",
            {
                "stage": "follow_up",
                "message": "Trying a second search where nothing held up",
                "question_ids": [q["id"] for q in unanswered],
            },
        )
        queries = run.follow_up_queries(unanswered)
        for question in unanswered:
            query = queries.get(question["id"])
            if query and query not in question["queries"]:
                question["queries"].append(query)
                yield from look_up(question, query)

    yield "step", {"stage": "write", "message": "Writing the brief from what held up"}
    yield "brief", run.result(run.synthesize())


# --- Persistence and routes -----------------------------------------------


def brief_dto(row: ResearchBrief) -> dict:
    return {
        "brief_id": row.id,
        "status": row.status,
        "created_at": row.created_at.replace(tzinfo=UTC).isoformat(timespec="seconds"),
        **(row.result or {"request": row.request}),
    }


def open_brief(
    session_factory: sessionmaker,
    request: BriefRequest,
    llm: LlmCall,
    search: SearchCall,
) -> Iterator[str]:
    """Run the research and stream it; the row is saved in short transactions."""
    with session_factory() as db:
        row = ResearchBrief(
            created_at=datetime.now(UTC).replace(tzinfo=None),
            status="running",
            request=request.model_dump(),
        )
        db.add(row)
        db.commit()
        brief_id = row.id

    def finish(status: str, result: dict | None) -> None:
        with session_factory() as db:
            saved = db.get(ResearchBrief, brief_id)
            saved.status = status
            saved.result = result
            db.commit()

    def events() -> Iterator[str]:
        status, result = "interrupted", None
        try:
            yield sse("started", {"brief_id": brief_id})
            for event, data in research(Run(request, llm, search)):
                if event == "brief":
                    status, result = "complete", data
                    finish(status, result)
                    with session_factory() as db:
                        data = brief_dto(db.get(ResearchBrief, brief_id))
                yield sse(event, data)
        except ResearchError as error:
            status = "failed"
            yield sse(
                "error",
                {
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable,
                },
            )
        except Exception as error:  # noqa: BLE001 - never leak provider text
            status = "failed"
            logger.error("Research run failed with %s", type(error).__name__)
            yield sse(
                "error",
                {
                    "code": "internal_error",
                    "message": "The research run could not be completed.",
                    "retryable": False,
                },
            )
        finally:
            if status != "complete":
                finish(status, None)

    return events()


def build_router(db_dep: object) -> APIRouter:
    """Routes under ``/api/research``."""
    router = APIRouter(prefix="/api/research")
    brief_path = Annotated[int, Path(gt=0, le=2**53 - 1)]

    @router.post("/briefs")
    def create(payload: BriefRequest, request: Request) -> StreamingResponse:
        state = request.app.state
        return StreamingResponse(
            open_brief(
                state.session_factory,
                payload,
                state.research_llm,
                state.research_search,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.get("/briefs")
    def briefs(request: Request, db: db_dep) -> list[dict]:  # type: ignore[valid-type]
        if request.query_params:
            raise ApiError(
                422, "validation_error", "This endpoint takes no query parameters."
            )
        rows = db.scalars(
            select(ResearchBrief)
            .where(ResearchBrief.status == "complete")
            .order_by(ResearchBrief.id.desc())
            .limit(LIST_LIMIT)
        )
        return [
            {
                "brief_id": row.id,
                "created_at": row.created_at.replace(tzinfo=UTC).isoformat(
                    timespec="seconds"
                ),
                "counterpart": row.request.get("counterpart", ""),
                "goal": row.request.get("goal", ""),
                "facts": len((row.result or {}).get("facts", [])),
                "sources": sum(
                    1 for s in (row.result or {}).get("sources", []) if s.get("cited")
                ),
            }
            for row in rows
        ]

    @router.get("/briefs/{brief_id}")
    def brief(brief_id: brief_path, db: db_dep) -> dict:  # type: ignore[valid-type]
        row = db.get(ResearchBrief, brief_id)
        if row is None:
            raise not_found("brief")
        return brief_dto(row)

    return router
