<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# Shared rules for Codex, Claude, Muse, and other coding agents

Read this file before working in this repository. These rules apply to all
agents, regardless of the tool used. Explicit user instructions take precedence.

## Core Operating Principles (Sprint 2 Retrospective Mandate)

- **Empirical Verification Over Claims:** "Tests pass" and "feature delivered" are claims, not proof. Every runtime delivery must be verified by running the real server, invoked by the real client, from the correct port (`8080` backend / `5173` frontend), in a clean environment.
- **Upfront API & Port Contracts:** All endpoint paths, payload schemas, and port bindings must be documented in `docs/api_contract.md` before parallel coding begins. No unilateral changes to ports or routes.
- **Toolchain Preflight:** Always verify the active toolchain (Python virtual environment, Node/npm PATH, environment variables) before writing or testing code.
- **Strict Worktree Hygiene:** Maintain separate git worktrees per agent. Codex acts as the sole integration gatekeeper merging via clean PRs into `dev`.

## Apply the Sprint 2 lessons

Read [the Sprint 2 retrospective](docs/sprint-2-retrospective.md) when claiming
work. In your Megillah claim, name the applicable lessons and how you will verify
them; for an inapplicable lesson, briefly explain why.

- Before conversational changes, define success with reviewer-authored natural
  and adversarial conversations written without scoring cues. Keep held-out
  cases. Passing authored scoring fixtures proves consistency, not learner value.
- Before parallel coding, agree context ownership, public/private boundaries,
  response schemas, trigger/retry behavior, timeout and fallback. Record accepted
  contract revisions and explicit affected-owner approval or waiver; acknowledge
  adoption directly. Do not infer agreement from silence.
- For backend work, use Python 3.12.x and verify the task venv's interpreter and
  `jiter` import before installing or testing. Resolve Node/npm explicitly for
  frontend work. Record versions, source revision, database path, ports and
  provider/mock mode; never print secret values. Documentation-only work needs
  document/link/diff checks, not a model call or server run.
- Use disposable verification databases and a reproducible browser procedure.
  Separate unit/mocked, real HTTP, browser-injected failure and live-provider
  evidence. Attribute checks to the agent who ran them and state untested paths.
  Measure latency for new live coaching calls and verify bounded failure fallback.
- At session start and each milestone, reread the task and update a concise
  current-state handoff: revision, actual checks, remaining work and owner awaited.
  A posted readiness request is not evidence that its recipient read it or began.
- Push feature branches and open a draft PR at delivery, within authorized scope,
  so integration does not depend on an unpushed commit on one machine. Preserve
  the separate implementation, delivery, verification and integration gates.

## Apply the Sprint 3 lessons

Read [the Sprint 3 retrospective](docs/sprint-3-retrospective.md) with the
Sprint 2 lessons when claiming relevant work. Keep these checks proportional
to the change; do not add approval loops or rerun broad suites without cause.

- Test one complete learner journey early, before expanding implementation.
  For coach changes, cover every scenario in the planned demo, first and chained
  second hints with actual prior-hint context, direct requests, explicit and
  implicit refusal, and natural punctuation. Send suggested lines to the persona
  and inspect its replies. Preserve independent unseen cases.
- Evaluate the next useful move, not mandatory what/how questions or score gains.
  An answer, reflection, clarification, action or respectful pause may fit better.
  Suggested promises must be conditional on the learner's authority and ability
  to honor them. Do not teach hidden scoring keywords or invent private motives.
- Keep public selected-branch dialogue beside reviewed hints, tied to exact
  source, session/head, attempt and prior hints. Trace factual claims to that
  dialogue; a hint's own explanation is not grounding evidence. Keep secrets,
  hidden scenario data and model reasoning out of artifacts. Separate safe
  operational telemetry from intentionally retained review text.
- Diagnose timeout, token exhaustion, invalid output and provider errors
  separately. Record actual elapsed time, finish reason, token usage when
  available, provider/fallback counts by attempt and actual paid-call totals.
  Plan sample sizes and rerun checkpoints; respect explicit spending limits.
  Small samples and unmatched comparisons do not establish reliability or cause.
- Publish the scripts and configuration needed to reproduce accepted evidence.
  Compare exact candidate and integrated bytes before carrying evidence forward.
  State whether the running app, catalog and pinned sessions actually use the
  new behavior; never silently migrate or rescore historical sessions.
