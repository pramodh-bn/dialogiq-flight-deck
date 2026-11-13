# Research brief contract (research-r1)

The research agent behind `/prepare`. Code: `backend/research.py`. Tests:
`backend/test_research.py`. Client: `src/lib/research.ts`.

## Rule

A fact reaches the brief only if code, not a model, has checked its citation.
Advice may rest only on facts that passed. What fails is kept and shown as
rejected.

## Providers

| Job | Provider | Call |
| --- | --- | --- |
| Plan, read, follow up, write | Nebius Token Factory | `POST {NEBIUS_API_BASE}/chat/completions` |
| Live web search with page text | Tavily | `POST https://api.tavily.com/search`, `search_depth: advanced`, `include_raw_content: markdown`, 5 results |

Server environment: `NEBIUS_API_KEY`, `TAVILY_API_KEY` (both required),
`NEBIUS_MODEL` (default `meta-llama/Llama-3.3-70B-Instruct`), `NEBIUS_API_BASE`
(default `https://api.tokenfactory.nebius.com/v1`). Keys never reach the browser.

## Steps of one run

1. **Plan.** One model call returns 2 to 5 research questions, each with one
   search query, plus `learner_said` (facts the learner stated) and
   `assumptions` (what they seem to assume about the other side). The prompt
   forbids researching a private individual or putting a private person's name
   in a query. Fewer than 2 usable questions ends the run with `research_no_plan`.
2. **Search.** One Tavily search per question. Each new URL becomes a source
   `S1`, `S2`, … and its page text is kept for the run (first 40,000 characters).
3. **Read.** One model call per question sees up to 5,000 characters of each
   source and returns up to 6 findings, each `{claim, source, quote}`.
4. **Check** (`check_finding`, no model). A finding is kept as fact `F1`, `F2`, …
   only if all of these hold:
   - its source is one that was shown for that question (`unknown_source`);
   - claim and quote are present and the quote is at most 400 characters
     (`malformed`);
   - the quote has at least 5 words and is in the stored page text word for
     word. Both are compared as lower-cased words and digits, so markup,
     punctuation and spacing do not matter. A quote may skip text with `...`;
     each part must appear, as whole words, after the part before it
     (`quote_not_in_source`);
   - every number in the claim is also in the quote (`figure_not_in_quote`).
5. **Follow up.** Questions with no fact get one new query (one model call for
   all of them) and steps 2 to 4 once more. There is no third try.
6. **Write.** One model call sees only the facts and the learner's situation. A
   talking point is kept only if it cites at least one real fact id and uses no
   number absent from the facts it cites; others are counted in
   `dropped_points`. With no facts this call is skipped and the brief has no
   advice.

A run makes at most 10 searches (5 first, 5 follow-up) and 13 model calls
(1 plan, 5 read, 1 follow-up, 5 read, 1 write). A model call is repeated once
if its reply is not JSON.

## What the check does and does not prove

It proves the quoted words were on the fetched page and the figures in the claim
are in those words. It does not prove the page is right, that the claim is a
fair reading of the quote beyond its figures, or that the page still says so
later. The page shows the quote beside every fact and links the source so a
reader can judge both.

## API

### `POST /api/research/briefs`

Body (unknown fields are refused, 422):

| Field | Rule |
| --- | --- |
| `counterpart` | 3 to 200 characters |
| `situation` | 20 to 2000 characters |
| `goal` | 5 to 500 characters |
| `constraints` | optional, up to 1000 characters |

Response: `text/event-stream`. Each event is `event: <name>` and one
`data: <json>` line.

| Event | Data |
| --- | --- |
| `started` | `{brief_id}` |
| `step` | `{stage, message?, question_id?, query?, question_ids?}`; `stage` is `plan`, `search`, `read`, `follow_up` or `write` |
| `plan` | `{questions, learner_said, assumptions}` |
| `sources` | `{question_id, query, sources: [{id, title, url}]}` |
| `finding` | `{verified: true, id, question_id, claim, source_id, quote}` or `{verified: false, question_id, claim, source_id, reason}` |
| `brief` | the full brief (below); always the last event of a good run |
| `error` | `{code, message, retryable}`; always the last event of a failed run |

Error codes: `research_not_configured`, `research_no_plan`,
`research_model_timeout`, `research_model_unavailable`, `research_model_invalid`,
`research_search_timeout`, `research_search_unavailable`,
`research_search_quota`, `research_search_invalid`, `internal_error`. Provider
error text is never passed on.

### `GET /api/research/briefs/{brief_id}`

The saved brief, or 404. `status` is `running`, `complete`, `failed` or
`interrupted`; only a complete brief has the fields below.

```
brief_id, status, created_at, contract_revision, request
questions[]      {id, question, why, queries[], answered}
sources[]        {id, title, url, published_date, retrieved_at, cited}
facts[]          {id, question_id, claim, source_id, quote}
rejected[]       {question_id, claim, source_id, reason}
learner_said[], assumptions[]
talking_points[] {text, facts[]}
questions_to_ask[], open_questions[], dropped_points
run              {model, llm_provider, search_provider, llm_calls, search_calls,
                  prompt_tokens, completion_tokens, seconds}
```

### `GET /api/research/briefs`

The 20 newest complete briefs: `{brief_id, created_at, counterpart, goal, facts,
sources}`.

## Stored data

Table `research_briefs`: the request and the finished brief. Page text is not
stored after the run; quotes and URLs are.
