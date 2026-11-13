# V3 voice rep contract

Status: draft `v3-r1`, written by Claude on 2026-11-11 (Megillah CS-91) before
the voice loop is built. It extends [`api_contract.md`](../api_contract.md);
everything there (ports, idempotency, error envelope, session and tree shapes)
still applies.

Implemented so far (CS-87, `backend/v3_reps.py`): create, streamed turn,
events, finish and list. Not yet implemented: `/coach` (CS-88) and `/rewind`
(CS-89); until then a retry uses the existing branch route.

## Scope

A voice rep is one timed spoken practice on a normal session. The existing
session, branch and node model stores the dialogue. Two new tables store the
rep and its timing events. Existing sessions and routes are unchanged.

Ports: backend 8080, frontend 5173. The rep screen is the route `/rep`.

## Clock

All times are integer milliseconds since the rep started, measured by the
browser with a monotonic clock (`performance.now()` minus the value at start).
The server never substitutes its own time for an event time.

## Events

The browser records events and posts them in batches. Each event is

```json
{ "seq": 12, "t_ms": 41350, "kind": "learner_speech_start" }
```

`seq` increases by one per event within a rep; the server ignores a `seq` it
already holds, so a batch can be resent safely.

| Kind | Extra fields | Meaning |
| --- | --- | --- |
| `learner_speech_start` | | Voice activity detection decided the learner started speaking. |
| `learner_speech_end` | | The learner stopped speaking. |
| `bob_audio_start` | `node_id` | Bob's audio for that turn began playing. |
| `bob_audio_end` | `node_id`, `interrupted` | Bob's audio stopped. `interrupted` is true when the client cut it because the learner spoke over him. |
| `whisper_shown` | `rule`, `trigger_ms` | A coach whisper became visible. `trigger_ms` is when its trigger happened. |
| `suggestion_shown` | `trigger_ms` | The first words of a model-written suggested line became visible. |

Speaking over Bob: the client stops Bob's audio once the learner has spoken
continuously for 500 ms while it was playing. Shorter sounds do not stop him.

## Endpoints

All bodies are JSON. Errors use the existing envelope and codes. Mutating calls
take an `Idempotency-Key` header like the existing ones, except the streamed
turn, which is described below.

### `POST /api/v3/reps`

Request: `{ "scenario_id": 2 }`. Creates a session pinned to `s4-bob-r1` with
the deterministic judge and the rule-based stance ledger (never
`semantic-r1`), and a rep on it.

Response `201`:

```json
{
  "rep_id": 7,
  "rep_number": 3,
  "session": { "...": "SessionResponse" },
  "duration_limit_ms": 180000,
  "score_ruleset": "v3-score-r1",
  "whisper_ruleset": "v3-whisper-r1",
  "opening_message": "You wanted to see me? If this is about Q3, I already sent the update."
}
```

`rep_number` counts this user's reps on this scenario, starting at 1.

### `POST /api/v3/reps/{rep_id}/turns`

Request:

```json
{
  "branch_id": 9,
  "parent_node_id": 31,
  "expected_revision": 4,
  "user_message": "what's been making delivery harder",
  "speech_start_ms": 38200,
  "speech_end_ms": 40900
}
```

`user_message` is the final transcript of one learner utterance. Response is
`text/event-stream`:

```
event: sentence
data: {"index": 0, "text": "It's all in the report."}

event: sentence
data: {"index": 1, "text": "Design changed three times."}

event: done
data: {"node": { "...": "NodeResponse" }, "session": { "...": "SessionResponse" }, "turn": {"question_type": "open", "leading": false, "meaning": true, "deflection": true}}
```

The turn is saved once, after the model finishes, with the same checks as
`POST /api/chat/turn`. If the provider fails before any sentence, the response
is the normal JSON error (`persona_unavailable`, `persona_timeout`,
`persona_invalid_response`) and nothing is saved. If it fails after at least
one sentence, the stream ends with

```
event: error
data: {"code": "persona_unavailable", "retryable": true}
```

