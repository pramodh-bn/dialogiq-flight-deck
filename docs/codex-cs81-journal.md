# Codex CS-81 journal

## Current handoff — 2026-11-03, evening (America/New_York)

User authorized the six-step coaching plan and asked for a demo tomorrow morning.
They specifically requested journal updates. Task CS-81 was reframed from a
deferred investigation to this implementation with explicit user authorization;
no peer approval or independent evaluation is claimed. Claim CS-C588.

Branch `codex/coach-next-move`, worktree `.worktrees/coach-next-move`, base
`b1c8a0d`, stacked on semantic feedback PR48. Canonical running app remains the
previous candidate until this change is verified. No recurring Megillah watch.

Diagnosis: current hints over-confirm answered facts, assume that short learner
responses mean learner error, and bury useful moves in long recaps. A prior
second hint also converted co-occurring facts into unsupported chronology.
These are observed failure classes, not measured prevalence or proven prompt
causality. Owner conversations were inspected locally; private transcripts will
not be committed or posted to Megillah.

Preflight: source task Python3.12.10 with jiter, Node26.13.0 resolved explicitly.
Task-local Python environment and npm dependencies are being installed. Backend
and frontend ports remain8080/5173. Verification uses a disposable SQLite file;
recording database and saved hints stay intact.

Planned scope: versioned Bob prompt pinned at new-session creation behind
`COACH_NEXT_MOVE_ENABLED=1`; public API, providers, context limits, normal/demo
timeouts and fallback remain unchanged. UI presents the example before detail.
Old sessions retain previous prompt selection; no migration or rescoring.

Verification plan: author development cases before prompt edits and reserve
separate evaluation cases. These are Codex-authored, not independent unseen
review. At most16 coach calls and4 persona follow-through calls in the first
batch, then checkpoint before at most4 coach/4 persona/4 grader HTTP journey
calls. Stop after two provider failures. Record actual counts/latency/errors,
not estimated billing. Existing broad user credit authorization applies.

Remaining: implement, unit/HTTP checks, live comparison and full follow-through,
production client build, owner fresh-session review, draft PR. Integration is a
separate gate. No agent delegation or automatic merge authorized.

## Milestone — implementation and focused checks

Pre-prompt contract/cases committed as `dceaaa9`. Task-local Python3.12.10/jiter,
npm11.20 and Node26.13 verified; pinned requirements and npm ci completed.
Candidate pins `bob-next-move-r1` on new opted-in Bob sessions only. UI leads
with “Try saying”. Existing context/provider/request contracts are unchanged.

Actual checks:38coach service tests pass (two existing TestClient deprecation
warnings),56frontend coaching tests pass, TypeScript and changed-file ESLint
pass. Ruff changed files and diff whitespace checks pass. These are unit/mocked
checks; they do not yet prove live coaching usefulness or browser behavior.
The next run is the previously recorded16coach/4persona bounded comparison.
