# CS-45 contextual coaching contract

Agent: Codex. 2026-11-01. Revision `s3-coach-r1`. **DRAFT, not implemented.**
Base: dev `939af9f98ba9fd292d8d6f8ee44d22b5d96c6230`.

This is the Sprint 3 extension of [the API contract](api_contract.md).
[Wire fixtures and acceptance matrix](cs45-coaching-fixtures.json) accompany it.
Claude and Muse must approve an exact commit/revision or explicitly waive review
on CS-45. Codex records adoption with direct affected-owner acknowledgments;
silence is not acceptance. CS-43/46 remain blocked until CS-45 delivers.
Historical Sprint 2 acceptance and pinned scoring remain intact.

## Purpose and interaction

Help a learner choose a productive next move, starting with Maya. The user's
informal attempt established believable persona and inadequate fixed hints;
their actual transcript is not available to this task. Author examples below
are synthetic and must never be presented as that user's dialogue.

The existing turn endpoint saves the persona exchange and deterministic feedback
exactly as before. A separate coach request runs after that success, never inside
the persona transaction. Coach failure cannot roll back or fail a saved turn.

- Automatic help: once per current completed turn when its score equals its
  parent's score (parent null means zero) and score is below seven. This is a
  mechanical stalled trigger, not an assessment of learner quality. Server
  verifies eligibility; client derives the same condition from public nodes.
- Requested help: a visible `Get a hint` action at any active head, including
  the empty opening and score seven. At seven, support continuation/debrief;
  never promise another scoring reveal. No unsent draft is sent to the coach.
- Each branch/head/revision-independent contract slot has at most one persisted
  result: `(session_id, branch_id, head_node_id-or-root, contract_revision)`.
  Automatic and requested help reuse it. No regenerate button or unbounded paid
  refresh at the same head. A new turn or a new branch creates a new slot.
- Load saved help before deciding whether to POST automatically. On a stalled
  head with no saved result, an Arena mount/reload may issue the automatic POST.
  No background prefetch, polling generation, or per-keystroke provider call.
- While pending, show `Getting a hint…` and retain prior hint labelled for its
  earlier turn. Disable duplicate hint actions, but keep the composer usable.
  A user may send a turn or navigate while coaching is pending.

## Endpoints and DTOs

Backend `8080`, frontend `5173`, same CORS, strict JSON and positive JS-safe IDs
as Sprint 2. No existing route or DTO changes. No coach field added to Node,
Coaching, State, Session or Tree. All success fields below are required; no
extra properties. Times are integer monotonic durations, not wall-clock IDs.

`POST /api/sessions/{session_id}/coach-hints`, canonical `Idempotency-Key` UUID:

```json
{
  "branch_id": 31,
  "head_node_id": 103,
  "expected_revision": 4,
  "trigger": "automatic"
}
```

`head_node_id` is a positive ID or null; `expected_revision` a nonnegative
integer; `trigger` exactly `automatic` or `requested`. No user-supplied context,
scenario, score, prompt, draft, model or timeout fields. Unknown fields fail422.
For example, requested help at an empty branch uses null and its current revision.

HTTP200, whether newly generated or cached:

```json
{
  "session_id": 12,
  "branch_id": 31,
  "head_node_id": 103,
  "revision": 4,
  "hint": {
    "id": 71,
    "contract_revision": "s3-coach-r1",
    "approach": "Give her control over whether to talk now.",
    "example": "We can leave this for later. Would you rather have some space?",
    "reason": "She asked to stop, so another demand may make the exchange harder.",
    "source": "meta",
    "fallback_reason": null,
    "latency_ms": 1320
  }
}
```

`Hint`: positive `id`; fixed contract revision; trimmed plain-text `approach`
1–240 Unicode code points, `example`1–320, `reason`1–360; `source` exactly
`meta` or `deterministic`; integer `latency_ms`0–10000 measured from entry to
coach service until validated result/fallback chosen, excluding transport and
SQLite final commit. `fallback_reason` null for Meta, else one of
`not_configured`, `timeout`, `unavailable`, `invalid_response`. Stored Hint
values, ID and latency never change on cache hits/replays. No raw model text,
endpoint, prompt, status exception, reasoning tokens or private data in DTOs.
Outer `revision` is the validated session revision of this response; an exact
idempotency replay preserves its original envelope, possibly now historical.

`GET /api/sessions/{session_id}/branches/{branch_id}/coach-hints`:

