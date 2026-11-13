# Sprint practices and the listening checklist

From the Sprint 6 retrospective (Megillah CS-103, 2026-11-13). Sprint 6 built
the voice rep. Tests passed on fakes while real use found most of the defects:
a 0.7 s end-of-turn wait that split turns, a clipped opening line, a stale hint,
an unreadable "why", and a keyword judge that capped Bob's needs at 2 of 7. The
rules below exist so Sprint 7 finds those problems before the user does.

## Rules

1. **A voice task is not delivered until the listening checklist below has been
   run by a person** on a real device and its result is in the delivery comment.
   Passing tests are not enough. A task whose Done line is not met is not
   delivered; say what is missing in a comment and leave it open.
2. **Paid calls carry a ledger.** Every paid-call plan comment says
   planned / used / remaining, and each later comment updates it. When used
   reaches planned, stop and post a revised plan before spending more.
3. **Say the trade-off.** When choosing a cheaper, faster or simpler option over
   a better one (for example a keyword judge instead of a meaning judge), tell
   the product owner in plain words what is given up, in chat and in the task.
4. **Merge in small steps.** Do not merge stacked large PRs within minutes of
   each other. Leave a soak period (a real session on `dev`) before `dev` goes to
   `main`. Fix a fault with a reproduction test, not only a workaround.
5. **Test the faults, not only the happy path.** Before a feature meets a real
   provider, a fake that fails (503, stalled stream, database lock, slow reply)
   must have a test.
6. **Focus.** While a launch-blocker task is open, do not start hackathon or
   backlog work unless the product owner directs it.
7. **Do not edit the build the owner is testing.** The dev server reloads the
   page and breaks a running rep. Say first, or work in another worktree and
   port.
8. **Journal as you go,** at each milestone, not after.

## Listening checklist (about 10 minutes, real device, Edge, headset on)

Run it on the build being delivered. Record each line pass or fail with a few
words in the delivery comment. Run it again after any change to timing, audio,
the judge or the coach.

| # | Check | Pass when |
| --- | --- | --- |
| 1 | Start the rep three times in a row. | You hear the whole opening line each time, from the first word. |
| 2 | Say a sentence, pause about one second mid-thought, then finish it. | It stays one turn; Bob does not start during the pause. |
| 3 | Ask a closed question ("did you send the update?"). | A coach whisper appears within about two seconds and you notice it without hunting. |
| 4 | Talk over Bob for a second. | You get the interruption whisper, and not when Bob started first. |
| 5 | Ask for a hint, twice. | A spinner shows while it loads; the old hint is not shown; the explanation reads clearly before the line to say. |
| 6 | Ask three open questions without trigger words ("what has the quarter been like?"). | Bob's disclosures count; needs unlock on meaning. |
| 7 | Let someone with a different voice try (a child, or someone with an accent). | Recognition mostly gets the words, and the rep is usable. |
| 8 | Finish the rep. | The scorecard and the whisper and reply timing appear; the rep says which judge scored it. |
| 9 | Look at the timing card. | No reply is slower than five seconds. If one is, note which turn. |

## Metrics to watch

- **Needs unlocked per rep.** If it stays at 2 or fewer across several reps, the
  judge or Bob is wrong, not the learner.
- **Whisper timing:** at least 90% within two seconds (the launch blocker).
- **Reply time:** last word to Bob's voice, and its slowest turn.
- **Paid calls per rep** and cost per rep, against the $200 budget.
