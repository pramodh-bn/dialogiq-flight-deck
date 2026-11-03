# Bob conversation behavior contract — review proposal

Owner: Codex. Task: CS-75. Base: dev `97c96cb`.

Proposal `s4-bob-r1`. CS-74 is delivered; this proposal adopts its predeclared
evaluation targets before any candidate exists. Claude/Muse interface review
is pending. This document does not claim runtime implementation or adoption.

## Exact proposed interfaces and behavior

This section supersedes open questions in the preparation inventory below.

**Version selection.** Add optional `behavior_revision` to SessionCreateRequest:
absent/null preserves catalog behavior; literal `s4-bob-r1` selects new Bob
only. Reject unsupported versions and non-Bob opt-in with typed422 validation.
Use stable Bob scenario identity, not display-name matching. UI explicitly opts
in for a new Bob session; never migrate old sessions or overwrite catalogs.
Snapshot behavior/public persona/private persona settings/needs/scoring at
creation. New Bob judge revision `s2-r2.3-bob` inherits2.2 reveals and parsing,
adding CS72 feedback and independent stance only. All old revisions and other
personas retain behavior; seven needs and their authorization remain fixed.

**Public schemas.** State-derived session/node/branch DTOs gain nullable
`conversation_progress` (default null for legacy). New Bob has exactly:

```json
{
  "behavior_revision": "s4-bob-r1",
  "stance": "warming",
  "last_signal": "clarity",
  "explanation": "Your wording offered a concrete clarification."
}
```

stance is guarded/warming/open and must equal existing `resistance`. New Bob
derives both from stance evidence, not reveal count. Legacy resistance remains
score-based. last_signal enum: initial/clarity/support/acknowledgment/repair/
pressure/boundary/none. explanation is fixed public text <=240characters, never
private scenario data. SessionResponse also gains `persona` using existing
public Persona schema from its pinned snapshot, for all versions (CS56).
No new routes/ports. Internal ledger lives in stored JSON state; no relational
migration required. Explicit API fixtures cover null legacy and new fields.

**Small deterministic mechanism (CS76).** Internal balance starts0, bounded
-2..2; <=0 guarded,1 warming,2 open. Max one increment/decrement per turn.
Save balance and last positive category in each node state, not public DTOs.
Only public learner text and that branch's ledger may determine signals;
never needs/stems, score/reveal events or an additional LLM call.

| Precedence | Signal | Evidence boundary | Transition |
| --- | --- | --- | --- |
| 1 | pressure | Whole-turn blame/comparison, demand to disclose or dismissive pressure overrides incidental supportive wording | -1; clear prior positive category |
| 2 | repair | Explicit withdrawal of a prior comparison or ownership of a specific learner action; quoted/withdrawn blame is not fresh pressure | +1, capped at warming on repair turn |
| 3 | boundary | Accept stop/defer without another present-topic probe | no change |
| 4 | clarity | Offer a concrete action to settle priority, write/check path/pass criteria, or separate commitment from what must be checked | +1 unless same as prior positive category |
| 5 | support | Offer a bounded action within speaker control, e.g. help arrange setup or communicate a tradeoff | same +1 rule |
| 6 | acknowledgment | Reflect a specific expressed concern/difficulty/value rather than generic agreement | same +1 rule |
| 7 | none | Question alone, ambiguous/negated support, generic praise or unsupported inference | no change |

Choose first applicable positive category and count once. Repeated positive
category does not increase stance; neutral/boundary does not reset it. A
different positive category permits another increase; pressure clears it.
Repair cannot jump guarded to open. Neither stance nor positive wording proves
a promise was honored or authorizes new private disclosures. Publish finite
normalized match expressions and negation/quoted-blame handling with independent
contrast fixtures before CS76 runtime review. Isolated help/hard/sorry words
must not count; this remains a limited lexical heuristic, not semantic truth.
Category/transition changes need a delta; expression refinements need reviewer
contrast tests, not repeated user permission.

Public explanations describe wording only: initial "This is Bob's simulated
starting stance, not a measure of trust."; clarity "Your wording offered a
concrete clarification."; support "Your wording offered practical support.";
acknowledgment "Your wording acknowledged a specific concern."; repair "Your
wording took responsibility or withdrew a comparison."; pressure "Your wording
included pressure or blame."; boundary "Your wording respected a request for
space."; none "No clear stance signal was recognized in this wording."
UI shows current stance separately; do not claim an increase for repeat signals.
CS72 suppresses positive empathy praise for blame/pressure on new Bob while
retaining genuine acknowledgment controls. Do not change historical metrics
or label every closed question as pressure.

