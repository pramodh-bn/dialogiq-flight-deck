# CS-62 demo coach reasoning

Agent: Codex. 2026-11-02. Proposed delta
`s3-coach-r2.demo-reasoning-low.1`.

## Exact proposal

When backend `COACH_DEMO_WAIT` is exactly `1`, send top-level
`reasoning_effort="low"` in the Meta Chat Completions request. Keep the adopted
demo `max_tokens=16384`. Otherwise retain `max_tokens=2048` and omit the
reasoning parameter entirely. Do not use `none`, change the model or introduce
a public request override. An SDK keyword or `extra_body` is acceptable only
if it produces that same top-level wire field; verify the emitted request.

Keep temperature 0.3, zero SDK retries, nonstreaming, strict whole JSON and
`finish_reason=stop` success. Preserve the exact grounded instruction at
`25c5102217aff89dc4f33ac8f2198eaaf7b337e4`, public context, field lengths,
cache/wire revision `s3-coach-r2`, two attempts, immutable rows, ownership
heartbeats, navigation protection and existing typed fallback. Demo still has
no application cutoff; normal mode retains its accepted timing behavior.
Do not add a migration, DTO field or scoring change.

This proposal layers on [demo waiting](cs60-demo-wait-delta.md) and the adopted
[16384 cap](cs62-demo-token-delta.md). It contains no CS-68 acknowledgment/open
question sentence; that is a separately attributable prompt change.

## Evidence and decision

Claude's real browser arm D (local source `c234ae0`, CS-C309) changed only the
reasoning field from arm C. Same cap, grounding, real Meta/Baseten, disposable
DB, paired demo flags, five N1 and three H1 pairs, no reruns. Claude reported:

| Observation                        | Default reasoning | Low reasoning |
| ---------------------------------- | ----------------- | ------------- |
| Calls finishing stop               | 40/40             | 40/40         |
| First saved hints from provider    | 14/14             | 15/15         |
| Second saved hints from provider   | 10/10             | 10/10         |
| Median / maximum seconds           | 11.53 / 17.78     | 6.78 / 10.72  |
| 90th percentile seconds            | 15.45             | 8.3           |
| Median / maximum completion tokens | 2222 / 3343       | 1057 / 1607   |

Codex read the saved C/D reports and content-free call logs: 40 calls each,
24/25 saved provider hints respectively, no saved fallbacks. That is an
artifact check, not a Codex rerun. Claude read the 25 D hints: no invented
scenario fact or hidden need observed, and distinct second hints. Two hostile
case second hints still mildly pressed for an explanation after a refusal;
one N1 second hint repeated a timing move. This is not a guarantee of quality,
privacy or latency, and it does not establish real learner benefit.

Muse's controlled measurement is pending at publication. This proposal does
not invent its results. Record them and any contrary evidence on CS-62 before
the final decision. Owner acknowledgment of the exact bytes and Codex's
explicit adoption are required; publication alone changes no runtime setting.
If further data contradicts the proposal, revise or reject it explicitly.

Meta's [reasoning documentation](https://dev.meta.ai/docs/reasoning) specifies
the top-level Chat Completions control and supports `low` for Muse Spark.
Reasoning consumes the completion allowance. A lower setting may reduce
latency, but this application must establish its own quality tradeoff.

## Implementation and verification

Muse owns SDK/service selection and regression tests. Capture the request at
the SDK/wire boundary: exact-1 demo must send low plus 16384 and explicit
`timeout=None`; unset, `0` and other strings must omit reasoning and keep the
normal defaults. Preserve explicit, recorded probe overrides for experiments.
Typed errors and no-config behavior remain unchanged and reveal no secrets.

Publish the runtime commit/PR and checks actually run. Claude verifies final
source wiring and independently judges first/second hints, grounding, hostile
cases and clear requests for space. Reuse the accepted controlled/browser
sample honestly; do not require another full exploratory arm just for changing
the tested setting into a production constant. New prompt wording still needs
its own output sample at the adopted final settings.

Provider metadata logs stay content-free; visible outputs belong in separate
evidence, never raw private reasoning. Normal-mode speed tuning is unmeasured
and outside this delta. Delivery, integration, production-build rehearsal and
the user's walkthrough remain separate gates.
