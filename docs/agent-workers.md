# Workers and critics: how a slice gets built here

How the DSL and verified-lift slices were built on 2026-09-30, what was measured, and the rules that came
out of it. It supplements the team conventions (spec → worker → critic → PR → squash merge on green `test`);
nothing here changes who owns what.

## The pipeline, as it runs now

1. **Spec.** The owning session writes one file: what to build, why, the tests that must be able to fail,
   the verification commands, the commit identity. Specs live in the session's scratchpad, not in the repo.
2. **One worker per task**, in its own worktree off `main`, with a prebuilt tree. Workers rotate:
   - codex `gpt-6-sol` (medium);
   - codex `gpt-6-luna` at `model_reasoning_effort=xhigh`;
   - a Claude Opus subagent;
   - a Claude Sonnet subagent.

   A design-heavy slice goes to Opus or luna-xhigh, a mechanical one to sol or Sonnet. Heavy commands run under
   `flock /tmp/osd-heavy.lock`. The worker commits and never pushes.
3. **The owner verifies** before anything leaves the machine: rebase, build, the named suites, and a leak scan on
   the changed paths.
4. **Critic from the other family.** codex judges a Claude worker's diff; a Claude read-only critic judges a codex
   worker's diff. The critic gets the spec, the diff and the PR body, and a bar: FIX FIRST only for P1/P2 (wrong
   output on real input, a false green, a false claim in the body, a test that cannot fail, a leak), everything
   else P3.
5. **Fix, re-critic, merge.** P2s go back to the same worker (it keeps its context); the owner fixes the PR body
   itself. Merge on "MERGE" plus green `test`, squash, never `--admin`.

## What was measured (comparison phase, same spec to two workers)

For four slices the same spec went to codex sol and to a Claude subagent in parallel, and a codex critic
judged both. The table is the whole record. "Round 1" is the critic's first verdict; "rounds" is how many critic
rounds the chosen candidate took to reach MERGE.

