# CS-45 contextual coaching contract

Agent: Codex. 2026-11-01. Revision `s3-coach-r2`. **DRAFT, not implemented.**
Base: dev `939af9f98ba9fd292d8d6f8ee44d22b5d96c6230`.

This is the Sprint 3 extension of [the API contract](api_contract.md).
[Wire fixtures and acceptance matrix](cs45-coaching-fixtures.json) accompany it.
Claude and Muse must approve an exact commit/revision or explicitly waive review
on CS-45. Codex records adoption with direct affected-owner acknowledgments;
silence is not acceptance. CS-43/46 remain blocked until CS-45 delivers.
Historical Sprint 2 acceptance and pinned scoring remain intact.

Revision2 addresses CS-C188/190/192/193. The user authorized the recommended
one additional requested same-head attempt. Both reviewers must review these
complete revised bytes; prior conditional approval is not r2 acceptance.

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
- Each session-revision-independent head group is
  `(session_id, branch_id, head_node_id-or-root, contract_revision)` and holds at
  most two immutable results, numbered attempt1 and attempt2. A generation/cache
  slot is that tuple plus attempt. Automatic help always requests attempt1;
  requested initial help also uses attempt1. Once attempt1 is saved, the learner
  may explicitly choose `Try another approach` for attempt2, including after a
  fallback or at root/seven. Automatic work never creates attempt2. No third
  attempt, editing/replacing saved hints or unlimited regeneration.
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
  "trigger": "automatic",
  "attempt": 1
}
```

`head_node_id` is a positive ID or null; `expected_revision` a nonnegative
integer; `trigger` exactly `automatic` or `requested`.
`attempt` is required, a strict integer1 or2. Attempt2 requires requested trigger
and a committed attempt1 in the same head group; otherwise409 hint_not_ready
(retryable true) if1 is absent/pending, or422 validation_error for automatic2.
Attempt3/zero/noninteger/unknown fields return422 validation_error, never a
provider call. No user-supplied context,
scenario, score, prompt, draft, model or timeout fields. Unknown fields fail422.
For example, requested help at an empty branch uses null and its current revision.

One additional explicit request after saved attempt1:

```json
{
  "branch_id": 31,
  "head_node_id": 103,
  "expected_revision": 4,
  "trigger": "requested",
  "attempt": 2
}
```

HTTP200, whether newly generated or cached:

```json
{
  "session_id": 12,
  "branch_id": 31,
  "head_node_id": 103,
  "revision": 4,
  "hint": {
    "id": 71,
    "contract_revision": "s3-coach-r2",
    "attempt": 1,
    "approach": "Give her control over whether to talk now.",
    "example": "We can leave this for later. Would you rather have some space?",
    "reason": "She asked to stop, so another demand may make the exchange harder.",
    "source": "meta",
    "fallback_reason": null,
    "latency_ms": 1320
  }
}
```

`Hint`: positive `id`; fixed contract revision; strict `attempt`1 or2;
trimmed plain-text `approach`
1–240 Unicode code points, `example`1–320, `reason`1–360; `source` exactly
`meta` or `deterministic`; integer `latency_ms`0–10000 measured from entry to
coach service until validated result/fallback chosen, excluding transport and
SQLite final commit, saturating at10000 rather than rejecting clock/dispatch
overshoot. Record uncapped HTTP/browser elapsed separately. `fallback_reason` null for Meta, else one of
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
        "contract_revision": "s3-coach-r2",
        "attempt": 1,
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

GET's revision is the current session revision in its consistent snapshot.
GET accepts no query parameters. One consistent DB snapshot, no model calls,
including inactive branches. Unknown session/foreign or unknown branch404.
Return only this branch's persisted hints at root or heads on its current
ancestry, oldest ancestor first (root before nodes), at most two per head group,
one per numbered slot. Within each head order contract_revision lexically then
attempt ascending (1 before2), with hint ID as a final deterministic tiebreaker.
An empty
list is normal and creates nothing. Return every stored contract revision if
future revisions coexist; only current
`s3-coach-r2` satisfies this revision's cache/automatic decision. No sibling or
future-head results. Selecting a branch never generates help by itself outside
the Arena's stalled-head mount behavior above.

## Concurrency, persistence and retry

1. Resolve an existing UUID first: same fingerprint and completed result replays
   exact original200, regardless of current state; different fingerprint409
   idempotency_conflict; unexpired pending UUID409 request_in_progress. For a new
   action, resolve session/branch/node ownership; validate current session revision,
   active branch and exact head. Unknown references404; stale revision409
   `stale_revision`; inactive409 `inactive_branch`; head differs409
   `parent_mismatch`. Verify trigger/attempt prerequisites and automatic
   eligibility before cache/generation;
   ineligible422 `hint_not_eligible` (retryable false).
2. Claim durable request reservation using existing canonical method/path/body
   fingerprint and UUID rules, rechecking key races atomically. Coach pending
   UUID reservations expire after30seconds, matching coach slot leases; do not
   inherit practice.py's120second persona reservation default. Preserve completed
   results indefinitely under existing replay retention. All failed actions,
   including state-change409 after generation, release their owned pending key
   and slot reservation; owner token prevents cleanup of a newer worker.
3. Look up an already saved slot before reserving generation. On cache hit,
   atomically validate current state and finish this UUID with the saved Hint
   and current envelope revision. Otherwise enforce one active generation lease
   per numbered slot across different keys and both
   triggers, not just a unique UUID. Different-key same-slot work receives409
   `request_in_progress`; release the losing action's pending UUID reservation
   without touching the winner's slot lease. Retry of that UUID can therefore
   re-enter validation/cache lookup and converge on the saved winner. It may
   retry the same key after2seconds without
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
6. A new key at a previously saved numbered slot validates current state and
   returns that Hint with current envelope revision. Different trigger uses the
   same attempt1 cache. Cached fallback is terminal only for that attempt;
   explicitly requested attempt2 may try the current configuration/provider once
   more and receives attempt1 as prior context. Retrying attempt1 never silently
   upgrades to2. A new key for already saved2 returns saved2; asking for3 is422.
   Automatic1 after two saved results returns1, never generates3 or replaces2.
   UI selects the highest saved attempt for the current head group and ignores
   an arriving lower attempt as current display. Persisted attempt1 is unchanged.

Coach pending-key and slot expiry timestamps are durable Unix epoch seconds,
evaluated using wall-clock time across processes (same local host clock);
latency and deadlines use a monotonic clock. The30second expiry is a crash
recovery bound, not the client request budget. One active generation per numbered
slot; attempt2 cannot start while attempt1 is pending because committed1 is a
prerequisite. Two saved results per head bounds ordinary intentional generation,
not upstream billing under crashes/ambiguous delivery or the whole session's
spend. Record actual calls, attempts, cache hits and fallback reasons in evidence.

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
retry the same key no more often than every2seconds within one15second elapsed
action budget, checking GET for completion after each409. Stop when GET finds
the requested attempt's hint or the deadline expires; then show manual retry.
Apply the same bounded observation to hint_not_ready. All HTTP
attempts use the remaining budget, not a fresh15seconds each. No automatic retry for
422/404/500. User retry after an ambiguous network outcome retains original key.

## Public coach context and provider boundary

Muse owns context assembly and provider prompt. Never pass a Scenario, private
session_config dict, ORM object, PersonaBrief, need list or whole public DTO to
the coach client. A dedicated immutable allowlist projection is required.

Serialized context object has exactly:

```json
{
  "contract_revision": "s3-coach-r2",
  "persona": {
    "name": "Maya",
    "role": "Teenage daughter",
    "opening_message": "What do you want? I'm in the middle of something."
  },
  "learner_situation": "You are checking in about homework and phone boundaries.",
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

Use pinned session public persona name/role/opening, not a mutable catalog.
Project its public_context into top-level learner_situation: `You` describes
the learner, never the persona. The system instruction states that the learner
is speaking with the named person in that role. Maya/parent is an illustration,
not a global parent assumption; Bob/manager remains valid under the same prompt.
No private relationship detail is inferred. Pinned config does not currently
contain the public scenario title, so no title field or catalog fallback is
added. Include last six complete selected-head ancestor turns in chronological
order. Each turn contains only user_text/character_text. Keep the first500 code
points of each persona string and learner_situation; for each turn string retain its last1500 code
points. `omitted_turns` counts older complete turns excluded; `truncated` true
if any string was shortened or older turns omitted. Keep at most two earlier
saved hints from this same branch and contract revision: include strict ancestors
and, for attempt2 only, same-head committed attempt1. Sort by ancestry position
(root first), then attempt; take the latest two and retain that order, containing
only approach/example/reason. Thus same-head1 is last for attempt2. Root qualifies
as an earlier position for non-root requests. Attempt1 includes no same-head hint.
Do not include siblings, another contract's hints, or the result being generated.
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
guaranteeing agreement. The example itself must be non-hostile; do not help the
learner shame, manipulate or pressure the persona, or shame the learner. It must not impersonate Maya or output a continuation
as if already spoken. No chain-of-thought requested or exposed.

Exactly one system-instruction variant applies at all scores. At seven,
requested help uses the same public context and prompt; continuation/debrief
emerges from observable dialogue, not a score flag or private variant. All hints
are prohibited from promising scoring reveals at every score. Root automatic
requests explicitly return422 hint_not_eligible.

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
This feasibility probe is the first CS-43 work after task authorization, before
building the provider integration. After CS45 delivers, CS46 may implement
against approved DTOs, mock and15second client budget in parallel with this
probe. Only a measured contract delta pauses affected UI work pending review;
UI does not wait for internal token/temperature feasibility to start.
Use five calls each on Claude's N1 and H1 public contexts (ten total), with the
exact candidate parameters, parser and deadline. Record every success/fallback,
finish_reason, actual elapsed and parse validity; no silent retries. Require at
least9/10 valid structured replies inside8seconds, with zero hostile/injection
assistance in the observed outputs. Muse assesses all ten; attach the exact
credential-free public inputs and raw content outputs to CS43 for Claude's
independent review of the H1 judgment. Keep provider headers/secrets/reasoning
out of evidence. This small sample proves feasibility only,
not quality calibration. No live call is authorized/executed by this document
task alone. If the task owner's authorized probe cannot meet that bar, stop
affected provider work and return a measured contract delta for both reviewers and
the user; do not ship a permanently-falling-back integration as live coaching.
No parameter, JSON fence or deadline tuning waiver is granted in this draft:
changing512 tokens,0.3 temperature, parsing or8second deadline requires the
explicit delta review, since provider support/latency are unproven. Existing
approved UI work may continue unless affected by that delta; no implementation
may adopt changed response/timeout assumptions without written acceptance.
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

For root attempt1 use root template. Otherwise choose first template if zero
eligible earlier hints; A for odd count, B for even count. Count all saved
same-branch/current-contract strict-ancestor hints plus same-head1 when generating2,
not just the context's two-item window. Root2 counts its saved1 and therefore
uses A, not a repeat of the root template. These are generic
fallbacks, not a claim of contextual usefulness or known hidden motives. Always
label `Basic hint` for deterministic and `AI coach` for Meta. One explicit
attempt2 is allowed after any saved1; a cached response or network retry never
consumes a new attempt. Saved2 exhausts help generation at this head group.

## UI, ownership and verification gates

Use the neutral panel heading `Conversation coach`. Place the contextual card
at the top with approach/example/reason and its `AI coach` or `Basic hint`
source label. Put only the current turn's deterministic feedback beneath it,
with a `Turn feedback` label; preserve historical feedback in the recorder.
Place transport/error notes separately from hint text. Show public learner
situation in a separate scenario-context line outside hint and Turn feedback.
Without saved1 show Get a hint; with1 show Try another approach; after2 show
both saved results (2 current,1 expandable) and disable further generation with
`Two approaches saved for this turn`. During either pending request, disable
hint actions but keep dialogue usable. Retain retry action for an ambiguous
pending request, bound to its original attempt/body/key. Hide exhausted/current
state when moving to a different head group, then restore that group's records.
Automatic score-triggering can miss a conversation
going badly while score rises; requested help remains available independently
of score. Do not equate stalled scores or breakthroughs with learner quality.
Hint display is bound to captured session/branch/head and client navigation
generation. Any session/branch/head change hides old current hint and invalidates
pending presentation, even if an exact replay200 arrives. A revision mismatch
refreshes state; no response should overwrite newer session/query data. Query
keys include session, branch, head and contract revision; never key by scenario
alone. Re-read after pending resolves; no GET polling outside the bounded15second
pending observation. GET restoration should
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

Received cases are [Claude's conversations](cs45-claude-review-cases.md) from
CS-A40/CS-C188 and [Muse's user-side transcripts](cs45-muse-review-cases.md) from
CS-C190. Both declare prior Sprint2 cue exposure; they authored independently of
this draft without consulting cue tables in that session, not strictly cue-blind.
Held-out identifiers/hashes are in the fixture metadata; preimages remain with
reviewers. A cue-naive user/tester walkthrough belongs to CS47. Do not represent
these cases, author fixtures or user-side-only lines as observed persona outputs
or learner validation. File formatting may differ; CS-A40 is Claude's original
byte-hash reference. Preview reviews CS-C192/193 approved no committed r2.

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