```json
{
  "session_id": 12,
  "branch_id": 31,
  "head_node_id": 103,
  "revision": 4,
  "hints": [
    {
      "head_node_id": 103,
      "hint": {
        "id": 71,
        "contract_revision": "s3-coach-r1",
        "approach": "Give her control over whether to talk now.",
        "example": "We can leave this for later. Would you rather have some space?",
        "reason": "She asked to stop, so another demand may make the exchange harder.",
        "source": "meta",
        "fallback_reason": null,
        "latency_ms": 1320
      }
    }
  ]
}
```

GET accepts no query parameters. One consistent DB snapshot, no model calls,
including inactive branches. Unknown session/foreign or unknown branch404.
Return only this branch's persisted hints at root or heads on its current
ancestry, oldest ancestor first (root before nodes), max one per slot. An empty
list is normal and creates nothing. Return every stored contract revision if
future revisions coexist, ordered by hint ID within the same head; only current
`s3-coach-r1` satisfies this revision's cache/automatic decision. No sibling or
future-head results. Selecting a branch never generates help by itself outside
the Arena's stalled-head mount behavior above.

## Concurrency, persistence and retry

1. Resolve session/branch/node ownership; validate current session revision,
   active branch and exact head. Unknown references404; stale revision409
   `stale_revision`; inactive409 `inactive_branch`; head differs409
   `parent_mismatch`. Verify automatic eligibility before cache/generation;
   ineligible422 `hint_not_eligible` (retryable false).
2. Claim durable request reservation using existing canonical method/path/body
   fingerprint and UUID rules. Exact completed replays return original200
   without rechecking current state, as for Sprint 2. Different payload/path
   with the key409 `idempotency_conflict`. A pending key409
   `request_in_progress`, retryable true. Validation before new work must not
   change these replay semantics: resolve existing key first.
3. Enforce one active generation lease per slot across different keys and both
   triggers, not just a unique UUID. Different-key same-slot work receives409
   `request_in_progress`; it may retry the same key after1second without
   automatic SDK retries. Lease expires after30seconds. Owner token guards
   publish/cleanup; expired workers cannot overwrite a winner. Crash recovery
   may call the upstream twice after expiry; exactly-once billing is not claimed.
4. Build allowlisted plain context, close read transaction, call provider with
   no SQLite lock. Cache hits make no provider calls. Before publishing even
   fallback, atomically revalidate session revision/active branch/head and lease
   owner. A concurrent turn/rewind/select returns the applicable409, stores no
   hint for that stale request, and leaves the new conversation unchanged.
5. Commit immutable hint row and completed idempotency response atomically.
   No node, score, active branch or session revision mutation. Rows reference
   same-session branch/head with null-root handled by an explicit unique slot
   key (SQLite NULL uniqueness alone is insufficient). Additive transactional
   migration; preserve existing turns, configs, nodes and databases. Restart
   preserves hints/cache/replay; no hint backfill or automatic startup API spend.
6. A new key at a previously saved slot validates current state and returns the
   saved Hint with the current envelope revision. Different trigger uses same
   cache. A cached deterministic fallback is terminal for this slot; retries
   retrieve it, not repeated live attempts. No public regeneration in Sprint3.

Session revision is a conversation version, not a coach-write version. Cache
slot does not include revision: selecting away/back reuses the saved hint.
Branch rewind copies no hint records. Original hints remain immutable; a fork
can obtain its own hint using only its shared-prefix conversation. Hints made
after a source branch diverges never enter the fork's context or GET response.

Reuse Sprint 2 error envelope. Infrastructure errors may still return safe500;
they must not be disguised as a persisted success. Unknown result/network
timeout: retain exact body+UUID, GET saved hints and refresh session/tree; retry
the same request only if the captured state is still current. A409 state change
discards action key, refreshes, and requires a newly bound action. Do not auto
POST on stale state. `request_in_progress` retains key, bounded client retry:
at most two retries at1second, then show manual retry. No automatic retry for
422/404/500. User retry after an ambiguous network outcome retains original key.

## Public coach context and provider boundary

Muse owns context assembly and provider prompt. Never pass a Scenario, private
session_config dict, ORM object, PersonaBrief, need list or whole public DTO to
the coach client. A dedicated immutable allowlist projection is required.

Serialized context object has exactly:

```json
{
  "contract_revision": "s3-coach-r1",
  "persona": {
    "name": "Maya",
    "role": "Teenage daughter",
    "public_context": "You are checking in after school.",
    "opening_message": "Can we not do this right now?"
  },
  "turns": [
    {
      "user_text": "I only asked about your day.",
      "character_text": "And I said I don't want to talk."
    }
  ],
  "omitted_turns": 0,
  "truncated": false,
  "previous_hints": []
}
```