and nothing is saved; the client discards the partial reply and may resend.
A resend with the same `Idempotency-Key` after a saved turn replays the saved
reply as a stream. A failure while saving (for example `stale_revision`) also
ends the stream with `event: error` and that code. Bob's saved text is the
sentences joined by single spaces. `speech_start_ms` and `speech_end_ms` are
checked (0 to 600000, end not before start) but not stored; timing comes from
the event log. A turn on a finished rep returns `409 rep_finished`.

### `POST /api/v3/reps/{rep_id}/events`

Request: `{ "events": [ ... ] }`, 1 to 200 per call. Response `200`:
`{ "accepted": 14, "last_seq": 57 }`. One malformed event rejects the whole
batch with `422`. `t_ms` and `trigger_ms` are 0 to 600000. Events for a
finished rep return `409 rep_finished`.

### `POST /api/v3/reps/{rep_id}/coach`

Request: `{ "branch_id": 9, "head_node_id": 33, "trigger_ms": 61200 }`.
Streams one suggested line as `event: text` chunks then `event: done`. The
coach call receives only the public dialogue of the selected branch, as in V2.
It never receives needs, the private brief or the stance ledger.

### `POST /api/v3/reps/{rep_id}/rewind`

Request: `{ "from_node_id": 31, "expected_revision": 6 }`. Creates and selects
a branch forked at the parent of `from_node_id`, so the next turn is a retry of
that turn. Response: `{ "branch": BranchResponse, "session": SessionResponse }`.

### `POST /api/v3/reps/{rep_id}/finish`

Request: `{ "duration_ms": 180000 }`. Computes and stores the scorecard from
the stored events and nodes. Response: `{ "rep": RepResponse }`. Finishing
twice returns the stored result. Rewind pairs are read from the tree: turns
that share a parent are attempts at the same moment, the first being the
original.

### `GET /api/v3/reps?scenario_id=2`

Returns `RepResponse[]` oldest first, for the rep 1 to rep 9 trend.

### `RepResponse`

```json
{
  "rep_id": 7,
  "rep_number": 3,
  "session_id": 41,
  "scenario_id": 2,
  "started_at": "2026-11-12T15:04:05Z",
  "duration_ms": 180000,
  "finished": true,
  "score_ruleset": "v3-score-r1",
  "scorecard": { "...": "Scorecard, null until finished" },
  "latency": [
    {
      "node_id": 88,
      "model_first_sentence_ms": 640,
      "model_total_ms": 1480,
      "voice_round_trip_ms": 1650
    }
  ]
}
```

`latency` has one row per saved turn, oldest first, and is filled in as turns
are saved, before the rep is finished. It is a measurement, not part of the
scorecard.

- `model_first_sentence_ms` and `model_total_ms` are timed by the server, from
  asking Bob's model to its first complete sentence and to the end of its
  reply. A replayed turn keeps the times of its first run.
- `voice_round_trip_ms` is the first `bob_audio_start` event for that node
  minus the turn's `speech_end_ms`, both on the browser's clock. It includes
  the client's end-of-turn wait. It is `null` when that audio never started,
  its event was not logged, or the difference is negative.

## Scorecard, ruleset `v3-score-r1`

Implemented as a pure function in `backend/v3_score.py`. Fixtures:
[`score-fixtures.json`](score-fixtures.json).

```json
{
  "ruleset": "v3-score-r1",
  "talk": { "learner_ms": 61000, "bob_ms": 74000, "learner_ratio": 0.45 },
  "questions": { "closed": 2, "open": 5, "meaning": 3, "statements": 4 },
  "pause_after_deflection": { "deflections": 4, "waited": 1, "median_gap_ms": 900 },
  "interruptions": 2,
  "rewind_recovery": { "rewinds": 1, "recovered": 1 }
}
```

### Talk

`learner_ms` is the summed length of learner speech segments
(`learner_speech_start` to the next `learner_speech_end`); `bob_ms` is the
summed length of Bob audio segments. Overlapping time counts for both. A
segment with no end is closed at the rep's `duration_ms`.
`learner_ratio = learner_ms / (learner_ms + bob_ms)`, rounded to two decimals,
or `null` when both are zero.

### Questions

