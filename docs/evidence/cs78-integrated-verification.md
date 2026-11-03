# CS-78 integrated verification

Codex owns this verification; Claude owns CS-52 product run instructions.
User acceptance CS-C532 records specific quality/latency misses as accepted
limits, not passed targets. No prompt tuning or old-session migration occurs here.

## Finite live plan (CS-C541)

One run of the three public `bob_capture_cases.json` cases: natural stall,
first/chained second hints, actual suggested-line follow-through, reload/fork,
direct request and hostile instruction. Expected 7 persona and 11–12 coach
attempts. Hard caps: **10 Baseten persona attempts, 16 Fireworks coach attempts,
zero Meta attempts**. Failed attempts count; no paid retry or quality rerun.
Do not reuse U1–U4 as untouched cases. Preserve any failure and the earlier
69/60 journey-cap breach. Actual counts come from the budget log, not estimates.

The verification-only runner refuses missing/invalid limits and an existing
budget log. It reserves each attempt under a lock before entering the SDK,
including automatic hints and failures. Exhaustion maps to the provider's typed
unavailable error, preventing another paid attempt. Inspect `attempts_blocked`:
any nonzero value means this journey exhausted its budget and is incomplete.
Logs contain only counts/limits; no keys, prompts or dialogue. Provider SDK
retries remain disabled. Unconfigured calls also count conservatively.

PowerShell, from the isolated verification worktree with its own Python 3.12
venv and Node/npm resolved explicitly:

```powershell
$env:COACH_PROVIDER = 'fireworks'
$env:COACH_DEMO_WAIT = '1'
$env:VERIFY_MAX_COACH_CALLS = '16'
$env:VERIFY_MAX_PERSONA_CALLS = '10'
$env:VERIFY_BUDGET_LOG = "$PWD/cs78-evidence.local/live/budget.jsonl"
node scripts/verify_coaching_browser.mjs --journey bob --coach real --demo-wait --frontend production --bind 127.0.0.1 --env-file <ignored-env-file> --backend-runner scripts/run_bounded_verification_backend.py --out cs78-evidence.local/live
```

The harness sets the paired frontend demo flag, builds the production client,
uses ports 8080/5173 and a disposable database, refuses occupied ports and stops
its own processes afterward. It never modifies the held demo or ignored env file.
Normal/demo wait limitations remain; demo mode has no application cutoff.

## Separate checks

Record full backend/frontend checks against exact final bytes, then stand-in
`bob-stance`, `lost-response`, `recorder-failure` and `graph-navigation` browser
journeys on the production build. These use zero paid calls and prove their
specific recovery/layout/state paths, not live quality. Attribute other agents'
evidence to them. Compare exact candidate/integrated files before carrying any
earlier evidence forward. Real-device pinch/zoom remains untested unless run.

## Results recorded by Codex, November 3, 2026

Integrated product: `fbfd47f5f8fa0850b85103321614abae5af440b3`, including
PR36/35 (Muse), PR39 (Muse), PR38/40/42 (Codex). Verification source
`bc7c88785f5aa4e642222ccb84080e690a1ab3bb` has identical backend, frontend
application and current README/contract/spec/report files. Its extra files and
harness changes are verification-only. Old catalogs/sessions were not migrated.

