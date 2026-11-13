# DialogIQ factory specification (DFS-1)

Status: draft by Claude, 2026-11-12, for Pramodh's review (Megillah CS-96, Track
CS-T11). Written for the BAND Dark Factory Buildathon, whose page says: build
"an AI Software Factory, where AI coding agents work together to produce working
software from specifications". As of 2026-11-12 the event has published no
rules, judging criteria or submission format; section 11 lists what to
re-check when it does.

## 1. What this document is for

A team of coding agents, coordinated in BAND rooms, must build DialogIQ from this
document and the files it names, and the result must be accepted or rejected by
programs, not by a person. So every requirement below has an ID, says MUST, and
names the check that decides it. A requirement with no check is a defect in this
document, and the Critic agent (section 5) may veto work that depends on one.

Words: MUST and MUST NOT are binding. "Check" is the file or command whose
pass/fail decides the requirement. "Fixture" is data in `acceptance/fixtures/`.

## 2. Product in one paragraph

DialogIQ is a rehearsal tool for hard conversations. A learner picks a scenario,
talks to a simulated counterpart (first scenario: Bob, a guarded engineer who
missed Q3 deadlines), and gets feedback on what they did, not only on what Bob
said. Every turn is kept in a tree, so the learner can rewind to an earlier turn,
try a different line, and compare the two attempts. Bob is a simulation; the
product never claims a real person would react the same way.

## 3. Scope of the factory build ("DialogIQ Core")

In scope, because a pipeline can verify all of it with no microphone and no
human:

| Module | What it is |
| --- | --- |
| M1 Domain and store | Scenarios, sessions, branches, turns (nodes), the conversation tree, saved in SQLite. |
| M2 Counterpart | Bob's reply through a `PersonaProvider` interface; stance from public conversation only. |
| M3 Feedback | Per-turn judgment through a `FeedbackProvider` interface, checked by code against the turn text. |
| M4 Scorecard | Deterministic scores from a timed event list. A pure function. |
| M5 API | HTTP and server-sent events, as in the annexes. |
| M6 Web client | Scenario list, rehearsal screen, flight recorder tree, two-attempt comparison. |
| M7 Verification | The acceptance suite and pipeline in section 7. It is not built by the builders. |

Out of scope for this build: live speech input and output, the research brief
(`/prepare`), video avatars, accounts and payments, any real model provider
(real providers are optional adapters behind the interfaces, section 6).

## 4. Normative annexes (the data the requirements point at)

These files already exist in this repository. The factory MUST treat them as
read-only inputs and reproduce their behaviour exactly.

| Annex | File | Governs |
| --- | --- | --- |
| A | `docs/api_contract.md` | HTTP wire shapes for scenarios, sessions, turns, branches, tree. |
| B | `docs/v3/voice-rep-contract.md` (sections Clock, Events, Scorecard `v3-score-r1`, Whisper `v3-whisper-r1`) | Event timeline and every scorecard measure, defined exactly. |
| C | `docs/v3/score-fixtures.json` | Utterances with the expected `v3-score-r1` result. |
| D | `docs/semantic-feedback-contract.md`, `docs/semantic-feedback-cases.json` | What a feedback judgment contains and which are rejected. |
| E | `acceptance/fixtures/` (new, written by the Test author, section 5) | Scripted conversations, expected trees, expected comparisons. |

Where an annex and this document disagree, the annex wins and the disagreement is
a defect to report in the room.

## 5. Agents (each a separate BAND agent, in one room)

One process playing several roles does not count: every role below is registered
as its own BAND agent with its own mandate. Roles are mandates in the form BAND's
Desktop uses (Own, Do not, Use, Ask a person, Done means).

| Agent | Owns | Must not | Done means |
| --- | --- | --- | --- |
| Planner | Breaks this spec into tasks per module, order, interfaces. Posts the plan as the first message. | Write product code or tests. | Every requirement ID appears in exactly one task. |
| Test author | `acceptance/` (fixtures, black-box tests), the pipeline script, `verify-report.json`. Writes them from this spec and the annexes BEFORE any builder starts. | Read builder code. Edit after the builders start, except through a Critic-approved spec change. | Gate G0 passes on an empty implementation by failing for every requirement. |
| Builder M1..M6 (one agent per module) | Code for its module only, plus its own unit tests under `src/` and `backend/`. | Touch `acceptance/`, the pipeline, or another module's files. Skip, weaken or delete a test. | `make verify` green for its requirements. |
| Critic | Reviews each Builder hand-in against requirements and the Test author's suite; injects defects (section 7, G6). | Write product code. | Posts `VERDICT: PASS` or `VERDICT: BLOCK` with requirement IDs. |
| Integrator | Merges module branches in dependency order, runs the whole pipeline, writes the final report. | Merge anything with an open `BLOCK`. | All gates green on the merged tree. |

Handoffs follow BAND mention routing: a Builder finishes by `@Critic` with the
requirement IDs it claims; the Critic answers the claim, not the original task;
only a `PASS` lets the Integrator merge (a dependent handoff and a verdict that
can be blocked). The Planner decides at run time which Builder agents the room
needs, looks them up with `band_lookup_peers` and adds them with
`band_add_participant` (a roster decided at run time).

