# DialogIQ V3 build plan

Status: proposed by Claude on 2026-11-11 for the project owner's review
(Megillah CS-86, Track CS-T10). It turns the product plan
(`dialogiq-v3-plan.md`, attached to CS-T10) into work that can start now. The
product plan's pilot gate was removed by the owner on 2026-11-11; recruiting
runs alongside the build.

## What V3 is

A 3-minute spoken practice rep with Bob. The learner talks, Bob answers in
voice, a coach whispers during the rep, and the rep ends with a scorecard
computed from timing and transcript by fixed rules. The text Arena from V2
stays as it is; V3 is a new route beside it.

## What we measured before planning

Read-only model listings and two small streaming probes on 2026-11-11
(26 calls in total, plus 7 Meta API calls; scripts and raw results are in
[`scripts/v3/`](../../scripts/v3/) and [`evidence/`](evidence/)). These are
small, unmatched samples on a short synthetic prompt. They show what is
feasible; they are not reliability figures.

| Finding | Detail |
| --- | --- |
| Bob's current host is switched off | Baseten `meta-models/muse-spark-open-1026` returned HTTP 400, "Model version wpgy40e is deactivated", on 8 of 8 calls. The V2 app's Bob cannot reply until the persona moves to another provider. |
| Muse Spark Open works on Fireworks, slowly for voice | Low reasoning, streaming: first full sentence after 2.2 s, 3.3 s and 3.5 s. Reasoning text arrives from about 0.4 s; the spoken answer waits behind it. |
| A fast model is available on the same account | Fireworks `gpt-oss-120b`, low reasoning: first full sentence after 0.6 to 0.8 s in 3 calls. One of those streams ended with a provider error after 81 characters. |
| Other candidates | Fireworks `glm-5p3-fast`: 2.2 to 3.2 s to first sentence. Baseten `DeepSeek-V4.1-Flash-Fast`: HTTP 403 on this key. |
| Meta API chat models (7 calls, later the same day) | `muse-spark-1.3`: first sentence after 6.3 and 6.7 s. `muse-wonder-1.0`: 3.3 and 4.1 s. `muse-spark-1.1`: 3.8 s once, then HTTP 402. `muse-ember-1.0`: HTTP 402 `billing_not_configured`. The account answers some calls again but its billing issue is not fully resolved. |
| Speech models | The Meta API account lists `muse-voice-transcribe-1.0`. Neither Fireworks nor Baseten lists a speech-to-text or text-to-speech model in its chat catalogue. The transcribe model itself has not been called. |

Consequence: the risk in V3 is Bob's reply delay as much as the coach's. A
natural spoken exchange needs Bob to start talking about a second after the
learner stops. Muse Spark Open at 2 to 3.5 s plus speech detection and
synthesis would leave gaps of 3 to 5 s.

## Design

### One timeline of events is the source of truth

Every rep is recorded as timed events on one clock that starts when the rep
starts: learner speech start and end, Bob audio start and end, final
transcript segments, whispers shown, rewinds. The scorecard is a pure function
of those events and the conversation tree. That makes it deterministic,
unit-testable from synthetic timelines, and recomputable later.

Timing does not come from the speech-to-text service. Learner timing comes
from voice activity detection on the microphone in the browser. Bob's timing
comes from the audio player, which knows exactly when his speech starts and
stops.

### Voice loop

```
mic -> voice activity detection (browser) -> speech events
    -> speech-to-text (interim and final text)
    -> POST turn -> Bob reply streamed sentence by sentence
    -> text-to-speech per sentence -> audio out -> Bob speech events
```

- **Speech-to-text** sits behind a small `Transcriber` interface. The first
  implementation is the browser's built-in speech recognition (Chrome and
  Edge): no key, no cost, interim results. Its limits: audio goes to the
  browser vendor's service, and Firefox is unsupported. The second
  implementation is `muse-voice-transcribe-1.0` through the backend, once a
  single test call shows the Meta account works again and what the API accepts.
- **Text-to-speech** sits behind a `Speaker` interface. First: the browser's
  speech synthesis, which starts instantly and costs nothing. Then: Kokoro,
  the local voice model already used for the submission video, served by the
  backend one sentence at a time. Kokoro's speed on this machine is unmeasured.
- **Modal as the hosted option for speech.** The owner has about $30 of Modal
  credit. If browser speech recognition or browser voices are not good enough,
  or pilot managers need the app without the owner's machine, an open
  speech-to-text model and Kokoro can run on Modal behind the same two
  interfaces. Risks to measure first: cold-start delay on the first request
  and how many reps $30 covers. Nothing is deployed there until the browser
  and local options have been tried.
