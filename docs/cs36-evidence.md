# CS-36 verification evidence

Run by Codex on 2026-10-30, task branch `codex/cs36-api-contract`, based on
`dev` at `0ed9284`. This is contract/baseline evidence, not Sprint 2 delivery.

## Environment and setup

- Own worktree: `D:/Workspace/meta-hackathon/dialogiq-flight-deck/.worktrees/cs36`.
- Own fresh Python environment: backend/.venv, Python 3.15.1.
- Explicit installed Node v26.13.0 / npm 11.20.0. Default NVM shim had no active
  version; no global environment change was made.
- `pip install -r backend/requirements.txt` succeeded. Direct dependencies are
  pinned, but not all transitive dependencies are pinned.
- `npm ci --ignore-scripts` succeeded, 532 packages installed. Reported two high
  vulnerabilities; dependency remediation is outside CS-36.
- `python -m pip check`: No broken requirements found.
- Initial sandbox attempts failed on worktree metadata/environment/formatter/
  SQLite writes. Approved escalated runs completed the required setup/checks.
  The initial SQLite failure was environmental, not recorded as a passing run.

## Real baseline check

Command, from this worktree root, with the installed node.exe path supplied:

```powershell
backend/.venv/Scripts/python.exe scripts/verify_cs36_baseline.py --node 'C:\Users\User\AppData\Local\Author Software\nvm\installs\v26.13.0\node.exe'
```

Passed with a fresh worktree database. The checker starts and stops only its own
uvicorn/Vite processes. It verifies backend port 8080 health, frontend HTML from
5173 using explicit strict-port flags, CORS from 127.0.0.1:5173, and invokes the
actual delivered TypeScript HTTP adapter over real HTTP (transpiled to JS by the
installed TypeScript compiler). It does not invoke the in-browser mock.

Captured result:

```json
{
  "backend": 8080,
  "servedFrontend": 5173,
  "corsOrigin": "http://127.0.0.1:5173",
  "actualTsHttpAdapter": "passed",
  "scenarios": 4,
  "session": "created",
  "unknownScenario": 404,
  "emptyMessage": 422,
  "reply": "fixed baseline placeholder",
  "modelCalls": 0,
  "visualBrowserCheck": false
}
```

The adapter selected Teenage Daughter by its returned title, created a session
for that scenario and received the current fixed delivery-timeline reply with
turn_id 1 / score 3. This demonstrates the current stub, not scenario-correct
persona behavior. Public scenario fields were exactly id/title/description.
Unknown scenario returned 404; empty text returned 422. Both owned server ports
had no listeners after cleanup.

The checker refuses an existing database, never deletes it. This worktree now
has the ignored database created by the successful check. For another clean
run, use a new isolated checkout/environment; do not remove someone else's data.

## Documentation and scope

Ruff lint/format passed for the added baseline checker. Prettier formatting was
applied to the contract and journal. Final read-only document checks are recorded
in the journal/handoff. The full backend/frontend test suites were not rerun:
no runtime application source changed. No paid requests or live provider probes
were made, and no browser interaction was performed.

The contract marks all new endpoints and extended DTOs planned. Claude and Muse
review/ownership acknowledgment remain required. No approval, integration or
CS-36 delivery is claimed by these checks.
