# What goes upstream, and how

> **2026-09-17, 06:41–06:49:** Lars merged #1862 (compare), #1864 (rounding)
> and #1867 (APPEND) within the morning; #1863 (MOD) is still open, #1866
> (integer division) unanswered, abaplint/abaplint#4302 open. The npm
> runtime is still 2.13.87; when the next release carries the three, the
> pinned `local/osd-build` loses three of its commits and the preview pin
> moves to a published version plus what remains (core pin, MOD).


The transpiler and the runtime this tree builds with are a local build of
`~/dev/transpiler` (branch `local/osd-build`), which is `@abaplint/transpiler`
plus fixes that are not released yet. Every one of those fixes has an entry
in `ANORMALIES.md` and a branch in that clone, and `npm run parked` prints the
two side by side and complains where they disagree. This is the dossier for
sending them: what each is, what proves it, where the fix lives, and what to
do next. Snapshot of 2026-09-16; `npm run parked` is the live version.

## The procedure, once per fix

1. `git fetch origin` in `~/dev/transpiler`, and move `main` to `origin/main`
   — the parked report compares branches with the local `main`, and today
   that is nine commits behind, so it shows upstream's own commits as if they
   were ours.
2. A branch **inside `abaplint/transpiler`**, never a fork: the regression
   workflow fires on a push to a branch there and not on a pull request from
   a fork (CLAUDE.md, the rule read off the workflows). After pushing, check
   that **Regression** is in the checks, not only **CI**.
3. In that repository's own clone, with nothing uncommitted, run its lint and
   the package's tests before the PR. An em dash in an ABAP comment failed the
   lint once; the prose style used everywhere else here is what breaks it.
4. One small PR per fix, the ANORMALIES entry as the description's source:
   reproducer, expected, actual, where. Lars merges; nothing of ours is
   merged by us there.
5. When it lands: the entry's status becomes `fixed upstream: #NNNN`, and
   when a release carries it, the version line says which. When every entry
   the link exists for says so, `npm run transpiler:published` drops the link.

## Already upstream — update the record, wait for a release

| entry | branch | upstream | in a release? |
| --- | --- | --- | --- |
| `ANOMALY-2026-09-14-float-separator-not-inverse` | `fix/float-separator` | #1847 merged | 2.13.87 |
| `ANOMALY-2026-09-13-paren-before-conv` | `fix/rearranger-constructor-operand` | #1843 merged | 2.13.87 |
| `ANOMALY-2026-09-13-conv-second-in-expression` | `fix/conv-builtin-type-name` | #1842 merged | after 2.13.87 |
| `ANOMALY-2026-09-13-sy-tabix-not-restored` | `fix/sy-tabix-restore` | #1848 merged | after 2.13.87 |
| `ANOMALY-2026-09-14-sy-tabix-hashed` | `fix/sy-tabix-restore` | #1848 merged | after 2.13.87 |

Their statuses in `ANORMALIES.md` were updated with this document. The
branches can be deleted once `main` is moved; `parked` will then stop listing
them.

## Local only — ready to send, in this order

Ordered by what breaks without them, most first.

1. **`fix/w3mi-objid`** — `ANOMALY-2026-09-13-w3mi-objid-encoded`. A Web
   Repository object is keyed on the name in its own XML, not on the escaped
   file name. Without it every W3MI with a dot in its name (all the demo's
   media) is registered under `ZO4D_00_SALES%2EPNG` and `init.mjs` imports a
   specifier Node cannot resolve; measured 2026-09-16 when `npm install`
   silently swapped the link for the published package. Needs an issue. Test:
   none yet — write one over a `.w3mi.data.png` whose name carries a dot.
2. **`fix/percent-in-filename`** — `ANOMALY-2026-09-13-percent-in-filename`.
   The other half of the same defect: the import specifier escapes the percent
   before the slash. Test in the transpiler's `test/files.ts` on the branch.
   Needs an issue; send with 1 or right after, they are one story.
3. **`fix/compare-character-literal`** — `ANOMALY-2026-09-16-float-vs-character-compare`.
   `0.06 > '0.5'` was true: the generic tail of `compare/gt.ts` read a
   character operand with `parseInt`; `parse()` reads it the way ABAP
   converts it. One commit on a worktree at `.local/pr-compare-char`, based on
   `origin/main`, the runtime's tests (10) and lint green, a regression test
   in `packages/runtime/test/compare.ts`. Found by comparing the demo frame by
   frame with a real system. Issue #1859; **PR #1862**, 2026-09-17.
4. **`fix/binary-file-copy`** — `ANOMALY-2026-09-13-binary-file-to-output`.
   A binary file survives the copy to output (read and written as latin1).
   Needs an issue.
5. **`fix/builtin-not-a-method`** — `ANOMALY-2026-09-13-builtin-as-method` and
   `ANOMALY-2026-09-14-builtin-positional-argument`. Two commits, not pushed.
   Needs an issue.
