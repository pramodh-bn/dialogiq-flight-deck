# DialogIQ Flight Deck

DialogIQ is a conversation rehearsal app for hard workplace conversations. You
talk to a simulated character, ask a coach for one concrete next move when you
are stuck, and rewind to an earlier turn to try a different line. It was built
for the Meta Global AI Developer Hackathon (Indie Developer track).

It is rehearsal, not surveillance: nothing records or scores real conversations.

## How it works

| Part         | What it does                                                               | Runs on                                                                    |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Persona      | Plays the character, such as Bob, a guarded engineer behind on Q3          | Baseten, `meta-models/muse-spark-open-1026`                                |
| Coach        | Suggests one next move as approach, example line and reason                | Fireworks, `accounts/fireworks/models/muse-spark-open` (Meta API optional) |
| Judge        | Scores which of the character's 7 hidden needs your turns have uncovered   | Local code, deterministic and lexical, no model                            |
| Stance (Bob) | Tracks Bob's simulated stance (guarded / warming / open) from what you say | Local code, deterministic, no model                                        |
| Recorder     | Keeps every turn as a tree so you can rewind and branch                    | FastAPI + SQLite                                                           |

The coach never sees the character's hidden needs or private prompt, and the
persona never sees the coach's hints.

## Quick start (mock, no keys)

Needs Node 26.13.0 and npm 11.20.0.

```sh
npm ci --ignore-scripts
npm run dev
```

With `VITE_API_BASE_URL` unset the frontend uses an in-browser mock API. This is
useful for looking at the UI. It is not the real app: no backend, no models.

## Run the real app

Needs Python 3.12 (on Windows, 3.12 rather than newer because of a jiter wheel
issue under Windows Application Control) and Node 26.13.0.

One-time setup, from the repository root:

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd ci --ignore-scripts
```

Provider keys are server-only and are never sent to the frontend. Put them in an
env file outside version control. `scripts/run_backend.py --env-file <path>`
loads only the known names into the backend process and never prints values.

```sh
BASETEN_API_KEY=...          # persona replies
COACH_PROVIDER=fireworks     # coach provider; meta is the code default
FIREWORKS_API_KEY=...        # coach, model accounts/fireworks/models/muse-spark-open
COACH_DEMO_WAIT=1            # required for Fireworks: low reasoning, no cutoff
```

Backend terminal (port 8080):

```powershell
$env:DIALOGIQ_CORS_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'
backend/.venv/Scripts/python.exe scripts/run_backend.py --env-file <path-to-env> --port 8080
```

Frontend terminal (port 5173). Vite reads these at startup, so restart after
changing them:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8080'
$env:VITE_COACH_DEMO_WAIT = '1'     # pairs with COACH_DEMO_WAIT=1
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. The database is `backend/dialogiq.db` and is
created and seeded on first start; set `DIALOGIQ_DB_PATH` to use a separate,
disposable database. The persona needs `BASETEN_API_KEY`: without it, sending a
turn returns a `persona_unavailable` error (HTTP 503). Without a configured coach
provider, hints fall back to deterministic text.

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
   approach. If a call fails, you can retry it.
5. Open the **Flight Recorder** to see the turn tree, select an earlier turn and
   branch from it. Saved hints and stance stay with their turns after reload.

Sessions keep the behavior they were created with. Older Bob sessions and other
personas keep their original behavior; only new Bob sessions use `s4-bob-r1`.

## Tests

```powershell
cd backend; .venv/Scripts/python.exe -m pytest -q; .venv/Scripts/python.exe -m ruff check .
npx tsc --noEmit
npm.cmd test
```

The test suites make no paid calls.

## Known limits

- **The judge is lexical.** It counts open questions by their opening words
  (what, how, why, tell me, walk me through, describe and similar). A useful
  question that starts with where, when, who or which gets no open-question
  credit, and needs are revealed by matched wording, not by meaning.
- **Bob's stance is rule-based**, from wording signals with negation handling. It
  can misread unusual phrasing.
- **Coach quality** (Sprint 4 measurement on 13 Bob cases, 78 hints):
  52/78 hints judged usable by a learner, against 23/78 for the previous coach;
  16/24 against 3/24 on unseen cases. Bob's requests to stop are respected in
  6/6. Still weak: repairing after the learner's own mistake (5/12) and
  letting a supportive statement stand without another question (1/12).
- **Coach latency** on Fireworks varied from about 7 to 22 seconds typical, with
  rare waits over 25 seconds.
- **Local single user.** There is no login and no multi-user authorization;
  CORS is not authentication.

## Project history

Built in sprints by one developer working with AI coding agents (Claude, Codex
and Muse) coordinated on a Megillah board. Sprint reports and retrospectives are
in [docs/](docs/). Earlier launch recipes in those reports are historical; this
README is current. The project began from a [Lovable](https://lovable.dev)
scaffold.
