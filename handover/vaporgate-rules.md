# vaporgate operating rules (OSG track)

Source: dell on Alice's request, 2026-09-27. Why: Alice wants useful work in
branches, no blocking questions, and main untouched.

## Branches
- Never push to main, never merge anything, never use --admin.
- Work only on own branches `vg/<topic>` cut from origin/main (Alice
  confirmed directly, 2026-09-27). The breakpoint guard went out earlier on
  the session branch `claude/nifty-curie-svjiyi`; that one stays there.
- Never push to a branch not created here. vscode.dev is parked: leave #166
  and feat/web-launchpad-travels alone.

## Critic = a subagent
Before every PR (and upstream issue), spawn a fresh read-only critic subagent
with the diff (git diff origin/main...HEAD) and the PR draft. Fix what it
flags, re-run until PASS, put the verdict in the PR body under "Critic".
Larger change: two critics (correctness / tests-and-hygiene). Template:

"You are a critic. Read-only. Here is the diff (git diff origin/main...HEAD)
and the PR draft. For each claim in the draft, find the line in the diff that
supports it or mark it UNSUPPORTED. Check out the base, run each new test, and
confirm it FAILS; then confirm it passes on the branch. Check that
test/suites.json registers each new test file. Check for stray or generated
files, live identifiers, non-ASCII in ABAP, and scope beyond the stated item.
Answer PASS or a numbered list of fixes; nothing else."

Give the critic no history of how it was built.

## Decide, don't wait
- Non-critical choices: decide (or ask a critic), record under "Decisions
  taken" in the PR body.
- Ask Alice ONLY for: a merge; main or someone else's branch; any SAP system;
  deleting data or branches; work outside the queue.
- Blocked on Alice: question in the PR body / draft PR, move on, never idle.

## Run hygiene
- One heavy run at a time. Develop with `npx mocha test/<file>.mjs`; full
  `npm test` once before a PR.
- `git status` before every commit; add files explicitly (no `git add -A`).
- Never commit test leftovers: src/osd/zcl_osd_scratch.clas.abap, the
  'Folders'->'Directories' label in src/cds/zc_osd_pack.ddls.asddls.

## Tempo
- Every 11-minute tick: read this file, `git status` + `git branch
  --show-current` (never on main with changes), then check a running job or
  take the next queue step.
- After each item: one short line to Alice -- PR link, what is verified,
  decisions taken.

## Queue
1. Base report. 2. Objective 0 PR (from fix/pack-app-manifest-rebase).
3. Breakpoint guard. 4. vg/test-cleanup (tests restore what they change).
5. Quick wins: T2 (measure; skip if > 1 day), Q7 Fiori/SEGW in a VS Code tab,
   "osd: New pack here", Q5 osd tools as VS Code LM tools.
6. Design doc only: background jobs (SUBMIT, JOB_OPEN/SUBMIT/CLOSE, events
   SM62/SM64, SM37-like view with breakpoint-in-job, spool-lite from WRITE),
   open question on imitating TBTCO/TBTCP, list of A4H probes (local, never
   from the cloud); model on docs/abap-daemons.md; draft PR.
Then stop and ask Alice.

## Learned the hard way
- Libraries are transpiled without source maps; a breakpoint there never binds.