**Coach.** Preserve approach1–240/example1–320/reason1–360 JSON and parser,
Hint contract_revision `s3-coach-r2`, response DTO/cache rules and privacy.
Select prompt variant from pinned behavior, never score. Replace mandatory
what/how with one useful next move: answer direct requests first; offer grounded
clarification/action, reflection, repair, purposeful question or respectful
pause. At most one question, no required question. Preserve exploration.
Respect conditions and explicit/implicit refusal. Never invent priorities,
product details, authority or guarantees; offer to decide/check/write criteria
when unknown. Second hint varies useful move unless a boundary precludes it.
Keep existing grounding and untrusted-transcript instructions.

No context expansion: latest6 branch exchanges, existing public persona/context
limits, latest2 eligible hints; older turns omitted, not summarized. No stance,
ledger, needs, scores or private prompt fields reach coach in this revision.
Preserve build_coach_context and parse_coach_output APIs. Add optional keyword
`behavior_revision: str | None = None` to build_coach_system_prompt; omitted
preserves baseline. Claude coordinates an explicit variant flag in
evaluate_bob.py so baseline/candidate see identical turns and prior hints.

**Persona.** Existing private brief/reveal authorization and candidate resistance
remain; add optional behavior_revision keyword from pinned config. Muse CS79
implements Bob-only instruction/config variant after CS57 and CS76. Practical
answers/support/repair can elicit fuller replies, even without a scored reveal;
the old open-question-only prompt must not override this variant. Unresolved
conditions/disagreement persist; never force agreement or new unauthorized
need disclosures. Other personas/legacy Bob use original prompt.

**Persistence/recovery.** Compute candidate stance before persona call; commit
node/state only after successful reply plus head/revision revalidation. Provider
failure persists no partial progress. Exact UUID/body replay returns saved
result, no new call; existing409 semantics remain (CS55 client body fix).
Fork/rewind uses chosen ancestor's ledger; root uses pinned initial state.
Reload/select never recompute under current defaults. Saved hints keep content
and identity. Preserve leases/heartbeat, attempts1/2, stale-result rules,
fallback types and retry behavior. No automatic paid retry/concurrency increase.

**Timing.** Existing normal8s provider/10s app,2048tokens; exact paired demo
flags16384/LOW and no app cutoff; persona30s. Preserve normal/demo behavior.
DTO latency cap10000ms stays for compatibility, but evaluation measures actual
elapsed time. Upstream failures/indefinite demo waiting remain limitations.

## Adopted evaluation targets and finite plan

Source: CS74 PR22/b98ea09 docs/sprint4/bob-review-cases.md; baseline253cb67
runtime matches dev97c96cb. One reviewer graded gap-focused authored cases:
21/78 useful, direct0/24, not general quality rates. Do not read U1–U4 preimages.
Adopt without weakening: overall>=52/78; direct B01/02/03/13>=16/24;
ownership/repair B04/09>=8/12; implicit refusal B08>=4/6; statement-fit
B05/12>=6/12; exploration B06>=4/6; second hints naming "the update"<=8/39
with relevance reviewed, not mechanical removal. Unseen>=14/24.

Hard gates: no private/instruction disclosure, injection compliance, unsupported
facts or unauthorized promises; explicit refusal B07 stays6/6. Review full text.
Provider failure only may be retried within budget; keep original failure and
fallback counts, never discard an unfavorable quality result.

Final paired evaluation:78+78 shared,24+24 unseen,3 journeys per side in same
session; about240Meta/26Baseten, hard stop270Meta and28Baseten. Stop even if
unfinished; any more calls need a new finite plan first. This is not unlimited
authorization. Muse must separately predeclare a finite shared-only tuning
budget; no unseen tuning and no charging tuning to final evaluation.

Actual wait targets: first median<=10s; second<=15s; max<=25s; journey stalled
median<=20s. These are evaluation targets, not a demo cutoff. Baseline fixed
medians8.7s/12.9s,max21.2s; journey stalled median17.0s/max30.8s. Any threshold
revision needs reasons before final results; never move the bar after failure.
Claude grades shuffled source-blinded hints; Codex regrades20percent. More
than1/5 disagreement requires rubric reconciliation before claiming results.
Journeys need substantive follow-through and no repeated question loop, support
without score gain, pressure/repair/refusal, branch/reload/replay controls and
old/other-persona regressions. No7/7 or forced-agreement target. CS78 remains
the integrated production8080/5173 and user acceptance gate.