Use pinned session public persona name/role/context/opening, not a mutable
catalog. Include last six complete selected-head ancestor turns in chronological
order. Each turn contains only user_text/character_text. Keep the first500 code
points of each persona string; for each turn string retain its last1500 code
points. `omitted_turns` counts older complete turns excluded; `truncated` true
if any string was shortened or older turns omitted. Keep at most two earlier
saved hints from this same branch at strict ancestors, latest two reordered
chronologically, containing only approach/example/reason. Root qualifies as an
earlier position for non-root requests. Do not include a current-head hint.
Prior hint text obeys the same DTO bounds. This bounds serialized input without
silently dropping a message role or merging user instructions with system text.

JSON-serialize this object with UTF-8 Unicode, sorted keys and compact separators;
send as a single user message after a fixed coach system instruction. Transcript
and prior hints are untrusted quoted data, never instructions. No score, needs
(even revealed ones), cue tables, classifier tags, resistance, persona_traits,
system_prompt, private IDs or siblings/future turns go to the model. Internal
binding IDs remain outside provider context. Public dialogue may itself contain
sensitive assertions; no assertion that a public-only prompt guarantees output
secrecy. Sentinel tests prove field exclusion, separate adversarial cases assess
reply behavior.

System instruction asks for one concrete approach, natural example and brief
reason grounded in observable dialogue, acknowledges uncertainty about motives,
respects refusal, and avoids inventing private facts, coaching scoring words or
guaranteeing agreement. It must not impersonate Maya or output a continuation
as if already spoken. No chain-of-thought requested or exposed.

Provider returns a JSON object with exactly approach/example/reason (same string
bounds); server attaches all provenance/timing/binding fields. Parse the entire
trimmed content as JSON; no fence stripping, substring extraction, coercion,
second repair call, unknown fields or HTML rendering. Empty/overlong/malformed
or wrong-type content becomes deterministic fallback. Render as text nodes.

## Configuration, deadline and deterministic fallback

Local inspection Nov1: ignored V1 and V2 root config contain Meta key SET and
HTTPS base api.meta.ai/v1; model override absent. Existing V1
`MetaSparkClient` defaults `muse-spark-1.3`, calls OpenAI chat.completions with
explicit base/key and max_retries=0. These are configuration/code findings,
not a fresh provider/eligibility verification. No endpoint invented here.

CS-43 uses META_MODEL_API_KEY, META_MODEL_API_BASE (required, no base default),
META_MODEL_API_MODEL (default matching existing muse-spark-1.3). Only explicit
Meta credentials; no Baseten or OPENAI key fallback. Missing/blank base/key/model,
invalid non-HTTPS base or userinfo/query/fragment => not_configured, zero network.
Muse verifies actual configured endpoint/model with a manual live probe before
delivery; absent capability is a recorded blocker/limitation, not invented config.
Extend run_backend.py's explicit env allowlist for Meta; process env wins over
explicit --env-file. No automatic V1 .env search/copy and no credentials in VITE_*.

One call: temperature0.3, max_tokens512, max_retries0, nonstreaming standard
chat.completions JSON content. No assumed provider JSON-schema mode/tool support.
Bound the whole network+read operation to8seconds, including SDK response body;
individual read inactivity timeout alone is insufficient. Backend must stop
waiting by8seconds and choose fallback by10seconds; timed-out workers may not
publish later. Exact cancellation mechanism is Muse-owned, acceptance tests
must prove the wall-clock bound including slow/trickled responses. Client coach
request timeout15seconds, separate from existing45second persona HTTP timeout.
Automatic hint should appear within10seconds server budget; record actual HTTP
and browser elapsed separately from persisted latency_ms. No measured claim yet.

Fallback on missing config, timeout (incl408/504), unavailable (SDK transport,
429/other non-success), invalid response (malformed/empty/schema-invalid200).
All return HTTP200 with deterministic Hint and safe fallback_reason; no provider
message/exception forwarded. Public-safe fixed output depends only on trigger
position and earlier hints, not private data. Exact bank:

