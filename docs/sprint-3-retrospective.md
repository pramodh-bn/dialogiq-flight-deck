# Sprint 3 retrospective

Recorded November 2, 2026 under Megillah CS-59. Codex synthesis of each
agent's own response: Codex CS-C334/335/388, Muse CS-C356/389 (including
CS-C357 corrections), and Claude CS-C314/390. These remain attributed records;
this synthesis does not invent another agent's approval.

## Closure and delivered outcome

The user explicitly directed consolidation, shared-guidance updates and Sprint 3
closure. Closeout accepts the integrated implementation with documented limits;
it does not assert a successful final Bob learner verdict or sealed held-out
evaluation. Claude's latest response remained conditional on that verdict;
Muse explicitly recorded unresolved acceptance. No additional verdict is invented.

Coaching, UI, demo waiting, grounding and provider settings reached dev through
PR18 (8ddcd9a). The versioned dash-question parser correction reached dev through
PR19 (d10a20f0bfd6c928facb03ccf5235aa7d904f2a9), preserving history. Main was not
promoted. Production readiness, voice and multilingual work are outside this
closeout. The user's later demo startup used fresh 2.2 data; old catalogs and
pinned sessions retain old behavior. A new commit alone does not migrate data.

Historical evidence, not rerun for these documentation changes:
- Codex: 123 backend tests and production-built browser 34/34 on ca27c69;
  parser candidate 52f9859: 157 backend, 59 focused, production browser 43/43
  and separate Bob visual 10/10. Full tree identity to PR19 merge was recorded.
- Claude: final coaching sample 55/55 completed, no fallback, median 6.2s,
  maximum 16.41s. An earlier run stopped on a persona 504; retain that failure.
  These finite samples are not universal reliability or learner-benefit claims.
- Evidence: CS47 attachments A74/A75; CS71 A76/A77/A78; CS68 A72/A73.
  Frontend 92-test evidence applies to unchanged 316080a bytes, not a new run
  on the final merge.

## Findings shared across the agents

1. Test the complete conversational loop early. Claude evaluated hint wording
   before sending it back to the persona. First-hint probes missed second-hint
   behavior. Maya-only tuning missed Bob's requests for answers, priorities and
   reassurance. Evaluate a useful next move, not a mandatory question shape.
2. Runtime validity and learner benefit are separate. The user found Maya
   believable but stalled; later Maya looked okay so far. Bob stayed at 1/7 and
   the user preferred accompanying chat coaching. The dash parser misclassified
   natural questions. Higher reveal counts and Guarded/Warming labels do not
   measure trust, empathy or learning.
3. Evidence must include the actual public dialogue. Claude's reports omitted
   persona replies, leaving a 'yesterday' detail unverified. A hint's explanation
   is not evidence of its grounding. Some final probes remained on unpushed local
   branches despite the reproducibility goal.
4. Diagnose provider failures separately. A call ending at 2048 tokens with
   2046 reasoning tokens before the 8s deadline demonstrates token exhaustion,
   not timeout. Muse explicitly retracted conflating those mechanisms.
   Completion caps, reasoning settings, wall-clock deadlines and output validation
   need separate telemetry and hypotheses.
5. Exact contracts and isolated worktrees worked. Provider changes preserved the
   public schema and avoided UI churn. Preserve explicit adoption and affected
   owners, but do not turn already-authorized execution into repeated permission
   loops. The PR19 review waiver was user-directed, not inferred peer consent.
6. Coordination was a material bottleneck. Codex acknowledged status-only turns
   and unsupported monitoring expectations; Muse acknowledged stalled execution
   after approval; Claude acknowledged ending a watch with review requests unseen
   and posting a port release away from the waiting task. A task marked active or
   a posted message does not show that a CLI is running or its owner has read it.

## Limits and differences to retain

- Muse regarded contract reviews as helpful with little approval latency; Claude
  and Codex also observed serial acknowledgment delays. These are different
  observations, not grounds to remove interface agreement or blame every delay
  on approval.
- Grounding instructions did not establish a causal improvement: controls also
  lacked the rare original invention. Missing transcripts weaken later judgments.
- Explicit stop handling improved in samples; implicit disengagement, repetitive
  openings, direct requests and authorized commitments still need evaluation.
- Existing coach context is limited; missing earlier context is not supplied by
  a proven summary. Do not silently widen it or expose private scenario data.
- Fixed hostile cases are not untouched held-out cases. No exhaustive privacy,
  prompt-injection, accessibility or real-user efficacy claim is supported.
- Demo mode intentionally has no application cutoff. Upstream failure or indefinite
  waiting remains possible. Normal mode remains separately bounded.
- Paid experiment estimates drifted (Claude reported 119 candidate and 107 final
  calls). Plan counts, rerun policy and checkpoints before testing; report actual
  usage, distinguish estimates from explicit authorization limits.
- Keyword-based scoring remains limited after the dash fix. Do not adapt the
  coach to secret scoring terms or treat question form as a proxy for usefulness.

## Three prioritized improvements

| Priority | Action and owner | Completion evidence / existing work |
| --- | --- | --- |
| 1 | Evaluate adaptive next moves: Muse implements, Claude independently reviews, Codex adopts/integrates. | CS-73: paired current/candidate tests on Bob and Maya, chained second hints, direct requests, explicit/implicit refusal, conditional commitments and unseen cases. Judge usefulness separately from scores. |
| 2 | Make evidence reviewable and portable: Claude. | CS-70: public selected-branch transcripts tied to hint/source/attempt identity, exact runtime metadata, saved probe scripts and public dialogue tracing; operational logs contain no secrets or model reasoning. |
| 3 | Make handoffs actionable and scope bounded: Codex coordinates; every owner acknowledges or declines. | Each milestone names source, result, next owner and concrete blocker. Before ending a watch list unanswered requests and availability; claim unattended monitoring only with a running mechanism. Split measurement/review from implementation where feasible without automatically adding agents. |

Other existing Sprint4 work remains assigned: CS-55 duplicate-turn recovery
(Claude), CS-57 persona errors (Muse), CS-58 recorder errors (Claude), CS-72 false
empathy feedback (Codex), and CS-49 through CS-53 cleanup. No duplicate tasks or
new runtime changes are authorized by this document.

## Applying the lessons

[AGENTS.md](../AGENTS.md) carries the concise operating rules. Read this document
alongside [Sprint 2](sprint-2-retrospective.md) when claiming relevant work.
Documentation-only validation is link, formatting and diff review, not paid model
calls or another full application test run. Sprint closure does not close the
remaining Sprint4 issues, establish production readiness, or claim that agents
have read the updated guidance before they acknowledge it.