## Adoption record

Claude/Muse: review these exact DTO/version/prompt/persona/evaluator boundaries
and either acknowledge or name concrete changes. Codex records adoption after
actual review or user waiver, never silence. Contract checks require no model
calls. Downstream coding begins after delivery; unrelated PR21–25 review does
not depend on this contract. No live demo migration/restart or main promotion.

## Intended outcome

Bob can respond to useful conversational moves beyond scored questions. The
learner receives a truthful explanation of simulated conversational progress,
separate from the fixed seven-need reveal count. The coach can suggest an answer,
reflection, clarification, feasible action, question or respectful pause.

Clarity about priorities, an explicit bounded commitment and a response to a
request for support are candidate observable signals. Their exact definitions
must come from independent cases, not matching the user's example wording.
Agreement is not required, and continued disagreement must remain possible.
No field should claim measured psychological trust or empathy.

## Boundaries to preserve

- New behavior applies only to explicitly versioned new Bob configurations.
  Existing sessions, saved hints and historical states remain pinned. Other
  personas retain their existing rules. Deploying code does not migrate data.
- Seven needs remain fixed. The coach receives public dialogue and approved
  public context, never need identifiers, scoring stems, private persona
  instructions, private traits or classifier internals.
- Supportive statements may affect simulated guardedness without revealing a
  need. Blame must not be praised as support. The mechanism remains bounded,
  inspectable and honestly limited rather than described as sentiment truth.
- Direct requests should be addressed before further probing. A question is
  optional. Suggested promises require authority and ability to honor them;
  inferred motives must remain uncertain. Explicit and implicit disengagement
  must be respected.
- Branch state derives from its own ancestors. Rewind/fork restores that
  branch's pinned state; sibling turns must not affect hints or transitions.

## Interface inventory and decisions still required

| Area | Existing boundary | Decision before adoption |
| --- | --- | --- |
| Progress | Reveal count and simulated resistance currently coupled | Public guardedness states, initial state, bounded signals, transition/recovery rules and honest explanations |
| Judge feedback | Public question/empathy/leading feedback | Bob-only versioned supportive-versus-blaming rules from CS-74 contrasts; preserve old results |
| Session snapshot | Scenario configuration pinned at creation | New Bob version opt-in and public pinned-persona projection for CS-56 |
| Coach input | Latest six branch exchanges and up to two earlier hints | Whether approved public state/context is needed; no automatic context expansion |
| Coach output | `approach`, `example`, `reason` JSON | Adaptive move wording within current lengths, or justified versioned length delta |
| Persistence | Saved branch state, hints and request identities | Exact fields/migration need, atomicity and replay compatibility if fields change |
| Timing/errors | Separate normal and demo modes | Preserve adopted settings unless baseline evidence justifies an explicit delta |
| UI | Need count, simulated resistance and coach cards | Explain distinct outcomes without numeric trust claims or exposing private scoring cues |

## Ownership and edit sequence

Codex owns judge, practice service, models, migrations, schemas and API contract.
Muse owns persona generation, persona fixtures and coach files. Claude owns
frontend and browser/evaluation harnesses.

Sequence: CS-70 evidence capture; CS-74 independent cases and baseline; CS-75
adopted contract; CS-72 narrow feedback correction before CS-76 judge changes.
Coordinate CS-56 snapshot/API edits with that sequence. Muse's CS-57 persona
error correction must remain separately owned and compatible with later persona
work. No concurrent uncoordinated edits to shared files.

## Evidence required before implementation approval

1. Reference delivered CS-74 shared cases, held-out identifiers and baseline.
   Implementation owners must not inspect private held-out contents.
2. Specify exact versioned fields and transition examples, normal/demo error,
   timeout/fallback and idempotency behavior, plus historical compatibility.
3. Predeclare qualitative acceptance and baseline-derived latency targets, finite
   paid-call plan, rerun checkpoints and stop policy. No calls authorized here.
4. Obtain actual Claude/Muse review of affected interfaces or an explicit user
   waiver. Posting a request or elapsed time is not approval.
5. Check schema/examples, links and diff for the contract. Runtime tasks later
   verify production-built frontend 5173 with backend 8080 on disposable data,
   keeping unit/mock, HTTP, injected and live-provider evidence distinct.

The running user demo must remain untouched during this preparation.
