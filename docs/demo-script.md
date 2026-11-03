# DialogIQ demo script

Aim for three minutes of narration, with room for live model waits. This is a
guide to the interaction, not a promise of Bob's exact replies or score.

## Before recording

Use the real app at http://127.0.0.1:5173 with backend port 8080. Start a **new
Bob session** so it uses `s4-bob-r1`. Keep a saved rehearsal with a branch in
reserve. Check audio, readable text and browser zoom before recording.

The acceptance preview had a verification-only allowance of three persona
replies. Its next two requests were blocked locally and displayed the generic
persona-unavailable message. That is not evidence of a Baseten outage. For a
longer demo, use the normal launcher below. It has no verification call cap;
each sent turn and live hint can incur provider charges. Automatic hints count
too. Demo wait has no application cutoff, so allow for variable provider waits.

## Presenter walkthrough

| Beat                        | On screen                                | Say / do                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00 - Problem              | Scenario Hub                             | **Say:** "Hard conversations are difficult to practice before they matter. DialogIQ lets you rehearse, get help when you are stuck, and try another approach."                                                                                                                 |
| 0:20 - Meet Bob             | Start Bob: Defensive Team Member         | **Say:** "Bob is a simulated teammate. We need to discuss missed Q3 deadlines." Read his actual opening. **Type:** `Bob, we missed the Q3 dates again.`                                                                                                                        |
| 0:40 - Feel the friction    | Bob's reply                              | Read what Bob actually says. **Type:** `I need a clearer answer about those dates.` **Say:** "Repeating the pressure can leave the conversation stuck." Do not predict his response.                                                                                           |
| 1:00 - Get help             | Get a hint, or inspect an automatic hint | **Say:** "The coach uses the public dialogue to suggest an approach, an example line and a reason." Read the actual example. Ask for a second hint at the same turn if time permits. **Say:** "I can compare another approach before choosing what to say."                    |
| 1:30 - Try it               | Send an appropriate suggested line       | Adapt the line to Bob's actual reply and your role. **Say:** "I choose the words; the coach doesn't send them for me." Read Bob's response rather than claiming the hint worked in advance.                                                                                    |
| 2:00 - Explain progress     | Needs uncovered and Bob's stance         | **Say:** "These are separate signals: the judge counts uncovered needs, while Bob's stance reflects simulated conversational cues. Neither is a measure of real trust or learning." If the score or stance stays unchanged, show that honestly.                                |
| 2:20 - Rehearse differently | Flight Recorder                          | Select the first turn and use the rewind/branch control. **Say:** "I can go back and try another opening while keeping the original conversation." **Type:** `I know the last few weeks have been messy. Where would you like to start?` Adapt to the selected public context. |
| 2:45 - Compare and close    | Both branches, then reload               | Show that the original remains, select the new branch and reload to show saved history. **Say:** "The value is a safe place to compare choices before the real conversation. The goal is a useful next move, not chasing a score."                                             |

If Bob asks for a direct answer, answer what you actually know. If he asks to
stop, respect the pause. Do not force the planned lines through a different
conversation or promise an outcome beyond your authority.

## If the live provider stalls or fails

Say: "The live provider hasn't returned a usable reply, so I'll show the saved
rehearsal." Open the saved session and explicitly identify it as recorded
history. Show its hint and branches without presenting them as a fresh response.
The UI can show a retry action; repeated clicks do not fix an exhausted
verification allowance. Coach failures may save a deterministic fallback hint.
Do not describe that as a successful live model response.

## Start a regular local demo on Windows

From this checkout, follow [the README setup](../README.md#run-the-real-app):
Python 3.12, this worktree's backend environment with requirements, and
`npm.cmd ci --ignore-scripts`. The launcher checks Python/jiter and reports
Node/npm versions. The verified versions were Node 26.13.0 and npm 11.20.0.

In two PowerShell terminals, run these from the repository root:

```powershell
# Terminal 1: real backend, normal runner, Fireworks + demo wait
# For this machine's Author nvm installation, select the executable, not its shim.
$demoNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v26.13.0/node.exe'
backend/.venv/Scripts/python.exe scripts/start_demo.py --mode backend --node $demoNode --env-file 'D:\path\to\ignored.env'

# Terminal 2: build and serve the recording frontend, paired demo wait
$demoNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v26.13.0/node.exe'
backend/.venv/Scripts/python.exe scripts/start_demo.py --mode frontend --node $demoNode
```

For preflight only, use `--mode check` (the default). Always invoke it with your
Python 3.12 backend venv. If Node/npm are not resolved correctly, pass
`--node 'D:\path\to\node\node.exe'` and, if needed,
`--npm-cli 'D:\path\to\node\node_modules\npm\bin\npm-cli.js'`.
The launcher is Python so it also works from PowerShell where `.ps1` execution
is disabled; it changes no execution policy.
Use your own Node installation path if it differs from the example.

The env file needs `BASETEN_API_KEY` and `FIREWORKS_API_KEY` plus any custom
provider endpoint settings from your existing configuration. The launcher sets
`COACH_PROVIDER=fireworks` and both sides of demo wait. Keys stay server-only;
never use a `VITE_` variable for a key. Existing process variables take precedence
over env-file values in the backend runner.

The default database is this checkout's ignored `demo.local/demo.db`; use
`--database 'D:\path\to\demo.db'` in the backend terminal to choose another.
Data is retained, not reset. This does not migrate old Bob sessions. Each server
runs in the foreground; Ctrl+C stops that server. The launcher refuses occupied
ports and never stops another process. The acceptance preview was stopped at the
owner's request; check for other listeners before launching on 8080/5173.

Frontend mode builds and serves the production output using pinned Wrangler
4.156.2 on port 5173 (local inspector 9335). It avoids Vite's development SSR
module loader, which can fail with `vite:invoke` / `fetchModule` transport
timeouts. The first launch builds the app and may download the pinned runner.
For development with hot reload, explicitly add `--frontend dev`.
The accepted production-build evidence is separately retained in
[CS-78 verification](evidence/cs78-integrated-verification.md). The user accepted
the current demo with documented quality/latency misses, including one unsupported
chronology claim; this script does not claim those misses were fixed.
