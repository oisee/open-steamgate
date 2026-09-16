# What goes upstream, and how

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
   frame with a real system. Needs an issue.
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

## Not for sending

- `fix/conv-builtin-type` — superseded 2026-09-14, split into the branches
  above. Delete.
- `fix/silent-zero-output` — a new failure mode with false positives on
  existing tests; parked on purpose, not a PR.
- `docs/client-handling` — merged upstream as #1850 already. Delete.

## Beside the transpiler

- **`@abaplint/core`**: nothing owed today.
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
