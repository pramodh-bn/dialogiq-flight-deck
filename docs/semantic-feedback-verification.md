# CS-82 candidate verification

Issue47, Codex branch codex/semantic-feedback. This candidate changes new Bob
sessions only when FEEDBACK_ENABLED=1 and the client selects semantic-r1.
The existing recording app and its private database are not migrated/restarted.

## Current checkpoint after live diagnostics

Latest reaction-gated correction and Baseten adapter:303backend tests passed,114frontend tests,
TypeScript,changed-file ESLint,Ruff and realHTTP fixture journey passed. These
are wiring/safety checks, not model judgment acceptance. The AI evaluator is
explicitly Fireworks gpt-oss-120b,4096tokens/low/JSONmode/12s. Bob stays on
Baseten Muse Spark and the coach stays on Fireworks Muse Spark. Model choice
was checked against the account's live model list, not inferred from a catalog.

The original eight evaluator-attempt ceiling is exhausted. No more automated
generation is authorized by this plan. A fresh finite plan and owner decision
are needed for further live validation. CS-82 remains active; draft PR48 is not
delivered or ready to merge. The existing recording app still uses its accepted
legacy feedback and has not been swapped to this candidate.

| Phase/source                                       | Actual requests            | Result and limits                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial Muse,2f5ee6d                               | 2persona,2evaluator,2coach | Evaluator2/2timeouts at12s; app saved unavailable feedback. Coach completed15.47/39.74s. Full8turn journey aborted; partial capture plus later GET recovery kept.                                                                                                  |
| Llama qualification,1303b99                        | 2evaluator                 | Two immediately rejected requests,0.50/0.08s,no finish/tokenusage. Account list later showed this model absent. Exact HTTP status was not retained; no completed grading claim.                                                                                    |
| GPT qualification,fa05610                          | 2evaluator                 | Both generated finishstop at1.48/1.75s. One validated support judgment; one rejected ValueError. Precise invalid field was not retained, so no proven quote-drift diagnosis. No saved-session rescore.                                                             |
| Span-ID integrated,e11f2ec backend /5f267a2capture | 2persona,2evaluator        | Both validated at1.61/1.41s; total turn7.125/7.422s. Open invitation counted and support recognized. Score/acknowledgment remained0. Reload preserved snapshots. Simulated stance moved warming→open despite a hesitant Bob reply: **quality miss**, not accepted. |

Totals: **8evaluator +4persona +2coach admitted attempts**, within original
8/8/4caps;0Meta,0SDKretries,0blocked. Timeout/rejected attempts still consume
the allowance. Missing usage on errors does not establish billing or zero cost.
Two read-only model-list requests made no generation. Small unmatched phases
do not establish model reliability, causal performance differences or learning.

### Correction after the final measured phase

The latest code requires an additional current-persona reaction source ID for
any stance change. The prompt prohibits converting hesitant/refusing replies
into openness merely because a learner offered help. The server copies the
reaction quote and enforces its speaker/source; semantic interpretation still
needs review. Templates now distinguish inviting clarification from providing
it. This correction passes local tests but has **not been measured live**.
The two measured span-ID judgments must not be carried forward as proof this
new reaction gate works. No user recordings or historical nodes were changed.

Evidence: [initial report](evidence/cs82/initial-muse-report.json),
[initial annotation](evidence/cs82/initial-run-annotation.json),
[initial budget](evidence/cs82/initial-budget.jsonl),
[initial telemetry](evidence/cs82/initial-telemetry.jsonl),
[unavailable model report](evidence/cs82/unavailable-llama-report.json),
[GPT qualification](evidence/cs82/gpt-qualification-report.json),
[span integrated report](evidence/cs82/span-integrated-report.json).
Each phase's budget and telemetry are beside these files. Reports contain
intentionally public synthetic dialogue, exact prior public context and public
DTOs only. Private rubric, prompts, model reasoning and actual user recordings
are excluded. Quote provenance is not proof a classification is correct.

The earlier pre-run plan and checkpoint below remain history, not live status.

### Prepared Baseten comparison, awaiting a new allowance

User asked about Baseten grading. An independent evaluator adapter is prepared
with isolated Baseten credentials, JSON request, no SDK retries and the same
deadline/evidence safeguards. No Baseten grading call has been made. Offline
checks cover missing Baseten key despite other provider keys, separate model/
endpoint settings, exact SDK request and inert unknown provider. Earlier
Baseten calls generated Bob, not grades; their latency is not grader evidence.

Proposed next step is **six additional evaluator attempts maximum**: three
Baseten Muse Spark and three Fireworks GPT-OSS, same frozen reaction-gated
candidate and same three contexts. Zero additional persona or coach calls.
Each process gets its own explicit3call pre-SDK cap and new evidence directory;
stop at two failures, no automatic retry/rerun. Inputs1/2 are the recorded public
span-ID exchanges; input5 is the pre-authored acknowledgment/disclosure contrast.
Review actual quoted reactions and need evidence, not only JSON validity. This
compares configurations/models; it does not isolate provider causality or
establish reliability from3cases. This plan has **not** been executed.

From this task's Python3.12venv, with the existing synthetic verificationDB:

```powershell
backend/.venv/Scripts/python.exe scripts/qualify_semantic_feedback.py --provider baseten --max-calls 3 --case-indices 1,2,5 --env-file <ignored-env-file> --prior-report docs/evidence/cs82/span-integrated-report.json --database semantic-evidence.local/integrated.db --out semantic-evidence.local/baseten-comparison
backend/.venv/Scripts/python.exe scripts/qualify_semantic_feedback.py --provider fireworks --max-calls 3 --case-indices 1,2,5 --env-file <ignored-env-file> --prior-report docs/evidence/cs82/span-integrated-report.json --database semantic-evidence.local/integrated.db --out semantic-evidence.local/fireworks-comparison
```

Do not run these merely because commands are published; the eight-call allowance
above is exhausted. The next owner decision is whether to authorize this fresh
six-call comparison. No inference is made from silence or a preselected option.

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