| Check                    | Actual result / scope                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend                  | 277 passed; two known TestClient deprecation warnings; provider keys cleared. Backend bytes equal integrated product.                                                                                             |
| Frontend                 | 110 passed, TypeScript and Arena ESLint clean after PR42.                                                                                                                                                         |
| Evidence helpers         | 17 passed.                                                                                                                                                                                                        |
| Call guard               | 9 passed, including 50 concurrent reservations, zero capacity, failed attempts and both real API provider boundaries without constructing an SDK client.                                                          |
| Clean setup              | Fresh Python3.12.10 venv, pinned requirements, jiter import and pip check; Node26.13.0/npm11.20.0, npm ci --ignore-scripts.                                                                                       |
| Production Bob/legacy UI | 38/38 on bc7c887, actual8080/5173, disposable DB, two stand-in persona calls, zero paid calls. Legacy Bob/Maya pins and reload preserved.                                                                         |
| Narrow composer control  | Earlier same assertions:36pass/2fail, textarea26px and Send right418.9px at390px. PR42 correction:textarea284px, Send right361px,38/38. Preserved A94/A95.                                                        |
| Lost response recovery   | 32/32 rerun on final bc7c887, stand-in persona, zero paid.                                                                                                                                                        |
| Recorder failures        | 15/15 on earlier f5c8867; Recorder/API bytes unchanged by subsequent Arena-only fix.                                                                                                                              |
| Graph navigation         | 75/75 on earlier f5c8867; unchanged Recorder/API,18turns/3branches,6viewports,4canvas zoom levels, first/last nodes reachable and state preserved. Magnification emulated, no physical pinch/device proof.        |
| Final live journey       | 7/7 workflow checks on bc7c887 with production client8080/5173 and disposable DB. Three shared cases,11provider hints,7persona replies, actual suggested-line follow-through, original/fork and reload preserved. |

The live run admitted **11 Fireworks coach attempts and 7 Baseten persona
attempts**, zero Meta, no fallback/provider failure, no cap blocks, no retries.
Both providers disable SDK retries. Budget caps were16/10, physically checked
before provider calls. All11 coach replies finished `stop`; observed model is
`accounts/fireworks/models/muse-spark-open`,16384tokens/low reasoning/no timeout.
Persona model was `meta-models/muse-spark-open-1026` from the readonly config.

Application hint waits: first median6.450s/max8.843s (7); second median7.825s/
max9.812s (4). At7stalled positions, maximum cumulative stall per selected
case/branch/head has median15.445s/max20.068s. Provider-only telemetry median
6.28s/max9.67s excludes application overhead. These unmatched finite results
do not replace earlier accepted13.7s/22.0s medians or83.9s max.

## Text review and remaining acceptance

[Public report](cs78-live-public-report.json), [text review](cs78-live-text-review.md),
[call-budget log](cs78-call-budget.jsonl), [coach telemetry](cs78-coach-telemetry.jsonl)
and [clean Python package versions](cs78-python-freeze.txt) preserve the evidence.
The public report is also CS-A96; review CS-A97. No credentials, private brief,
hidden scenario graph or model reasoning text are included. Manual-review
conversation content is not automatically published with these scripted cases.

**One new grounding flag remains:** hint6 says the spec changed after the Q3
update was sent. The selected public branch and prior hints do not establish
that order. This is unsupported chronology, not proven falsehood. Its reason
claiming grounding is not evidence. No private/instruction disclosure,
injection compliance or unauthorized promise was found in11hints inspected;
this is not a guarantee or a new untouched evaluation. Hints5/6 still return
clarity questions to Bob, and every live stance stayed guarded in this small
sample. Controlled unscored stance movement is separate stand-in evidence.
Explicit stop was not sampled anew here; Muse's prior6/6 stays attributed.

UserC532 accepted named earlier quality/latency misses and prohibited further
tuning before submission. No prompt change or paid rerun was made for this
new finding. Final user treatment of this additional limit and learner verdict
remain pending; do not call all quality gates passed or mark final acceptance
from workflow success. The earlier69/60journey-cap breach remains history.

A fresh production review preview is served on127.0.0.1:8080/5173, using a
separate DB and only the original budget remainder: at most3additional persona
replies and5coach attempts. Automatic hints count. Automated+manual totals
therefore remain bounded by10/16. This preview makes no model call until the
user acts. Its actual process health/budget must be refreshed on resumption;
do not infer ongoing operation from this timestamped document.

Acceptance state above is a snapshot at about18:45UTC. Later owner decisions
and the learner verdict belong to Megillah CS-78; this file is not a live status
feed and does not presume their outcome.
