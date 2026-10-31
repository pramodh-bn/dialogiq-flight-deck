# Sprint 2 integration gate — CS-40

Codex, 2026-10-30. **Browser gate passed; dev integration pending.**
This report separates completed checks from requested verification.

## Integrated source

Isolated worktree: `D:/Workspace/meta-hackathon/dialogiq-flight-deck/.worktrees/cs40`.
Branch: `codex/cs40-integration`, based on dev0ed9284.

- Backend/persona/contract881e1c1 integrated in merge5bc7490.
- Frontend2824542 integrated in merge8ad2c33, without conflicts.
- Backend tree matches881e1c1; frontend src tree matches2824542 exactly.
- Merge commits retain history and Agent:Codex / Megillah-Task:CS-40 trailers.
- No dev/main merge, force push, rebase, squash or main promotion performed.

The implementation claims/evidence were reviewed on delivered CS-39,41,42,
including Claude's CS-A28 browser evidence. That earlier46-check run is prior
feature evidence, not a substitute for the outstanding combined browser check.

## Combined checks run by Codex

Fresh local Python3.12.10 venv, Node26.13.0/npm11.20.0; own dependency install.

| Check                                           | Result                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Backend pytest                                  | 71 passed                                                              |
| Contract reference                              | 8 JSON examples,23 cases/97 turns passed                               |
| Frontend Vitest                                 | 36 passed                                                              |
| TypeScript                                      | Passed                                                                 |
| API-configured production build                 | Passed                                                                 |
| pip check                                       | Passed                                                                 |
| Deterministic demo with explicit fixture        | Closed0/7, good7/7; branch/replay integrity passed                     |
| Same demo through production API + live Baseten | Closed0/7, good7/7; branch/replay integrity passed                     |
| Public client bundle scan                       | 13 JS files,0 private-field/need-title hits; known public marker found |

Repository-wide ESLint is **not green**:37 errors and6 warnings. The errors are
2 in unchanged __root.tsx and35 in analytics.tsx's existing formatting; the
6 React Refresh warnings are in existing UI component exports. These match the
feature handoff baseline. No new integration runtime source changes were made.
npm reported2 high findings; no forced dependency upgrades were performed.

The inherited backend suite includes actual legacy SQLite migration preservation,
repeatability and corrupt-upgrade rollback; immutable/same-session graph rules;
private sentinels/coach boundaries; durable retry/restart; provider failures and
stale concurrent generation. Automated tests never make paid calls.

## Reproducible demo proof

`scripts/demo_run.py` defaults to a temporary SQLite database with an explicitly
injected fixture persona, no network. The --live mode targets the configured
real API and sends15 new turns:7 closed,7 good and1 alternate closed turn.

```powershell
backend/.venv/Scripts/python.exe scripts/demo_run.py
# Manual real-provider proof; real API must already be running:
backend/.venv/Scripts/python.exe scripts/demo_run.py --live --require-empty --base-url http://127.0.0.1:8080
```

Both modes produced scores0/7 and7/7, satisfying <=3 and>=6. Good progression
was1,2,3,4,5,6,7. Inclusive rewind to good turn3 copied score3; alternate closed
continuation kept3; the original7-turn transcript and score7 remained unchanged.
Replaying the last success produced the original node without another turn;
HTTP resume/reload and original branch selection passed. The good tree has
8 unique nodes and2 branches. Sanitized evidence includes original-node SHA256
and actual returned IDs, not private prompts, credentials or reply text.

Artifacts:

- `docs/evidence/cs40-demo-fixture.json`: explicit fixture,0 paid calls.
- `docs/evidence/cs40-demo-live.json`: real production HTTP/Baseten;15 new turns.

The fixture/questions are deterministic scoring regressions, authored with the
stem table available; neither mode calibrates normal-user question quality.
Roleplay wording varies in live mode. Generic lexical scores can be fooled.

## Clean real environment and browser work

The verified owned CS-42 serverPID2984 was stopped; its database was preserved.
CS-40 started with no backend/dialogiq.db, then production startup created its
own database. No old user/test sessions were copied or deleted. Live demo ran
with --require-empty before new browser sessions were created.

Current combined servers:

- FastAPI127.0.0.1:8080:PID23400 / execsession46534, real Baseten.
- Vite127.0.0.1:5173:execsession21196, VITE_API_BASE_URL explicitly set; mock off.
- Backend config read from the existing ignored original-repo .env; values were
  not printed or copied. Actual practice turns spend provider credits.

Browser access host was unavailable. Native Firefox control ended with a URL
policy unsupported-browser restriction; it was not bypassed. The user explicitly
suggested Edge/Chrome, and supported native Edge control worked on resumption.

Codex's direct Edge observation on the combined source verified:

- Hub fetched all4 scenarios and Bob's actual demo score7/7.
- Non-earned competency/history surfaces carried DEMO DATA labels.
- Maya New Session navigated to /arena?sessionId=3.
- Correct Maya identity, teenage-daughter role, tags and opening dialogue.
- Real UI question "How was school today?" returned "Fine. It was school."
- Server score1/7, open ratio100%, open-question coaching and guarded resistance.
- Arena inspected at narrow and maximized window sizes.

This is a **partial browser check**. Native controls require fresh per-action
observations and repeatedly detected user focus changes to the terminal.
The user authorized requesting Claude's tests. Codex stopped the slow native
loop and posted exact combined-snapshot requests CS-C170 (CS-40) and CS-C171
(delivered CS-41) for Claude's existing headless Edge harness.

Still required: combined browser reload persistence, tree/node detail, selected
rewind, alternate continuation, and original transcript/score resume. The API
demo proves storage/branch rules; it does not claim these remaining UI checks.
Claude subsequently completed the requested combined run: CS-C172 / CS-A29,
47/47 checks with zero console errors on commit4baa28d. This supersedes the
pending browser status above. All four personas, Arena/Recorder reload, tree
and selected-node detail, rewind, alternate branch scoring, original transcript
and score preservation, Resume this branch, Branch from here, Hub resume,
leaving mid-turn and a real stale409 passed. The served frontend selected the
HTTP adapter with mock disabled. Of14 turn POSTs,3 were browser-injected errors,
11 reached8080, including1 stale rejection: approximately10 live model calls.

Limits: timeout/network/unavailable screens were injected in the browser,
not actual provider failures. Bob's browser run used two initial turns; the
closed0/good7 proofs are the separate combined live demo artifacts. Browser
testing used Vite development serving and headless Edge, not a served production
build. Production build compilation passed independently. No adversarial model
reply leakage test was performed. Claude's evidence is preserved verbatim in
docs/evidence/cs40-claude-combined-browser-evidence.md, attributed to Claude.

Codex launched the production app with scripts/run_backend.py, not a fixture
runner. backend/main.py creates app with its default practice.real_persona;
that calls BasetenPersonaClient. Tests inject fixtures only into separately
constructed test apps. The existing ignored config supplies Baseten settings;
no credentials are recorded. This source/launcher confirmation complements
Claude's browser evidence; it is not runtime process-memory introspection.

## Remaining integration gate

Combined browser evidence is complete. Review final diff and evidence;
integrate via PRs into dev in dependency order;
verify final dev tree matches the checked result. Do not mark CS-40 delivered or
Sprint2 complete while browser or required PR integration remains outstanding.
Keep main unchanged. Existing lint/dependency limitations stay explicit.
