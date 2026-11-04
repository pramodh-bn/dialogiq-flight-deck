# CS-81 candidate verification

Codex implementation/review, not independent evaluation. User requested more
useful in-app hints after a separate walkthrough helped Bob explain his view.
Source before prompt edits: `dceaaa9` cases/contract. First candidate `59d8bc2`;
final backend candidate `6bac228`. The frontend component/build is unchanged
between those candidate revisions. This branch stacks on semantic feedback PR48.

## What changed and why

The previous Bob prompt allowed useful moves but still explicitly suggested
reflection/checking interpretations, without clearly distinguishing answered
questions from unresolved issues. In owner review and the authored comparison,
the coach often chose redundant confirmation. The provider also treated brief
interjections as confusion and sometimes joined supported facts into unsupported
counts/chronology. These are observed failure classes; this sample does not prove
a unique causal explanation for every output.

The new prompt prioritizes the latest request/unresolved concern, discourages
recaps and unsupported quantities, preserves speaker/action status, and asks for
a short speakable line. It permits repeating a necessary answer/pause while
seeking useful alternatives elsewhere. UI leads with “Try saying”. New-session
flag/pinning preserves old hints and prompt behavior. No new model, judge rule,
persona prompt, public DTO, context expansion or provider setting was introduced.

## Checks actually run

- Python3.12.10/jiter, Node26.13/npm11.20; task-local dependencies installed.
- 306 backend tests, 114 frontend tests, TypeScript, changed-file ESLint/Ruff and
  production build pass on the first candidate. Two existing TestClient timeout
  deprecation warnings remain. The final refinement changes prompt strings and
  a manual probe only;8prompt-selection/pinning tests, Ruff and realHTTP fixture
  checks were rerun and passed. Frontend bytes did not change after its build.
- RealHTTP fixture on127.0.0.2:8080:4turns,2chained hints, prompt selection,
  saved/replayed turns, fork/reload and unavailable feedback;0paid calls.
  One rerun initially refused my occupied verification port; after stopping my
  idle server, the rerun passed. No request/model call occurred in that refusal.
- 12 exact old/unknown-version coach-prompt comparisons against `b1c8a0d` pass.
  The initial ad hoc comparison used Windows' default decoding and failed on
  non-ASCII text; explicitly decoding Git source as UTF-8 resolved the harness
  error. It was not a product prompt regression.
- Browser host retry via CUA reports unavailable. No substitute browser driver
  was used. Production pages/assets respond200, but DOM/visual/keyboard behavior
  remains an owner review gate. Unit rendering tests are not browser evidence.

## Live batches and limits

All synthetic public evidence is in [evidence/cs81](evidence/cs81/). No private
owner transcript, system prompt, hidden rubric, secret or model reasoning is
retained. Development cases are Codex-authored, not independently authored or
sealed held-out evaluation. Historical U1–U4 were not used or relabeled.

First batch:16coach calls (4previous/12candidate) and4fixture-persona replies,
no provider/parse errors. Same Fireworks model/settings for paired calls;
single samples per context do not establish reliability or latency causality.
The4previous examples had median37.5words/max48; the12candidate examples had
median23/max32, across unequal case mixes. In the4matched contexts, candidate
word counts were28/24/25/32 versus26/29/48/46 previously: three shortened,
one lengthened, and unnecessary confirmation was reduced in the reviewed text.
Candidate coach median14.84s/max41.11s; previous median9.22s/max25.69s.

Do not count all12candidate hints as quality passes. Review caught a derived
rework count, loose burden attribution in a reason, verbose secondary text and
overlapping second hints. Outputs are retained in `comparison.json`.

After a recorded checkpoint (CS-C589), the final refinement ran5coach calls and
1fixture-persona follow-through on the affected cases. No provider/parse errors.
Examples had median20words/max26; coach median10.02s/max29.63s. The count and
attribution examples improved, and labels/reasons shortened. The second
exploratory hint still overlaps the first. This is corrective remeasurement,
not fresh independent validation. See `corrective.json`.

Final evolving journey used the **actual frontend HTTP adapter in Node**, real
API127.0.0.2:8080 and a disposable DB.4persona/4Baseten feedback/4Fireworks coach
attempts admitted by hard SDK caps,0blocked/0retries/0fallbacks, all feedback
ready. First and chained second hints were saved at the first head; three
first-hint examples were sent verbatim to Bob on successive turns. Selected
dialogue and head/attempt identities are retained in `journey-final.json`.
Reload verified four nodes and four hints. This tests client/HTTP behavior, not
browser DOM interaction. First/second hints receive prior suggestions without
pretending they were spoken. The four-turn exercise is not a resolved complete
conversation or a claim of learner acceptance.

Bob developed rework into competing deadlines, uncertainty about priority and
concern about asking for help. The first two hint choices explored workload
impact and a needed priority decision. The next acknowledged his stated worry
and proposed checking priorities together. He continued to request a concrete
decision; the conversation had not yet agreed one. Final score4/7 is incidental,
not the acceptance criterion. First-head second hint offered a different useful
angle (support versus impact), unlike the overlapping exploratory sample above.

Actual journey hint median12.79s/max23.86s; turn median9.15s/max10.83s. External
elapsed time is retained because the legacy hint DTO caps its latency field at
10seconds. Safe provider telemetry records actual seconds, finish=stop and token
usage for all4coach/4grader completions. Direct fixture-persona calls expose
reply/error/elapsed but not completion/token metadata through their existing
adapter; missing usage is not zero billing.

Total this task so far: **25coach +9persona +4grader admitted attempts**. All
completed, no SDK retries. No universal reliability or provider speed claim.
Broad user credit authorization applied; each batch/checkpoint was finite.

## Reproduction and owner gate

`scripts/evaluate_next_move_coach.py --env-file <server-only-env> --out <new-json>
--live` runs the16coach/4persona maximum. The corrective subset uses
`--candidate-only --case-ids answered-cause,stakeholder-ownership,chronology-injection,short-ack`.
Omitting `--live` spends nothing. Each report path must be new.

`scripts/verify_semantic_feedback_http.py` starts/stops a disposable fixture
server itself and refuses an occupied127.0.0.2:8080. It makes no paid calls.

For the live client journey, run `scripts/run_bounded_verification_backend.py`
with FEEDBACK_ENABLED=1, FEEDBACK_PROVIDER=baseten, COACH_PROVIDER=fireworks,
COACH_DEMO_WAIT=1, COACH_NEXT_MOVE_ENABLED=1; all three VERIFY_MAX_*_CALLS=4,
new budget/telemetry paths, a disposable DB and --host127.0.0.2 --port8080.
Then run `node scripts/capture_coach_journey.mjs http://127.0.0.2:8080 <new-json>`.
Server-only keys stay in the ignored env file; stop the verifier after the run.

Canonical app now uses this candidate on127.0.0.1:5173/API8080, with its original
recording DB backed up before restart. Six owner sessions are preserved without
rescoring or prompt migration. The .2 verification processes were stopped.
Backend runs without verification quotas for normal owner use.

Owner next: refresh the app and choose **New Session** on Bob's card; try only
the in-app hints. Judge usability, grounding and useful next moves. Existing
semantic-feedback sessions keep their old coach prompt too. Historical hints
remain unchanged. See [demo rehearsal](coach-demo-walkthrough.md).

Remaining: owner GUI/learner verdict, overlapping second-hint quality and
variable provider latency. Integration separate; no merge or final acceptance
claimed. PR48 semantic feedback and PR46 production launcher remain integration
dependencies; the preview is manually served from the verified production build.
