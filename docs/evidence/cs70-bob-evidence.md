# Bob coach evidence (CS-70)

`scripts/verify_coaching_browser.mjs --journey bob` drives Bob in a real browser
and saves each coach hint beside the public dialogue it answered, so a reviewer
can trace a detail in a hint to the turn it came from. A hint's own `reason` is
not grounding evidence.

## Run it

```
node scripts/verify_coaching_browser.mjs --journey bob --coach real --demo-wait \
  --frontend production --env-file ../dialogiq-flight-deck/.env --out <dir>
```

- Add `--bind 127.0.0.2` to run beside a held demo. The same ports are used on
  that address, and the backend allows only that origin for this run.
- `--cases <file>` supplies other cases. Case text is never printed to the
  console, so an independent runner can pass unseen cases without showing them
  to whoever watches the run. The report does contain the text.
- `node --test scripts/test_coach_evidence.mjs` checks capture with synthetic
  data: no servers, browser or model calls.

The default cases in `scripts/cases/bob_capture_cases.json` prove the capture
path. They do not measure coach quality; CS-74 defines those cases.

## What a run costs

Every stalled turn draws an automatic hint, so count Meta calls as stalled turns
plus second attempts, not hint steps alone. A rewind to a stalled turn also draws
one. The default cases used 11 Meta calls and 7 Baseten turns per run. The report
gives the observed Meta count in `meta_calls_observed`.

## Reading the report

| Field | Meaning |
| --- | --- |
| `bob.hints[]` | One saved hint with its selected-branch `transcript`, `opening`, `prior_hints`, session, branch, head, attempt and hint id. |
| `bob.hints[].timing` | Elapsed time measured by the harness. |
| `bob.transcripts[]` | Whole public dialogue for each branch, including forks. |
| `bob.follow_through[]` | A suggested line sent verbatim, with Bob's reply. |
| `bob.denominators` | Planned, saved, provider, fallback and not-saved counts by attempt. |
| `bob.missing_hints[]` | Hints a case asked for that never arrived. |
| `bob.reloads[]`, `bob.forks[]` | Hint ids around a reload, and the branches around a rewind. |
| `provider_settings.declared` | Read from `backend/coach.py`. Not observed. |
| `provider_settings.emitted` | Observed at the coach client, from content-free telemetry. |

`stalled_total_ms` runs from sending the turn to the hint being saved, and adds
the second hint's wait for attempt 2. It leaves out reading time between actions.
It is null-based for rewinds and first requests at the opening, which have no turn
to send. `latency_ms_wire` saturates at 10000, so use `timing` for real waits.

## Limits

- Bob is simulated, so a good reply here is not evidence about real people.
- Records hold public fields by allowlist, and `report holds no private field
  names` checks key names only. It does not prove a model reply is free of
  private content.
- `coach-telemetry.jsonl` covers the coach client. It does not cover Baseten.
- The report cannot reconstruct older runs, so the disputed "yesterday" detail
  in CS-A73 stays unverified.
