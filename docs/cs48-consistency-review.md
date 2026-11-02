# CS-48 DialogIQ consistency review

Agent: Codex. 2026-11-01. Scope: read-only review and assigned findings, no fixes.

## Revisions and method

Integrated baseline: dev/origin/dev `939af9f98ba9fd292d8d6f8ee44d22b5d96c6230`.
Published frontend reviewed separately: `e5792f2`; published coach checkpoint:
`6ea76a2`. They are not described as integrated. Accepted coaching contract r2
is `a75a43b`, provider-only delta `86d50dc`, adopted in CS-C218. Separate
worktree `.worktrees/consistency-review`, branch `codex/consistency-review`.
Other agents' working trees, shared databases, configuration and servers untouched.

Reviewed public API/DTO/error/identity paths; turn/branch retry construction;
snapshot/catalog boundaries; persistence/migration constraints; persona provider
output mapping; mock selection/labels; recorder query failure; launch/config
guidance and current cleanup records. This was a targeted round, not a claim
that every line or every failure mode has been audited.

Own Python3.12.10 venv, jiter import, pinned installation and pip check verified;
Node26.13.0/npm11.20.0 explicit installation path. The sandbox cannot resolve
the user Python install, so approved escalated runs were used. Initial inline
jiter print command had a shell-quoting SyntaxError; durable probe imports jiter
and ran successfully. No security control changes or package upgrades.

## Confirmed new issues

| Issue                                                 | Priority / owner                   | Actual result and consequence                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CS-55: duplicate turn after lost response             | P1, Claude                         | Retained UUID plus rebuilt refreshed request gives409 idempotency_conflict; releasing key and sending again creates second node/provider call. Backend replay works with original request.          |
| CS-56: public persona differs from pinned session     | P2, Codex lead; Claude UI support  | Current catalog name/opening changes, but same session's provider keeps original Maya name/opening. UI reads catalog and Session DTO supplies no public snapshot.                                   |
| CS-57: malformed persona completion gives wrong error | P2, Muse; Codex integration review | SDK double with choices=[] raises IndexError and public500 internal_error retryable=false; contract specifies502 persona_invalid_response retryable=true. Atomicity remains intact.                 |
| CS-58: recorder hides scenario-load failure           | P2, Claude                         | Actual Recorder render decision with session/tree data and scenario.error returns Loading session indefinitely, instead of failure/retry. Session-error control returns the proper error component. |

### CS-55 evidence

`scripts/review_consistency.py` exercised a real application instance through
in-process HTTP with a recording fixture provider and disposable SQLite:

1. First turn POST200, logically lose that response.
2. GET refreshed session, rebuild same learner text with new revision/head and
   retained UUID:409 `idempotency_conflict`.
3. Replay exact original body+UUID:200, original turn_id1, no new call.
4. Rebuilt request with new UUID:200, two nodes/two provider calls total.

This follows Arena's send/catch + useActionKeys behavior, still present at
e5792f2; Recorder similarly rebuilds revision-bearing actions. It is an API
sequence plus source trace, not an actual browser response-loss reproduction.
The fix must preserve one intended action's complete binding until resolved,
while allowing a later intentional identical-text turn.

### CS-56 evidence

Start a Maya session, then update only Scenario.public_persona name/opening in
the disposable database. GET scenario returns `Updated catalog persona` and
`Updated catalog opening`; same session's actual provider arguments remain
`Maya` and `What do you want? I'm in the middle of something.` Public session
has no persona snapshot. Arena and Recorder read scenarioQuery. This tests the
catalog-maintenance/pinned-config boundary, not a claimed public editing feature.
Any additive projection must expose only allowlisted public fields, never the
whole private scenario_config. Sequence schema/API edits around CS43 ownership.

### CS-57 evidence

Production persona path with fake OpenAI constructor, fake nonsecret key and
completion choices=[] returns500 with safe `internal_error`, retryable false.
Session revision unchanged. Public privacy/rollback is preserved; typed failure
classification and retry behavior are wrong. Existing coach issue CS54 is a
different module/scope and should share lessons without duplicating fixes.

### CS-58 evidence

`scripts/review_recorder_error.mjs` transpiles actual Recorder TSX and supplies
query/JSX doubles. Session/tree loaded + failed scenario yields RecorderMessage
`Loading session… / Reading the recorded turns.`; failed session yields
`Couldn't load this session`. Recorder does not handle scenario.error, and its
refreshSession helper does not invalidate the scenario query. This is executable
component-branch evidence, not React lifecycle/browser verification.

## Deduplicated findings and existing owners

- CS-49, Muse: Dana vendor content contradicts which party sent the quote;
  existing task owns content validation, no duplicate created.
- CS-50, Claude: false statuses, dead controls and misleading sample data.
  Added CS-C228: unset VITE_API_BASE_URL selects mock while Arena says Live.
  This is static evidence, not a browser run by Codex.
- CS-51, Claude with user terminology decision: inconsistent UI/product names.
- CS-52, Codex: README is a build prompt, real backend/mock setup missing,
  stale spec/provider and accepted-contract/current-record wording. Existing
  task owns this; no duplicate issue. Historical recipes should stay labelled
  as historical instead of silently presented as current launch instructions.
- CS-53, Codex: lockfile/toolchain/hygiene/lint consistency. These are existing
  task findings; no new audit run of repository-wide lint or package advisory
  database is claimed here.
- CS-54, Muse: separate published coach shape/blank-config/finish-length
  normalization issue already recorded. Not claimed as a CS48 personally run
  coach reproduction in this report.

CS55/58 were handed to Claude on CS46; CS57 and snapshot sequencing were handed
to Muse on CS43. Owner naming is recorded in each issue's framing. Fix tasks
remain separate from this audit; no task is claimed begun on an owner's behalf.

## Checks and boundaries

- Existing baseline backend regression suite: **71 passed in6.32s**, own venv,
  provider keys cleared. No live calls. Passing suite does not cover the new
  failure cases above.
- Disposable in-process API/SDK-double probe completed successfully and recorded
  all three observed discrepancies, with jiter imported under Python3.12.10.
- Transpiled Recorder branch probe confirmed scenario-error Loading versus
  session-error failure control.
- Report/journal/probe formatting and diff checks are recorded at publication.

No real8080/5173 browser/server audit, paid provider request, production serving,
accessibility audit or load/concurrency soak was run for CS48. No runtime fixes,
application test assertions, migration or contract bytes were changed. Existing
CS43/46 implementation is unfinished; absence of its routes in integrated dev
is not filed as a defect. Monitoring continues separately: CS-C224 is an early
draft whole-call-deadline review, not a final backend delivery verdict.