6. **`fix/sy-tabix-restore`, the remaining commit** — "Take the
   class-constructor timing out of …", `ANOMALY-2026-09-14-class-constructor-eager`.
   #1848 took the sy-tabix half; this half is still local. Rebase the branch
   on `origin/main` and it is one commit. Needs an issue.

## The performance track, in sending order

*Opened 2026-09-17 after `docs/demo-profile.md` and `docs/abap-hot-code.md`.*

These are not defects and they have no `ANORMALIES.md` entry, because
nothing here computes a different answer from a real kernel — the answers
are right and they are slow. `npm run parked` therefore does not claim
these branches, so **this section is their only record**, and each branch
carries its reason in `git branch --edit-description`, which is the rule
for a branch that is not a defect fix.

What they are all about: an ABAP arithmetic operation costs about 30 ns
here and about 1 ns in plain JavaScript, and one frame of the demo's
`sdf_blobs` performs 1.97 million of them. The cost is the protocol around
the operation — dispatch on the operand types, parse each operand, allocate
the result — and not the arithmetic. Seven of twenty-six demo scenes miss
their frame budget because of it.

**The order below is by gain against risk, and it is deliberately not the
order somebody would guess.** Each item goes as one issue with the
measurement, then one pull request with one commit, one test and one number,
through the critic gate (CLAUDE.md).

| # | what | where | gain, measured | state |
| --- | --- | --- | --- | --- |
| 0 | the anchor issue: the arithmetic protocol dominates compute-bound ABAP, with the profile and the ranked list | an issue only, `abaplint/transpiler` | — | to write |
| 1 | a constant `Character` remembers the number it parses to | runtime, `operators/_parse.ts` + the character factory | 22 % of an `sdf_blobs` frame | in progress |
| 2 | a `Float`/`Float` branch at the head of `add`/`minus`/`multiply`/`divide` | runtime, `operators/` | 9–17 % of every heavy frame | in progress |
| 3 | plain JavaScript arithmetic when the operand types are proven | transpiler, `expressions/source.ts` + a new type walk | 110–200 ns to about 1 | in progress |
| 4 | a synchronous `LOOP AT` when the body contains no `await` | runtime + codegen | 172–349 ns a row to 74 | design question, unwritten |
| 5 | method inlining | transpiler | 123 ns to 67, and 206 to 67 for a structure return | unwritten, high risk |

Notes that belong with them, so they are not rediscovered:

- **Item 1 and item 3 overlap on purpose.** Folding `'0.5'` in code
  generation makes it disappear; caching it in the runtime makes it cheap
  for every caller that the code generator cannot prove. Both are worth
  having, and item 1 is five lines against a project.
- **Item 3's admission rule is the whole safety argument**: every operand
  a `Float`, an `Integer` or a numeric literal, and at least one proven
  `Float`. One proven float means the calculation-type flag can never
  produce an `Integer` result, which is what makes the rest fall away.
  Packed, `decfloat34`, `int8`, hex, date, time and character variables
  are refused.
- **`Integer.set(number)` and `Integer.set(Float)` are equivalent**, both
  through `roundHalfAwayFromZero`, and the integer overflow check below
  them is commented out. Read in the source, 2026-09-17. That is what makes
  handing `.set()` a raw number safe, and it is the fact item 3 rests on.
- **What is deliberately not in this list**, so that nobody proposes it
  again: a lookup table for a function over a proven range, and any
  "fast maths" library. Measured, not argued — `sin( )` is 19 ns and a
  `READ TABLE INDEX` lookup is 71, so a table is four times slower than the
  function it would replace, and no table equals `Math.sin` at the sampled
  points, which breaks the frame comparison against a real system. For the
  same reason, hand-expanding `**` into multiplications is a pessimisation:
  `** 8` is 44 ns and three multiplies are 83.
- **The demo's own ABAP is not part of this stream.** Rewriting three
  scenes by the same rules took 28 to 38 % off a frame with every frame
  identical, which measures the ceiling a compiler could reach on its own.
  It is a measurement, not a patch to send (Alice, 2026-09-17).

Every item's evidence is `docs/demo-profile.md` (where the time goes) and
`docs/abap-hot-code.md` (what each idiom costs, and what the code generator
would have to know). The oracle — `tools/o4d-record.mjs --compare` against a
recording made with the unmodified transpiler — is the acceptance test for
all of them: a performance change that alters one frame is wrong.

## Not for sending

- `fix/conv-builtin-type` — superseded 2026-09-14, split into the branches
  above. Delete.
- `fix/silent-zero-output` — a new failure mode with false positives on
  existing tests; parked on purpose, not a PR.
- `docs/client-handling` — merged upstream as #1850 already. Delete.

## Beside the transpiler

