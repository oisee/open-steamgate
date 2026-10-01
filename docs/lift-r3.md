# R3: filter at the top of a database loop

R3 moves a leading `CHECK row-column op value` into the `SELECT`'s `WHERE` and removes the `CHECK`. A leading `IF row-column op value. CONTINUE. ENDIF.` is accepted with the complementary SQL operator. `ORDER BY` stays in place. The model is `node tools/lift.mjs model <class> <method> --recipe r3`; the template renders through `tools/dsl-regions.mjs` and the L0 ABAP template engine, including its line trace. The sample is under `recipes/r3-filter-into-where/sample`.

For a host variable the generated condition uses the 7.02 form `AND column = variable`. The escaped host spelling `@variable` in the proposed rewrite needs a newer ABAP release and conflicts with this repository's 7.02 source rule.

This implementation is deliberately narrow. It accepts one static `SELECT * FROM one_table INTO work_area WHERE ... [ORDER BY ...]` and requires the work area to be declared `TYPE table` in the method. It refuses an explicit projection because the value fetched into a differently laid-out work area may not be the database column value. It also refuses `SELECT INTO TABLE` followed by `LOOP`: proving that the table has no other use or alias is required before removing that materialization boundary.

## Obligations

| Obligation | Model action |
|---|---|
| Reads only the row and a loop-invariant value | Requires one DDIC column of the selected table and either a literal or a same-width CHAR variable; refuses a variable that may be written in the body. Other row shapes refuse. |
| No side effect before the filter | Requires `CHECK` or the exact `IF/CONTINUE/ENDIF` as the first action. |
| `UP TO n ROWS` | Refuses: the limit applies before the original filter. |
| `sy-dbcnt`, `sy-subrc` | Refuses later reads of `sy-dbcnt` and reads of `sy-subrc` in or after the loop. The old `sy-subrc` after a loop with fetched rows but no passing row is not yet measured on A4H. |
| ABAP versus SQL comparison | Accepts only CHAR equality/inequality/order comparisons with a literal of precisely the DDIC width or a same-width CHAR variable. Case and collation agreement remains open. NUMC, packed and other type pairs refuse. |
| NULL | Requires the DD03P `NOTNULL` flag or a key field. A DB NULL fetched into ABAP becomes initial; `CHECK f = space` can then pass where SQL `f = space` cannot. |
| Operators | Maps `=`, `<>`, `<`, `>`, `<=`, `>=` and the complement of each for IF/CONTINUE. `BETWEEN`, `IN` ranges, `CP`, `CS`, `NP`, `NS` refuse. |
| Existing WHERE grouping | Refuses OR to avoid changing precedence when appending AND. |
| ORDER BY | Preserves the clause byte-for-byte in the generated SELECT. |

The model's `open` list also names concurrent database changes and client/snapshot agreement. Passing the model is conditional, not a proof that A4H and this runtime collate CHAR in the same way.

## Local measurement and mutants

`test/lift-r3.mjs` seeds a SQLite table and compares an accepted filter-after-fetch with the SQL filter-before-fetch: both produce rows `001, 003`. Four counterexamples kill naive variants: `UP TO 1 ROWS` gives zero versus one passing row, a NULL maps to ABAP initial but SQL equality matches zero rows, NUMC `0012` differs from SQL text `'12'`, and padded CHAR `A   ` differs from SQL text `'A'`. The model also refuses each unsafe source shape. These local SQLite observations are not an ABAP runtime differential; a full transpiled differential is pending because the worktree lacks the pinned ABAP libraries and transpiler. The A4H observations are pending the lead's probe run.

The local direct `@abaplint/runtime` comparison operators and SQLite give this matrix (true/false means the seeded row passes):

| Pair | ABAP operator | SQLite WHERE | A4H |
|---|---:|---:|---|
| CHAR(3) `A  ` against CHAR(1) `A` | true | false | pending |
| CHAR(3) `A  ` against CHAR(4) `A   ` | true | false | pending |
| NUMC(4) `0012` against integer 12 | true | false | pending |
| NUMC(4) `0012` against CHAR(2) `12` | false | false | pending |
| CHAR(3) `A  ` against lower-case `a  ` | false | false | pending |
| packed 10.50 against integer 10 | false | false | pending |
| nullable database NULL fetched as initial CHAR(1), compared with initial | true | false | pending |

The direct operator plus SQLite measurements isolate comparison semantics but do not exercise the transpiler's SELECT lowering. The NULL result uses the ABAP initial value that a nullable column yields after fetch; the local SQLite row itself remains NULL.

Mutation check: each of the `UP TO`, NUMC type-pair, CHAR-length, and DDIC NULL guards was individually replaced with `if (false)` in a temporary local copy of `tools/lift.mjs`. The matching focused Mocha test failed in each of the four runs (exit 1, one failure); the original file was restored after every run. The seeded counterexamples also assert that each naive SQL result differs from the post-fetch result.

The A4H probe has two folders and deployment units. First run `node tools/osd-prove-on-system.mjs recipes/r3-filter-into-where/a4h-probe-stage1 --unit lift-r3-stage1 --keep`: its ABAP Unit seeds one `R3N` row while `OPT` does not exist. Then run `node tools/osd-prove-on-system.mjs --in-place --package <package printed by stage one> recipes/r3-filter-into-where/a4h-probe --unit lift-r3-probe`: the second table definition adds nullable `OPT` without initial values. Its `null_initial` method compares the old row through ABAP against SQL; the other named methods compare BEFORE and AFTER counts for CHAR short/long literals, NUMC literal and number, case, packed number, and `sy-subrc` after the loop. Compare each named method's result and expected/actual counts with the local test. Follow `docs/prove-on-system.md` for rollback and cleanup; an in-place run may refresh object stamps and make stage one's receipt cleanup refuse, in which case the lead must handle that disposable package explicitly. Neither stage has been run here, so no A4H result is claimed.

## Survey

`node tools/lift.mjs survey src --recipe r3 --list` on this checkout: 2 candidate methods, 0 accepted, 2 refused by `shape` (both have multiple/other loop structures). The requested public corpus at `/home/alice/dev/osg-research/.local/corpus` is absent in this environment, so public-corpus accepted/refused numbers were not measured. R3 survey counts only methods with a parsed `SELECT/ENDSELECT` loop and reports one refusal per method.

## Not proven

No ABAP runtime differential, A4H comparison, public-corpus survey, explicit field-list mapping, table-form liveness proof, `sy-subrc` equivalence, case/collation equivalence, packed/NUMC conversion equivalence, or performance improvement is proven. The sample has a generated region and the rendering/line-trace integration is registered, but its regeneration could not run without the compiled L0 classes in this worktree.
