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
