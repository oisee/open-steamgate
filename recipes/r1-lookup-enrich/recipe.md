# R1 lookup-enrich: a SELECT SINGLE per loop row becomes one SELECT

The shape, in the semantic-patch form of `docs/verified-lift.md` 4.4 (on the research branch, at
[`14172d39`](https://github.com/oisee/open-steamgate/blob/14172d39f94051be8bde09bb9c56dbea5e19bc6c/docs/verified-lift.md)):

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
| R1 has one body statement; R1b has one SELECT among other statements | the lookup must be unique and its position known | `tools/lift.mjs model` (shape) |
| R1b places the read at the SELECT's statement index | statements before and after retain their order | `position`, `before`, and `after` from abaplint's statement tree; generated-region test |
| a key component is not written before the SELECT | prefetch uses the original key | abaplint write positions; aliases, method calls carrying the row, and MODIFY of the loop table refuse conservatively |
| no later read of `sy-dbcnt` | READ TABLE does not set it | abaplint read positions; `sy-subrc` remains set by READ TABLE |
| no other database statement in the body | its order relative to the prefetch can matter | `tools/lift.mjs model` (database statement classes) |
| the generated names are free | `lt_lookup` / `<ls_lookup>` declared twice would not compile, or would alias the row | `tools/lift.mjs model` (names) |
| `K1..Kn` is the whole primary key of `D` without the client | then at most one row answers, so the hashed table can be unique and "which row" is not a question | `tools/lift.mjs model` against the DDIC as abaplint resolves it (key includes expanded, data element to domain for CLNT): transparent, the client left out only as the first field and key of a client-dependent table; every key include must be a table in the DDIC given, recursively, since abaplint drops an unresolved key include from the key without a word and skips a missing `CI_`/`SI_` one; a view or suffixed include is refused by name |
| each `R-ki` has the type of `Ki` | `FOR ALL ENTRIES` needs compatible operands ([SAP documentation](https://help.sap.com/doc/abapdocu_752_index_htm/7.52/en-US/abenwhere_logexp_itab.htm)) and `READ TABLE` compares after conversion | `tools/lift.mjs model`: the loop table's line type from abaplint's syntax (a generic table or one with a header line refuses; the field symbol must be a structure typed like the line, and where that does not resolve it stays in `open`) against the column's from the DDIC, same kind, length and decimals, key by key; a key that does not resolve leaves it in `open` without hiding a mismatch in another, and so does an integer key unless the column is INT4 and the row's component a data element of type INT4, because abaplint gives INT1, INT2 and INT4 one type with no width |
| a miss leaves `R-ci` as it was | `SELECT SINGLE` that finds nothing does not touch its target | differential test `a_miss_keeps_the_old_value`, checked failing with a miss that clears; the same on A4H's kernel (2026-09-30) |
| no rows, no read | `FOR ALL ENTRIES` over an empty table reads the whole table | the `IS NOT INITIAL` guard; visible only in cost, so `test/lift-r1.mjs` counts the database calls (0) |
| a key asked twice | `FOR ALL ENTRIES` drops duplicates | differential test `the_same_key_twice` |

**Equivalence declared:** the rows of `T` after the loop, under two
preconditions the recipe cannot check: nobody writes the table while the loop
runs (BEFORE reads it `n` times and could see a commit in between; AFTER reads
it once), and the reads are confined to one client (a system does that
implicitly; this runtime does not, see `docs/luw-buffer.md` and ANORMALIES on
MANDT, so a fixture keeps one client). Not declared: `sy-subrc` and `sy-dbcnt`
after the loop -- a caller that reads them needs its own obligation. The model
lists what it did not check under `open`.
R1b also lists `prefetch may read keys the loop skips` in `open`: control flow
before the SELECT remains in place, but the prefetch can do extra work.

**Cost:** `n` round trips become a few blocks of `FOR ALL ENTRIES`. Measured on
A4H (2026-09-30, 42 rows, 20 repetitions): 17.2 ms before, 1.6 ms after, with the
same rows. Not measurable in OSG yet: the runtime sends `FOR ALL ENTRIES` one row
at a time (`ANOMALY-2026-09-30-fae-one-select-per-row`).

**Not handled here:** `INTO CORRESPONDING`, a WHERE with anything but key
equalities, a loop over `INTO` a work area, a SELECT reached through a method
call (the finder counts those; R1 does not rewrite them).

## Where the shape occurs

`node tools/lift.mjs find <folder>`, 2026-09-30, over the loops inside class
implementations (a FORM or a function module is not counted yet). "With DB" is
a loop with a database statement anywhere inside it, which is what abaplint's
`db_operation_in_loop` reports. "Via own method" is a loop without one that calls a
method of the same class (no receiver, or `me->`) whose body does one, which the
rule cannot see. Neither is yet a candidate for R1: that takes `model`, and its
obligations.

| corpus | files | loops | with DB | with `SELECT SINGLE` | via own method |
|---|---|---|---|---|---|
| [abapGit](https://github.com/abapGit/abapGit) `src/` at `3b6485b` | 743 | 1074 | 35 | 13 | 14 |
| [spacelab-problem-management-backend-live](https://github.com/simplicity-goodness-truth/spacelab-problem-management-backend-live) | 136 | 115 | 15 | 2 | 6 |
| [ABAPToTheFuture04](https://github.com/hardyp/ABAPToTheFuture04) | 123 | 88 | 2 | 1 | 2 |
| SAP-delivered SEGW samples (local, not named) | 374 | 581 | 10 | 0 | 2 |
| this tree, `src/` | 154 | 379 | 4 | 1 | 0 |

In abapGit the loops reached through an own method add 40% to what the rule reports.

## What stops the rest

`node tools/lift.mjs survey <folder>` puts every method with a `SELECT SINGLE`
in a loop through `model` and counts the refusals by obligation and sub-kind
(2026-09-30; DDIC from `src`, open-abap-core and the corpus itself):

| corpus | candidates | accepted | refused by |
|---|---|---|---|
| abapGit, before R1b | 13 | 0 | `shape/body` 7, `shape/loop-where` 2, `shape/loop-into` 2, `shape/loop-table` 1, `shape/loops` 1 |
| abapGit, after R1b | 13 | 0 | `shape/select` 3, `no other database statement in the loop` 3, `shape/loop-where` 2, `shape/loop-into` 2, `shape/loop-table` 1, `shape/loops` 1, `full key` 1 |
| spacelab | 2 | 0 | `shape/loop-other` 2 |
| this tree, `src/` | 1 | 1 (the demo) | |

The `object_view` deserialize candidate now reaches the DDIC check, but its
`DD03L` SELECT constrains `TABNAME` and `FIELDNAME` only. The DDIC is absent
from the local corpus; published DD03L layouts show additional primary-key
fields `AS4LOCAL`, `AS4VERS`, and `POSITION`, so supplying its DDIC would
still refuse `full key`. See [DD03L layout](https://www.sapdatasheet.org/abap/tabl/dd03l.html).
Accepting this example would require a separate recipe for nonunique lookups.