| Position                              | approach                                   | example                                                             | reason                                                                      |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Root                                  | Start with a low-pressure invitation.      | Is now an okay time to talk, or would later be better?              | Giving a choice can make it easier to begin.                                |
| First stalled/requested non-root hint | Pause and invite their perspective.        | I may be missing something. What would you like me to understand?   | An invitation leaves room for their account without assuming their reasons. |
| Later hint, rotate A                  | Ask permission for one small question.     | Would it be okay if I asked one thing, or should we stop here?      | Permission gives the other person a clear way to set a boundary.            |
| Later hint, rotate B                  | Invite them to correct your understanding. | I may be reading this wrong. Is there anything you want to correct? | Checking your interpretation avoids assuming you know their reasons.        |

For non-root, choose first template if zero prior same-branch strict-ancestor
hints; otherwise A for odd count, B for even count (count all saved hints,
not the context's two-item window). Root always root template. These are generic
fallbacks, not a claim of contextual usefulness or known hidden motives. Always
label `Basic hint` for deterministic and `AI coach` for Meta. No regenerate or
provider-retry action for a saved fallback; next conversation turn may try live.

## UI, ownership and verification gates

Display approach/example/reason with source label and a help button, independent
of class-based score labels. Keep original deterministic node feedback available
in recorder; avoid showing repeated historical whispers as the main coach hint.
Hint display is bound to captured session/branch/head and client navigation
generation. Any session/branch/head change hides old current hint and invalidates
pending presentation, even if an exact replay200 arrives. A revision mismatch
refreshes state; no response should overwrite newer session/query data. Query
keys include session, branch, head and contract revision; never key by scenario
alone. Re-read after pending resolves; no auto-poll GET. GET restoration should
not trigger another Meta call. Late server results need no browser cancellation
guarantee; UI ignores them and server revalidation controls persistence.

| Owner        | Files and responsibilities                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CS-45  | docs/api_contract.md, this extension, wire fixtures, journal, document checker and explicit adoption record; incorporates reviewer cases with attribution                                                                                                                                                                                                                                                                                       |
| Muse CS-43   | new backend/coach.py, backend/coach_context.py, backend/coach_service.py, backend/test_coach*.py; sole backend editor of main.py route/dependencies, schemas.py coach DTOs, models.py hint/lease storage, migrations.py additive upgrade, practice.py only reusable reservation helpers if necessary; scripts/run_backend.py Meta allowlist and scripts/probe_coach_live.py manual probe; owns server/provider/context/fallback/migration tests |
| Claude CS-46 | src/lib/api/types.ts/http.ts/mock.ts/index.ts, src/lib/practice.ts, src/routes/arena.tsx and focused src/test coach tests; new reusable CoachHint.tsx if useful; repository scripts/verify_coaching_browser.mjs and documented usage; no backend writes                                                                                                                                                                                         |
| Codex CS-47  | integration review/PR sequencing and combined evidence; any fixes in another owner's files require explicit handoff                                                                                                                                                                                                                                                                                                                             |

Existing backend/persona.py, persona fixtures, judge.py, seed content and scoring
reference fixtures are outside implementation edits. conversation_context.py
ancestry helper may be imported, not repurposed for private coach data. If a
listed frontend path does not exist, Claude creates the agreed equivalent and
records it before edits. No concurrent backend/schema edit by Codex. Cross-file
requirements are reviewed here, not implemented unilaterally.

CS-45 checks document examples, schema/bounds/fixture consistency and links;
no server or paid calls required. This proves clarity, not coaching quality.
Each reviewer supplies at least one natural and one hostile conversation,
authored without reading scoring cue tables, plus one held-out case retained
by that reviewer until evaluation. Include author, exposure and synthetic/source
labels. Author examples here never substitute for those independent cases.
Review acceptance: usefulness (specific observable next move, natural example,
reason grounded in text, no unsupported motive, no coercion), repetition,
branch/public boundaries, exact schema/races and file ownership. Both reviewers
must approve exact revision; remaining implementation-forcing issues block it.

CS-43 delivery: mocked privacy/schema/race/cache/migration/deadline tests with
zero paid calls; real8080 HTTP harness, separate manual live Meta timing and
safe fallback evidence. Can deliver without full UI gate. CS-46: types/tests/
build, fixture UI followed by real8080/5173 live Meta browser checks; durable
browser procedure, labels for injected failures and keyboard operation.
CS-47: exact combined source, disposable DB, production-built frontend, Baseten
personas/Meta coaching, replay/rewind/reload/original regression, held-out cases
and user's Maya walkthrough. Record actual feedback; no score threshold can
stand in for usefulness. Report provider/injected/mocked evidence separately.
No main promotion, filing, analytics or scoring redesign belongs to these tasks.
