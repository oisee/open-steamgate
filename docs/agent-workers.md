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

After L2 s2 the parallel runs stopped (below).

## What we learned

1. **No candidate passed round 1: 0 of 8.** Every first verdict found at least one real P2, and every one was a
   defect a user would have hit. Round 2 was MERGE in 3 of the 4 chosen slices. The critic is not optional, and
   one fix round is normally enough.
2. **The Claude workers wrote broader tests; sol was faster or equal.** Test counts were 2–4× higher on the
   Claude side, and round-1 P2 counts were equal or lower. Both sides were ahead of the spec in places and behind it
   in others. Neither family is safe to merge unreviewed.
3. **Most of the value of two candidates was the union.** In three of four slices, the best result was the chosen
   candidate plus a defect class found only in the other one: re-encoding bytes outside a region, raw tags with
   filters, empty examples accepted. That value can be kept without paying twice. The recurring classes below go
   into every critic prompt as a checklist.
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

## Recommendations: which model, in which role, judged by whom

The evidence column says how much of a row is measured and how much is judgement. Re-check it as the
table above grows.

| role | recommended | judged by | why, and the evidence |
|---|---|---|---|
| spec writer, owner, merger | the owning session (Opus) | the critic, through the diff and the body | holds the context of the track and the team rules; nobody else merges. Team rule, not measured |
| worker: design-heavy slice (a new layer, a compiler, a recipe with obligations) | Claude Opus | codex `gpt-6-sol` | won L1 s10 and L2 s1 on coverage and on fewer round-1 P2s. 2 slices |
| worker: well-specified slice with a clear test list (a build step, a checker) | Claude Sonnet | codex `gpt-6-sol` | won L1 s11 with 54 tests and 1 P2 against 15 and 3. 1 slice, plus L2 s2 undecided |
| worker: small, mechanical or time-critical slice (a fix, a rename, a wiring change) | codex `gpt-6-sol` | a Claude critic | faster or equal in every run, and leaner diffs, but thinner tests. 4 slices |
| worker: hard reasoning, e.g. semantics and edge-case proofs | codex `gpt-6-luna`, xhigh | a Claude critic | **not measured yet**; first run is recipe R2. Revisit after it |
| fix round after a critic | the same worker that wrote the slice | the same critic, round 2 | keeps its context; fixes took 2–4 min in every case. 5 fix rounds |
| merge critic of a codex worker | a Claude Opus read-only subagent, asked for concrete counterexample rules or inputs | the owner reads the verdict against the diff | on L2 s2 it found 7 P2s where codex found 4 on the same diff, each with a reproducer. 1 slice, both candidates |
| merge critic of a Claude worker | codex `gpt-6-sol`, medium, read-only | the owner | found a real P2 in every Claude candidate (5 of 5), missed two that the Claude critic found. Consider adding a Claude critic for high-stakes slices |
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
