# CS-42 handoff — current status and historical checkpoint

## Latest resume state (supersedes the initial checkpoint below)

Implementation and independent verification are complete; final source commit,
PR and Megillah delivery are being prepared. Read `docs/cs42-delivery.md` for
the implemented scope, actual checks and limits. Do not follow the earlier
"routes/migrations not implemented" checklist as current work.

Current branch remains codex/cs42-persistent-conversations in .worktrees/cs42.
Muse's a65b127 was cherry-picked as e2db4ec, preserving author/trailers. All
CS-42 changes are still uncommitted at this checkpoint; obtain the eventual
commit/PR from live CS-42 or branch history before resuming.

User explicitly required Python3.12; own backend/.venv was rebuilt as3.12.10.
jiter import/pip check pass. Full backend71 tests, r2.1 reference97 turns,
runtime fixture matching and real HTTP checks pass. One live Baseten turn via
Claude's actual adapter succeeded, replayed without another model call and
persisted after process restart. No Codex browser QA claim.

r2.1 is ADOPTED, recorded CS-C158/159 (Claude waiver CS-C143, Muse approval
CS-C149); contract, runtime judge and fixtures match. New sessions pin r2.1;
old pinned r2 is supported without reinterpretation. Muse's code is untouched.

Production backend is running at127.0.0.1:8080, ownedPID2984/execsession24614,
its own backend/dialogiq.db, real provider configured from existing ignored
original-repository .env. No keys copied/printed. Health passed. CS-C161 tells
Claude to run the real5173 browser loop; CS-C162 records verification. Keep
the server available; coordinate before restart. Actual turns spend credits.

Next: finish final style/diff checks on reviewed files/documents, explicitly
stage and commit with attribution, push task branch and create PR into dev,
attach report/current handoff, close out and deliver CS-42 once actual checks
are recorded. Do not wait for CS-41 or PR merge to deliver CS-42. Do not merge
dev/main or begin CS-40 without its own task/acceptance checks.

## Initial checkpoint (historical; retained as the work log)

Updated 2026-10-30 by Codex at the user's request, before a possible session limit.
**CS-42 is active, not delivered. Code is uncommitted and not runtime-verified.**

## Exact place to resume

- Task: CS-42, "Persistent Conversations, Branching & Deterministic Judge".
- Claim: Megillah CS-C148; begun at the user's explicit instruction.
- Worktree: `D:/Workspace/meta-hackathon/dialogiq-flight-deck/.worktrees/cs42`.
- Branch: `codex/cs42-persistent-conversations`.
- HEAD/base: `04af9aaabb5cc12c1494cbe98f642f5efd107bc4`.
- No CS-42 commit, push, PR, merge, running server or local database yet.
- Runtime baseline is dev `0ed9284` plus accepted CS-36 docs at `04af9aa`.
- Original dev/main and other agents' worktrees were not edited.

Read `AGENTS.md`, this file and live CS-42/39/41/36 comments first. Resume using
Megillah continue_task then inspect_task CS-42. Check current branch/status and
worktree list again before edits. Do not create another worktree or restart from
scratch: the uncommitted foundation below already exists here.

## Ownership and coordination

Codex owns main.py, models.py, database.py, seed.py, new backend schema/service/
migration/judge/coaching/context modules and backend integration tests. Muse
owns `backend/persona.py`, `backend/test_persona.py`, and the new
`backend/persona_fixtures.json`. Claude owns frontend routes/lib/api/classify
and UI tests. Do not edit their files or copy their uncommitted work.

Both other tasks are active. Muse claim CS-C147; own worktree
`D:/Workspace/meta-hackathon/muse`, branch `muse/cs-39-persona`.
Claude uses `D:/Workspace/meta-hackathon/claude`, branch
`claude/cs-41-ui-wiring`. Their current progress must be reread from Megillah.

Coordination comments sent by Codex:

- CS-C151 on CS-39: exact provider call boundary, stable JSON hidden_need format,
  source handoff requested, no persona-file edits by Codex.
- CS-C152 on CS-41: backend rollout/ownership and proposed optional rule adoption.

## Contract baseline and optional patch

CS-36 is DELIVERED. Claude approved r2 in CS-C143; Muse approved exact04af9aa
in CS-C145; Codex delivery close-out CS-C146. PR3 is an unmerged draft:
https://github.com/pramodh-bn/dialogiq-flight-deck/pull/3

