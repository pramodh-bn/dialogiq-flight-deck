"""Research brief: citation checks and the agent loop, with fake providers."""

import json
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import research
from database import create_sqlite_engine
from main import create_app

PAGE_RENT = (
    "# Rent report 2026\n\nThe median rent for a one-bedroom flat in Leeds rose "
    "to £1,050 a month in 2026, up 4% on the year before. Landlords must give "
    "at least two months' written notice of any rent increase."
)
PAGE_LAW = (
    "Under the Renters' Rights Act a landlord may raise the rent only once a "
    "year, and a tenant can challenge an increase at the First-tier Tribunal."
)
REQUEST = {
    "counterpart": "My landlord's letting agent",
    "situation": "The agent wrote to say my rent goes up by 12% next month.",
    "goal": "Agree a smaller increase",
}


def reply(data: dict) -> research.LlmReply:
    return research.LlmReply(json.dumps(data), "fake-model", 10, 5)


class FakeLlm:
    """Answers by which system prompt it is given; records every call."""

    def __init__(self, **answers: object) -> None:
        self.answers = answers
        self.calls: list[tuple[str, str]] = []

    def __call__(self, system: str, user: str) -> research.LlmReply:
        self.calls.append((system, user))
        for name, prompt in (
            ("plan", research.PLAN_SYSTEM),
            ("extract", research.EXTRACT_SYSTEM),
            ("followup", research.FOLLOWUP_SYSTEM),
            ("synth", research.SYNTH_SYSTEM),
        ):
            if system == prompt:
                answer = self.answers[name]
                if callable(answer):
                    answer = answer(user)
                if isinstance(answer, str):
                    return research.LlmReply(answer, "fake-model")
                return reply(answer)
        raise AssertionError("unexpected prompt")


PLAN = {
    "questions": [
        {"question": "What is the market rent?", "query": "leeds rent 2026", "why": ""},
        {"question": "What are the rules?", "query": "rent increase law", "why": ""},
    ],
    "learner_said": ["Rent goes up by 12% next month."],
    "assumptions": ["The agent can negotiate."],
}


def search(query: str) -> list[dict]:
    if "law" in query:
        return [{"title": "Law", "url": "https://law.example/a", "content": PAGE_LAW}]
    return [
        {
            "title": "Rent report",
            "url": "https://rent.example/r",
            "content": "snippet",
            "raw_content": PAGE_RENT,
            "published_date": "2026-05-01",
        }
    ]


def source_id(user: str, title: str) -> str:
    """The id the run gave a source; it depends on the order of the searches."""
    return re.search(rf"\[(S\d+)\] {title}", user).group(1)


def extract(user: str) -> dict:
    if "market rent" in user:
        rent = source_id(user, "Rent report")
        return {
            "findings": [
                {
                    "claim": "Median one-bedroom rent in Leeds is £1,050 a month.",
                    "source": rent,
                    "quote": "median rent for a one-bedroom flat in Leeds rose to "
                    "£1,050 a month",
                },
                {
                    "claim": "Rents rose 9% in a year.",
                    "source": rent,
                    "quote": "up 4% on the year before",
                },
                {
                    "claim": "Most tenants negotiate successfully.",
                    "source": rent,
                    "quote": "most tenants who ask get a lower increase than first",
                },
                {
                    "claim": "Something from nowhere at all.",
                    "source": "S9",
                    "quote": "a landlord may raise the rent only once a year",
                },
            ]
        }
    return {
        "findings": [
            {
                "claim": "A landlord may raise rent only once a year.",
                "source": f"[{source_id(user, 'Law')}]",
                "quote": "a landlord may raise the rent only once a year ... a "
                "tenant can challenge an increase",
            }
        ]
    }


SYNTH = {
    "talking_points": [
        {"text": "Market median is £1,050; compare your rent.", "facts": ["F1"]},
        {"text": "Rents are up 30% so expect a rise.", "facts": ["F1"]},
        {"text": "No citation here.", "facts": []},
        {"text": "Cites nothing real.", "facts": ["F7"]},
        {"text": "You can challenge the increase.", "facts": ["F2", "F2"]},
    ],
    "questions_to_ask": ["What is driving the increase?"],
    "open_questions": ["What comparable flats cost on this street."],
}