Delete test: remove the room and nothing builds, because the Builders cannot
merge without a Critic verdict and the Integrator cannot merge without it.

## 6. Interfaces and determinism

R-DET-1. All model calls MUST go through `PersonaProvider.reply(...)` and
`FeedbackProvider.judge(...)`. No other module MAY import a model SDK or read an
API key. Check: `acceptance/test_no_direct_model_use.py` (static import scan and a
run with network disabled).

R-DET-2. The build MUST ship `FakePersonaProvider` and `FakeFeedbackProvider`
that return answers from `acceptance/fixtures/scripts/*.json` keyed by a hash of
the request. With them, the whole suite MUST pass offline with no keys. Check:
pipeline gate G2.

R-DET-3. A real provider (any model service) MAY be added as an adapter but MUST
NOT be required by any gate. Check: gate G2 runs with `NO_NETWORK=1`.

R-DET-4. The scorecard (M4) MUST be a pure function of its input events: same
input, byte-identical output. Check: `acceptance/test_score_pure.py` runs every
Annex C case twice and compares bytes.

## 7. Requirements

### M1 Domain and store

R-M1-1. Creating a session for scenario 1 MUST return an empty tree with one
active branch and Bob's opening line. Check: `acceptance/test_sessions.py::opening`.

R-M1-2. A turn MUST attach to the head node of the named branch; a request whose
`expected_revision` is stale MUST fail with HTTP 409 and change nothing. Check:
`test_sessions.py::stale_revision`.

R-M1-3. Repeating a request with the same `Idempotency-Key` MUST return the first
answer and create no second node. Check: `test_sessions.py::idempotent`.

R-M1-4. Rewinding to a node MUST create a new branch whose chain is the original
chain up to that node; the original branch MUST be unchanged. Check:
`test_tree.py::rewind_keeps_original`.

R-M1-5. After restarting the server, every session and its tree MUST be identical.
Check: `test_sessions.py::persistence`.

### M2 Counterpart

R-M2-1. Bob's reply MUST be produced from his public persona, the conversation so
far and his stance; the hidden needs list MUST NOT appear in any text sent to the
provider. Check: `test_persona.py::no_hidden_needs_in_prompt` (inspects the
recorded request to the fake).

R-M2-2. Stance MUST be one of `guarded`, `warming`, `open` and MUST change only
by the rules in Annex A/D; pressure MUST NOT raise it. Check:
`test_stance.py` over `fixtures/stance_cases.json`.

R-M2-3. If the provider fails or times out, the turn MUST fail with a retryable
error and MUST NOT save a partial node. Check: `test_persona.py::provider_failure`.

### M3 Feedback

R-M3-1. A feedback judgment MUST be accepted only if every quote it cites occurs
word for word in the turn it describes; otherwise the turn is saved with feedback
status `unavailable` and a controlled reason, never with invented evidence. Check:
`test_feedback.py` over Annex D cases.

R-M3-2. Each turn's notes MUST say what the learner did (with a quote), what
Bob disclosed (with a quote) or that he added nothing, and how many hidden needs
remain unspoken. Notes MUST NOT name an undisclosed need. Check:
`test_feedback.py::notes_never_leak` (seeds a unique title per need, searches all
output).

R-M3-3. A turn judged as pressure MUST be labelled a dead end even if Bob
disclosed something that turn; the notes MUST still report the disclosure. Check:
`test_feedback.py::pressure_with_disclosure`.

R-M3-4. A feedback failure MUST NOT lose Bob's reply or the turn. Check:
`test_feedback.py::failure_keeps_turn`.

### M4 Scorecard

R-M4-1. Every case in Annex C MUST return its `rule` result. Check:
`test_score_fixtures.py` (all cases, no skips; the count in the test equals the
count in the file).

R-M4-2. Talk ratio, pause after deflection, interruptions and rewind recovery
MUST equal the Annex B definitions on the timelines in
`fixtures/timelines/*.json`. Check: `test_score_timelines.py`.

R-M4-3. Empty and one-sided timelines MUST return defined values (no exception,
no NaN). Check: `test_score_timelines.py::edges`.

R-M4-4. No scorecard code MAY call a model. Check: R-DET-1 scan.

### M5 API

R-M5-1. Every route in Annex A MUST exist with the documented request and
response shape; unknown request fields MUST be refused with 422. Check:
`test_contract.py` (validates every response against the JSON Schemas in
`acceptance/schemas/`, generated from Annex A by the Test author).

R-M5-2. Errors MUST carry `{code, message, retryable}` and MUST NOT include
provider text or stack traces. Check: `test_contract.py::error_shape`.

R-M5-3. A reply stream MUST send one event per sentence and end with exactly one
`done` or `error` event. Check: `test_stream.py`.

### M6 Web client

