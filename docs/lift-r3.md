# R3: filter at the top of a database loop

R3 moves a leading `CHECK row-column op value` into the `SELECT`'s `WHERE` and removes the `CHECK`. A leading `IF row-column op value. CONTINUE. ENDIF.` is accepted with the complementary SQL operator. `ORDER BY` stays in place. The model is `node tools/lift.mjs model <class> <method> --recipe r3`; the template renders through `tools/dsl-regions.mjs` and the L0 ABAP template engine, including its line trace. The sample is under `recipes/r3-filter-into-where/sample`.

For a host variable the generated condition uses the 7.02 form `AND column = variable`. The escaped host spelling `@variable` in the proposed rewrite needs a newer ABAP release and conflicts with this repository's 7.02 source rule.

This implementation is deliberately narrow. It accepts one static `SELECT * FROM one_table INTO work_area WHERE ... [ORDER BY ...]` and requires the work area to be declared `TYPE table` in the method. It refuses an explicit projection because the value fetched into a differently laid-out work area may not be the database column value. It refuses an enclosing DO, WHILE, LOOP or SELECT, and `SELECT INTO TABLE` followed by `LOOP`.

## Obligations

| Obligation | Model action |
|---|---|
| Reads only the row and a loop-invariant value | Requires one DDIC column of the selected table and either a literal or a same-width CHAR variable; refuses any loop statement naming that variable unless it is provably read-only, including statements before the CHECK. Other row shapes refuse. |
| No side effect before the filter | Requires `CHECK` or the exact `IF/CONTINUE/ENDIF` as the first action. |
| `UP TO n ROWS` | Refuses: the limit applies before the original filter. |
| `sy-dbcnt`, `sy-subrc` | Refuses later reads of `sy-dbcnt` and reads of `sy-subrc` in or after the loop. Measured on A4H: when rows are fetched and none passes the filter, the old loop leaves `sy-subrc = 0` and the rewritten SELECT leaves `4`, so the refusal is necessary, not merely cautious. |
| ABAP versus SQL comparison | Accepts only CHAR equality/inequality comparisons with a literal of precisely the DDIC width or a same-width CHAR variable. Case and collation agreement remains open. CHAR ordering, NUMC, packed and other type pairs refuse. |
| NULL | Requires the DD03P `NOTNULL` flag or a key field. A DB NULL fetched into ABAP becomes initial; `CHECK f = space` can then pass where SQL `f = space` cannot. |
| Operators | Maps `=` and `<>` and their complements for IF/CONTINUE. CHAR ordering refuses. `BETWEEN`, `IN` ranges, `CP`, `CS`, `NP`, `NS` refuse. |
| Existing WHERE grouping | Refuses OR to avoid changing precedence when appending AND. |
| ORDER BY | Preserves the clause byte-for-byte in the generated SELECT. |

The model's `open` list also names a caller reading `sy-subrc` after method return and concurrent database changes and client/snapshot agreement. Passing the model is conditional, not a proof that A4H and this runtime collate CHAR in the same way.

## Local measurement and mutants

`test/lift-r3.mjs` seeds a SQLite table and compares an accepted filter-after-fetch with the SQL filter-before-fetch: both produce rows `001, 003`. Four SQLite counterexamples demonstrate differences in naive variants: `UP TO 1 ROWS` gives zero versus one passing row, a NULL maps to ABAP initial but SQL equality matches zero rows, NUMC `0012` differs from SQL text `'12'`, and padded CHAR `A   ` differs from SQLite TEXT `'A'`. This is a conservative refusal based on SQLite TEXT behaviour; it does not establish that Open SQL differs. The model also refuses each unsafe source shape. These local SQLite observations are not an ABAP runtime differential; a full transpiled differential is pending because the worktree lacks the pinned ABAP libraries and transpiler. The lead's A4H measurements are recorded below.

The local direct `@abaplint/runtime` comparison operators and SQLite give this matrix (true/false means the seeded row passes):