Accepted r2 material: CS-A17 contract, A18 fixtures, A19 reference checker,
A20 evidence, A21 journal. Pending-review wording inside the frozen document
is superseded by those actual approvals/delivery. Baseline includes no runtime
implementation of the planned APIs.

Optional judge refinement is preserved separately as CS-A22, not applied to
this worktree. Muse subsequently APPROVED that delta in CS-C149, including
early-n7 tentative voicing; Claude's CS-C143 waived another review if adopted
verbatim. Codex has proposed adopting it as r2.1 on CS-41, but has not applied
or recorded final adoption. **Current runtime judge.py implements r2, not r2.1.**

Before changing rules, read the latest coordination responses. If adopting,
apply the exact CS-A22 patch to docs/api_contract.md, contract fixtures and
reference checker, update acceptance metadata to reflect CS-C143/149, record
the final revision on delivered CS-36 without reopening it, and tell Claude
the precise shared revision. Then update the runtime judge consistently.
No wire DTO changes are involved. Do not let UI mock/backend rules diverge.

R2.1 delta: split on comma/semicolon/colon in addition to .!?; strip at most one
leading filler (so/and/but/okay/ok/well/um/uh/hey/then/alright/right/now); add nine
blame phrases; remove next/first n7 stems. CS-A22 also documents hostile and
historical-plan misfires and tentative n7 while guarded. It passed 23 cases /
97 turns in the prior CS-36 worktree; that is historical contract-only evidence,
not a CS-42 runtime test. Accepted r2 has 18 cases / 76 turns.

## Actual uncommitted files

Modified:

- `backend/models.py`: adds public persona/needs/config revision to Scenario;
  active branch/revision/private pinned config to Session; node State/coaching
  JSON and composite same-session parent FK; Branch and IdempotencyRecord tables.
  Existing node relationships specify foreign_keys to avoid ambiguity. Only the
  new Node/Branch tables currently request sqlite_autoincrement; assess stable
  ID requirements for the other tables too. ORM mapping has NOT been exercised.
- `backend/database.py`: optional DIALOGIQ_DB_PATH and SQLite 30s busy timeout.
  No migration or initialization implementation yet.

New:

- `backend/schemas.py`: strict, extra-forbidden JSON request models and explicit
  public Scenario/Persona/State/Metrics/Coaching/Node/Branch/Session/Tree DTOs.
  Safe positive integer IDs, revision checks, text trimming/length. No routes
  use these models yet. Add strict query/path validation carefully: URL values
  are strings; body strictness must not reject valid numeric path/query text.
- `backend/api_errors.py`: safe ApiError plus not_found/conflict helpers.
- `backend/judge.py`: r2 lexical classifier, public-text-only coaching boundary,
  fixed generic stems, candidate scoring and branch metrics/resistance snapshots.
  No DB/provider code; outcome attaches breakthrough only after a candidate is
  selected. No network, no Fireworks. Evaluate/coaching code needs runtime tests.
- `backend/conversation_context.py`: sole ORM ancestry walk and node→messages
  conversion. Checks cycles/same-session ancestry; opening assistant message,
  committed ancestor user/assistant pairs only; excludes pending user/siblings.
- `backend/need_catalog.py`: all 28 fixed private facts transcribed/generated
  from accepted contract table, keyed by the four exact seed scenario titles.
  No frontend export or runtime dependency on docs. Verify exact content in tests.
- `docs/codex-cs42-journal.md`: rolling log of setup/coordination.
- This handoff file.

Unchanged and still Sprint 1: `backend/main.py` is the placeholder API;
`backend/seed.py` is the old four-title seed; old integration tests still assume
the stub and need replacement/extension. Persona files remain Muse-owned.
No migration/service/idempotency execution/provider adapter/runtime tests exist.
Do not mistake presence of model classes for implemented persistence behavior.

## Environment and checks actually performed

Own `backend/.venv` created with py -3.15. Active Python3.15.0;
Node26.13.0 / npm11.20.0 from explicit installed version directory:
`C:/Users/User/AppData/Local/Author Software/nvm/installs/v26.13.0`.
Default NVM shim can be unconfigured; do not change global machine state.

