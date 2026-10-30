# DialogIQ V2 API contract

CS-36 · Codex · 2026-10-30 · revision 1, **draft pending Claude/Muse review**.

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
npm.cmd ci
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

| DTO          | Fields and meanings                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario     | `id`, `title` string, `description` string or null, `persona` Persona                                                                                                         |
| Persona      | `name`, `role`, `initials`, `opening_message`, `public_context` (strings); `practice_hints` string array of generic communication advice                                      |
| RevealedNeed | `id` string (scenario-local `n1`…`n7`), `title` string, `description` string; only actually revealed entries                                                                  |
| Metrics      | `turns`, `open_questions`, `closed_questions`, `empathy_turns` (nonnegative integers); `open_question_ratio` number 0–1, open/(open+closed), 0 when denominator is 0          |
| Coaching     | `source` literal `deterministic`; `question_type` `open`/`closed`/`statement`; `empathy` boolean; `whispers` array of Whisper                                                 |
| Whisper      | `kind` `good`/`warn`/`tip`, `text` string                                                                                                                                     |
| State        | `score` integer 0–7, `total_needs` literal 7, `revealed_needs` RevealedNeed array in n1…n7 order, `resistance` `guarded`/`warming`/`open`, `metrics` Metrics                  |
| Session      | `id`, `scenario_id`, `active_branch_id`, `active_head_node_id` (node ID or null), `revision`, plus all State fields                                                           |
| Node         | `id`, `session_id`, `parent_id` (node ID or null), `turn_number` (chain depth, starts 1), `user_text`, `character_text` (strings), `coaching` Coaching, plus all State fields |
| Branch       | `id`, `session_id`, `fork_node_id` (node ID or null), `head_node_id` (node ID or null), plus all State fields                                                                 |
| Tree         | `session_id`, `revision`, `active_branch_id`, `branches` Branch array, `nodes` Node array                                                                                     |