R-M6-1. With the fake providers, a scripted browser run (`acceptance/e2e/play.spec`)
MUST: pick Bob, send the 8 lines in `fixtures/scripts/bob_run_1.json`, see each
reply and its notes, open the flight recorder, rewind to turn 4, send the retry
lines, and open the two-attempt comparison. Check: that spec, headless, passing.

R-M6-2. The comparison MUST show, for each attempt, turns, open and yes/no
question counts, concerns acknowledged, pressure turns, new concerns Bob shared,
final stance, and the first line and reply after the fork, and MUST say Bob is a
simulation. Check: `e2e/compare.spec` against `fixtures/expected/compare_1.json`.

R-M6-3. The client MUST show a message, not a blank page, when the API is down.
Check: `e2e/offline.spec`.

R-M6-4. No console errors during R-M6-1. Check: the spec fails on any.

### Cross-cutting

R-X-1. No secrets in the repository or logs. Check: gate G5 secret scan.

R-X-2. Types and style: Python 3.12 with type hints on every function, ruff
clean (line length 88); TypeScript strict, ESLint and Prettier clean. Check: gate
G1.

R-X-3. `make verify` MUST run every gate and exit non-zero on any failure. Check:
the Integrator runs it on a tree with one deliberately broken test.

## 8. Verification pipeline (the only judge)

The pipeline is `make verify` in the repository root. It is written by the Test
author and is read-only to Builders (a file-permission and diff check, gate G0).

| Gate | Decides |
| --- | --- |
| G0 Integrity | `acceptance/`, `Makefile`, `SPEC.md` and annexes unchanged since the spec hash in `.factory/spec.sha256`; no test deleted, skipped or marked xfail; test counts match the manifest. |
| G1 Static | ruff, type check, ESLint, Prettier, secret scan (R-X-1, R-X-2). |
| G2 Offline behaviour | Every requirement with a `test_*.py` check, with fake providers and `NO_NETWORK=1`. |
| G3 Contract | Every response of every route against `acceptance/schemas/`. |
| G4 Browser | The Playwright specs for M6, headless. |
| G5 Hygiene | No `print` or debug leftovers, no committed databases or logs, no secrets. |
| G6 Mutation | The Critic applies each mutation in `acceptance/mutations/` (for example: drop the stale-revision check, let hidden needs into the prompt, let pressure raise stance, label a pressure turn a breakthrough). Each mutation MUST make at least one test fail. A surviving mutation fails the gate and means the suite is too weak. |
| G7 Simulation (optional) | A simulated learner (see section 9) plays the scenarios against the built API; checks are policy-style, not exact text. Reported, never blocking, until the suite is validated on the reference implementation. |

Evidence: `verify-report.json` with, per requirement ID, pass or fail, the check
that decided it, and the spec hash. The run is accepted only if every required
requirement passes and G6 has zero survivors.

## 9. Validation datasets and simulation

Two kinds of data, kept apart:

1. Authored fixtures (`acceptance/fixtures/`): the exact scripts, timelines and
   expected trees that gates G2 to G4 use. They are small and exact, so they are
   written by hand or by the Test author, not generated at random.
2. Generated scenarios (gate G7 and the held-out set): conversations produced by a
   dataset tool (for example Plurai Simulation, section 10) that probe policies
   such as "a blaming line is never labelled a breakthrough" and "notes never name
   an undisclosed need". A held-out set the Builders never see is part of
   the final run, so the suite cannot be tuned to the visible cases.

## 10. Plurai in this plan

Plurai Simulation reads an agent's code, writes scenarios (a simulated user's
goal, persona, opening line) and pass/fail evals, and runs them in a sandbox.
The agent under test here is the DialogIQ backend; the simulated user is the
learner. It generates broad edge cases cheaply; it does not replace the exact
fixtures in section 9. Use it for G7 and for the held-out set, after the first
build passes G0 to G6.

## 11. Open decisions and things to re-check

1. Start from an empty repository, using the existing DialogIQ implementation only
   as an oracle to prove the suite (recommended, and it matches "software from
   specifications"), or let the factory extend the existing code. The event rules
   may decide this; check them when published.
2. Event rules, judging criteria, submission format, remote schedule: not
   published on 2026-11-12. Re-read the Luma page and the BAND hacker guide.
3. BAND Desktop is not set up yet and the Luma ticket is awaiting approval; the
   spec assumes Claude Code and Codex agents run through Desktop.
4. Budgets: set a ceiling per Builder and per run before the first factory run
   (suggested: 2 hours and a fixed dollar cap per Builder; the Integrator stops
   the run at the cap and reports what failed).
5. Whether the demo should show the factory run (room, handoffs, a blocked
   verdict, the mutation gate catching a bad build) as the main story. The hacker
   guide says judges look for meaningful use of BAND; this design puts the room on
   the critical path, which is the point.

## 12. Definition of done for the specification

- Every requirement names a check that exists, and the Test author's suite fails
  on an empty implementation for each of them.
- The suite passes on the existing DialogIQ implementation (the oracle) with the
  fake providers, or each difference is explained and fixed in the suite.
- Gate G6 mutations all fail the suite on the oracle.
- Pramodh has reviewed this document and the manifest of requirements.
