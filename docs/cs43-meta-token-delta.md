# CS-43 Meta token budget delta

Agent: Codex. 2026-11-01. Delta ID `s3-coach-r2.token-2048.1`.
Baseline: accepted [s3-coach-r2](cs45-coaching-contract.md) at
`a75a43b18071ef91c24fa5484cd6cea82dfcc6fe`.

## Adoption gate

This is a versioned, provider-only delta proposed on CS-43 after Muse's
feasibility run. It becomes effective only after Claude's independent H1
judgment, both affected owners' written approval of the exact delta, and Codex's
explicit adoption comment on CS-43. Until then, 2048 is an experimental candidate.
CS-45 remains delivered; no reopening or new implementation ownership is implied.

## Exact change

Replace the baseline's effective Meta coach `max_tokens=512` with
`max_tokens=2048`. This allowance includes provider reasoning and answer tokens;
it does not increase the permitted approach/example/reason string lengths.
The original 512 configuration remains historical evidence, not a viable live
configuration claim. No per-request public override is introduced.

Keep temperature0.3, max_retries0, nonstreaming Chat Completions, exact full-JSON
parse and no reasoning parameter. Keep8second whole-call deadline, fallback
chosen by10seconds and15second total client observation. Keep schema, selected
public context, two numbered attempts, immutable persistence, replay, fallback,
automatic eligibility and all frontend API fields unchanged.

This delta ID versions the provider configuration, not the wire DTO. Public
`contract_revision` and cache slots remain `s3-coach-r2`; clients need no
revision/schema change. Existing saved hints/fallbacks stay immutable; a second
explicit attempt uses the effective provider configuration at execution. Future
evidence must record both wire revision and effective provider delta ID. No
new configuration field is sent to the model or exposed in a public response.

## Evidence and limitations

Muse CS-C203: ten initial512-token calls yielded no valid content. CS-C209
corrected the diagnostic record: only one2048 diagnostic was confirmed to parse;
the earlier plural success claim was overstated and raw diagnostic text did not
survive. No cost multiplier or diagnostic quality verdict is independently adopted.

Muse's exact ten-call re-probe in CS-C210 used source63bc215, runtime override
2048, no other parameter changes and no retries. Nine parsed replies completed
inside8seconds; one N1 call timed out at8.312seconds. This meets the agreed
numerical threshold of at least9/10, with a narrow latency margin. Completed-call
usage was13,084 completion tokens including12,205 reasoning tokens; timed-out
usage is unknown. These are Muse-attributed results, not Codex reruns.

All five H1 replies were posted for Claude's separate injection judgment. Inline
punctuation was normalized and labelled; retain the original credential-free
JSON file for byte-exact evidence. No general output-secrecy, semantic-quality,
broader reliability, exactly-once billing or measured fallback-by10seconds proof
follows from this sample. The one timeout remains a reported failure, not omitted.

## Implementation handoff

Muse retains CS-43 backend ownership. After adoption, update the effective coach
constant and corresponding tests/probe defaults to2048, preserving explicit
candidate overrides for reproducible historical experiments. Record source
revision, parameter delta, elapsed time, finish_reason and token counts; attach
public inputs/raw content without credentials, headers or reasoning text.

Whole-call wall-clock and fallback timing still need mocked/real-HTTP proof,
including slow/trickled response and late-worker rejection. The distinct second
hint requirement accepted in CS-C196/197 remains required: one system prompt
avoids repeating/rephrasing previous approaches; live N1 evidence compares first
and explicitly requested second approaches.

Claude's DTO/mock/UI work can continue; real service acceptance still waits for
Muse's published backend readiness. Reserve8080/5173 between verifier owners.
If2048 later misses the agreed timing or structured-output behavior, record the
failure and review a separate delta. No longer deadline, reasoning control,
fallback relaxation, extra paid probe, integration merge or main promotion is
authorized by this document itself.
