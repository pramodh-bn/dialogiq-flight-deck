# DialogIQ V2 API contract

CS-36 · Codex · 2026-10-30 · revision 2, **draft pending Claude/Muse re-review**.

This document is the proposed Sprint 2 implementation agreement for CS-39,
CS-41 and CS-42. It supersedes the port examples in the Sprint 1 report and
the generated-graph language in the early Sprint 2 plan. It does not assert
that planned endpoints already work. Changes require a recorded contract
revision and coordination with affected owners before implementation.

## Implementation boundary

Baseline inspected: `dev` at `0ed9284`. Current behavior:

| Operation                              | Baseline                                                              | Sprint 2 target                                       |
| -------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /health`                          | Working health JSON                                                   | Unchanged                                             |
| `GET /api/scenarios`                   | Public id/title/description array                                     | Add public persona fields                             |
| `GET /api/scenarios/{id}`              | Absent                                                                | Public scenario detail                                |
| `POST /api/sessions`                   | Creates demo-user session; score 0                                    | Idempotent creation and snapshot                      |
| `GET /api/sessions?scenario_id={id}`   | Absent                                                                | List scenario sessions for Hub resume                 |
| `GET /api/sessions/{id}`               | Absent                                                                | Resume persisted active branch                        |
| `POST /api/chat/turn`                  | Fixed reply, turn_id 1, score 3; no session validation or persistence | Atomic persisted persona turn and deterministic judge |
| `GET /api/sessions/{id}/tree`          | Absent                                                                | Real persisted tree and all branches                  |
| `POST /api/sessions/{id}/branches`     | Absent                                                                | Rewind into a new branch                              |
| `PUT /api/sessions/{id}/active-branch` | Absent                                                                | Select an existing branch                             |

All target shapes, constraints, errors, coaching and scoring below are
**planned**, including changes to existing routes. The existing HTTP adapter
has only listScenarios/createSession/sendTurn and cannot yet exercise the
planned loop. Sprint 1 chat accepts an unknown session and whitespace text;
neither is acceptable Sprint 2 behavior. No separate coach, score, analytics,
streaming, voice, or scenario-creation endpoint is included in Sprint 2.

## Ports, configuration and launch

Run each agent's checkout with its own `backend/.venv`, ignored configuration
and SQLite database. Never share a live SQLite file between worktrees.
Use Node 26.13.0/npm 11.20.0 and Python 3.15 (the pinned baseline toolchain).
Verify executable paths and versions first. If the NVM shim has no active
version, prepend its installed version directory to PATH; do not change a
machine-wide installation for this task.

From the isolated worktree root, once:

```powershell
$env:PATH = 'C:\Users\User\AppData\Local\Author Software\nvm\installs\v26.13.0;' + $env:PATH
node --version
npm.cmd --version
py -3.15 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd ci --ignore-scripts
```

Backend terminal, from root:

```powershell
$env:DIALOGIQ_CORS_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'
Set-Location backend
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8080
```

Frontend terminal, from root (Node version directory on PATH):

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8080'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. Explicit CLI flags override the Lovable wrapper's
default port; preserve its existing plugin configuration. Occupied ports are
an error, never a reason to silently use 5174 or stop unrelated processes.
Stop only processes started for this check. HTTP adapter selection occurs at
Vite startup/build; restart after changing `VITE_API_BASE_URL`. An unset value
selects the mock and cannot establish API integration.

The baseline database is `backend/dialogiq.db`; startup creates/seeds an empty
database. `create_all` does not migrate old databases. CS-42 must ship a
repeatable migration of existing Sprint 1 data before claiming persistence.
Do not delete an existing user's database as an upgrade procedure.

Backend allows exactly the two frontend origins above for the target launch,
including JSON and `Idempotency-Key` preflights and GET/POST/PUT/OPTIONS.
CORS is not authentication. Sprint 2 remains a local single demo-user app;
there is no user_id in requests and no cross-user authorization claim.
`/health` remains `{ "status": "healthy", "service": "dialogiq-backend" }`;
it does not assert provider readiness.

Baseline checks require no model credentials. Live persona configuration is
server-only `BASETEN_API_KEY`, optional `BASETEN_API_BASE` and `BASETEN_MODEL`.
No `VITE_*` key and no fallback to another provider's key. Local `.env` files
are not automatically loaded by the current backend: load configuration into
the backend process environment without printing values. Fireworks is CS-43
in Sprint 3 and does not block deterministic Sprint 2 coaching.

## Wire conventions and state

- JSON uses snake_case, UTF-8, and `application/json`. No SSE or partial turns.
- All scenario/session/branch/node IDs are server-issued positive JSON integers
  within JavaScript's safe range. Clients treat them as opaque. Null is used
  only where explicitly allowed. Never assume seed IDs or reuse IDs after deletion.
- A node represents one complete user/persona exchange, not a single bubble.
  `turn_id` is exactly `node.id`. Opening dialogue is scenario data, not a node.
- A branch has an immutable fork point and mutable head. Its transcript is the
  unique chain of node parents from root to head. Shared prefix nodes keep their
  original IDs; a node does not require a single owning branch.
- A session has one persisted active branch. `revision` starts at 0 and increases
  once per successful new mutation, including inactive-branch selection and
  branch creation; selecting the already active branch is a successful no-op
  that keeps revision. Idempotent replay does not increment it.
- Score is the count of distinct revealed needs on that branch, from 0 to 7.
  It is never the sum/max across branches. Session score mirrors its active
  branch. Branch selection or rewind may reduce the displayed session score.
- User text is stripped at both ends and must then contain 1–4000 Unicode code
  points. Preserve the stripped original for dialogue. Reject unknown request
  fields and invalid types (including booleans as IDs); do not silently coerce.
- All mutations require `Idempotency-Key`: a client-generated canonical lowercase
  UUID string, retained across retries of one action. A new intentional action
  gets a new key. Body `expected_revision` is a nonnegative integer.

### Public DTOs

The following field lists are exhaustive; each listed field is required.
Arrays may be empty. Objects must not expose ORM rows wholesale.

| DTO          | Fields and meanings                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario     | `id`, `title` string, `description` string or null, `persona` Persona                                                                                                                                                |
| Persona      | `name`, `role`, `initials`, `opening_message`, `public_context` (strings); `tags` string array of public display traits; `practice_hints` string array of generic communication advice                               |
| RevealedNeed | `id` string (scenario-local `n1`…`n7`), `title` string, `description` string; only actually revealed entries                                                                                                         |
| Metrics      | `turns`, `open_questions`, `closed_questions`, `empathy_turns` (nonnegative integers); `open_question_ratio` number 0–1, open/(open+closed), 0 when denominator is 0                                                 |
| Coaching     | `source` literal `deterministic`; `question_type` `open`/`closed`/`statement`; `empathy` and `leading` booleans; `outcome` `breakthrough`/`deadend`/`neutral`; `alternatives` string array; `whispers` Whisper array |
| Whisper      | `kind` `good`/`warn`/`tip`, `text` string                                                                                                                                                                            |
| State        | `score` integer 0–7, `total_needs` literal 7, `revealed_needs` RevealedNeed array in n1…n7 order, `resistance` `guarded`/`warming`/`open`, `metrics` Metrics                                                         |
| Session      | `id`, `scenario_id`, `active_branch_id`, `active_head_node_id` (node ID or null), `revision`, plus all State fields                                                                                                  |
| Node         | `id`, `session_id`, `parent_id` (node ID or null), `turn_number` (chain depth, starts 1), `user_text`, `character_text` (strings), `coaching` Coaching, plus all State fields                                        |
| Branch       | `id`, `session_id`, `fork_node_id` (node ID or null), `head_node_id` (node ID or null), plus all State fields                                                                                                        |
| Tree         | `session_id`, `revision`, `active_branch_id`, `branches` Branch array, `nodes` Node array                                                                                                                            |

Persona.tags is required display data, never private personality instructions.
No timestamps, branch names, resistance percentages or empathy percentages
are required in the DTOs. Use actual metrics and resistance enum
instead of inventing numeric model outputs. Node and branch State snapshots
reflect only their prefix and must survive reload unchanged.

## Endpoint operations

### Public scenarios

`GET /api/scenarios` → 200 Scenario array sorted by id. No pagination in Sprint 2.
`GET /api/scenarios/{scenario_id}` → 200 same Scenario; 404 if absent.

Example detail (illustrative ID; use returned IDs):

```json
{
  "id": 1,
  "title": "Bob: Defensive Team Member",
  "description": "Performance review · missed Q3 deadlines",
  "persona": {
    "name": "Bob",
    "role": "Team member",
    "initials": "B",
    "tags": ["Guarded", "Performance review"],
    "opening_message": "You wanted to see me? If this is about Q3, I already sent the update.",
    "public_context": "You are meeting to discuss missed deadlines.",
    "practice_hints": ["Invite their perspective before proposing a solution."]
  }
}
```

Each seeded scenario must have a matching public persona and distinct opening;
do not substitute Bob for Daughter, Priya or Vendor. Private seed content is
specified below. Muse authors per-scenario public/private persona wording in
`backend/persona_fixtures.json` under CS-39; Codex loads the fixture in seed.py
under CS-42. The public example illustrates shape, not frozen copy. See the
persona handoff below for the exact fixture fields and ownership.

### Create and resume

`POST /api/sessions`, header `Idempotency-Key`, body:

```json
{ "scenario_id": 1 }
```

→ 201 Session, also on replay. Create exactly one initial branch with null fork
and head, score 0, no revealed needs, guarded resistance, zero metrics, revision 0.
Unknown scenario → 404. Explicit New Session is the only UI action that creates
a run. The Hub action creates it with one key retained across retries/double
submissions; Arena only resumes by GET, never POST on mount. Navigation or
StrictMode remounts must not create sessions. Client stores returned session
ID in the Arena URL
`/arena?sessionId=12`, with optional scenarioId only as a consistency check.

`GET /api/sessions/12` → 200 Session; 404 if absent. No side effects.
Resume by GET, then get tree to render the selected branch's ancestor chain
and prepend scenario.opening_message. A scenarioId mismatch must show an error
or redirect to the session's actual scenario, never silently mix personas.

Hub data source: `GET /api/sessions?scenario_id=1` → 200 Session array for the
local demo user and selected scenario, newest first by created_at descending
then id descending. The required query scenario_id is a positive safe integer;
missing/invalid or unknown query fields → 422 validation_error. Unknown scenario
→ 404 scenario_not_found; known scenario with no runs → `[]`. No side effects,
pagination or authentication addition. Each item reflects its persisted active
branch State. The Hub uses the first item for Resume Practice and View Branch
Tree, or disables those actions when empty; New Session remains explicit.
A clean browser can resume without invented localStorage/session caches.

Initial Session example:

```json
{
  "id": 12,
  "scenario_id": 1,
  "active_branch_id": 31,
  "active_head_node_id": null,
  "revision": 0,
  "score": 0,
  "total_needs": 7,
  "revealed_needs": [],
  "resistance": "guarded",
  "metrics": {
    "turns": 0,
    "open_questions": 0,
    "closed_questions": 0,
    "empathy_turns": 0,
    "open_question_ratio": 0
  }
}
```

### Submit a turn and obtain coaching/score

`POST /api/chat/turn`, header `Idempotency-Key`, body:

```json
{
  "session_id": 12,
  "branch_id": 31,
  "parent_node_id": null,
  "expected_revision": 0,
  "user_message": "What has this quarter been like for you?"
}
```

→ 200 `{ "turn_id": 81, "character_response": "…",
"revealed_node_score": 1, "node": Node, "session": Session }`.
`character_response` equals node.character_text; revealed_node_score equals
node.score; Session active_head_node_id is 81 and revision is 1. See the complete
response example below. Coaching is node.coaching, not another provider request.

Branch must belong to the session and be active. Parent must equal that branch's
current head, including null at the opening. To edit an earlier turn, create a
new branch first; submitting to an arbitrary parent never silently forks.
Provider history is opening assistant dialogue followed by the selected parent
chain's user/assistant messages and this new user text, oldest first. No sibling
messages, other sessions, UI sample dialogue or rolled-back turns enter history.
Sprint 2 never truncates history silently; reject a provider context failure
with the mapped provider error and leave state unchanged.

Validate references, revision and text before a model call. Judge the candidate
reveal, call the persona with private brief plus current branch and permitted
candidate reveal, then atomically commit the complete node, branch/session State
and idempotency result. A failure commits none of these. Do not save half a user
turn, advance score early, fabricate fallback dialogue or report fixed success.
Use a 30-second persona request timeout, no automatic provider retries. Concurrent
requests must revalidate revision before commit; a race loser returns 409 and
must not persist its generation. One upstream call may have occurred in that race;
database idempotency is not an exactly-once billing guarantee.

Complete success example:

```json
{
  "turn_id": 81,
  "character_response": "The quarter has felt difficult to keep up with.",
  "revealed_node_score": 1,
  "node": {
    "id": 81,
    "session_id": 12,
    "parent_id": null,
    "turn_number": 1,
    "user_text": "What has this quarter been like for you?",
    "character_text": "The quarter has felt difficult to keep up with.",
    "coaching": {
      "source": "deterministic",
      "question_type": "open",
      "empathy": false,
      "leading": false,
      "outcome": "breakthrough",
      "alternatives": ["What else would you like to share?"],
      "whispers": [{ "kind": "good", "text": "Open invitation: leave room for their perspective." }]
    },
    "score": 1,
    "total_needs": 7,
    "revealed_needs": [
      {
        "id": "n1",
        "title": "Quarter experience",
        "description": "The quarter has been difficult to keep up with."
      }
    ],
    "resistance": "guarded",
    "metrics": {
      "turns": 1,
      "open_questions": 1,
      "closed_questions": 0,
      "empathy_turns": 0,
      "open_question_ratio": 1
    }
  },
  "session": {
    "id": 12,
    "scenario_id": 1,
    "active_branch_id": 31,
    "active_head_node_id": 81,
    "revision": 1,
    "score": 1,
    "total_needs": 7,
    "revealed_needs": [
      {
        "id": "n1",
        "title": "Quarter experience",
        "description": "The quarter has been difficult to keep up with."
      }
    ],
    "resistance": "guarded",
    "metrics": {
      "turns": 1,
      "open_questions": 1,
      "closed_questions": 0,
      "empathy_turns": 0,
      "open_question_ratio": 1
    }
  }
}
```

### Retrieve the recorder tree

`GET /api/sessions/12/tree` → 200 Tree, 404 if absent. Return every persisted node
once, sorted by id, and every branch sorted by id. This permits rendering old
branches; the backend must never use the entire tree as persona/coach context.
There is no generated root exchange: the UI may draw a synthetic opening node
but must use null, never its synthetic ID, in requests. A fresh session yields
one empty Branch and `nodes: []`. Fetch session/tree again if revisions differ
due to a concurrent mutation; do not merge inconsistent snapshots.

### Rewind and select branches

`POST /api/sessions/12/branches`, header `Idempotency-Key`, body:

```json
{ "source_branch_id": 31, "rewind_to_node_id": 81, "expected_revision": 3 }
```

→ 201 `{ "branch": Branch, "session": Session }`, also on replay.
Target must occur on source branch's root-to-head path; source may be inactive.
The target exchange is **included**. New branch fork_node_id and head_node_id
both equal 81; its State copies node 81. It becomes active and revision increases
to 4. Old branch head, nodes, scores and coaching remain unchanged. No model call.
To retry node 81's question, rewind to its parent, not 81. Null target starts
before every user turn, retaining only public opening dialogue and zero State.
Rewinding the current head still creates a new branch, as explicitly requested.

UI mapping is explicit: **Branch from here** sends the selected node ID as
rewind_to_node_id (include this exchange; continue after it). **Rewind to this
node** sends its parent_id (exclude/retry this exchange; null for turn 1).
Both use a source branch whose ancestor chain contains the selected node,
preferring the active branch; otherwise choose the lowest-id containing branch.
Disable actions until the real tree is loaded. Do not invent a second endpoint.

Example: old path 81→82→83, rewind inclusive to 81, submit alternate turn 84:
old branch remains headed at 83; new branch heads at 84 with parent_id 81.
No reveal from 82 or 83 may appear on 84 unless earned again by its own path.

`PUT /api/sessions/12/active-branch`, header `Idempotency-Key`, body:

```json
{ "branch_id": 31, "expected_revision": 5 }
```

→ 200 Session; selecting an existing branch resumes at its stored head and State.
No node/branch is created and no model call occurs. Revision becomes 6 unless
already active. `/flight-recorder?sessionId=12` identifies the real session.
Arena resume
uses the persisted active branch after selection; never navigate with mock data.

## Duplicate requests, conflicts and error responses

Idempotency scope is the local demo user plus key across all mutation routes.
Store method, concrete path, canonical validated request body and success status/
body durably with the mutation. Compare after text trimming; JSON key order is
irrelevant. Identical completed retries return the original status/body, before
checking current revision, even after restart or later branch changes. They do
not reactivate an old branch. The UI refetches current session/tree after replay
or uncertain network outcomes rather than replacing newer state with old State.
A changed body/path/method under that key is 409 `idempotency_conflict`.
An identical request still in flight is 409 `request_in_progress`; retry the
same key later. Failed mutations do not consume a completed key; retry with the
same body/key after transient failure. Persisted reservations must be released
after failure or process recovery; no permanent pending keys after restart.

Error response for all planned routes:

```json
{
  "detail": {
    "code": "stale_revision",
    "message": "Reload the session before retrying.",
    "retryable": false
  }
}
```

| HTTP | code                                      | Trigger / action                                                                                                      |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 422  | `validation_error`                        | Missing/malformed UUID header, invalid IDs/revision/type, unknown fields, invalid/blank/overlong message; fix request |
| 404  | `scenario_not_found`, `session_not_found` | Referenced top-level resource absent                                                                                  |
| 404  | `branch_not_found`, `node_not_found`      | Missing or wrong-session branch/node; never expose another session's details                                          |
| 409  | `stale_revision`                          | expected_revision differs; GET session/tree before a new action/key                                                   |
| 409  | `inactive_branch`                         | Turn targets a valid but inactive branch                                                                              |
| 409  | `parent_mismatch`                         | Existing same-session parent is not the active branch head                                                            |
| 409  | `rewind_target_not_on_branch`             | Valid same-session node is not in source ancestry                                                                     |
| 409  | `idempotency_conflict`                    | Same key used for different mutation                                                                                  |
| 409  | `request_in_progress`                     | Same operation still running; retryable true                                                                          |
| 503  | `persona_unavailable`                     | Missing configuration, upstream authentication/rate limit/unavailability; retryable true                              |
| 504  | `persona_timeout`                         | Upstream exceeds 30 seconds; retryable true                                                                           |
| 502  | `persona_invalid_response`                | Empty/malformed result, rejected request/context limit, other upstream failure; retryable true                        |
| 500  | `internal_error`                          | Unexpected persistence/server failure; retryable false, no partial commit                                             |

All other errors above have retryable false unless explicitly true. Do not expose
provider response bodies, model prompts, exception traces, keys or private needs
in errors/logs. Retryable means safe to retry the same operation/key; configuration
or context errors can still require intervention. Baseline errors differ: current
404 is `{ "detail": "Scenario not found" }` and 422 is FastAPI's validation array.
CS-42 must normalize validation and handler errors; CS-41 must implement the
new envelope together with the API adapter, not assume it already exists.

Validation precedence: syntax/types → completed/in-flight idempotency check →
session/scenario existence → branch/node ownership → revision → active branch →
parent/ancestry → provider. No paid request on a reference or conflict error.
Mutation responses have no hidden key/ref reveal in error messages.

## Deterministic judge and proof fixtures

Sprint 2 uses seven fixed scorable needs per scenario, with **no prerequisite
edges or enforced reveal order**. n1 is an initial invitation; n2…n7 are distinct
need categories. The model never creates, reorders, deletes or scores needs.
Generic cues are an explicit Sprint 2 scope decision: the same eligible
questions can earn all seven categories in each scenario, revealing that
scenario's different fixed content. This is not scenario-specific semantic
understanding. Do not add a model judge or scenario-specific cue calibration
under CS-36; disclose this limitation in demo evidence.

Normalize input by Unicode NFKC, lowercase, convert curly apostrophes to ASCII,
collapse whitespace and strip surrounding whitespace. Classify each nonempty
sentence after splitting on one or more of `.`, `!`, `?`; trim whitespace and
leading straight or curly single/double quotation marks on each sentence.

A sentence is open if it begins with `what`, `how`, `why`, `tell me`,
`help me`, `walk me`, `describe`, or `in what`. Otherwise it is closed if
it begins with `do`, `does`, `did`, `is`, `are`, `was`, `were`,
`can`, `could`, `will`, `would`, `should`, `have`, `has`, `had`,
`won't`, `don't`, `isn't`, or `aren't`. Prefixes must end at the end of
the sentence or before a non-ASCII-letter/digit character; apostrophes are
boundaries **for classification**, so "What's" and "How's" are open. This
intentionally fixes r1's contraction regression. A turn is open if any sentence
is open, else closed if any is closed, else statement. A question mark alone
does not determine class. "That sounds frustrating. How could I support you?"
is open. No requirement to reorder an acknowledgment before a question.

`leading` is true if the normalized whole turn contains a bounded phrase
`don't you`, `isn't it`, `you should`, `you must`, `your fault`,
`just admit`, or `obviously`. At each phrase edge, ASCII letters/digits/
apostrophes count as word characters. This bounded-phrase rule applies only
to the leading filter, not the different classifier/stem boundary rules.
Set leading on **all** turn classes; it does not alter question_type or
metric counts.

A turn is eligible **only if question_type is open and leading is false**.
Closed and statement turns reveal nothing even when they contain a cue.
No empathy prerequisite is imposed. Select at most one new need:
if n1 is unrevealed, any eligible open turn reveals n1 and no other need.
Otherwise choose the lowest-numbered unrevealed n2…n7 matching at least one
stem below anywhere in the normalized turn. Skip unmatched/revealed needs;
there is no prerequisite chain. A stem matches the beginning of an ASCII
alphabetic token (tokens are maximal runs of a–z); no suffix restriction.
Thus affected→affect, felt→felt, needs→need, costing→cost, helped→help.
A turn containing several stems still earns at most one need.

Otherwise reveal nothing. At 7 continue dialogue/coaching with score 7.
Score is independent of model wording and repeated cues. A provider failure
does not commit a candidate reveal. Returned revealed_needs remain sorted
by ID, even if discovery happened out of order.

| Need | Matching stems (any one)                                                  | Proof question, in order                   |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------ |
| n1   | Any eligible open turn                                                    | What has this situation been like for you? |
| n2   | `hard`, `difficult`, `challeng`, `pressure`, `tough`, `struggl`, `stress` | What has been the hardest part?            |
| n3   | `feel`, `felt`, `worr`, `afraid`, `scared`                                | How does that make you feel?               |
| n4   | `impact`, `affect`, `cost`, `consequence`, `toll`                         | How does that affect you?                  |
| n5   | `need`, `matter`, `important`, `value`, `fair`                            | What matters most to you here?             |
| n6   | `support`, `help`, `change`, `different`, `option`                        | What support would help?                   |
| n7   | `next`, `step`, `plan`, `agree`, `try`, `first`                           | What next step could we agree on?          |

The seven fixed private seed needs use these exact titles and descriptions.
They are design fixtures, not secrets or client-side seed data. Only earned
entries may cross the API/coach boundary; do not bundle this table into the UI.

| Need | Bob                                                                            | Teenage Daughter                                                          | Priya                                                                         | Vendor                                                                              |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| n1   | Quarter experience: The quarter has been difficult to keep up with.            | Evening experience: Evenings have felt crowded with demands.              | Work experience: Work has felt difficult to sustain.                          | Negotiation experience: The contract discussion has felt pressured.                 |
| n2   | Conflicting priorities: Competing deadlines make prioritization hard.          | Homework pressure: Homework and phone expectations compete for attention. | Workload pressure: Too many simultaneous commitments create pressure.         | Delivery pressure: Rising delivery costs strain the existing agreement.             |
| n3   | Fear of judgment: Bob worries that asking for help will look incompetent.      | Fear of dismissal: She worries her perspective will be dismissed.         | Fear of weakness: Priya worries that disclosing burnout will look weak.       | Fear of distrust: The vendor worries the price change will be treated as bad faith. |
| n4   | Confidence impact: Repeated misses are undermining Bob's confidence.           | Trust impact: Repeated arguments make honest check-ins harder.            | Health impact: Sustained overload is affecting Priya's wellbeing.             | Partnership impact: The dispute threatens the working relationship.                 |
| n5   | Clear priorities: Bob needs explicit agreement on what matters first.          | Autonomy and trust: She needs a voice in setting realistic boundaries.    | Sustainable expectations: Priya needs a workload she can sustain.             | Fair terms: The vendor needs a workable balance of price and delivery obligations.  |
| n6   | Practical support: Bob wants help resolving competing commitments.             | Shared boundaries: She wants to help design a practical evening routine.  | Concrete support: Priya wants help removing or redistributing commitments.    | Flexible options: The vendor wants room to discuss scope and timing alternatives.   |
| n7   | Agreed next step: Bob is ready to agree one prioritized action and a check-in. | Agreed next step: She is ready to try one shared boundary and revisit it. | Agreed next step: Priya is ready to agree one workload change and a check-in. | Agreed next step: The vendor is ready to agree one revised option and follow-up.    |

Split each cell at its first colon into title/description. Scenario selection
uses the four existing titles from backend/seed.py, never an assumed numeric ID.
Pin this ruleset and seed revision per new session. Migrate old sessions to zero
turns on a new initial branch (baseline chat saved none); preserve session IDs,
scenario links and created_at; reset the placeholder score to 0 with a documented
migration. Never reinterpret an existing Sprint 2 session under changed rules.

Resistance after a committed turn is guarded at scores 0–2, warming at 3–5,
open at 6–7. Metrics count the selected chain only. `empathy` is true if the
normalized text contains any substring `understand`, `sounds like`, `i hear`,
`feel`, `frustrat`, `appreciate`, `makes sense`, `tough`, `hard` (matching the
existing simple empathy heuristic). Counts and ratios are computed server-side.

Known heuristic limits: "hardest" counts as empathy through substring "hard",
and "Do you understand?" counts through "understand"; do not interpret the
empathy counter as measured understanding. "What do you think you should do?"
is leading by this rule and can be a false warning.

Coaching outcome is breakthrough if this turn committed a new reveal, else
deadend if question_type is closed or leading is true, else neutral.
The UI derives its pedagogical tag from question_type/empathy and blind spots
from leading/question_type across the selected chain. No hidden-state inference.

Alternatives are fixed generic templates, independent of scenario, cues,
candidate/hidden needs or sibling dialogue. Return exactly a one-string array,
with precedence: leading → "How are you seeing this situation?"; otherwise
closed → "What would you like me to understand?"; otherwise statement →
"How has this been for you?"; otherwise open → "What else would you like to share?".
These are deterministic suggestions, not a paid AI feature.

Coaching whispers are deterministic, in this order, with exact text:

- Open: good, "Open invitation: leave room for their perspective."
- Closed: warn, "Closed question detected. Try an open invitation."
- Statement: tip, "Follow up with a question that invites their perspective."
- If empathy: append good, "You acknowledged emotion or difficulty."
- If the leading/blame filter matched (open, closed or statement): append warn,
  "Try a question without blame or an assumed answer."

Do not mention a hidden need, next cue, candidate reveal or a future answer in
coaching. Provider-neutral means a later provider may replace coaching internals
without altering the DTO; Sprint 2 source is always deterministic.

Contract-only reference fixtures are in `docs/cs36-judge-fixtures.json`.
Run `backend/.venv/Scripts/python.exe scripts/check_cs36_contract.py` to
check the draft rules against these examples. This reference checker is not
the application judge and proves no model/persistence integration. Each
natural conversation names a scenario and expected new need per turn.

Required executable runtime proofs in CS-42/40:

1. Poor run: seven repetitions of "Did you finish it?" → 0/7. Closed-with-cue
   "Did the work get done?" and "Did that affect you?" reveal nothing.
2. Scripted table questions → 1…7. Natural good transcript for each of Bob,
   Daughter, Priya and Vendor → the fixture's per-turn reveals and final score.
   These examples protect regressions, not broad calibration claims.
3. "What happened?" repeated seven times → 1,1,1,1,1,1,1. An unrelated open
   turn reveals nothing **after n1**. A leading open turn reveals nothing even
   before n1. "What's…" / "How's…" classify as open; acknowledgment followed by
   an open sentence is open. Inflected cues and out-of-order discovery work:
   n1 then support earns n6 without earning n2…n5.
4. At scripted good node 3 rewind inclusive to node 1: new score 1 and turns 1.
   A closed alternate remains 1; original branch remains 3. Re-select original
   and reload after restart: exact IDs/state persist.
5. Duplicate POST key returns original IDs/body with no extra node/session.
   Changed-body key reuse is 409. Concurrent stale turn never commits.
6. Cross-session parent/branch, sibling rewind, inactive branch, stale revision,
   whitespace, 4001 characters and each typed provider failure are tested.
7. Sentinel tests exclude private prompts/unrevealed needs from public DTOs,
   errors and coach input, including sibling leakage after rewind. A new
   candidate reaches persona only; coaching templates never consume it.

## Persona and coach privacy boundary

### Python persona-to-route handoff (planned)

Muse owns `backend/persona.py`; Codex owns conversion of selected database
nodes into messages in `backend/conversation_context.py` under CS-42. This
is the sole node→message assembly location. It validates same-session ancestry,
orders the selected parent chain, prepends opening assistant dialogue, and
returns `list[dict[str, str]]` with role/content only. It excludes the current
pending user turn. Muse consumes these messages unchanged, constructs the
system prompt and appends the current user text exactly once. No ORM/tree
traversal in persona.py; Muse tests supplied history with message fixtures.

Keep existing `generate_persona_reply(client, brief, user_text, *, ...)`
calls working; this is **backward-compatible**, not a frozen signature.
CS-39 adds keyword-only `newly_revealed_titles: list[str] | tuple[str, ...] = ()`
and `timeout: float = 30.0`, forwarding timeout to client.respond.
Existing revealed_titles means previously committed selected-branch titles
only; newly_revealed_titles holds zero or one judge-authorized candidate title.
They must be disjoint and belong to the fixed scenario brief. Codex validates
this before calling; Muse's prompt labels already public / permitted this
reply / still private separately. Resistance uses the candidate post-turn
score; history uses only previously committed messages. Default temperature
remains 0.7; routes explicitly pass timeout=30.0. No automatic provider retry.

The brief may contain all seven needs for roleplay, but no prompt/need table
is returned to the browser. Failed generation commits neither candidate nor
turn. Model instructions do not prove generated dialogue never leaks; record
live adversarial probe results and limitations.

CS-39 defines `PersonaError(Exception)` with these concrete subclasses in
persona.py. Routes depend on these types, never on OpenAI SDK classes or
exception text. Exceptions carry no raw response/prompt/key in their public
message; routes use the fixed safe envelope messages below.

| Python type                 | Provider/config cause                                                                              | HTTP / code / safe message                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| PersonaUnavailableError     | Missing key/base URL; connection failure; upstream HTTP 401/403/429 or 5xx except 504              | 503 / persona_unavailable / "Persona service is unavailable."               |
| PersonaTimeoutError         | SDK/request timeout; upstream HTTP 408 or 504                                                      | 504 / persona_timeout / "Persona response timed out."                       |
| PersonaInvalidResponseError | Empty/malformed result; context-window rejection; other upstream 4xx or provider failure not above | 502 / persona_invalid_response / "Persona response could not be generated." |

Map timeouts/status exceptions inside persona.py before the generic provider
failure catch. Existing unconfigured/empty RuntimeErrors become these typed
errors (subclassing RuntimeError as well is optional for compatibility).
Catch provider errors around the provider operation; programming/invariant
errors must not be broadly disguised as provider failures and reach the
route's safe internal_error handler. Context overflow is only known when the
provider rejects it; use PersonaInvalidResponseError, no silent truncation.
Client-error mapping tests stay mocked; CS-42 adds HTTP/atomic rollback tests.

### Persona wording fixture ownership

Muse authors `backend/persona_fixtures.json` and its provider/prompt tests.
It has `revision` string and `scenarios` array; each item has `scenario_title`
(exact existing seed title), `persona` (all public Persona fields, including
tags), `persona_traits` string and `system_prompt` string. Exactly the four
seed scenarios appear once each. Public traits/tags/hints must not embed private
need text or reveal cues. Codex reviews and loads it into seed.py, owns the
structured fixed seven-need data and builds brief.hidden_need from that data.
Muse does not edit seed.py/routes/models; Codex does not concurrently edit the
persona module or wording fixture. Schema/fixture version is pinned per session.
Existing system prompts/traits are not public persona fields.

Coach input is limited to the current user's text, prior committed selected
chain dialogue and its already-public State. Exclude private persona_traits,
system_prompt, unrevealed titles/descriptions, cue tables and sibling dialogue.
Use explicit public DTO construction; never serialize the private Scenario ORM
instance into a coach request. RevealedNeed entries represent earned design
facts even if the model uses different wording; score is not inferred from text.
The browser receives the session's other branches for the recorder, but they
must not flow into active-branch generation or coaching.

## Ownership, review and implementation sequence

| Owner/task   | Owned files/scope                                                                                                                             | Coordination rule                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex CS-36  | docs/api_contract.md, contract fixtures/reference checker, evidence/journal                                                                   | Record both re-reviews before delivery                                                 |
| Muse CS-39   | backend/persona.py, backend/test_persona.py, backend/persona_fixtures.json and prompt/provider fixtures                                       | Own optional parameters, typed errors and wording; no route/model/seed edits           |
| Claude CS-41 | src/routes/index.tsx, arena.tsx, flight-recorder.tsx, analytics.tsx (demo labels only); src/lib/api, src/lib/classify.ts, associated UI/tests | Own typed HTTP/mock/classifier updates; preserve Lovable UI                            |
| Codex CS-42  | backend/main.py, models.py, database.py, seed.py, conversation_context.py; migrations/judge/coaching/integration tests                        | Own node→message conversion, fixture loader and route/error integration                |
| Codex CS-40  | integration report, scripts/demo_run.py and integration verification                                                                          | PR integration into dev; real 8080/5173 browser loop/live persona/branch/reload proofs |

Ownership is acknowledged by Muse in CS-C139 and Claude in CS-C140, with
Claude's file-list corrections incorporated above. The new persona boundary
choices in r2 need re-review; acknowledgments alone are not contract approval.
Backend integration tests touching persona calls belong
to Codex; Muse owns provider-focused tests. If a change needs both scopes,
coordinate sequential edits, not concurrent changes to the same file.

Claude/Muse review requests must cover the full draft and leave explicit findings
on CS-36, including approval or exact required revisions. Until those reviews
and baseline evidence are recorded, this is a draft and CS-36 stays active.
No review is implied by assignment or by Codex's self-review. No parallel dependent
implementation should begin against an unapproved revision.

## Verification record

Source inspection establishes only the baseline table above. Real server/client
evidence and documentation checks are recorded in `docs/cs36-evidence.md` when
run. Planned branch/judge/provider proofs remain CS-39/41/42/40 work. CS-36
does not certify a live model, a working recorder or a completed Sprint 2 loop.

## Revision 2 decisions and review status

R1 is f54fdef / CS-A14. Muse CS-C139 conditionally approved; Claude CS-C140
requested changes and CS-C141 corrected the review timing/boundary distinction.
R2 resolves their findings as follows, pending actual re-review:

- Muse F1: optional newly_revealed_titles and timeout preserve old call shape.
- Muse F2: Codex owns node→message conversion; Muse owns prompt assembly only.
- Muse F3: three typed persona errors map to safe route errors, including context.
- Muse F4: Muse authors persona_fixtures.json; Codex reviews/loads and owns needs.
- Claude 1: contractions/multiple sentences, explicit open-only eligibility,
  stems, n1 any open and no need prerequisites; four natural fixtures added.
- Claude 2–6: real flight-recorder route/file, Hub session listing, public tags,
  outcome/leading/templates and both branch-button mappings are explicit.
- Generic cues retained for Sprint 2; score is a limited category-coverage
  heuristic, not calibrated semantic understanding. Identical generic probes
  may reach 7/7 across scenarios. Fixed revealed contents remain scenario-specific.
- Muse N1 and Claude setup note: setup now matches npm ci --ignore-scripts.
  Baseline invoked vite.js directly; CS-40 must additionally verify the
  documented npm.cmd run dev invocation verbatim. No claim that this ran yet.
- Muse N2/N3 and Claude whisper note: boundaries, context overflow and leading
  feedback for all turn classes are explicit.

No runtime judge/persona/frontend changes are introduced by r2. CS-36 remains
active, CS-39/41/42 blocked, and PR #3 an unmerged draft until re-review resolves
all findings. The earlier baseline proof is still a proof of the Sprint 1 stub.