- **`@abaplint/core`**: one owed, and it is not a table edit.
  `ANOMALY-2026-09-16-numeric-builtins-typed-integer` — `frac`, `abs`,
  `floor`, `ceil`, `trunc` and `sign` are declared with a fixed integer
  return type, and ABAP gives them the type of their argument. It is the
  last three of sixty differing frames of the demo. The return type has to
  come from the argument where the call is typed
  (`expressions/method_call_chain.ts`). Issue abaplint/abaplint#4302, filed
  2026-09-17 with the A4H measurement; the three syntax tests (`frac( f )`
  typed `f`, `abs( f )` typed `f`, `frac( i )` still `i`) sit on
  `fix/numeric-builtins-argument-type` in the fork worktree, without a fix.
  A fork PR when the fix is written.
- **`@abaplint/runtime`, two more, found by probing around it and measured
  on A4H 2026-09-17**: `ANOMALY-2026-09-16-mod-result-integer` (`MOD`
  with a float operand returns an integer; a system says 0.75) is #1860 and
  `ANOMALY-2026-09-16-integer-rounds-negative-half-to-zero` (`-0.5` to `i`
  is 0, `Math.round`; a system says −1) is #1861. Both fixed on a branch
  (`fix/mod-float-result`, `fix/integer-round-half-away`), one commit each
  with the test, runtime tests and lint green; **PRs #1863 and #1864**,
  2026-09-17, from inside the repository.
- **`@abaplint/runtime`, from the plasma scene (2026-09-17)**:
  `ANOMALY-2026-09-17-append-number-rounded` — `APPEND sin( x ) TO` a
  float table rounds every value to an integer, because `cloneRow` wraps
  a raw number as an `Integer` first. Branch `fix/append-number-float`, one commit with a
  test (`packages/runtime/test/statements/append_number.ts`), runtime
  tests and lint green; issue #1865 and **PR #1867**, 2026-09-17, after
  the critic pass Alice asked for. Cherry-picked onto `local/osd-build`.
- **`@abaplint/core`, from the mountains scene (2026-09-17)**:
  `ANOMALY-2026-09-17-character-literal-calc-type` — already fixed
  upstream by #4293 in 2.120.52; the pin was behind. `local/osd-build`
  now takes `^2.120.54` (c148d363), and the preview's
  `OSD_TRANSPILER_REF` has to move with it. Nothing to send.
- **`@abaplint/transpiler`, from the last seven plasma frames (2026-09-17)**:
  `ANOMALY-2026-09-17-integer-division-not-rounded` — in calculation type
  `i` a system rounds every `/` to an integer before the next operation
  (`7 / 2 + 7 / 2` is 8 there, 7 here; measured on A4H). The fix needs
  the statement's calculation type, so it is the transpiler's, not the
  runtime's: put to Lars as issue #1866 with the six measured lines,
  2026-09-17. Not started.
- **How these were found**: `docs/frame-comparison.md`, the demo as an
  oracle, scene by scene.
- **The order was test, issue, fix (Alice, 2026-09-17):** the reproducers
  went first, with the A4H measurement, so the issue could say what a
  system answers; the fixes followed the same day for the two runtime
  ones. The core one (#4302) is still test-only: its fix is not a table
  edit and belongs in the syntax pass.
- **Alice's own repositories, through the packs** (`packs/*/README.md`
  says what each overlay changes): `oisee/vivid-vibes`, one line in
  `zcl_o4d_http_handler` — the megademo page asks `?image=<name>` and the
  handler serves `?img=<NAME>.PNG`, so no picture loads at the pinned
  commit. `oisee/zork-abap` needs nothing: the pack runs its HEAD as is
  (an earlier pack carried five classes from an older commit, which is why
  it looked patched). A PR to vivid-vibes once the line is reviewed; until
  then the overlay is the diff.
- **Filed as issues rather than fixed (Alice, 2026-09-17): "можно пока не
  фиксить … а пока сделать тест и завести как issue."** The tests are the
  measured contract; a fix that passes them is the PR.
- **open-abap-core**: `W3MIMETABTYPE` (#1218) and `get_source_position`
  (#1219) are merged; `SCMS_BINARY_TO_XSTRING` and the `WWWDATA_IMPORT` walk
  are in `.local/lars/open-abap-core` and still to send — a fork there, since
  `oisee` has no write access (CLAUDE.md).
- **Bun** (`oven-sh/bun`): the resolver takes a percent-encoded relative
  specifier literally (`ANOMALY-2026-09-13-bun-percent-encoded-specifier`).
  Worked around in `bin/osd.mjs`; transpiler #1841 would remove the need.
  An issue upstream is worth filing with the two-file reproducer from
  `docs/bun-spike.md` part one.
- **Node**: nothing to send. A single executable could not import a file
  outside itself on 26.3 and can on 26.9 (`docs/bun-spike.md` part four).
