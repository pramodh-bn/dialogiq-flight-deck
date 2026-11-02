# Dash-separated coaching questions

Owner: Codex. Task: CS-71. Candidate ruleset: `s2-r2.2`.

This is a narrow parser candidate for review. Adoption is recorded explicitly
on CS-71 before integration; this file does not itself grant approval. It does
not change the coaching wire contract `s3-coach-r2`, model settings, endpoints,
ports, need facts or reveal stems.

## Observed failure

In the user's Bob walkthrough, acknowledgment plus a question separated by an
ASCII hyphen or em dash was classified as a statement. For example,
`Makes sense ... — what is making that hardest right now?` was not credited
as an open question. The same question after a period is recognized.

The current public classifier splits at `. ! ? , ; :`, but not at dashes.
This proposal addresses that syntax mismatch, not semantic understanding or
the separate empathy false positive in CS-72.

## Exact delta

- `s2-r2.2` keeps the `s2-r2.1` normalization, filler handling, prefix rules,
  whole-turn leading detection, empathy heuristic, reveal stems, one-reveal
  limit, resistance thresholds and metrics.
- Split segments additionally at U+2013 en dash and U+2014 em dash, whether or
  not surrounded by spaces. Split an ASCII `-` or `--` only when surrounded
  by whitespace after normalization. Do not split compound words such as
  `what-if`, `how-to` or `follow-up`.
- Classification still uses open-before-closed precedence across all segments.
  A leading/blaming phrase anywhere in the normalized whole turn still makes
  the turn ineligible, even when a later segment is an open question.
- Accept the explicit revision `s2-r2.2`; use it as the default for fresh seed
  catalogs. Preserve both supported old revisions byte-for-behavior. In
  particular, `s2-r2.1` must not regain the old `next`/`first` reveal stems
  when the default constant changes.

## Existing data and availability

Session snapshots remain immutable. Existing `s2-r2` and `s2-r2.1` sessions,
replays, branches and committed feedback retain their original rules. There
is no retroactive reclassification or rescoring.

The existing seed policy also preserves complete catalog entries. Merely
restarting an existing database does not upgrade its catalog or its new
sessions. A fresh verification/demo database seeds `s2-r2.2`. Any later
upgrade of an existing catalog needs a separately explicit revision update;
it is not hidden in this parser patch. The user's current walkthrough stays
running on its existing source, database and pinned rules.

## Verification

Check the three actual Bob examples, independently phrased natural and hostile
review cases, closed questions, open precedence, compound hyphens, both legacy
revisions, the historical reference fixtures and fresh/pinned-session API
behavior. Provider mocks prove wiring only. Correct-port real-server/client
verification on disposable data is required before delivery, coordinated with
the user's held 8080/5173 ports. Do not stop the user's walkthrough to run it.

Isolated verification may use `127.0.0.2:8080` and `127.0.0.2:5173`, while the
user's app retains `127.0.0.1:8080/5173`. Both servers must bind their specific
loopback addresses, with the verification frontend compiled against the matching
API origin and that origin explicitly allowed by the verification backend.
This is a test-only binding, not a product default or an additional route.

The broader lexical progression limitation remains: a semantically relevant
open question can still lack a configured reveal stem. This proposal does not
teach hidden scoring keywords to the coach or claim to measure trust.
