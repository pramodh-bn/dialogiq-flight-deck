# CS-40 combined browser evidence (Claude)

Run 2026-10-30 by Claude at Codex's request (CS-C170), authorized by the user. No source, server, database or config was changed.

## What was tested
Source: D:/Workspace/meta-hackathon/dialogiq-flight-deck/.worktrees/cs40, branch codex/cs40-integration, HEAD 4baa28d, clean tree. Contains 881e1c1 and 2824542 (git merge-base --is-ancestor passed for both).
Frontend: Codex's server on 5173. Process 11444 runs vite from .worktrees/cs40. Served /src/lib/api/index.ts has VITE_API_BASE_URL=http://127.0.0.1:8080, which selects createHttpApi, so the mock is off. Served classify.ts is r2.1.
Backend: Codex's production server on 127.0.0.1:8080, healthy; CS-40 database, existing sessions left in place.
Browser: headless Edge 1400x900 over CDP, own temporary profile, on port 9334.

## Result
47/47 checks, 0 console errors or exceptions. 14 turn POSTs, all to http://127.0.0.1:8080/api/chat/turn: 3 answered by browser injection, 11 reached the server, of which 1 was the deliberate stale resend rejected with 409. So about 10 live model calls. Replies differed from the earlier run and matched each persona, which fits a live provider and not a fixture; the harness did not separately inspect the server's provider setting.

## Real server and live model
- Hub: 4 API scenarios, demo surfaces labelled.
- Persona and opening correct for Maya, Bob, Dana, Priya.
- Double click made one session; double Enter sent one POST.
- Meter matched server score; closed turn did not score; closed coaching shown.
- Arena reload kept transcript and score; recorder reload kept the tree.
- Tree and node panel: opening plus real turns, branch count, selected-branch score.
- Rewind to this node on turn 2 excluded it and later turns; alternate continuation scored on its own branch (2/7).
- Original branch kept its own score (2/7); Resume this branch restored all 3 turns and the score.
- Branch from here kept the chosen turn; server tree had 3 branches.
- Hub Resume and tree links used the real session (id 4), card showed its score.
- Leaving the Arena mid-turn: turn committed, reply present on return.
- Real 409: session changed through a free API createBranch call behind an open Arena; message shown, draft restored, resend committed on the current branch, warning cleared.
- Unknown session shows Session not found.
- No hidden_need, system_prompt or persona_traits in Bob's session, tree or scenario responses.

## Browser-injected, not provider failures
504 persona_timeout, connection failure and 503 persona_unavailable were replaced in the browser only. Each showed the right message, restored the draft and added no phantom turn; all 4 attempts shared one idempotency key and one turn committed.

## Not covered here
- Bob ran 2 turns only, to limit paid calls. The good-run and closed-only proofs are Codex's demo_run.py results, not this run. A full 7/7 browser run was only done on the pre-merge source (CS-A28).
- Real provider outage or timeout behaviour.
- Vite dev server only, no production build served. Headless Edge only.
- Adversarial leakage of hidden needs in model replies was not tested.
