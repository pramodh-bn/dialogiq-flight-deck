# DialogIQ ? Sprint 1 delivery and integration report

Reviewed by Codex on October 29, 2026, under CS-33.

## Outcome

Sprint 1 establishes a working frontend-to-backend foundation. The Scenario Hub
loads four seeded scenarios from FastAPI; selecting one starts a database-backed
practice session; sending a message reaches the API and displays its placeholder
reply. The standalone persona client is implemented and tested with mocked calls.

This is a foundation demo. Chat replies and scores are fixed placeholders;
conversation turns are not saved, and the persona client is not connected to chat.
The full communication-training loop remains future work.

## Delivered workstreams

| Task | Delivery | Contributors |
| --- | --- | --- |
| CS-30 | SQLAlchemy models for users, scenarios, sessions, and parent/child conversation nodes | Antigravity implemented; Claude completed the handoff |
| CS-29 | SQLite engine, request-scoped sessions, database setup at server startup, and idempotent scenario seeding | Antigravity and Claude |
| CS-28 | Health check, public scenario listing, practice-session creation, placeholder chat endpoint, and CORS for ports 8080/5173 | Antigravity; Claude added session creation, startup seeding, CORS correction, and server dependencies |
| CS-31 | Typed HTTP and mock clients, API-backed Scenario Hub, selected-scenario routing, session creation in Arena, reply/error handling, and browser-side coaching | Claude |
| CS-32 | Baseten/OpenAI-compatible persona client, persona prompt builder, resistance levels, environment-only configuration, and 14 mocked tests | Antigravity implemented; Muse reviewed and delivered |
| CS-33 | Combined integration review, foreign-key enforcement, private-field and model-tree regression checks, test isolation, style convergence, and repeatable API/client demo verification | Codex |

## Verified behavior

- Startup creates the tables and seeds four scenarios on an empty database.
- GET /api/scenarios exposes only id, title, and description.
- POST /api/sessions returns a new session and initial score; unknown scenarios
  return 404. Sprint 1 uses one demo user and has no authentication.
- POST /api/chat/turn accepts a question and returns the fixed Sprint 1 reply.
  Empty messages return 422. Session validation and turn persistence are deferred.
- The frontend selects HTTP when VITE_API_BASE_URL is set; otherwise it uses the
  in-browser mock. API configuration must be present when starting/building Vite.
- The persona client stays inert without its Baseten key and never falls back to
  the Meta key. All persona tests replace the model client; no paid calls ran.

## Integration corrections

Codex combined dev cffa4dd with Claude's frontend a2e0003 in an isolated worktree.
The merge had no conflicts and preserves the original commits and attribution.

Review found SQLite foreign-key enforcement disabled despite ForeignKey declarations.
The shared engine factory now enables it for each connection; a regression test
rejects orphan sessions. Additional tests cover persisted branch-shaped node trees,
subtree deletion, and exclusion of private scenario fields from public responses.
API tests now start with independent databases, removing their execution-order
assumption. Production functions missing annotations received type hints.

Ruff formatting was applied to the backend, and Prettier to the Sprint 1 frontend
files. ESLint now excludes Python virtual environments. Pytest caches are ignored.
LF checkout rules prevent formatter failures caused solely by Windows line endings.

## Verification evidence

Run by Codex on the combined review branch with Python 3.15 and Node 26.13.0:

| Check | Result |
| --- | --- |
| Backend pytest | 25 passed: 14 persona tests and 11 integration/model tests |
| Session test run by itself | 1 passed, confirming independence from scenario-list tests |
| Frontend Vitest | 8 passed |
| TypeScript typecheck | Passed |
| Backend Ruff lint and formatting | Passed |
| Sprint 1 frontend ESLint and Prettier | Passed |
| pip check | No broken requirements |
| API-configured Vite production build | Passed |
| Real uvicorn + actual TypeScript HTTP adapter | Passed twice, including seeding, scenario selection, session creation, placeholder reply, 404, 422, and CORS from port 8080 |

Claude separately recorded a Chrome click-through of the Hub and Arena in CS-C123.
Codex's independent demo check uses real HTTP and the actual frontend adapter;
it does not claim a second visual browser inspection.

Repository-wide ESLint is not clean: the review snapshot had 5,239 Prettier errors
and six React Refresh warnings in untouched files. The Sprint 1 scope passes.
The npm audit snapshot reports two high-severity dependency findings (Vite and
Zod). Dependency upgrades and whole-repository formatting are follow-ups; no forced
upgrade or unrelated source rewrite was included in integration.

## Private-data boundary

Private hidden needs, traits, and system prompts stay out of the public scenario
DTO. A sentinel-based test checks scenario, session, and chat responses. Browser
coaching currently consumes only the user's text through regex classification.

The persona model intentionally receives its private roleplay brief. Instructions
in that prompt are not proof that a model cannot reveal it. There is no backend
coach path, structured hidden-need graph, or deterministic reveal judge yet;
those boundaries need new tests when implemented. No live model validation ran.

## Remaining work

1. Persist and validate turns, wire persona generation into chat, and replace fixed
   turn_id/score values with session state and a deterministic judge.
2. Implement structured need graphs and revealed-node tracking; test the future
   coach boundary independently of the persona brief.
3. Replace the hardcoded Bob persona, opening line, tags, hints, and resistance
   labels when another scenario is selected. Only the Arena title is scenario-aware.
4. Prevent duplicate development-mode session creation under StrictMode, and reset
   Arena state when switching scenarios without unmounting. Cancel pending reply
   timers/requests on navigation.
5. Connect Flight Recorder branching/rewind and Analytics to persisted data.
   Dashboard progress/history remain demonstration data; Fireworks is not wired.
6. Add database migrations. The current create_all setup does not upgrade an
   existing schema. The manual backend/smoke_test.py is not repeatable against
   the same database because its test user is unique; use the verifier below.
7. Before building real branching, enforce that a parent node belongs to the same
   session as its child; the current schema has no composite constraint for this.
8. Address whole-repository formatting and dependency audit findings separately.

## Reproduce locally on Windows

Use an isolated checkout, Node on PATH, and a fresh Python environment:

```powershell
npm.cmd ci
py -3.15 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pytest backend -q
npm.cmd test
backend/.venv/Scripts/python.exe scripts/verify_sprint1.py --node node
```

The verifier starts an ephemeral-port uvicorn server, uses this checkout's local
backend/dialogiq.db, exercises the actual TS HTTP client, and stops its server.
It assumes the four demo scenarios; use a fresh checkout database for this check.
It makes no model requests. If Node is not on PATH, pass its absolute path to --node.

For the interactive demo, run these in separate terminals:

```powershell
# Terminal 1, from repository root
Set-Location backend
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2, from repository root
$env:VITE_API_BASE_URL = "http://localhost:8000"
npm.cmd run dev
```

Open http://localhost:8080, select a scenario, and send a question. Expect the fixed
backend reply and local regex coaching. No API keys are needed for this demo.
