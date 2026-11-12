# DialogIQ Flight Deck

DialogIQ is a conversation rehearsal app for hard workplace conversations. You
talk to a simulated character, ask a coach for one concrete next move when you
are stuck, and rewind to an earlier turn to try a different line. It was built
for the Meta Global AI Developer Hackathon (Indie Developer track).

It is rehearsal, not surveillance: nothing records or scores real conversations.

## How it works

| Part                           | What it does                                                                         | Runs on                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Persona                        | Plays the character, such as Bob, a guarded engineer behind on Q3                    | Fireworks `muse-spark-open` (`PERSONA_PROVIDER=fireworks`); Baseten optional |
| Coach                          | Suggests one next move as approach, example line and reason                          | Fireworks, `accounts/fireworks/models/muse-spark-open` (Meta API optional) |
| Legacy judge                   | Scores which of the character's 7 hidden needs your turns have uncovered             | Local code, deterministic and lexical, no model                            |
| Semantic feedback (opt-in Bob) | Classifies the completed exchange and cites public evidence; server derives counters | Fireworks GPT-OSS (`FEEDBACK_PROVIDER=fireworks`); the Baseten default is deactivated |
| Stance (Bob)                   | Tracks simulated guarded / warming / open states                                     | Server ledger; semantic sessions use evidence from the AI evaluator        |
| Recorder                       | Keeps every turn as a tree so you can rewind and branch                              | FastAPI + SQLite                                                           |

The coach never sees the character's hidden needs or private prompt, and the
persona never sees the coach's hints.

## Quick start (UI mock, no keys)

Needs Node 26.13.0 and npm 11.20.0.

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:5173`. With `VITE_API_BASE_URL` unset the frontend uses
an in-browser mock API. This is useful for looking at the UI; it does not run
the backend or models. For the complete conversation flow, use the real-app
setup below.

## Run the real app

Needs Python 3.12 (on Windows, 3.12 rather than newer because of a jiter wheel
issue under Windows Application Control) and Node 26.13.0.

One-time setup, from the repository root:

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd ci --ignore-scripts
```

Provider keys are server-only and are never sent to the frontend. Create an
ignored `.env` in the repository root, or use another private env-file path.
`scripts/run_backend.py --env-file <path>` loads only known names into the
backend process and never prints values. A complete Bob demo configuration is:

```sh
# Persona replies. The demo launcher uses fireworks unless this file or the
# shell names a provider; scripts/run_backend.py alone defaults to baseten.
PERSONA_PROVIDER=fireworks
# PERSONA_MODEL=accounts/fireworks/models/muse-spark-open   (the default)
COACH_PROVIDER=fireworks     # coach provider; meta is the code default
FIREWORKS_API_KEY=...        # coach, model accounts/fireworks/models/muse-spark-open
COACH_DEMO_WAIT=1            # required for Fireworks: low reasoning, no cutoff
FEEDBACK_ENABLED=1           # semantic feedback for new Bob sessions
FEEDBACK_PROVIDER=fireworks  # evaluator; the Baseten default is deactivated (see below)
COACH_NEXT_MOVE_ENABLED=1    # concise next-move hints for new Bob sessions
```