- **Bob's reply** streams from the backend as server-sent events, one sentence
  per event, so speech can start on the first sentence. Session and tree calls
  stay on the existing REST contract.
- **Bob's model** is selected by configuration (`V3_PERSONA_PROVIDER`,
  `V3_PERSONA_MODEL`). Recommended default for voice: Fireworks
  `gpt-oss-120b`. Muse Spark Open stays selectable. See "Decisions needed".
- **Speaking over Bob**: if the learner starts talking while Bob's audio is
  playing, Bob stops and the event is logged as an interruption. The mic runs
  with echo cancellation and the rep screen asks for headphones; whether Bob's
  own audio falsely triggers detection on speakers is tested in week 1.
- **Audio stays in the browser.** Learner audio is kept in memory for the
  rewind comparison and is not uploaded or stored on the server. Transcript,
  timing events and scores are stored.

### Coach whisper in two tiers

The 2-second target is met by not putting a model on the critical path.

1. **Rule whispers (instant).** Fixed lines triggered by events, shown on
   screen within the same animation frame as the trigger:
   - closed question detected: "That was a closed question. Try a meaning question."
   - interruption: "You interrupted. Pause 2 seconds."
   - no pause after a deflection: "He deflected. Wait before you push."
   - blame or leading phrase: "That assumed the answer. Ask how he sees it."
   - learner talking for more than 30 s without a question: "Hand it back with a question."
   At most one whisper every 8 s, so the learner is not flooded.
2. **Suggested line (model, off the critical path).** After two deflections
   in a row, or when the learner asks, a separate coach call streams one short
   "try saying" line. It uses the fast model, sees only the public dialogue,
   and never sees hidden needs, as in V2. Target: first words visible in under
   2 s; if it misses, the rule whisper has already covered the moment.

Whispers are visual by default (a line at the edge of the rep screen with a
soft tone). A spoken whisper would talk over Bob.

Launch blocker, measured in the client and logged per rep: 90% of whispers
visible within 2 s of their trigger.

### Scorecard, ruleset `v3-score-r1`

All rules are fixed and versioned. A rep keeps the ruleset it was scored with.

| Measure | Definition |
| --- | --- |
| Talk ratio | Learner speech time divided by learner plus Bob speech time, from speech events. |
| Question counts | Each learner utterance is classified closed, open or statement by its opening words, using the existing judge rules (they do not depend on punctuation, which speech-to-text often drops). A **meaning question** is an open question that also asks about Bob's experience: it contains a meaning stem (hard, difficult, feel, worry, impact, matter, important, need, support, help) or "for you" / "to you". |
| Pause after deflection | A Bob reply is a deflection when it revealed no new need and his stance after it is guarded (both from the existing deterministic judge and stance rules). The pause is the gap from the end of Bob's audio to the learner's next speech start. Reported as the median gap and "waited at least 2 s" in N of M deflections. |
| Interruptions | Learner speech starting while Bob's audio is playing and overlapping it for at least 500 ms (shorter overlaps are treated as "mm-hm"). |
| Rewind recovery | For each rewound turn, the retry counts as recovered when it revealed a need or moved Bob's stance up where the original attempt did not. Reported as recovered in N of M rewinds. |

V3 reps pin the deterministic judge and the rule-based stance ledger. The
opt-in semantic feedback from V2 is a model's judgment and is not used for the
scorecard.

Known weakness to accept or revisit: these rules are lexical. They will miss
some good questions and credit some poor ones, as the V2 README already
documents. Fixtures of natural and adversarial spoken lines are written
before the classifier changes, with held-out cases kept back.

### Data model

Additive migration, no change to existing tables or sessions:

- `voice_reps`: session, start time, duration, ruleset revision, provider and
  model names, final scorecard.
- `voice_events`: rep, milliseconds from rep start, kind, speaker, payload.

A rep belongs to a normal session, so turns, branches and rewind reuse the V2
tree. Reps are numbered per user and scenario, which gives the "rep 1 to rep
9" trend the pilot measures.

### API additions (to be written into `docs/api_contract.md` first)

| Call | Purpose |
| --- | --- |
| `POST /api/v3/reps` | Start a rep on a new session for a scenario. |
| `POST /api/v3/reps/{id}/turns` | Send one final learner utterance with its timing; returns Bob's reply as a sentence stream. |
| `POST /api/v3/reps/{id}/events` | Append timing events in batches. |
| `POST /api/v3/reps/{id}/coach` | Stream one suggested line. |
| `POST /api/v3/reps/{id}/rewind` | Branch from an earlier turn. |
| `POST /api/v3/reps/{id}/finish` | Close the rep and return the scorecard. |
| `GET /api/v3/reps?scenario=` | Rep history and scorecards for the trend view. |
| `POST /api/v3/tts` | Kokoro audio for one sentence (only if Kokoro is adopted). |