Each learner turn is classified from its transcript by
`v3_score.classify_spoken`: `open`, `closed` or `statement`, plus `leading`.
It uses the Sprint 2 judge's word lists (opening words, fillers, and the
`leading` rule of `s2-r2.3-bob`) and reads the opening words of each clause,
so it does not depend on a question mark. Two steps are added for speech:

- written-down hesitation sounds (`um`, `uh`, `erm`, `er`, `hm`, `mm`) are
  removed before anything else;
- every leading filler in a clause is removed, not only the first, so
  "okay so um what do you need" is `open`.

The result names its rules as `v3-score-r1/s2-r2.3-bob`.

A turn is a **meaning question** when all three hold:

1. it is `open`;
2. it is not `leading`;
3. it contains a meaning stem as the start of a word (`hard`, `difficult`,
   `challeng`, `struggl`, `tough`, `feel`, `felt`, `worr`, `impact`, `affect`,
   `matter`, `important`, `need`, `support`, `help`), or one of the phrases
   `for you`, `to you`, `from your side`, `on your side`.

`open` counts every open turn, including meaning questions. `meaning` is the
subset. `closed` and `statements` count the other two types.

Only turns on the rep's selected branch at finish are counted, plus nothing
from abandoned branches.

### Pause after deflection

Bob's reply on a turn is a **deflection** when that turn revealed no new need
and Bob's stance after it is `guarded`. Both come from the deterministic judge
and stance ledger stored on the node.

For each deflection on the selected branch, find the first
`learner_speech_start` at or after that turn's `bob_audio_start`. If there is
none (the rep ended), the deflection is not counted.
`gap_ms = max(0, learner_speech_start - bob_audio_end)`; starting before Bob
finished gives 0. The learner **waited** when `gap_ms >= 2000`.

`deflections` is the number counted, `waited` the number with a wait, and
`median_gap_ms` the median gap (mean of the middle two for an even count,
rounded half up to an integer), or `null` when none were counted.

### Interruptions

A learner speech segment is an interruption when it starts strictly after a
Bob audio segment starts and before that segment ends, and
`min(learner_end, bob_end) - learner_start >= 500`.

### Rewind recovery

A rewind pairs an original turn with a retry turn that has the same parent.
The retry **recovered** when it revealed a new need and the original did not,
or when Bob's stance after the retry is higher than after the original
(`guarded` < `warming` < `open`). When a turn is retried more than once, each
retry is compared with the first attempt.

## Whisper rules, ruleset `v3-whisper-r1`

Evaluated in the browser so they appear without a network call. At most one
whisper is shown in any 8-second window; a suppressed whisper is dropped, not
queued.

| Rule | Trigger | Text |
| --- | --- | --- |
| `closed_question` | A final learner transcript classifies as `closed`. | That was a closed question. Try a meaning question. |
| `leading` | A final learner transcript classifies as `leading`. | That assumed the answer. Ask how he sees it. |
| `interruption` | The client cuts Bob's audio because the learner spoke over him. | You interrupted. Pause 2 seconds. |
| `no_pause` | The learner starts speaking less than 2000 ms after the end of a deflection reply. | He deflected. Wait before you push. |
| `monologue` | Learner speech segments since Bob last spoke add up to 30000 ms with no `open` or `closed` turn among them. | Hand it back with a question. |

When `leading` and `closed_question` both apply, `leading` is shown.

Launch blocker: across the reps of a verification run, at least 90% of
`whisper_shown` events have `t_ms - trigger_ms <= 2000`.

## Privacy

Learner audio is not sent to the DialogIQ backend and is not stored. The
backend stores transcripts, timing events and scores. With browser speech
recognition, the browser vendor's service receives the audio; the rep screen
says so before the first rep.

## Known limits accepted in `v3-r1`

- The question rules are lexical. A good question that opens with "where",
  "when", "who" or "which" is not counted as open, and wording alone decides
  what counts as a meaning question.
- The stance ledger's "respecting a pause" rule checks for a question mark,
  which speech recognition may omit or add.
- Timing depends on the browser's voice activity detection; its thresholds are
  part of the client and are recorded with each rep once chosen.