No timestamps, branch names, arbitrary tags, resistance percentages or empathy
percentages are required by the UI. Use actual metrics and resistance enum
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
    "opening_message": "You wanted to see me? If this is about Q3, I already sent the update.",
    "public_context": "You are meeting to discuss missed deadlines.",
    "practice_hints": ["Invite their perspective before proposing a solution."]
  }
}
```

Each seeded scenario must have a matching public persona and distinct opening;
do not substitute Bob for Daughter, Priya or Vendor. Private seed content is
specified below; persona wording beyond the example belongs to CS-39/42.

### Create and resume

`POST /api/sessions`, header `Idempotency-Key`, body:

```json
{ "scenario_id": 1 }
```

→ 201 Session, also on replay. Create exactly one initial branch with null fork
and head, score 0, no revealed needs, guarded resistance, zero metrics, revision 0.
Unknown scenario → 404. Explicit New Session is the only UI action that creates
a run. Keep one key for duplicate StrictMode mounts/retries; navigation alone
must not create sessions. Client stores returned session ID in the Arena URL
`/arena?sessionId=12`, with optional scenarioId only as a consistency check.

`GET /api/sessions/12` → 200 Session; 404 if absent. No side effects.
Resume by GET, then get tree to render the selected branch's ancestor chain
and prepend scenario.opening_message. A scenarioId mismatch must show an error
or redirect to the session's actual scenario, never silently mix personas.

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

Example: old path 81→82→83, rewind inclusive to 81, submit alternate turn 84:
old branch remains headed at 83; new branch heads at 84 with parent_id 81.
No reveal from 82 or 83 may appear on 84 unless earned again by its own path.

`PUT /api/sessions/12/active-branch`, header `Idempotency-Key`, body:

```json
{ "branch_id": 31, "expected_revision": 5 }
```

→ 200 Session; selecting an existing branch resumes at its stored head and State.
No node/branch is created and no model call occurs. Revision becomes 6 unless
already active. `/recorder?sessionId=12` identifies the real session. Arena resume
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

Sprint 2 uses a fixed chain of seven scorable needs for each scenario: n1 has
no prerequisite; n2 requires n1; …; n7 requires n6. The model never creates,
reorders, deletes or scores needs. No semantic model classifier is required.
This is a deliberately limited, reproducible lexical baseline, not a claim
to understand every meaningful paraphrase.

Normalize judge input by Unicode NFKC, lowercase, convert curly apostrophes to
ASCII, collapse whitespace, strip surrounding whitespace. Match phrases with
word boundaries (ASCII letters/digits/apostrophes count as word characters).
Classify in this order:

1. `open`: starts with one of `what`, `how`, `why`, `tell me`, `help me`,
   `walk me`, `describe`, `in what` at a word boundary.
2. Otherwise `closed`: starts with `do`, `does`, `did`, `is`, `are`, `was`,
   `were`, `can`, `could`, `will`, `would`, `should`, `have`, `has`, `had`,
   `won't`, `don't`, `isn't`, `aren't` at a word boundary.
3. Otherwise `statement`. A question mark alone does not determine the class.

An open turn is ineligible for a reveal if it contains a bounded phrase
`don't you`, `isn't it`, `you should`, `you must`, `your fault`, `just admit`,
or `obviously`. This is the deterministic leading/blame filter. It does not
change question_type or metric counts. No empathy prerequisite is imposed.

Find the first unrevealed need in n1…n7 order whose prerequisite was revealed
**before** this turn. Reveal it only if the turn is eligible and contains at
least one of that need's cue phrases below. Maximum one reveal per turn.
Do not skip it to reveal a later need. Otherwise reveal nothing. Once at 7,
continue conversation/coaching with score 7. Score is independent of persona
wording, model availability and repeated cue occurrences; a provider failure
does not commit a candidate reveal.

| Need | Matching cues (any one)                                       | Proof question, in order                   |
| ---- | ------------------------------------------------------------- | ------------------------------------------ |
| n1   | `quarter`, `day`, `work`, `situation`, `experience`, `lately` | What has this situation been like for you? |
| n2   | `hardest`, `difficult`, `challenge`, `pressure`               | What has been the hardest part?            |
| n3   | `feel`, `feeling`, `worry`, `worried`                         | How does that make you feel?               |
| n4   | `impact`, `affect`, `cost`, `consequence`                     | How does that affect you?                  |
| n5   | `need`, `matter`, `matters`, `important`, `value`             | What matters most to you here?             |
| n6   | `support`, `help`, `change`, `different`                      | What support would help?                   |
| n7   | `next`, `step`, `plan`, `agree`                               | What next step could we agree on?          |

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

Coaching whispers are deterministic, in this order, with exact text:

- Open: good, "Open invitation: leave room for their perspective."
- Closed: warn, "Closed question detected. Try an open invitation."
- Statement: tip, "Follow up with a question that invites their perspective."
- If empathy: append good, "You acknowledged emotion or difficulty."
- If the leading/blame filter matched: append warn,
  "Try a question without blame or an assumed answer."

Do not mention a hidden need, next cue, candidate reveal or a future answer in
coaching. Provider-neutral means a later provider may replace coaching internals
without altering the DTO; Sprint 2 source is always deterministic.

Required executable proofs in CS-42/40 (not implemented by this document):

1. Poor run: seven repetitions of "Did you finish it?" → 0/7 (therefore ≤3).
2. Good run: seven proof questions in the table → scores 1…7 (therefore ≥6).
   Repeating n1's question at score 1 reveals nothing else. An unrelated open
   question and leading "What is obviously your fault?" reveal nothing.
3. At good node 3 rewind inclusive to node 1: new State score 1 and turns 1.
   A closed alternate remains 1; the original branch remains score 3. Re-select
   original and reload after process restart: exact IDs/state are preserved.
4. Duplicate POST key returns the original IDs/body and creates no extra turn or
   session. Changed body/key reuse is 409. Concurrent stale turn is not committed.
5. Test cross-session parent/branch, sibling rewind target, inactive branch,
   stale revision, whitespace text, 4001 characters and provider failures.
6. Sentinel tests show private prompts/unrevealed needs absent from every public
   DTO, error and coach input, including sibling branch leakage after rewind.

## Persona and coach privacy boundary

Muse owns persona prompt construction and provider behavior; Codex routes supply
`PersonaBrief`, branch-local history, revealed_titles and resistance to the
existing generate_persona_reply interface. Keep this interface unless a jointly
recorded revision requires a change. The private brief may include all seven
needs so the persona can roleplay; the request must explicitly distinguish
already revealed and newly permitted content from unrevealed content. Do not
return the brief or judge cues to the browser. Model instructions alone cannot
prove that generated dialogue never leaks; record live adversarial probe results
and limitations rather than claiming absolute prevention.

Coach input is limited to the current user's text, prior committed selected
chain dialogue and its already-public State. Exclude private persona_traits,
system_prompt, unrevealed titles/descriptions, cue tables and sibling dialogue.
Use explicit public DTO construction; never serialize the private Scenario ORM
instance into a coach request. RevealedNeed entries represent earned design
facts even if the model uses different wording; score is not inferred from text.
The browser receives the session's other branches for the recorder, but they
must not flow into active-branch generation or coaching.

## Ownership, review and implementation sequence

| Owner/task   | Owned files/scope                                                                                     | Coordination rule                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Codex CS-36  | docs/api_contract.md, focused contract evidence                                                       | Record review decisions before marking delivered                                                 |
| Muse CS-39   | backend/persona.py, provider unit tests/prompt fixtures                                               | No route/model/seed edits without handoff; review persona history/privacy/error mapping          |
| Claude CS-41 | src/routes/index.tsx, arena.tsx, recorder.tsx; src/lib/api; associated UI/tests                       | Own all API wire types/HTTP/mock changes; review DTO/UI completeness/idempotency                 |
| Codex CS-42  | backend/main.py, models.py, database.py, seed.py; migrations/judge/coaching/backend integration tests | Sole owner of shared backend foundation; wire Muse's interface after handoff                     |
| Codex CS-40  | integration report, scripts/demo_run.py, integration verification                                     | Integrate via PRs into dev; run real 8080/5173 loop, live persona probe and branch/reload proofs |

This ownership proposal is recorded in Megillah; affected owners must acknowledge
or correct it in review. Backend integration tests touching persona calls belong
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