From the repository root, first check this worktree's Python, jiter, Node and
npm. On this machine, use the actual Node executable behind the nvm shim. For
another Node installation, set `$demoNode` to its `node.exe`; see the
[demo guide](docs/demo-script.md#start-a-regular-local-demo-on-windows).

```powershell
$demoNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v26.13.0/node.exe'
backend/.venv/Scripts/python.exe scripts/start_demo.py --mode check --node $demoNode
```

Then start each server in its own PowerShell terminal from the repository root:

```powershell
# Terminal 1: FastAPI on 127.0.0.1:8080, SQLite in ignored demo.local/demo.db
$demoNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v26.13.0/node.exe'
backend/.venv/Scripts/python.exe scripts/start_demo.py --mode backend --node $demoNode --env-file .env

# Terminal 2: production frontend on 127.0.0.1:5173
$demoNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v26.13.0/node.exe'
backend/.venv/Scripts/python.exe scripts/start_demo.py --mode frontend --node $demoNode
```

The frontend command builds the app and serves the production Worker using
pinned Wrangler 4.156.2. Its first run may download Wrangler; port 9335 is also
used for the local inspector. This path avoids the Vite development SSR
`fetchModule` timeout seen during recording. Open `http://127.0.0.1:5173`, then
choose **New Session** on Bob's card. Check the API with
`Invoke-RestMethod http://127.0.0.1:8080/health`; it should report
`status: healthy`. Each server runs in the foreground; press Ctrl+C in each
terminal to stop it. The launcher refuses occupied ports and does not stop
another process.

The demo database is retained across restarts. Pass `--database <path>` in the
backend terminal for a separate disposable database. Direct use of
`scripts/run_backend.py` defaults to `backend/dialogiq.db` and accepts
`DIALOGIQ_DB_PATH`. Without a key for the selected persona provider, sending a
turn returns `persona_unavailable` (HTTP 503). The persona provider defaults to
Baseten (`BASETEN_API_KEY`) when `PERSONA_PROVIDER` is unset; on 2026-11-11 the
hackathon Baseten model returned "Model version wpgy40e is deactivated", so use
`PERSONA_PROVIDER=fireworks`. Without a configured coach provider, hints
fall back to deterministic text. Each real turn, evaluator call and live hint
can use paid provider credits.

For frontend hot reload, add `--frontend dev` to the frontend command. This
uses Vite's development server and can be less reliable for long recording
sessions. The launcher sets `VITE_API_BASE_URL` and `VITE_COACH_DEMO_WAIT` for
both frontend modes; Vite reads them at startup, so restart after changing
frontend settings.

### Normal and demo settings

Demo wait is a paired flag: `COACH_DEMO_WAIT=1` on the backend and
`VITE_COACH_DEMO_WAIT=1` on the frontend. With it, the coach uses up to 16384
tokens, low reasoning effort and no cutoff, and the client keeps waiting. Without
it, the coach uses 2048 tokens and an 8 second cutoff. Fireworks timed out in
normal mode in our checks, so use demo wait with Fireworks. If only one side is
set, the client may give up while the server is still working.

The Meta API (`COACH_PROVIDER=meta` with `META_MODEL_API_KEY`,
`META_MODEL_API_BASE`, optional `META_MODEL_API_MODEL`) is still supported. Keys
never cross providers. See [docs/api_contract.md](docs/api_contract.md) for every
setting.

## The Bob practice journey

1. On the Hub, choose **Bob: Defensive Team Member**. New Bob sessions opt into
   behavior revision `s4-bob-r1` automatically when the server offers it.
2. In the Arena, talk to Bob. He opens with "You wanted to see me? If this is
   about Q3, I already sent the update."
3. Two kinds of progress are shown separately:
   - **Needs uncovered** (0 to 7) is the judge's score.
   - **Bob's stance** (guarded, warming or open) is a simulated conversational
     state with a short public explanation, such as "Your wording offered a
     concrete clarification." It changes with clarity, support, acknowledgment
     and repair, and moves back with pressure or blame. It is not a measure of
     real trust or empathy.
4. Ask for a hint at any turn. A second hint at the same turn tries a different
   approach; each turn keeps at most two. If the coach provider times out or
   fails, the server saves a fixed fallback hint as that attempt's hint; it is
   kept like any other hint and still counts toward the two. If a request is
   unresolved (the response was lost or the wait ran out with no known
   result), **Try again** repeats that same attempt.
5. Open the **Flight Recorder** to see the turn tree, select an earlier turn and
   branch from it. Saved hints and stance stay with their turns after reload.

Sessions keep the behavior they were created with. Older Bob sessions and other
personas keep their original behavior; only new Bob sessions use `s4-bob-r1`.

### Opt-in semantic feedback

Semantic feedback replaces phrase matching for **new Bob sessions** when
the backend is started with these settings (or loads them from the ignored env
file through `scripts/run_backend.py`):

```sh
FEEDBACK_ENABLED=1
FEEDBACK_PROVIDER=baseten
# optional evaluator-only override:
FEEDBACK_MODEL=meta-models/muse-spark-open-1026
```

As of 2026-11-11 the Baseten hackathon model is deactivated, so this default
cannot grade. Use `FEEDBACK_PROVIDER=fireworks` (below); that path was not
re-run after the deactivation.

The grader uses a separate prompt/request from Bob, even on the same provider.
It reads the selected public conversation and evaluator-only rubric. The coach
does not receive that rubric. Server-assigned excerpts ground the displayed
evidence; a source quote does not guarantee the AI interpretation is correct.
Bob may gradually disclose relevant concerns without the old judge's advance
permission list. The grader then checks his actual reply, so a useful statement
or closed question can uncover a need, and a question need not earn points.

The UI labels the observable acknowledgment measure **Acknowledgment** rather
than treating it as psychological empathy. Simulated stance changes also cite
Bob's reaction. Evaluations have a 12-second deadline; failures save the turn,
retain prior knowledge and display unavailable feedback with coverage instead
of false zeros. Existing sessions remain pinned and are never silently rescored.

`FEEDBACK_PROVIDER=fireworks` selects the separately configured Fireworks
grader; its default is `accounts/fireworks/models/gpt-oss-120b`. No provider key
falls back across services. Keep `COACH_PROVIDER=fireworks` and the paired demo
wait flags for the coach. See the [contract](docs/semantic-feedback-contract.md)
and [actual checks and limits](docs/semantic-feedback-verification.md).

## Demo and verification

The [three-minute demo script](docs/demo-script.md) includes presenter narration,
suggested dialogue, hints, branching and a saved-session fallback. The
[local demo launcher](scripts/start_demo.py) starts the backend and frontend in
separate terminals with Fireworks and paired demo-wait settings. Follow the
script's setup instructions; its default database is `demo.local/demo.db`,
separate from the direct backend recipe above. On Windows with an nvm shim,
pass `--node` with the actual Node installation path as shown in the demo guide.
The accepted [v5.1 presentation](submission/video/v5.1/out/DialogIQ-presentation-v5.1.mp4),
[captions](submission/video/v5.1/out/DialogIQ-presentation-v5.1.srt) and
[rebuildable source](submission/video/v5.1/README.md) are checked in separately
from the app runtime.
For recording, frontend mode builds and serves the production output with
pinned Wrangler 4.156.2, avoiding the Vite development SSR module loader. Use
`--frontend dev` only when you want the development server and hot reload.

The project owner accepted the final Bob preview on November 3, 2026, with
the documented coaching and latency limits. The
[integrated verification report](docs/evidence/cs78-integrated-verification.md)
records exact source revisions, reproducible configuration, public scripted
conversations and separate unit, browser and live-provider evidence. Its
pending-acceptance wording is a timestamped snapshot; the later acceptance is
recorded on Megillah CS-78. Acceptance does not mean every quality target passed.

The verification preview had a finite model-call allowance. After three manual
persona replies, two later attempts were blocked locally and displayed
`persona_unavailable`; that incident was not an observed provider outage.
The normal demo launcher does not impose that verification cap. User turns and
live hints, including automatic hints, can incur provider charges.

## Tests

```powershell
Push-Location backend
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check .
Pop-Location
npx tsc --noEmit
npm.cmd test
npm.cmd run build
```

These checks make no paid calls. The production build is also run automatically
by `scripts/start_demo.py --mode frontend` before the Worker starts.

## Known limits

The optional concise Bob coach mode uses `COACH_NEXT_MOVE_ENABLED=1` on
the backend. It applies to **new** Bob sessions only; saved sessions keep their
earlier prompts. See the [mode contract](docs/coach-next-move-contract.md)
and [demo rehearsal](docs/coach-demo-walkthrough.md). The historical coach
measurements below predate this mode and do not establish its quality.

- **The legacy judge is lexical.** It counts open questions by their opening words
  (what, how, why, tell me, walk me through, describe and similar). A useful
  question that starts with where, when, who or which gets no open-question
  credit, and needs are revealed by matched wording, not by meaning.
- **Legacy Bob stance is rule-based**, from wording signals with negation handling.
  Semantic sessions use AI classifications and a bounded ledger; both can misread
  language and neither measures real trust. The eight-turn semantic sample had
  grading with a median of 2.98 s and a maximum of 4.91 s, not a reliability guarantee.
- **Coach quality** (Sprint 4, small finite samples, graded by the agents):
  - These earlier measurements predate semantic-feedback sessions and remain
    historical evidence, not a benchmark of the new complete journey.
  - On the final coach (merged as a740eea, measured on branch 9afaa54 with the
    same coach code), 13 shared Bob cases, 78 hints: 52/78 judged usable by a
    learner, against 23/78 for the previous coach. Bob's requests to stop were
    respected in 6/6. Still weak: repairing after the
    learner's own mistake (5/12) and letting a supportive statement stand
    without another question (1/12).
  - On 4 unseen cases (24 hints), 16/24 against 3/24 for the previous coach,
    but that was measured once on an earlier revision (b022828). It was not
    rerun on the final stop-rule wording, so it is not evidence about the final
    coach. The final revision was accepted by the project owner with these
    known misses, not because the unseen result carried over.
- **Coach latency** on Fireworks in demo-wait mode, on the same 78-hint final
  run: median 13.7 s for a first hint and 22.0 s for a second hint, with a
  slowest hint of 83.9 s. This misses the original goal of a quick hint and is
  a finite sample, not a guarantee.
- **Grounding is imperfect.** An earlier integrated review found one hint asserting
  that a spec changed after an update was sent, although the public dialogue did
  not establish that order. The later concise coach mode targets this failure,
  but its small authored checks do not prove it is eliminated. See the
  [public text review](docs/evidence/cs78-live-text-review.md) and
  [new mode checks](docs/coach-next-move-verification.md).
- **Local single user.** There is no login and no multi-user authorization;
  CORS is not authentication.

## Project history

Built in sprints by one developer working with AI coding agents (Claude, Codex
and Muse) coordinated on a Megillah board. Sprint reports and retrospectives are
in [docs/](docs/). Earlier launch recipes in those reports are historical; this
README is current. The project began from a [Lovable](https://lovable.dev)
scaffold.
