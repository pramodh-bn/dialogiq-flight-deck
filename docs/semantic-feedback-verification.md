# CS-82 candidate verification

Issue47, Codex branch codex/semantic-feedback. This candidate changes new Bob
sessions only when FEEDBACK_ENABLED=1 and the client selects semantic-r1.
The existing recording app and its private database are not migrated/restarted.

Actual checks before paid work:295backend tests passed (277prior+18semantic),
114frontend tests (110prior+4new), TypeScript and changed-file ESLint passed.
After explicit Fireworks selection and independent budget changes, targeted
48backend/guard/client checks passed. Ruff/format/diff checks pass. Python3.12.10
task venv with jiter, pinned requirements and explicit Node26.13.0/npm11.20.0.
Production build uses the real API at127.0.0.2:8080, frontend5173, paired demo
flags. Two existing TestClient deprecation warnings remain attributed.

`backend/.venv/Scripts/python.exe scripts/verify_semantic_feedback_http.py`
passed a realHTTP fixture journey on127.0.0.2:8080/disposableDB:4turns,
2chained hints, actual hint-example follow-through, changing counters/stance,
invalid-evidence unavailable state, idempotent replay, fork and reload.
All3providers are fixtures;0paid calls. Authored classifications prove wiring,
not semantic quality. Windows child-process cleanup is scoped to its own tree.

## Finite live plan, before calls

Under Pramodh's explicit "once you are ready let me know lets run it": one
frozen candidate, one public synthetic2session/8turn journey. Baseten persona
at most8attempts; Fireworks evaluator8; Fireworks coach4(first/chained second
hint after turn2 in each session).0Meta; SDK retries0; no paid quality rerun.
Server caps are reserved before SDK calls with separate role counters. Plan
includes following an actual hint, open invitation, support, acknowledgment,
closed check, injected grading instructions and respectful pause. Actual Bob
dialogue—not intended learner effect—grounds the review. Record all failures,
finish/token telemetry, actual waits and status/counters. No untouched-case
claim, independent evaluation or reliability claim from this authored sample.

The live server runs on127.0.0.2:8080 using a fresh verification database and
COACH_PROVIDER=fireworks, COACH_DEMO_WAIT=1, FEEDBACK_ENABLED=1,
VERIFY_MAX_PERSONA_CALLS=8, VERIFY_MAX_FEEDBACK_CALLS=8,
VERIFY_MAX_COACH_CALLS=4 and a NEW VERIFY_BUDGET_LOG. Telemetry is credential/
prompt-free. Use run_bounded_verification_backend.py with the ignored env file;
capture_semantic_feedback_live.py writes only these intentionally public
synthetic cases and public DTOs. Never publish private rubric or user recordings.

No GUI browser claim: supported browser host was unavailable in the current
session; automatic review rejected a headless browser command during demo
recovery. ReactDOM tests and HTTP checks are separate evidence. Visual/learner
verification and actual owner verdict remain before delivery/integration.
