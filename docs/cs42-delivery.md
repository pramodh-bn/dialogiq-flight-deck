# CS-42 delivery and verification

Codex, 2026-10-30. Task branch `codex/cs42-persistent-conversations`, isolated
worktree `D:/Workspace/meta-hackathon/dialogiq-flight-deck/.worktrees/cs42`.
Integration into dev/main remains a separate PR gate.

## Result

The backend now implements the agreed practice loop: public scenario/persona
details, idempotent new sessions, session listing/resume, persisted complete
turns, deterministic coaching/score, real tree retrieval, inclusive branch
creation and branch selection. Branches share immutable prefix nodes and retain
independent heads, reveals and metrics. Session score follows its active branch.

Provider generation uses Muse's delivered CS-39 code, integrated from a65b127
as e2db4ec with Muse's author/trailers preserved. The chat route passes the
session-pinned brief, selected ancestor history, committed titles, zero/one
newly permitted title, candidate resistance and explicit 30-second timeout.
There is no production placeholder/fallback reply. Unconfigured/failed provider
calls return the safe typed error envelope and save no partial turn.

CS-A22's optional rule refinement is now accepted as contract r2.1, recorded
in CS-C158/159 under Claude CS-C143's waiver and Muse CS-C149's approval.
The contract, reference fixtures and runtime judge use the same rules. Existing
sessions pin r2/r2.1 independently; updating the scenario does not reinterpret
their scoring or private brief. Windows launch uses Python3.12 at user direction.

## Storage and concurrency

- A startup transaction upgrades the Sprint 1 schema additively. It preserves
  users, scenario/session IDs, timestamps and valid legacy dialogue/forks. Old
  placeholder scores become zero; no reveal is invented from them. Repeat
  startup is idempotent. Corrupt ancestry fails atomically, including DDL rollback.
- New nodes have same-session parent constraints and are immutable after commit.
  Branch head/fork constraints, immutable branch identity and active-branch
  checks prevent cross-session graph references. Pinned session config is immutable.
- UUID retry keys store canonical mutation identity and original success response
  in SQLite. Replays work after restart or later branch selection, without
  reactivating a branch. Changed requests conflict. Pending reservations expire
  after120 seconds, permitting recovery after a crashed worker. Failures release
  their reservation; active duplicates get request_in_progress.
- No DB transaction is held during generation. Revision/head ownership are
  rechecked under a writer lock before the complete node/state/retry result is
  atomically committed. A race loser can have made a provider call but cannot
  commit stale state. Read endpoints use a consistent SQLite snapshot.

Public DTOs are explicit Pydantic projections. Coaching sees public user text
and a ruleset identifier, never an ORM scenario, private need table or sibling
history. Tests use private sentinels to check the boundary. Model prompts
intentionally contain private roleplay facts; instructions alone do not prove
that a model will never disclose them.

## Checks actually run

Environment: fresh task venv, Python3.12.10, Node26.13.0/npm11.20.0.
The initially installed3.15 environment was replaced only in this worktree,
with the resolved target path checked before rebuilding. No security controls
were disabled. pip check and jiter import passed on3.12.

| Check                                    | Result                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Full backend pytest                      | 71 passed:44 Muse provider tests,27 integration/migration cases                        |
| Contract reference checker               | 8 JSON examples,23 cases/97 turns passed                                               |
| Runtime judge vs all reference fixtures  | Passed, including public/closed/blame/inflection/out-of-order cases                    |
| Ruff lint/format                         | Passed for backend and added verification/launch scripts                               |
| API HTTP adapter + strict ports          | Passed, actual client from Claude84f436c, backend8080, served frontend5173             |
| Fixture-provider persistence/branch flow | 7/7,8 nodes,2 branches; replay, rewind/original,409/404/422 and process restart passed |
| Real Baseten API turn                    | ONE model call via actual HTTP adapter;132-character reply, score1, one persisted node |
| Live replay/restart                      | Passed without another model call; original response and persisted State recovered     |

Automated tests use mocked providers only. Real live verification is a separate
manual invocation, not part of pytest. The real client is Claude's committed
TypeScript HTTP adapter transpiled with the installed compiler; the checker
also starts Vite5173 and checks CORS from that origin. This is not a visual
browser test of the newly wired UI. Claude owns that separate CS-41 check.

Captured fixture result:

```json
{
  "backend": 8080,
  "servedFrontend": 5173,
  "clientAdapterRef": "84f436c",
  "provider": "explicit fixture",
  "paidCalls": 0,
  "scenarios": 4,
  "score": 7,
  "branches": 2,
  "nodes": 8,
  "realAdapter": "passed",
  "replay": "passed",
  "rewindAndOriginal": "passed",
  "stale409": "passed",
  "missing404": "passed",
  "invalid422": "passed",
  "replyCharacters": 26,
  "visualBrowserCheck": false
}
```

Captured live result:

```json
{
  "backend": 8080,
  "servedFrontend": 5173,
  "clientAdapterRef": "84f436c",
  "provider": "Baseten live",
  "paidCalls": 1,
  "scenarios": 4,
  "score": 1,
  "branches": 2,
  "nodes": 1,
  "realAdapter": "passed",
  "replay": "passed",
  "rewindAndOriginal": "passed",
  "stale409": "passed",
  "missing404": "passed",
  "invalid422": "passed",
  "replyCharacters": 132,
  "visualBrowserCheck": false
}
```

Both checks restarted uvicorn and matched persisted session/tree exactly.
They used disposable, independent SQLite databases and stopped only owned
processes. No credential or model reply content was printed in those results.

## Reproduce and review

From the task worktree, with Node on PATH:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend -q
backend/.venv/Scripts/python.exe scripts/check_cs36_contract.py
backend/.venv/Scripts/python.exe scripts/verify_cs42.py --node node
# Manual only: makes one real turn call, requires an ignored credential file.
backend/.venv/Scripts/python.exe scripts/verify_cs42.py --live --env-file PATH_TO_ENV --node node
```

Interactive production backend (owns this worktree's backend/dialogiq.db):

```powershell
backend/.venv/Scripts/python.exe scripts/run_backend.py --env-file PATH_TO_ENV
```

Use frontend5173 with VITE_API_BASE_URL=http://127.0.0.1:8080. Keys remain
backend-only; the launcher reads only Baseten fields without printing or copying
them. DIALOGIQ_DB_PATH can be set in the process environment for isolated checks.
Do not remove an existing user's database as an upgrade method.

## Limits and integration handoff

The supported catalog is the four agreed scenarios, not a scenario-creation API.
Legacy custom session scenarios need a reviewed seven-need fixture before they
can be upgraded; the migration refuses unsupported data atomically rather than
discarding it. Generic lexical scoring remains a limited category heuristic:
hostile wording and historical-plan questions can still fool it. Reference
examples are regression coverage, not real-use calibration.

This task makes no longitudinal analytics, authentication or model-secrecy claim.
npm setup reported2 high dependency findings; no forced dependency upgrades.
Full combined browser/demo thresholds and broader live persona probes remain
CS-40 work. No dev/main merge was performed. CS-41 was notified in CS-C161 that
the real server was ready; its browser verification is separate from this report.

At publication, Codex left production backendPID2984 / execsession24614 on8080
for Claude's testing. It uses real Baseten and a persistent local task database.
Coordinate before stopping/restarting it; do not kill unrelated Python processes.
