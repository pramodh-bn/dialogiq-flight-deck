# CS-60 demo coach waiting

Agent: Codex. 2026-11-02. Delta ID `s3-coach-r2.demo-wait.1`.

## Authority and scope

Pramodh explicitly authorized removing the latency cutoff for the demo:
"for the demo purpose we can lift that limit on latency, let it take as much
time as it needs". This replaces the demo responsiveness target, not hint
quality or privacy requirements. CS-60 records owner acknowledgment and exact
source adoption. Publication defines intended behavior; it does not claim the
implementation or verification is complete.

Baseline: [accepted coach contract](cs45-coaching-contract.md), wire revision
`s3-coach-r2`, plus adopted [2048-token delta](cs43-meta-token-delta.md).
Existing routes, request/response fields, ports, prompts, scoring, automatic
eligibility, attempt limits, immutable hint slots and cache identity stay the
same. No reasoning parameter is introduced. The newly proposed low-effort
experiment is deferred; it is not required to meet this demo direction.

## Exact operating modes

Use paired opt-in configuration, both unset by default:

| Surface                     | Demo setting             | Effect                                                       |
| --------------------------- | ------------------------ | ------------------------------------------------------------ |
| Backend process             | `COACH_DEMO_WAIT=1`      | Coach generation has no application elapsed-time cutoff.     |
| Frontend Vite process/build | `VITE_COACH_DEMO_WAIT=1` | Coach action waits without a fixed total observation cutoff. |

Only the exact string `1` enables the mode. Configure both together and record
both values, without secret values, in verification evidence. Restart the
backend and Vite after changing configuration; a production frontend needs a
new build. The launcher must allowlist `COACH_DEMO_WAIT` when reading its
explicit env file. Never copy credentials into worktrees or frontend variables.

Normal mode retains the existing 8-second provider, 10-second fallback choice
and single 15-second client action budgets. Persona calls and unrelated HTTP
operations retain their existing timeouts in either mode.

Demo mode must disable each coach deadline rather than substitute an arbitrary
large number. In particular, pass `timeout=None` explicitly to the provider SDK;
omitting it would retain its own default. Remove the service worker's 8-second
join cutoff and 10-second fallback cutoff for demo generations. The frontend
coach POST and its recovery observation have no fixed total elapsed deadline;
do not feed Infinity to `AbortSignal.timeout` or timer APIs. Short recovery GET
requests may retain a per-read network timeout, but it cannot terminate an
otherwise healthy pending generation solely because total time exceeded 15s.

Missing configuration, invalid output and actual provider/transport failures
still use the existing typed outcomes/fallbacks. Provider-side timeouts can
still occur. This mode removes our elapsed-time cutoff; it cannot guarantee
that a remote provider, proxy, browser or connection never fails.

## Ownership while waiting

The existing pending UUID reservation and hint-slot lease expire after 30s.
During a demo generation, renew BOTH atomically at intervals no longer than 5s,
to 30s after renewal. Use the same owner token and require both rows to remain
pending and owned by that generation. Do not create a fresh reservation or
reclaim ownership in a heartbeat. If ownership is lost or already expired,
stop observing that generation and prevent its result from publishing.

Provider work holds no database lock or transaction. Renewals use short
transactions on the waiting/server thread or a correctly isolated DB session;
never share a SQLAlchemy session concurrently with the provider worker. After
process failure, leases become reclaimable 30s after the last successful
renewal. An infinite lease or a large fixed expiry is not a substitute.

Same-key replay preserves exact method/path/body/UUID. A competing same-slot
request must observe `request_in_progress` while ownership is healthy, including
after the original 30s expiry would have elapsed. One generation means one
provider call and at most one saved hint. Returning from a long call still
revalidates session revision, active branch, head and owner before saving.

## Frontend waiting and recovery

Keep the coach visibly pending while the learner remains at that position.
Continue paced observation of existing `request_in_progress` responses without
resetting UUID/body or creating another automatic attempt. Preserve one explicit
second approach and no third attempt. Do not spin on failed network requests:
an actual lost connection may expose the existing unresolved/same-key retry.

Navigation/unmount abandons local observation and prevents late display. Abort
the local fetch/wait where supported; do not describe that as cancellation of
the server's paid provider call. The server can finish/cache a still-valid
generation; a changed conversation must fail its existing state validation.
No new server-cancel endpoint or additional attempt is introduced.

Keep wire `latency_ms` in its existing 0..10000 range and saturation semantics.
In demo evidence, 10000 means at least 10 seconds, not exactly 10 seconds.
Record actual HTTP/browser elapsed time separately; never claim a long hint
completed in 10 seconds because its persisted latency saturated.

## Owners and verification

Muse owns backend client/service/lease tests and launcher changes. Claude owns
frontend adapter/observer/pending behavior and browser harness. Codex owns this
delta, independent review and the integration handoff. Owners acknowledge the
exact revision before parallel edits; no takeover of another worktree.

Required evidence:

1. Default-mode timeout/fallback and single-budget regression checks remain
   green. Demo failures still map safely; no scoring or private-context changes.
2. Injected provider success after 15s and after 30s, with real HTTP for the
   long-lease case. Same-key and different-key competitors produce one provider
   invocation and one saved hint. Also test renewal owner loss, crash-expiry
   recovery and conversation changes before a late completion.
3. Frontend controlled-clock tests and real browser delayed-response checks:
   pending beyond 15s, success, navigation with no late display, exact retry
   identity and recovery. Distinguish simulated delay from live Meta latency.
4. Coordinate a single disposable backend8080/frontend5173 run after both owners
   publish ready commits. Record Python/Node preflight, source revisions,
   configuration, DB, actual elapsed time and injected versus live provider.
5. At least one real Meta hint through the actual demo-mode browser path; N1
   stalled Maya first/second hint usefulness remains required in the combined
   acceptance. Preserve independent hostile/privacy judgments. No 8-second
   speed pass/fail requirement applies to demo mode.

Document tested startup commands in the implementation handoff. Delivery and
integration remain separate. No merge, production deployment, main promotion
or completion claim follows automatically from this document.
