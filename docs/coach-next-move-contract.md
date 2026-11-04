# CS-81 concise next-move coaching

User approved implementation Nov3. This is a narrow prompt/presentation change,
stacked on PR48. Codex owns the change; owner learner review remains outstanding.

## Accepted implementation boundary

New Bob sessions with `behavior_revision=s4-bob-r1` pin the internal
`coach_prompt_revision=bob-next-move-r1` only when the server environment has
`COACH_NEXT_MOVE_ENABLED=1`. Existing sessions, saved hints and other personas
retain their prompt behavior. Flag changes never rewrite session configuration.
The coach receives neither this private config nor grader data. Session-create
and hint request/response DTOs stay unchanged; `s3-coach-r2` names the response
contract, not the prompt version. No DB migration is needed.

The provider still receives selected-branch public dialogue (latest six turns,
existing string bounds), opening/public situation and current-head previous
hints. No scores, hidden needs, classifier tags, private motives, other branches
or model reasoning. Fireworks stays the coach provider, Meta only the existing
configuration alternative. Temperature/token/timeout/retry/fallback/lease/cache
behavior is unchanged. API8080/frontend5173 and routes remain unchanged.

## Behavior delta

Choose an unresolved concern or latest request; avoid asking the same answered
question in new words. Prefer one short speakable line (normally under35words),
one move label and a short dialogue-grounded reason. No mandatory reflection
prefix or question. Reflect specific concerns when useful; respond to direct
requests, make bounded offers, clarify actual ambiguity, or accept a pause.
An unclear learner interjection does not establish fault, confusion in Bob, or
a need to apologize. Prior hints are suggestions, never conversational events.
Preserve who owns each concern and whether an action is offered, planned or
complete. Do not infer temporal/causal order from two separate facts.
Alternative hints may keep the same necessary move in fresh words when another
move would avoid a request or violate a boundary; useful variety is preferred
over superficial variation. Do not teach scoring cues or promise progress.

UI presents `example` as “Try saying”, followed by the existing approach and
reason as secondary text. Stored examples render as text, never HTML. No schema
change or automatic sending. Existing copy/paste remains possible.

## Evidence and acceptance

Before editing prompts, author natural/adversarial development cases and reserve
separate evaluation cases. They are not independently authored or sealed cases;
historic U1–U4 remain outside this work. Judge whether the move fits the reply,
avoids repetition/invention, honors boundaries and authority, and is usable.
Scores and Bob's verbosity alone do not establish learner benefit.

Run mocked/session-pinning/privacy/HTTP checks and live first/chained second
hints, including actual suggestion-to-persona follow-through. Preserve public
synthetic dialogue beside source/session/head/attempt and paid-call telemetry.
Keep failed runs and latency separate from quality judgments. Production client
and real API checks are required; unavailable browser automation is reported.
Final acceptance: owner tries a fresh Bob conversation using only in-app hints.