def events(body: str) -> Iterator[tuple[str, dict]]:
    for block in body.strip().split("\n\n"):
        name, data = block.split("\n", 1)
        yield name.removeprefix("event: "), json.loads(data.removeprefix("data: "))


@pytest.fixture
def make_client(tmp_path: Path) -> Iterator:
    clients = []

    def make(llm: research.LlmCall, search_call: research.SearchCall = search):
        engine = create_sqlite_engine(f"sqlite:///{tmp_path / 'research.db'}")
        app = create_app(engine, research_llm=llm, research_search=search_call)
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


# --- check_finding ---


def test_quote_must_be_in_source_word_for_word() -> None:
    assert research.quote_in_source("rose to £1,050 a month in 2026", PAGE_RENT)
    assert research.quote_in_source("ROSE TO  £1,050 A MONTH — in 2026", PAGE_RENT)
    assert not research.quote_in_source("rose to £1,150 a month in 2026", PAGE_RENT)
    assert not research.quote_in_source("rent rose sharply in Leeds in 2026", PAGE_RENT)


def test_quote_parts_must_be_whole_words_in_order() -> None:
    assert research.quote_in_source("median rent ... up 4% on the year", PAGE_RENT)
    assert not research.quote_in_source("up 4% on the year ... median rent", PAGE_RENT)
    assert not research.quote_in_source("dian rent for a one-bedroom flat", PAGE_RENT)


def test_short_quotes_are_refused() -> None:
    assert not research.quote_in_source("rent increase", PAGE_RENT)


def test_check_finding_reasons() -> None:
    quote = "median rent for a one-bedroom flat in Leeds rose to £1,050 a month"
    assert research.check_finding("Rent is £1,050.", quote, PAGE_RENT) is None
    assert research.check_finding("Rent is 1050.", quote, PAGE_RENT) is None
    assert (
        research.check_finding("Rent is £1,500.", quote, PAGE_RENT)
        == "figure_not_in_quote"
    )
    assert (
        research.check_finding("x", "words that are not on the page", PAGE_RENT)
        == "quote_not_in_source"
    )
    assert research.check_finding("x", quote, None) == "unknown_source"
    assert research.check_finding("", quote, PAGE_RENT) == "malformed"
    assert research.check_finding("x", "a " * 300, PAGE_RENT) == "malformed"


def test_parse_json_object_ignores_reasoning_and_fences() -> None:
    text = '<think>{"no": 1}</think>\n```json\n{"a": [1]}\n```'
    assert research.parse_json_object(text) == {"a": [1]}
    with pytest.raises(ValueError):
        research.parse_json_object("no json here")


# --- the run ---


def test_brief_keeps_only_what_the_sources_say(make_client) -> None:
    llm = FakeLlm(plan=PLAN, extract=extract, synth=SYNTH)
    client = make_client(llm)
    response = client.post("/api/research/briefs", json=REQUEST)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    stream = list(events(response.text))
    names = [name for name, _ in stream]
    assert names[0] == "started" and names[-1] == "brief"
    assert "error" not in names

    brief = stream[-1][1]
    assert brief["status"] == "complete"
    assert brief["contract_revision"] == research.CONTRACT_REVISION
    assert [f["id"] for f in brief["facts"]] == ["F1", "F2"]
    assert [f["source_id"] for f in brief["facts"]] == ["S1", "S2"]
    assert [r["reason"] for r in brief["rejected"]] == [
        "figure_not_in_quote",
        "quote_not_in_source",
        "unknown_source",
    ]
    assert brief["rejected"][2]["source_id"] is None
    assert all(s["cited"] for s in brief["sources"])
    assert brief["sources"][0]["published_date"] == "2026-05-01"
    # Uncited, wrongly cited and new-figure points are dropped.
    assert brief["talking_points"] == [
        {"text": "Market median is £1,050; compare your rent.", "facts": ["F1"]},
        {"text": "You can challenge the increase.", "facts": ["F2"]},
    ]
    assert brief["dropped_points"] == 3
    assert brief["learner_said"] == PLAN["learner_said"]
    assert brief["assumptions"] == PLAN["assumptions"]
    assert brief["run"]["llm_calls"] == 4
    assert brief["run"]["search_calls"] == 2
    assert brief["run"]["model"] == "fake-model"

    findings = [data for name, data in stream if name == "finding"]
    assert [f["verified"] for f in findings] == [True, False, False, False, True]

    saved = client.get(f"/api/research/briefs/{brief['brief_id']}").json()
    assert saved == brief
    listed = client.get("/api/research/briefs").json()
    assert listed[0]["brief_id"] == brief["brief_id"]
    assert listed[0]["facts"] == 2 and listed[0]["sources"] == 2