| slice | worker | wall | tests, mutations | round 1 | chosen | rounds |
|---|---|---|---|---|---|---|
| L1 s10 generated regions (#306) | sol | 8 min | 5, 5 | 7/10, 1 P2 | | |
| | Opus | 9.4 min | 18, 19 | 7/10, 1 P2 | yes | 3 |
| L1 s11 `dsl build` (#308) | sol | 9.5 min | 15, 15 | 6/10, 3 P2 | | |
| | Sonnet | 10.6 min | 54, 18 | 7/10, 1 P2 | yes | 2 |
| L2 s1 fleet rule (#309) | sol | 22 min | 23, 9 | 6/10, 3 P2 | | |
| | Opus | 18.5 min | 17 + 30 later, 7 + 11 | 7/10, 2 P2 | yes | 2 |
| L2 s2 JOIN + boundaries | sol | 24 min | 57, several | codex: 6/10, 4 P2 (self-judged); Claude: 4/10, 7 P2 | | |
| | Sonnet | 21 min | 57, many | codex: 6/10, 2 P2; Claude: 7/10, 3 P2 + 1 shared | yes | in progress |

The L1 rows are from the run log; the L2 s2 rows are from the critic reports of the same day (the slice is
still in its fix round). Fix rounds took 1.8 to 9.1 minutes: 3.8 and 1.9 (L1 s10), 1.8 (L1 s11), 9.1 (L2 s1, the
worker's own run time).

After L2 s2 the parallel runs stopped (below).

## What we learned

1. **No candidate passed round 1: 0 of 8.** Every first verdict found at least one real P2, and every one was a
   defect a user would have hit. Of the three finished slices, two reached MERGE in round 2 and one in round 3.
   The critic is not optional, and one or two fix rounds are normal.
2. **Mixed on tests and time, consistent on findings.** On the L1 slices the Claude workers wrote 3–4× more tests
   (18 vs 5, 54 vs 15) and sol was about a minute faster; on the L2 slices the counts were close (17 vs 23 at first,
   57 vs 57) and sol was slower (22 vs 18.5 min, 24 vs 21 min). Round-1 P2 counts were lower or equal on the Claude
   side in all four slices (1 vs 1, 1 vs 3, 2 vs 3, 2 vs 4 by the same critic). Neither family is safe to merge
   unreviewed.
3. **Part of the value of two candidates was the union.** In two of four slices a defect class found only in the
   losing candidate was carried into the chosen one: re-encoding bytes outside a region (L1 s10), and a rule
   accepted with no examples or a check call traced to the wrong line (L2 s1). In L1 s11 the losing candidate's
   gaps were already covered by the chosen one. That value can be kept without paying twice: the recurring
   classes below go into every critic prompt as a checklist.
4. **The same bug classes came back.**
   - **False greens.** A check reports ok without checking: mixed line endings made `check` find zero regions;
     partials nothing calls were never linked; a derived test case whose rows did not isolate its condition.
     The general fix is a guard that proves the check bites. In L2 s2, each derived case must change its result
     under a mutant of its own condition, or it is not emitted.
   - **Lost type widths.** abaplint gives INT1/2/4 one type, packed length in bytes, and loses a data element
     behind a local `TYPES` alias. Take DDIC types from the data element, not from the basic type.
   - **Byte boundaries.** Writing a region must not re-encode the rest of the file.
   - **Trace to the wrong line.** Every node gets the line where its own construct appears; test it per construct.
   - **The PR body claims more than the code.** "Byte for byte" while values were normalised; counts off by two.
     The critic reads the body against the diff, and the owner fixes the body.
5. **Settled design gets re-raised unless it is written where reviewers look.** A critic flagged the missing
   `MANDT` condition as a bug. It is correct ABAP, since the kernel adds the client, and this runtime is
   single-client by decision (ANORMALIES `no-implicit-mandt`). Once `docs/dsl-l2.md` said so, it stopped.
6. **Two critics from different families found different things.** On L2 s2 both critics read both candidates.
   codex sol judged its own family's work 6/10 with four P2s, so it was not lenient. The Claude critic gave
   the same work 4/10 with seven P2s, each with a concrete counterexample rule. On the Sonnet candidate it found
   two defects the codex critic missed: a JOIN that disagrees with the reference on fields of different lengths,
   and NUMC printing. Crossing the critics is about independence, and the evidence says it also finds more.
7. **A worker's own mutation list covers what the worker thought of.** Every worker reported all its mutations red,
   and the critic still found gaps. The critic's job includes asking which mutation is missing.
8. **Duplicate runs double the spend.** They doubled both the worker and the critic cost for a gain that the
   checklist in point 3 captures. From now on, one worker per task.

## The rotation phase (2026-09-30 night to 2026-10-01)

One worker per task from here on, rotated, with the critic always from the other family. "Rounds" counts critic
rounds up to MERGE. The wall times are the worker's own; lock waits are included where noted. Times, token
counts and scores come from the owning session's run log and the critics' reports, which are kept in its
scratchpad and not in the PR threads. The PR bodies and commit messages record the findings and the fixes.

| slice | worker | wall | round 1 | rounds | final |
|---|---|---|---|---|---|
| L2 s3 or/not/all/any/require (#321) | Opus | 44 min | codex 6/10, 3 P2 | 2 | MERGE |
| L1 s12 SAMC/SAPC from the model (#322) | sol | 24 min (+25 fix) | Claude 6/10, 3 P2 | 3 | MERGE 8/10 |
| L1 s12b SAMC as real abapGit output (#325) | Sonnet | 2.8 min | codex 8/10, 1 P2 | 2 | MERGE |
| Lift R2 (#326) | luna, xhigh | 1 h 53 min with lock waits, 918k tokens | Claude 7/10, 3 P2 | 3 | MERGE 8/10 |
| L1 s13 report selection model (#327) | sol | 12 min (+13 fix) | Claude 7/10, 3 P2 | 2 | MERGE 8/10 |
| L1 s13 follow-ups (#329) | Sonnet | 2.4 min | codex MERGE 9/10 | 1 | MERGE 9/10 |
| Lift R2 follow-ups (#330) | Opus | 20 min, two fix rounds | codex 7/10, 1 P2 | 3 | MERGE 8/10 |

What this phase added to the list above:

9. **One first-round pass in seven, and it was the smallest slice.** #329 was five named corners with a test
   each, and it passed at 9/10. Everything with a new design surface took two or three rounds. Plan for
   the rounds; do not read a quick pass on a small slice as a verdict on the worker.
10. **A guard written as a deny-list failed every time it was attacked.** R2's alias guard listed the forms
    it refused, and round 2 found four it did not list. The call guard listed statement kinds, and
    `CALL DIALOG ... IMPORTING ... TO` (a form abaplint cannot parse) and `OVERLAY` (whose write abaplint does not report) went
    past it. A local table that escaped through a call before the loop went past the rule "a call reaches T only
    if it names T". Each was fixed by turning the check around: an allow-list of what is known to be safe, a
    refusal for everything else, and a refusal for any file the parser could not read. For a lift, an
    over-strict guard loses a rewrite; a lenient one changes the program's result.
11. **The strongest finding is a run, not a reading.** On #330 the codex critic built both methods,
    BEFORE and AFTER, and showed that BEFORE found a row where AFTER found none.
    A reproducer that runs ends the argument about severity. Ask for one whenever the harness allows.
12. **A critic can find a wrong premise in the owner's spec.** On #322 round 2 found that the SAMC target was
    a hand-prepared deserialisation input, not abapGit's output. The spec had said otherwise. The fix was a
    capture from A4H and a new slice (#325), not a worker fix round.
13. **luna at xhigh, measured once.** On R2 its round-1 score was in the range of the others (7/10 with three
    P2s, against 6 to 9/10) and it fixed its own findings well in two rounds. It is the slowest and the most expensive worker measured
    here: almost two hours and 918k tokens, against 2.4 to 44 minutes for the other slices of this phase.
14. **Small follow-ups belong to Sonnet.** Its two follow-up slices took 2.4 and 2.8 minutes and needed one
    round and two rounds.

## Recommendations: which model, in which role, judged by whom

The evidence column says how much of a row is measured and how much is judgement. Re-check it as the
table above grows.

| role | recommended | judged by | why, and the evidence |
|---|---|---|---|
| spec writer, owner, merger | the owning session (Opus) | the critic, through the diff and the body | holds the context of the track and the team rules; nobody else merges. Team rule, not measured |
| worker: design-heavy slice (a new layer, a compiler, a recipe with obligations) | Claude Opus | codex `gpt-6-sol` | chosen on L1 s10 (P2s tied, 18 tests vs 5) and L2 s1 (2 P2 vs 3). 2 slices |
| worker: well-specified slice with a clear test list (a build step, a checker) | Claude Sonnet | codex `gpt-6-sol` | chosen on L1 s11 (54 tests and 1 P2 vs 15 and 3) and L2 s2 (7/10 vs 4/10 by the Claude critic, equal test counts). 2 slices |
| worker: small, mechanical or time-critical slice (a fix, a rename, a wiring change) | codex `gpt-6-sol` | a Claude critic | about a minute faster on the small L1 slices with leaner diffs, slower on the larger L2 slices; more P2s in round 1 in three of four. 4 slices |
| worker: hard reasoning, e.g. semantics and edge-case proofs | codex `gpt-6-luna`, xhigh | a Claude critic | R2: round 1 7/10 like the others, MERGE in round 3; ~2 h and 918k tokens. Use when the reasoning is the hard part and time is not. 1 slice |
| worker: follow-up of named corners, each with its test | Claude Sonnet | codex `gpt-6-sol` | #325 and #329: 2.8 and 2.4 min, MERGE in round 2 and round 1. 2 slices |
| fix round after a critic | the same worker that wrote the slice | the same critic, round 2 | keeps its context; fix rounds took 1.8–9.1 min. 4 measured, listed under the table |
| merge critic of a codex worker | a Claude Opus read-only subagent, asked for concrete counterexample rules or inputs | the owner reads the verdict against the diff | on L2 s2 it found 7 P2s where codex found 4 on the same diff, each with a reproducer. 1 slice, both candidates |
| merge critic of a Claude worker | codex `gpt-6-sol`, medium, read-only | the owner | found a real P2 in every Claude candidate (4 of 4), and missed two on L2 s2 that the Claude critic found. Consider adding a Claude critic for high-stakes slices |
| tie-breaker, when a critic keeps raising P3s as P2 | the other family's critic, one round | the owner decides | good-enough bar; stops a nagging critic without dropping a real finding |
| leak and resemblance review (public vs private material) | a separate session from the author's, any family | the owner | ADR 0006: the author's own review does not count |
| synthesis across many results (a report, a plan) | Fable | the owner | team rule: Fable only for synthesis |

Never: Haiku as a worker or a critic (team floor is Sonnet); a critic from the worker's own family as the only
judge; two workers on the same spec (see point 8).

## Critic checklist (append to every critic prompt)

- Does any check report ok without having checked? Look for zero-iteration paths, unlinked or unreachable parts,
  and inputs that make the check vacuous.
- Are types taken from DDIC (data element, domain) where abaplint's basic type loses width or unit?
- Does any write touch bytes it did not mean to change?
- Does every trace entry point to the line of its own construct?
- Does the PR body claim anything the diff or the tests do not show: counts, "byte for byte", "all"?
- Which mutation of the new code would survive the new tests?
- Is anything flagged a documented, settled design decision (look in ANORMALIES and the doc for the area)?
- Is a safety check a list of forbidden forms? Name a form it does not list, and try a statement the parser cannot read.
- Where the harness can run both sides, run them: a differing result is the reproducer.
