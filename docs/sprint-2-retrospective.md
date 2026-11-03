# Sprint 2 retrospective

Recorded October 31, 2026, under Megillah CS-44. This is an attributed synthesis,
not a replacement for the three agents' full responses or their confirmations.
Working rules are in [AGENTS.md](../AGENTS.md); task-specific acceptance criteria
remain in Megillah and the [API contract](api_contract.md).

## Outcome and evidence

CS-40 delivered the integrated Sprint 2 practice loop into dev. PRs 3 through 6
integrated the implementation; documentation PR 7 produced dev revision
508c88c1ca224de0779789144d9aae7a942dec6f. Main was not promoted.

Codex recorded 71 backend tests, 36 frontend tests, 23 contract cases covering
97 turns, and separate fixture and live Baseten demos: closed questions 0/7,
good questions 7/7, with rewind, alternate branches, original preservation,
replay and reload. Claude recorded 47/47 combined browser checks with zero
console errors. These are attributed historical results, not checks rerun for
this documentation change. Scoring-aware demo questions do not prove learning.

Sources: CS-40 closeout CS-C176 and evidence CS-A29 through CS-A33; Muse response
CS-C168, Claude response CS-C174, Codex response CS-C175, synthesis CS-C177 and
attachments CS-A34/CS-A35 on CS-44. Earlier unmerged-dev and single-live-turn
premises were superseded by the final integration outcome.

## What the agents learned

| Finding                                                    | Evidence and attribution                                                                                                                                                              | Practice to carry forward                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Author fixtures can conceal poor conversation behavior.    | Claude's independent natural transcripts scored 0/7 under Codex's first proposed rules while the scripted proofs passed. Reviews produced r2 and r2.1.                                | Review natural and hostile transcripts independently of scoring cues; hold some cases out of tuning.                                         |
| Working infrastructure does not establish useful coaching. | Claude observed repeated fixed whispers. The user found Maya believable but became stuck without useful help.                                                                         | Evaluate whether a hint helps the learner choose a next move, separately from whether a score rises.                                         |
| Explicit interfaces and isolated ownership worked.         | Muse's review clarified candidate reveals, errors and history ownership. Combined integration required no runtime repair patch.                                                       | Trace the complete interaction through agreed DTOs and name context/file owners before parallel work.                                        |
| Provider mocks have limits.                                | Muse verified request/error mapping; live wiring and browser behavior were established separately by Codex and Claude. Real outages and output quality distributions remain unproven. | Label evidence accurately, measure latency, validate structured output and exercise fallback.                                                |
| Setup and browser verification were not portable enough.   | Python 3.15/jiter caused setup churn. Claude's browser harness was outside the repository.                                                                                            | Preflight Python 3.12, jiter and Node paths; preserve a repeatable browser procedure with disposable data and known source/provider mode.    |
| Readiness comments do not notify agents.                   | Codex and Claude reported stale journals and reliance on the user to relay requests.                                                                                                  | Refresh current state at milestones and acknowledge dependencies; never report another agent as working merely because a request was posted. |

Codex acknowledged overfitting the first judge, unresolved initial API seams,
integration concentration and stale status. Claude acknowledged delayed journals,
an omitted delivery PR and a missed direct coordination response. Muse reported
clean component integration but late environment checks and an unpushed handoff
that depended on the shared machine.

## Limits and disagreements to preserve

- The generic lexical judge can be gamed or miss useful natural phrasing. A first
  open question labelled breakthrough may overstate conversational progress.
- Prompt instructions and prompt-presence tests do not guarantee secrecy. Coach
  input privacy must be enforced structurally; adversarial output leakage remains
  a separate evaluation question.
- Browser failure screens used injected responses; a real stale-state 409 was
  tested separately. Production-build browser serving, accessibility, latency
  distributions and broader learner evaluation were not established by CS-40.
- Existing repository lint errors and dependency findings remain documented
  limitations, not passing checks.
- Codex described a readiness bottleneck; Claude measured about 45 minutes from
  mock UI completion to backend readiness. This supports a coordination risk,
  not a claim of a multi-day backend delay. Muse reported no component rework.
- Claude and Muse's responses were provisional. Their own final reconciliations
  remain theirs to provide; this document does not assert their approval.

## Sprint 3 application: contextual coaching

The user prioritized assistance when stalled with Maya. CS-43 now specifies
Muse Spark through the direct Meta API for coaching, with Baseten continuing to
generate persona replies. Verify the configured endpoint/model before coding.
The deterministic judge stays unchanged and deterministic hints remain fallback.

Before implementation, agree the schema, branch-public context, stalled-turn
trigger, on-demand interaction, timeout/latency budget and retry/fallback behavior
in the API contract. Muse owns coaching, Claude required UI changes, and Codex
privacy/API review and integration; coordinate exact file ownership first.

Success means a concrete next approach, a natural example and a short reason,
without revealing hidden needs or teaching scoring keywords. Start with Maya:
use the user's session if available, otherwise label a new reproduction honestly.
Use independent natural and hostile conversations, include held-out cases,
measure response time, and verify rewind context and safe fallback in the real UI.

Analytics/history aggregation and personalized training recommendations remain
nice-to-haves outside the committed coaching scope. This document does not
authorize scoring redesign, main promotion or additional feature tasks.

## Follow-up proposals and closure

The retrospective proposed an exact-candidate production rehearsal (Codex with
Claude and the user), a portable browser gate (Claude with Codex integration),
and independent semantic review (Codex with Claude/Muse). Task acceptance should
name an owner and measurable evidence for any adopted follow-up. The coaching
task incorporates relevant verification requirements; a broader rehearsal or new
tooling project still needs explicit scope rather than silent expansion.

CS-44 remains the place for the agents' final reconciliations and retrospective
closure. Merging these instructions does not close that shared task.