def test_unanswered_question_gets_one_follow_up_search(make_client) -> None:
    queries: list[str] = []

    def searching(query: str) -> list[dict]:
        queries.append(query)
        if query == "leeds rent 2026":
            return []
        return search(query)

    llm = FakeLlm(
        plan=PLAN,
        extract=extract,
        followup={
            "queries": [
                {"id": "Q1", "query": "ONS private rent Leeds"},
                {"id": "Q9", "query": "ignored"},
            ]
        },
        synth=SYNTH,
    )
    client = make_client(llm, searching)
    stream = list(events(client.post("/api/research/briefs", json=REQUEST).text))
    brief = stream[-1][1]
    assert queries == ["leeds rent 2026", "rent increase law", "ONS private rent Leeds"]
    assert brief["questions"][0]["queries"] == [
        "leeds rent 2026",
        "ONS private rent Leeds",
    ]
    assert brief["questions"][0]["answered"]
    assert any(d.get("stage") == "follow_up" for n, d in stream if n == "step")


def test_no_findings_gives_an_honest_empty_brief(make_client) -> None:
    llm = FakeLlm(
        plan=PLAN, extract={"findings": []}, followup={"queries": []}, synth=SYNTH
    )
    client = make_client(llm)
    brief = list(events(client.post("/api/research/briefs", json=REQUEST).text))[-1][1]
    assert brief["facts"] == [] and brief["talking_points"] == []
    assert brief["open_questions"] == [q["question"] for q in PLAN["questions"]]
    assert not any(system == research.SYNTH_SYSTEM for system, _ in llm.calls)


def test_bad_model_output_is_retried_once_then_fails(make_client) -> None:
    llm = FakeLlm(plan="I cannot answer in JSON.")
    client = make_client(llm)
    stream = list(events(client.post("/api/research/briefs", json=REQUEST).text))
    assert stream[-1][0] == "error"
    assert stream[-1][1]["code"] == "research_model_invalid"
    assert len(llm.calls) == 2
    brief_id = stream[0][1]["brief_id"]
    assert client.get(f"/api/research/briefs/{brief_id}").json()["status"] == "failed"
    assert client.get("/api/research/briefs").json() == []


def test_provider_failure_is_reported_without_its_text(make_client) -> None:
    def broken(query: str) -> list[dict]:
        raise RuntimeError("secret upstream detail")

    client = make_client(FakeLlm(plan=PLAN), broken)
    response = client.post("/api/research/briefs", json=REQUEST)
    last = list(events(response.text))[-1]
    assert last[0] == "error" and last[1]["code"] == "internal_error"
    assert "secret" not in response.text


def test_missing_keys_are_a_clear_error(make_client, monkeypatch) -> None:
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    client = make_client(research.nebius_llm)
    last = list(events(client.post("/api/research/briefs", json=REQUEST).text))[-1]
    assert last == (
        "error",
        {
            "code": "research_not_configured",
            "message": "NEBIUS_API_KEY is not set on the server.",
            "retryable": False,
        },
    )


def test_request_is_validated(make_client) -> None:
    client = make_client(FakeLlm())
    assert client.post("/api/research/briefs", json={}).status_code == 422
    short = {**REQUEST, "situation": "too short"}
    assert client.post("/api/research/briefs", json=short).status_code == 422
    extra = {**REQUEST, "model": "x"}
    assert client.post("/api/research/briefs", json=extra).status_code == 422
    assert client.get("/api/research/briefs/999").status_code == 404
