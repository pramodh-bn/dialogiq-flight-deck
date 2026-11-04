# CS-82 candidate verification

Issue47, Codex branch codex/semantic-feedback. This candidate changes new Bob
sessions only when FEEDBACK_ENABLED=1 and the client selects semantic-r1.
The recording app now serves this candidate on `http://127.0.0.1:5173`, with
the API on `127.0.0.1:8080`. The redundant `127.0.0.2` preview was stopped
after owner review revealed that the familiar address still served old code.
The recording database was backed up before restart; its four saved sessions
remain on their original rules, without rescoring. The arena now identifies
older Bob sessions and links to the catalog to choose New Session for AI feedback.
The canonical API health and advertised semantic-r1 capability were checked.
Private owner dialogue was inspected locally and is excluded from this report.

## Current checkpoint: Baseten candidate ready for owner review

Pramodh subsequently authorized further testing with sufficient credits on both
providers (CS-C582), superseding the earlier eight-evaluation ceiling. Finite
batches remained recorded before calls. No recurring Megillah watch resumed.

Current application source `8fa9749641611ce16e47dde7929337142f800135` selects
Baseten Muse Spark for feedback by default. Persona-only changes remove the
old judge's advance-disclosure permission list **only** for semantic-r1 sessions;
otherwise Bob could not disclose concerns for a post-reply judge to evaluate.
Old prompt paths still match accepted dev730a3dc in all144tested combinations
([reproducible comparison](../scripts/check_legacy_persona_prompts.py),
[result](evidence/cs82/legacy-prompt-comparison.json)).

Actual final checks: **304backend,114frontend,10budget tests**, TypeScript,
changed-file ESLint,Ruff,production build and realHTTP fixture journey. Two
existing TestClient deprecation warnings remain. Owner GUI/learner verdict is
still needed; the supported browser host remains unavailable to Codex.

### Additional live batches

| Source/batch               | Calls                                               | Actual finding                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8b6e684 matched comparison | 3Baseten+3FireworksGPT grading                      | All6validate; both keep hesitant Bob from warming. Baseten recognizes specific acknowledgment that GPT misses. Baseten2.359–3.578s;GPT1.782–2.890s. Models/configurations differ: no host-only speed claim. |
| 8569d88 authored suite     | 12Baseten grading                                   | 12validate;median2.461s/max4.406s. Review finds negated-help mislabeled boundary and a weak generic need quote; both retained, definitions clarified. Shared authored cases, not independent/unseen.        |
| 8fa9749 full live journey  | 8Basetenpersona+8Basetengrading+4FireworksMusecoach | All8grades available;0fallback/error/retry/blocked. Grade median2.98s/max4.91s; full turn6.454–11.766s. Fourcoach calls median9.97s/max14.27s. Both reload checks preserve exact saved nodes.               |
| 8fa9749 definition checks  | 2Baseten grading                                    | Direct answer no longer earns a need from generic approval; negated help is none rather than a pause boundary.2.281/2.187s. Reused authored examples, not independent evidence.                             |

Full-journey public evidence shows needs0→1→2→3, an open invitation recognized
without forcing a reveal, a closed question changing the ratio100→50, and a
supportive statement earning progress only after Bob discloses a priority need.
Specific acknowledgment is counted in the second session. The request to inflate
grades leaves score2unchanged; the pause is respected. Stance movement cites
Bob's response rather than learner intent. This is a finite authored sample,
not proof of real empathy/trust or universally correct scoring.

Review retains limits: coach hint1 says "Thanks for pulling that list together"
when Bob only said "I can pull it into one list". This future-to-completed action
slip belongs to the known invention family tracked in CS-81; no coach prompt
was tuned here. Mixed positive/hesitant reactions and rubric category choices
remain subjective. A valid source ID proves provenance, not the judgment.

Across **all** recorded phases: **36evaluator +12persona +6coach admitted
requests**,0Meta/SDKretry/blocked. All per-batch caps held. Old timeouts/rejected
requests still count; absent usage does not prove zero billing. Manual owner
review is separate from these completed automated batches.

### Owner preview

http://127.0.0.2:5173 serves the new production client with backend8080 and
Baseten feedback enabled, Fireworks coach/demo wait retained. Backendexec55902,
frontendexec74265 were running at this checkpoint; refresh health on resume.
Normal backend runner, **no tiny verification quota**. Fresh private database
`semantic-evidence.local/owner-review.db`; owner's dialogue is never
automatically published. The previous127.0.0.1recording app/database is untouched.
Start a new Bob session; historical sessions are never silently rescored.

Evidence for each batch is in `docs/evidence/cs82/` with matching reports,
pre-SDK budget logs and credential/prompt-free telemetry. Only intentional
synthetic public dialogues are retained. CS-82 remains active for owner review;
PR48is draft and not merged. Earlier pending-budget statements below are
historical and superseded by CS-C582 and this checkpoint.

## Earlier checkpoint after limited live diagnostics

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
