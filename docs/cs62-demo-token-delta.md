# CS-62 demo coach token budget

Agent: Codex. 2026-11-02. Delta ID `s3-coach-r2.demo-tokens-16384.1`.

## Exact change and authority

Pramodh requested four times the proposed 4096 allowance. This delta sets the
effective Meta coach `max_tokens=16384` only when backend `COACH_DEMO_WAIT` is
exactly `1`. With that flag unset or any other value, keep `max_tokens=2048`.
No public per-request token override is introduced. The cap covers reasoning
and visible output together; it does not require consuming the full allowance.

Use the exact grounded system instruction at Muse commit
`25c5102217aff89dc4f33ac8f2198eaaf7b337e4` (CS-61). Its single added paragraph
is the correction approved in CS-C268; all other instruction bytes remain
unchanged. Adopt the grounding correction and demo headroom together. This
document does not add the separate CS-68 communication sentence.

Baseline agreements are [coach r2](cs45-coaching-contract.md), the adopted
[2048 token delta](cs43-meta-token-delta.md), and
[demo waiting](cs60-demo-wait-delta.md). Owner approval of these exact bytes and
Codex's adoption are recorded on CS-62. Historical proposal wording is
superseded by that explicit record; publication alone is not a runtime claim.

## Preserved behavior

- Temperature remains 0.3, `max_retries=0`, nonstreaming Chat Completions.
  Do not send a reasoning parameter under this delta. A separately authorized
  `reasoning_effort=low` experiment is not production adoption.
- Demo has explicit SDK `timeout=None`, no application elapsed-time cutoff,
  paired frontend waiting flag and existing atomic ownership heartbeats.
  Normal mode retains its 8/10/15 second timing behavior and 2048 cap.
- Keep exact whole-JSON parsing, only completed `finish_reason=stop` success,
  current field lengths and typed fallback. No partial hint is published.
- Wire `contract_revision`, cache slots and saved hint identity remain
  `s3-coach-r2`. No migration, new DTO field or invalidation of saved hints.
  Existing fallback rows stay immutable; do not silently regenerate an attempt.
- Public context allowlist, two attempts, replay, branch validation, scoring,
  persona settings, ports 8080/5173 and navigation protection stay unchanged.
- Continue saturated `latency_ms` wire semantics; record actual HTTP/browser
  elapsed time separately. No prompt, response text, secret or private reasoning
  belongs in operational metadata logs.

## Evidence and its limits

Muse's 30-call probe (CS-C283/284, CS-A61/62) returned 30 valid outputs across
2048, 4096 and grounded 4096 arms. These are first-attempt-shaped contexts;
even the 2048 arm passed, so they do not settle second-hint reliability.

Claude's real browser arm C (CS-C298) used local source `575f2e2`, real Meta and
Baseten, disposable DB and both demo flags. It changed only the cap from arm B,
keeping the exact grounding paragraph. Reported results:

| Observation                      | Grounded 4096            | Grounded 16384 |
| -------------------------------- | ------------------------ | -------------- |
| Calls finishing stop             | 39/40                    | 40/40          |
| First saved hints from provider  | 13/13                    | 14/14          |
| Second saved hints from provider | 9/10                     | 10/10          |
| Maximum completion tokens        | 4096, one length failure | 3343           |
| Median completion tokens         | 2326                     | 2222           |
| Median / maximum elapsed         | 11.89 / 28.55s           | 11.53 / 17.78s |

Claude read all 24 arm C provider hints: no invented scenario fact or hidden
needs observed, and all eight evaluated second hints differed from the first.
Several N1 hints still converge on similar help questions. No submitted coach
line was followed through to Maya in this arm. These checks are attributed to
Claude, not independently rerun by Codex.

This small sample supports demo headroom, not a guarantee. No arm C call used
4096 tokens, so it alone cannot establish that 16384 was necessary. Earlier
4096 arms each had one length failure. Counterfactual failures at a lower cap
are inference; generation can follow a different trajectory. Higher headroom
can allow longer, more costly calls even though this sample did not show that.
Remote provider timeouts remain possible despite disabled application cutoffs.

Meta's [model setup documentation](https://dev.meta.ai/docs/coding-agents)
lists a 131072-token output limit for Muse Spark 1.3; the exact configured
endpoint's observed acceptance is established by the live arm, not that general
limit alone. [Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions)
accepts the `max_tokens` alias and can end naturally before the cap.

## Implementation and handoff

Muse owns backend cap selection, focused regression checks, a published runtime
commit and PR. Tests must prove exact-1 demo gets 16384, normal gets 2048,
explicit measurement overrides remain attributable, and request fields, SDK
timeout and strict parsing stay unchanged. Keep provider metadata in safe
structured logs, without database/DTO expansion for this diagnosis.

Claude owns independent output review and browser verification of the exact
delivered source. Codex reviews runtime bytes and adopts the exact agreement.
Do not require another full 40-call exploration solely because measurement
settings become production constants; verify wiring on the actual source and
retain the accepted sample plus its limits. Any later prompt or reasoning
change needs separately attributable evidence.

CS-61/62 delivery records implementation, checks and limitations separately
from CS-47 integration, production-build rehearsal and the user's walkthrough.
This delta does not complete those final gates, merge a PR or promote main.