| Pair | ABAP operator | SQLite WHERE | A4H |
|---|---:|---:|---|
| CHAR(3) `A  ` against CHAR(1) `A` | true | false | see measured section |
| CHAR(3) `A  ` against CHAR(4) `A   ` | true | false | see measured section |
| NUMC(4) `0012` against integer 12 | true | false | see measured section |
| NUMC(4) `0012` against CHAR(2) `12` | false | false | see measured section |
| CHAR(3) `A  ` against lower-case `a  ` | false | false | see measured section |
| packed 10.50 against integer 10 | false | false | see measured section |
| nullable database NULL fetched as initial CHAR(1), compared with initial | true | false | see measured section |

The direct operator plus SQLite measurements isolate comparison semantics but do not exercise the transpiler's SELECT lowering. The NULL result uses the ABAP initial value that a nullable column yields after fetch; the local SQLite row itself remains NULL.

Mutation check: each of the `UP TO`, NUMC type-pair, CHAR-length, and DDIC NULL guards was individually replaced with `if (false)` in a temporary local copy of `tools/lift.mjs`. The matching focused Mocha test failed in each of the four runs (exit 1, one failure); the original file was restored after every run. The seeded counterexamples also assert that each naive SQL result differs from the post-fetch result.

The disposable A4H probe is in `recipes/r3-filter-into-where/a4h-probe` and the `lift-r3-probe` deployment unit. It measures CHAR short/long literals, NUMC literal and number, case, packed number, and `sy-subrc` after the loop. The attempted two-stage NULL probe was removed because abapGit reported possible data loss when adding a nullable column in place and the in-place mode refuses that deployment. NULL remains unmeasured; the model refuses nullable columns.

## Survey

`node tools/lift.mjs survey src --recipe r3 --list` on this checkout: 2 candidate methods, 0 accepted, 2 refused by `shape` (both have multiple/other loop structures). The lead's public-corpus survey is recorded below; it was not repeated in this worktree. R3 survey counts only methods with a parsed `SELECT/ENDSELECT` loop and reports one refusal per method.

## Not proven

No ABAP runtime differential, nullable-column A4H comparison, explicit field-list mapping, table-form liveness proof, `sy-subrc` equivalence, case/collation equivalence, packed/NUMC conversion equivalence, or performance improvement is proven. The lead's A4H type-pair and survey results are recorded below. The sample has a generated region and a renderer/line-trace regression, gated on the compiled L0 classes and pinned transpiler. The renderer could not run in this worktree.


## Measured on A4H (2026-10-01)

The lead ran the probe through `tools/osd-prove-on-system.mjs` as a fresh run (unit `lift-r3-probe`). All eight original test methods ran on the system; the ineffective NULL method has since been removed.

- **Type pairs.** For the CHAR literal shorter and longer than the column, the NUMC column against a literal and against a number, case, and the packed number, the count of rows the old CHECK lets through equals the count the rewritten WHERE selects.
- **`sy-subrc` after the loop.** It differs: 0 before, 4 after (see the obligation table).
- **NULL.** Not measured. In stage 2, adding the nullable `OPT` column to the stage-1 table was reported by abapGit's table comparator as possible data loss, and the in-place mode refuses a deploy with data loss, by design. The original `null_initial` ran with no `R3N` row and proved nothing; it has been removed. R3 refuses nullable columns regardless.
- **What the system caught that this runtime did not.** Two defects in the probe itself: `LABEL` is a reserved DDIC field name (activation refused), and a class XML without `WITH_UNIT_TESTS` gets no test include.

Survey with `--recipe r3`, measured by the lead:

- abapGit `src`: 5 candidates, 0 accepted (shape 4, `UP TO n ROWS` 1).
- Public corpus: [ABAPToTheFuture04](https://github.com/hardyp/ABAPToTheFuture04) 2 (shape 1, UP TO 1); [building_gateway_services](https://github.com/grahamrobbo/building_gateway_services) 3 (shape 3); [spacelab-problem-management-backend-live](https://github.com/simplicity-goodness-truth/spacelab-problem-management-backend-live) 15 (UP TO 7, shape 8); the other repositories 0.
- In total, 25 candidates and 0 accepted. Nine of them, more than a third, are refused because the loop has `UP TO n ROWS`, exactly where the naive fix changes which rows are read.
