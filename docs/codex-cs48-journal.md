# Codex CS-48 consistency review journal

## Current handoff — 2026-11-01

User explicitly requested codebase consistency audit and Megillah issues with
appropriate owners. CS48 active, claim CS-C225. Isolated worktree
`.worktrees/consistency-review`, branch codex/consistency-review, base fetched
origin/dev939af9f. Published frontend e5792f2/backend6ea76a2 reviewed separately;
not represented as integrated. No application fixes or other worktree edits.

Read current AGENTS/retro and full task/track records. CS-T7 cleanup track
already exists; no duplicate open audit found. Owners: Codex repository/backend
integration, Muse persona/provider content, Claude UI/client. Confirmed distinct
defects get separate issues, unfinished CS43/46 scope remains there. Monitoring
CS43/46 continues roughly2min during this review.

## Preflight and evidence scope

Node26.13/npm11.20 verified; Python3.12.10 explicitly located with approved
launcher. New own backend/.venv installed pinned requirements; pip check passes.
Initial one-line jiter confirmation hit PowerShell argument quoting SyntaxError,
not an import failure; the durable reproduction script imports it explicitly.
No .env copied/read, no paid calls, no shared server or database touched.
Reproductions use disposable SQLite and in-process FastAPI TestClient/SDK doubles;
these are not real8080/5173 browser or live-provider evidence.

## Areas under verification

- Lost-success response retry: frontend retains UUID but rebuilds body from
  refreshed head/revision; verify conflict then duplicate after key reset.
- Pinned persona: backend uses immutable session config while Arena/Recorder
  read current catalog; verify public name/opening diverge after catalog update.
- Malformed provider200 choices=[]: check typed502/retry contract versus current
  unexpected500, preserving atomicity and private error sanitization.
- Recorder scenario-query failure handling and mock/live mode labelling.
- README launch instructions/current spec status versus actual8080/5173 HTTP
  adapter configuration. Historical verifier files are historical, not defects.

No findings are delivered from these suspicions alone; run targeted probes and
record exact evidence before issue framing. No scoring redesign or integration.

## Reproductions and assigned issues

Python probe completed with jiter import, Python3.12.10, disposable SQLite,
in-process HTTP/SDK doubles and zero paid calls. Confirmed lost-response
rebuilt-body409 followed by duplicate new-key turn; catalog/public persona
versus pinned generation mismatch; empty choices -> safe but incorrect500,
nonretryable, with revision unchanged. New issues CS55(Claude/P1), CS56(Codex
lead with Claude/P2), CS57(Muse/P2), exact evidence and acceptance recorded.

Recorder probe transpiles actual source with query/JSX doubles and confirms
scenario.error returns Loading while session-error control returns failure.
CS58 assigned Claude/P2. This is not a browser lifecycle reproduction.

Checked existing CS49–54 and avoided duplicate tasks: UI mock-labelled-Live
evidence added CS50 as CS-C228; README/spec covered by CS52; coach normalization
is existing CS54, not my persona-path probe. Do not claim other session's
reported coach checks as personal executions. Current records checked again
immediately before issue framing. Owner handoffs posted on CS43/46.

Baseline backend pytest actually run:71 passed in6.32s, keys cleared, no network
model calls. In-process TestClient is not real8080/5173 evidence. Report in
cs48-consistency-review.md; repro scripts are durable outputs. Next: format,
publish report/probes, attach findings/checks and deliver this audit separately
from issue fixes. CS43/46 monitoring remains active; no readiness assumed.