- Execute already-authorized work once its agreed dependencies are met. A handoff
  names the artifact, decision needed, next owner and blocker; acknowledgment
  means receipt, not implementation. Post releases where the waiting owner is
  tracking them. Before ending a watch, list unanswered requests and availability.
  Never claim unattended monitoring or CLI execution without a running mechanism.
- Separate implementation, independent measurement and integration ownership when
  feasible, without automatically spawning agents. Keep fixes narrow and reuse
  existing follow-up tasks. Record explicit user waivers as waivers, never as
  fabricated peer approval, successful tests or learner acceptance.

## Isolate each agent's work

- Use a separate Git worktree and task branch for each agent. Separate branches
  in a shared working directory do not isolate files.
- Do not edit on `main`, switch another agent's working directory to a different
  branch, or reset, clean, stash, overwrite, or discard another agent's changes.
- Suggested sibling worktrees are `../codex`, `../claude`, and `../muse`, with
  branches named `codex/<task>`, `claude/<task>`, and `muse/<task>`.
- Before editing, check the current branch, working tree, and `git worktree list`.
  If the directory is shared with an active agent, create an isolated worktree
  from the agreed integration commit before proceeding.
- Each worktree uses its own local Python environment and configuration. Keep
  `.env` ignored; never put credentials in commits, logs, chat, or Megillah.

## Coordinate ownership in Megillah

- Read the task's full record and recent comments before taking up work.
- Claim the task with a comment naming your agent, branch, worktree, intended
  scope, and files likely to change. Check for an existing owner first.
- Do not take over active work without an explicit handoff or user direction.
- Keep task boundaries narrow. If two tasks need the same file, coordinate who
  owns integration or sequence the edits before modifying it.
- Do not expand into another agent's task without coordinating the handoff.

## Unified Code Style & Convergence (Strict Mandate)

All agents must strictly adhere to the project's shared coding conventions to prevent stylistic drift:

- **Python Backend Standards (FastAPI & SQLAlchemy):**
  - Follow strict **PEP 8** guidelines.
  - Use `snake_case` for functions, methods, and variables (e.g., `calculate_question_ratio`).
  - Use `PascalCase` for classes and Pydantic models (e.g., `SimulationTurnRequest`, `ConversationNode`).
  - Mandatory type hinting for all function signatures and return types.
  - Formatted and checked via `ruff` (line length set to 88 characters).

- **Frontend Standards (React, Vite, TypeScript, Tailwind):**
  - Use `PascalCase` for components and pages (e.g., `SimulationArena.tsx`, `FlightRecorder.tsx`).
  - Use `camelCase` for functions, hooks, and variables.
  - Apply utility-first Tailwind CSS classes in a consistent ordering convention.
  - Enforced via ESLint and Prettier.

## Commit and integrate carefully

- Review the diff and stage explicit paths or hunks belonging to your task.
  Avoid blanket staging such as `git add .` or `git add -A`.
- Do not include unrelated changes from another agent in your commit.
- Run the checks appropriate to your change and report only results you ran.
- Use a pull request for integration. One designated integrator merges changes
  in sequence, resolves conflicts, and runs the combined test suite.
- Delivery and integration are separate gates. Once your task's acceptance
  criteria are met, record its delivery comment (files changed, checks actually
  run with results, limitations, and branch/commit references or explicitly
  `uncommitted`) and mark the task delivered in Megillah. Do not wait for a PR
  merge or integration into `dev` to deliver. The designated integrator handles
  that separate step. If the task is already delivered, add a follow-up comment
  without reopening it merely to record your contribution.
- Do not push directly to `main` or merge your own work unless authorized.
- Leave a Megillah handoff with the commit/PR, files changed, checks and results,
  remaining limitations, and any integration requirements. Attach test evidence
  when the task requires it. Never include secrets.

## Attribute changes and follow up on issues

- Use the stable agent names `Codex`, `Claude`, and `Muse` consistently. Name
  the agent that actually made each change; the human Git author alone is not
  sufficient attribution. Keep the user's configured Git author identity.
- Every new agent-created commit must include an `Agent: <name>` trailer and a
  `Megillah-Task: <task-id>` trailer in its commit message. For shared repository
  maintenance without a task, use `Megillah-Task: none (repository maintenance)`.
  Example:

  ```text
  Fix coach session isolation

  Agent: Codex
  Megillah-Task: CS-27
  ```
