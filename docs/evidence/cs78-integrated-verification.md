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

Final results, exact revisions, counts, timings and remaining limits will be
added after the checks. A running app is not inferred from merged source.