Pinned direct requirements installed successfully; transitive requirements
are not fully locked. npm ci --ignore-scripts installed532 packages and
reported2 high findings. No forced upgrades were made. Sandbox blocks many
Git/environment/formatter/SQLite writes; use normal approval escalation for
necessary operations, never permissions workarounds.

Final handoff checks: `python -m pip check` passed; ast.parse passed for all7
new/modified Python foundation files. **Syntax only**, not imports/ORM/tests.
No pytest, Ruff, formatter, TS, build, real API/client, browser or model checks
have run for CS-42. `backend/dialogiq.db` does not exist. Neither port8080 nor
5173 had a listener at handoff. No secrets read/copied/printed; no paid calls.

## Remaining implementation sequence

1. Resolve shared judge revision as above, and get Muse's committed persona/
   fixture handoff. Do not manufacture a production fallback persona or author
   Muse's fixture while waiting. Tests may inject a provider/fixture explicitly.
2. Implement seed fixture loading: Muse authors persona_fixtures.json with
   revision/scenarios; exact title + public Persona + private traits/system_prompt.
   Codex owns fixed seven needs and loader. Pin all scenario config per session.
   Preserve valid existing rows/IDs/private fields; don't overwrite user data.
3. Implement transactional additive SQLite migration from Sprint1. create_all
   does not upgrade columns. Preserve users/scenarios/sessions/valid turns;
   reset only unverifiable placeholder score, establish branches, normalize
   valid legacy turn State conservatively. Fail on corrupt foreign ancestry
   rather than silently discard it. Add DB enforcement for same-session
   parent/head/fork/active branch and immutable node ancestry. Add schema-version
   tracking, repeat-run proof and migration fixture tests. Never delete a user's
   database as an upgrade procedure.
4. Build public DTO serializers and service/routes: scenario list/detail;
   session create/list/resume; real turn; tree; inclusive branch creation;
   branch selection. Body extra fields/types/UUID header/text/ref validation;
   safe uniform error envelope incl. validation failures; CORS5173 origins.
5. Durable idempotency: canonical method/path/validated body + UUID key; replay
   original status/body BEFORE current revision checks; changed request conflict;
   in-flight duplicate409; failures release reservation; restart recovers pending
   leases. Store success atomically with State. No fake success for failures.
6. Conversation transaction: validate session/branch/parent/revision before model;
   build plain immutable generation context; release DB read transaction before
   slow provider; revalidate under SQLite write lock/CAS before atomic node,
   branch head, active score/revision and idempotency result commit. Race loser
   returns409; duplicate upstream billing is an acknowledged limitation, not an
   exactly-once claim. A provider failure commits no turn/reveal/head/revision.
7. Wire Muse's provider using the boundary below. Add fixture/rules/persistence/
   rewind/reload/old-branch preservation/privacy/failure/concurrency tests;
   update old stub tests rather than retain contradictory assertions.
8. Run appropriate Ruff/pytest/pip checks and real server8080 + actual client
   from5173 in this clean environment. Coordinate with Claude's updated HTTP
   adapter; no frontend ownership takeover. Distinguish injected-provider HTTP
   evidence from live Baseten evidence. Full combined demo proof is CS-40.
9. Review explicit diff/paths; commit Agent:Codex and Megillah-Task:CS-42
   trailers; PR into dev, no direct merge. Record actual checks/limitations and
   attach evidence before delivery; delivery does not wait for PR merge.

## Exact planned provider handoff (CS-C151)

Call generate_persona_reply with PersonaBrief plus selected-branch history,
previous committed revealed_titles, zero/one newly_revealed_titles, post-candidate
resistance and explicit timeout30.0. It appends pending user text once; Codex
history excludes it. brief.hidden_need is stable JSON serialization of pinned
`[{id,title,description}]`, so Muse can label per-need content without another
parameter. No raw Scenario ORM object goes to a coach; coach_public_text accepts
only the current public user text. Newly revealed outcome decoration is local
deterministic output, never a private coach/provider input.

Map Muse's PersonaUnavailableError→503, PersonaTimeoutError→504,
PersonaInvalidResponseError→502 using safe contract messages. Routes do not
depend on SDK exceptions/text. Programming errors map to safe internal_error,
not a fabricated provider answer. No prompt/key/private data in errors/logs.
Early n7 is tentative, not forced persona agreement; Muse already accepted
and claimed the corresponding prompt fixture in CS-C147/149.
