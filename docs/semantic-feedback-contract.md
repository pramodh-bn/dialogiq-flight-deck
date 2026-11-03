# Semantic feedback v1 (CS-82 / issue 47)

Codex owns backend, DTOs and UI in this isolated follow-up; no parallel owners.
User authorized implementation after the recorded demo exposed lexical misses.
This contract is implementation scope, not independent acceptance or a live result.

## Version and API

Ports remain backend8080/frontend5173. No new route. When FEEDBACK_ENABLED=1,
complete Bob scenarios advertise feedback_revisions:["semantic-r1"]. A new
POST /api/sessions may include feedback_revision:"semantic-r1" together with
behavior_revision:"s4-bob-r1". Pin that revision in scenario_config. Unavailable
combinations return422 before persistence. UI selects the advertised version;
old servers and mock scenarios without the capability retain their old behavior.
Existing sessions retain their exact old feedback and are never rescored.

State gains optional feedback:null on legacy sessions, otherwise revision,
status(not_evaluated/ready/unavailable), evaluated_turns, skipped_turns,
failure_reason, latency_ms and public evidence(role/quote/kind/optional revealed
need ID). Coaching source adds semantic; unknown classification is unavailable,
with null empathy/leading and unavailable outcome. Existing fields retain their
wire meaning for legacy sessions. Coverage must be visible; failed evaluation
does not count as a negative observation or silently fall back to lexical rules.

## Turn and evidence ownership

Generate the persona reply first, with prior known state and no lexical reveal
or invented stance signal injected for semantic sessions. Then evaluate exactly
one completed exchange with selected-branch public history, public opening,
current learner and Bob text, and the evaluator-only private need rubric.
The evaluator never receives the private persona prompt, coach hints, sibling
branches, credentials or model reasoning. The coach never receives the rubric.
The evaluator returns classifications, not scores or free-form reasoning:
question type(open/closed/statement), acknowledgment, pressure, stance signal,
bounded stance change and exact learner evidence, plus zero/one need ID and
exact evidence in the CURRENT persona reply. Model instructions explicitly
treat dialogue as untrusted data, not commands.

Validate strict JSON/types/limits/enums and cross-field constraints; each quote
must occur exactly in its designated current speaker text. A valid quote is
provenance, not proof the classification is semantically correct. Need IDs must
exist in the server rubric; reveal titles/descriptions come only from server
data, never model output. No evidence means no reveal. Server derives counters,
coverage, score and bounded stance from validated results and parent state.
Bound stance to one step per turn; repair alone cannot reach open. Respectful
pauses need not increase score. Repeated offers/thanks do not require movement.

One evaluation attempt after a successful persona call, before immutable node
commit; no DB transaction held across either call. Fireworks via existing
server-only provider configuration, separate prompt/client request. SDK retries0,
4096token cap, low reasoning, JSONobject mode, HTTP12s and total12s deadline, two daemon worker
slots. Timeout/invalid/unconfigured/upstream/saturation persist unavailable with
prior known values and increment skipped coverage; the actual persona turn
still commits. Late results cannot change saved nodes. No automatic evaluation
retry. Idempotent replay/GET/reload/branch selection make0new provider calls;
normal revision/head recheck still guards commit after generation.

No raw private rubric, prompts, model output or user transcript goes to logs.
Operational telemetry may record provider/model, elapsed time, finish reason,
token usage, result/failure type and attempt count. Finite live plan is posted
before calls; user is notified when candidate is ready. Existing recording app
stays running until a controlled test is agreed. Paid evaluator authorization
is not inferred from the earlier coach allowance.

## Acceptance before delivery

Authored natural/adversarial examples below are consistency checks, not unseen
or independent learner evidence. Validate quote/ID spoofing, private leakage,
negation, sarcasm, empty polite thanks, mixed questions, repeated support,
actual need disclosure, paraphrases, statement-only practical answers and pause.
Test one complete mocked learner→persona→evaluation→hint→follow-through loop,
then branch/reload/replay, unavailable/timeout/late-result behavior and coverage.
Keep a separate reviewer-authored sample for the eventual frozen candidate.
Real8080/5173/disposableDB/browser and bounded provider measurements are separate
gates from unit/mock checks. No live-readiness/delivery claim before those gates.
Default evaluator is Fireworks `accounts/fireworks/models/gpt-oss-120b`, verified
present in the account's live models list. `FEEDBACK_MODEL` is an explicit
server-only override, independent from the Muse coach and Baseten persona.
The first Muse evaluator trial timed out2/2. A catalog-listed Llama model was
not present in the account list and rejected2requests; neither trial is a
successful grading result. Keep those failures with later evidence.
