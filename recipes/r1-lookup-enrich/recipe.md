# R1 lookup-enrich: a SELECT SINGLE per loop row becomes one SELECT

The shape, in the semantic-patch form of `docs/verified-lift.md` 4.4:

```
@@ itab T; field-symbol R; dbtab D; key-columns K1..Kn of D; columns C1..Cm of D @@
- LOOP AT T ASSIGNING R.
-   SELECT SINGLE C1..Cm FROM D INTO R-c1..R-cm
-     WHERE K1 = R-k1 AND ... AND Kn = R-kn.
- ENDLOOP.
+ <template.tpl>
```

**Obligations**, each closed by a named check:

| obligation | why | closed by |
|---|---|---|
| the loop body is that one statement | anything else may depend on the order of reads | `tools/lift.mjs model` (shape) |
| `K1..Kn` is the whole primary key of `D` without the client | then at most one row answers, so the hashed table can be unique and "which row" is not a question | `tools/lift.mjs model` against the table's DDIC |
| each `R-ki` has the type of `Ki` | `FOR ALL ENTRIES` and `READ TABLE` compare after conversion; a different type is a different comparison | open: needs the type-aware model (L1) |
| a miss leaves `R-ci` as it was | `SELECT SINGLE` that finds nothing does not touch its target | differential test `a_miss_keeps_the_old_value`; checked failing with a miss that clears |
| no rows, no read | `FOR ALL ENTRIES` over an empty table reads the whole table | the `IS NOT INITIAL` guard; visible only in cost, so `test/lift-r1.mjs` counts rows fetched |
| a key asked twice | `FOR ALL ENTRIES` drops duplicates | differential test `the_same_key_twice` |

**Equivalence declared:** the rows of `T` after the loop. Not declared: `sy-subrc`
and `sy-dbcnt` after the loop, the order the database was read in.

**Cost:** `n` round trips become at most one (plus one per 5-10 thousand keys
on a system that splits `FOR ALL ENTRIES`).

**Not handled here:** `INTO CORRESPONDING`, a WHERE with anything but key
equalities, a loop over `INTO` a work area, a SELECT reached through a method
call (the finder counts those; R1 does not rewrite them).

## Where the shape occurs

`node tools/lift.mjs find <folder>`, 2026-09-30. "Direct" is what abaplint's
`db_operation_in_loop` reports: a database statement inside LOOP/DO/WHILE.
"Via own method" is a loop that calls a method of the same object whose body
does one, which the rule cannot see. Neither is yet a candidate for R1: that
takes `model`, and its obligations.

| corpus | files | loops | direct | of them `SELECT SINGLE` | via own method |
|---|---|---|---|---|---|
| [abapGit](https://github.com/abapGit/abapGit) `src/` at `3b6485b` | 743 | 1074 | 35 | 13 | 14 |
| [spacelab-problem-management-backend-live](https://github.com/simplicity-goodness-truth/spacelab-problem-management-backend-live) | 133 | 137 | 26 | 2 | 6 |
| [ABAPToTheFuture04](https://github.com/hardyp/ABAPToTheFuture04) | 116 | 89 | 2 | 2 | 2 |
| SAP-delivered SEGW samples (local, not named) | 322 | 652 | 10 | 0 | 2 |
| this tree, `src/` | 154 | 388 | 6 | 2 | 0 |

In abapGit the indirect loops add 40% to what the rule reports.