Ports stay 8080 for the backend and 5173 for the frontend.

### What is reused from V2

Bob's persona brief and stance behaviour, the deterministic judge and stance
ledger, the conversation tree with branches and rewind, the idempotent turn
handling, the coach's public-only context boundary, the launcher and the test
setup.

## Build order

Each step ends with something the owner can try. The numbers map to the
Megillah tasks.

**Step 0, before the voice loop (new, small)**
- Move the persona to a working provider behind configuration and add a
  streaming reply path. This also repairs Bob in the V2 app.
- Write the V3 section of `docs/api_contract.md` and the `v3-score-r1`
  fixtures.

**Step 1, voice loop (CS-87)**
- Rep screen at `/rep`: mic permission, headphone prompt, 3-minute timer.
- Voice activity detection, browser speech-to-text, sentence-streamed Bob,
  browser speech synthesis, speaking over Bob.
- Events stored; transcript shown after the rep.
- Done when a full spoken 3-minute rep works through the real client and the
  logged gap from learner speech end to Bob audio start has a median under
  1.5 s on the chosen model.
- Then measure Kokoro and adopt it if a sentence is ready in under 0.5 s.

**Step 2, whisper and scorecard (CS-88)**
- Scorecard function with fixture tests, then the end-of-rep scorecard screen.
- Rule whispers, then the suggested-line call.
- Whisper latency logged; the 2-second blocker checked on real reps.

**Step 3, rewind in voice (CS-89)**
- "Go back to the stall" from the rep or the scorecard, re-say the line, hear
  the original attempt and the retry side by side.
- Rewind recovery added to the scorecard.

**Step 4, pilot readiness and pilot (CS-90, needs CS-85 recruits)**
- Rep history with the rep 1 to rep 9 trend.
- A way for pilot managers to reach the app. V2 is local and single-user, so
  this needs a decision: supervised sessions on the owner's machine, a
  tunnel, or a small hosted deployment with per-person links.
- Second and third authored scenarios only if the pilot needs them.

## Verification

- **Scorecard**: unit tests on synthetic event timelines, one per rule and
  edge (overlap of 499 ms and 500 ms, a 1.9 s and a 2.0 s pause, and so on).
- **Voice loop, reproducible**: Playwright with Chrome's fake microphone fed
  from recorded WAV files, against the real backend on 8080 and frontend on
  5173 with a disposable database. This gives the same spoken input on every
  run.
- **Live**: a finite call plan posted to Megillah before each paid batch, with
  elapsed times, finish reasons and call totals recorded.
- **Owner walkthrough** after each step. Agent-run checks are not learner
  acceptance.

## Cost

Speech-to-text and speech synthesis cost nothing in the first implementations
(browser and local). Modal credit (about $30) is the reserve for hosted
speech models or pilot hosting; Fireworks credit covers Bob and the coach. Model cost is Bob's replies and the occasional suggested
line: roughly 15 to 25 short calls per rep. The cost per rep in dollars is not
known yet; week 1 logs token usage per rep so it can be set against the $200
budget before the pilot.

## Unknowns

- Whether the Meta API account works again, and the request format of
  `muse-voice-transcribe-1.0`. One test call settles both.
- Bob's reply delay with the full persona prompt and conversation history;
  the probe used a two-line prompt.
- How well browser speech recognition handles the learner's accent and how
  long it takes to finalize an utterance.
- Whether echo cancellation is enough without headphones.
- Kokoro's synthesis speed on this machine.
- Whether `gpt-oss-120b` plays Bob as believably as Muse Spark Open did. This
  needs a side-by-side on the Sprint 4 Bob cases.
- How pilot managers will reach the app (see Step 4).
- The product plan cites "the retrospective" for its three tests (timing,
  live coaching in character, voice rewind). The tests are stated in the plan,
  but that retrospective document was not found in the workspace.

## Decisions needed from the owner

1. **Bob's model for voice.** Recommended: build it switchable, default to
   Fireworks `gpt-oss-120b` for speed, and compare it against Muse Spark Open
   on the Bob cases in Step 0. The alternative is to keep Muse Spark Open and
   accept gaps of several seconds, which undercuts live voice.
2. **Browser speech recognition for the build phase.** Recommended: yes, with
   the Meta transcribe model as the second implementation. The catch is that
   learner audio goes to Google or Microsoft through the browser.
3. **Whisper as text with a soft tone.** Recommended over a spoken whisper.
4. **Who builds.** Recommended: Claude builds Steps 0 to 3 in task worktrees
   with draft pull requests into `dev`; Codex reviews and integrates if
   available, otherwise the owner approves merges.
