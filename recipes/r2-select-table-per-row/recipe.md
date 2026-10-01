# R2: SELECT INTO TABLE per loop row becomes one FOR ALL ENTRIES read

R2 lifts a `SELECT ... INTO TABLE lt_x` from a loop over `T`. It fetches the
matches for all driver rows once, sorts that result by the correlation fields
and the DDIC primary key, and rebuilds `lt_x` at the original SELECT position
for each row. The original statements before and after the SELECT keep their
order and text model. R2 is rendered by `template.tpl` from the abaplint model
in `tools/lift.mjs`; a generated region names its source method as
`from=before`.
The copied source spans retain comments between the surrounding body
statements; a body statement that belongs to a chain is refused.

## Obligations

| obligation | why | closed by |
|---|---|---|
| One simple outer `LOOP AT T ASSIGNING <R>` in the method | the template replaces that loop | `methodContext` and `loopHead` in `tools/lift.mjs`; otherwise `shape/loops` or `shape/loop-*` |
| No body statement is part of an ABAP chain | chain members share source tokens, so slicing one member can copy invalid ABAP | shared statement tokens in `modelR2FromSource`; `chain/body` |
| Exactly one top-level `SELECT ... INTO TABLE lt_x` in the loop; no other database operation there | this is the only query whose position is moved | `modelR2FromSource` over abaplint statements; `shape/select`, `shape/select-position`, or `no other database statement in the loop` |
| One transparent source table, a simple selected column list, and a simple table target | joins, aliases, aggregates and alternate INTO forms have different result mapping | abaplint `SQLFrom`, `SQLFieldList`, and `SQLIntoTable`; `shape/select` |
| WHERE is a conjunction of `D-field = <R>-component` correlations plus comparisons of D fields to literals | the same condition can be applied to the bulk read without depending on another row or runtime value | abaplint `SQLCond` and `SQLCompare`; `correlation` or `conditions` |
| Correlation columns are primary-key fields and their row components resolve to the DDIC key types | the driver lookup must compare the same key values | `abapKeyModel` from `dsl-ddic` plus abaplint `SyntaxLogic`; `correlation`, `shape/row`, or `key types` |
| The SELECT says `ORDER BY PRIMARY KEY` | an unordered result cannot be reconstructed faithfully | abaplint `SQLOrderBy`; `order` |
| FOR ALL ENTRIES cannot collapse two BEFORE rows into one | FAE removes duplicate selected rows. The bulk SELECT adds every DDIC primary-key column missing from BEFORE's list; reconstruction copies only BEFORE's selected columns into `lt_x` | `source.fields` contains the full logical primary key and original columns; `result.assignments` projects away added key columns |
| `lt_x` is a resolved table, written only by this SELECT in the loop, read after it during the iteration, and not read after the loop | the rebuilt target must have the same shape and lifetime as the original target | abaplint `SyntaxLogic` read/write positions and the loop structure; `shape/result-*` or `result *` |
| `lt_x` is a standard table with one resolved component per selected column, each with the selected column's type | appending must preserve the SELECT's row order and the original positional projection | abaplint `SyntaxLogic` table and line types; `shape/result-table` or `shape/result-types` |
| The SELECT's `sy-subrc` and `sy-dbcnt` values reach the same original statements, and the reconstruction does not leak its `sy-tabix` | the bulk SELECT and local reconstruction loop set system fields differently | the generated template saves/restores fields around the preload, sets `sy-subrc` to 0/4 and `sy-dbcnt` to `lines( lt_x )`, and restores `sy-tabix` at the SELECT position |
| Before the loop, any statement naming `T` together with `ASSIGNING`, `REFERENCE INTO`, `REF #`, `GET REFERENCE`, or `ASSIGN` is refused, regardless of statement kind; any dynamic `ASSIGN (` is refused. In the body, `GET REFERENCE OF` and `REF #` involving `T` or `<R>`, dynamic `ASSIGN (`, and writes through a dereference are refused. A write through a field symbol other than `<R>` is refused when that field symbol may point into `T` or `<R>`: every `ASSIGN`, `ASSIGNING` or `FOR` statement of the method that names it counts as an assignment, and it is unsafe when such a statement names `T` or `<R>` (so `ASSIGN COMPONENT ... OF STRUCTURE <R>` too), a dereference `->` or a component `=>`, a dynamic `ASSIGN`, another unsafe field symbol, or, when `T` is not a local, any attribute or by-reference parameter; a field symbol with no such statement has no known source and is unsafe as well. So `LOOP AT lt_x ASSIGNING <h>` over the result table, the same over another local table, and `ASSIGN ls_local TO <x>` are accepted. `LOOP AT` / `READ TABLE ... ASSIGNING` over `lt_x` is not a write of `lt_x` for the next obligation, since BEFORE's SELECT and AFTER's rebuild both replace the whole table at the SELECT. `T` is also refused in any body statement outside the SELECT, and no correlation field may be written through `<R>` before the SELECT, nor `<R>` passed to any call there. When `T` is a class or instance attribute or a by-reference `IMPORTING`, `EXPORTING` or `CHANGING` parameter (read from the signature and from abaplint's parameter metadata, so `!ct_rows` counts), a method call in the body is refused, and so is every other call into code the method does not show: a body statement whose kind is not on the allow-list of local kinds below, or one holding `NEW`; `VALUE( )` parameters are locals. When `T` is a local, such a statement is refused only when it names `T`, or `<R>` before the SELECT. Before the SELECT, a statement naming `<R>` whose kind is not on the allow-list of reported writes below is refused too. A file with a statement abaplint cannot parse, or with a syntax error, is refused last, since the structure and the read and write positions are then incomplete. | the prefetch reads the driver rows before the loop and cannot follow row aliases, indirect writes, or prove what a call mutates | `modelR2FromSource` token and write-position guards; `loop table alias`, `loop row reference`, `dynamic ASSIGN`, `field-symbol write`, `dereference write`, `loop table method call`, `loop table call`, `key not written before the read`, `shape/parse`, `shape/syntax`, or `shape/loops` |
| `T` is not empty before `FOR ALL ENTRIES` | an empty FAE driver reads the whole source table | the generated `IF T IS NOT INITIAL` guard; the host test counts zero calls for empty `T` |
| Generated names are unused | declarations must not shadow the method's locals or parameters | `requireNamesFree` in `tools/lift.mjs`; `names` |

## The two allow-lists

Both are lists of what is known, so a statement kind nobody thought of is
refused rather than let through (`LOCAL_KINDS` and `KEY_WRITE_KINDS` in
`tools/lift.mjs`).

**Local kinds**, statements that run no code of their own: `MOVE` and
assignments, `MOVE-CORRESPONDING`, `CLEAR`, `FREE`, `IF` / `ELSEIF` / `ELSE` /
`ENDIF`, `CHECK`, `CASE` / `WHEN` / `WHEN OTHERS` / `ENDCASE`, `DO` / `ENDDO`,
`WHILE` / `ENDWHILE`, `LOOP` / `ENDLOOP`, `EXIT`, `CONTINUE`, `READ TABLE`,
`APPEND`, `INSERT` (internal table), `MODIFY` (internal table), `DELETE`
(internal table), `COLLECT`, `SORT`, `CONCATENATE`, `CONDENSE`, `SPLIT`,
`TRANSLATE`, `SHIFT`, `REPLACE`, `FIND`, `OVERLAY`, `DESCRIBE`, `ASSIGN`,
`UNASSIGN`, `GET REFERENCE`, the `SELECT` itself, `DATA`, `FIELD-SYMBOLS`, and
comments. A method call or `NEW` inside one of them is still a call. Anything
else counts as a call: `PERFORM`, `CALL FUNCTION`, `CALL DIALOG`,
`CALL TRANSFORMATION` (an XSLT can call ABAP), `MODIFY ENTITIES` (behaviour
handlers), `CREATE OBJECT`, `RAISE`, `CALL BADI`, `COMMIT WORK`, `WAIT`,
`SUBMIT`, `CALL TRANSACTION`, `CALL SCREEN`, `IMPORT`, `GET PARAMETER`, and
`WRITE`, whose conversion exits are function modules.

**Reported writes**, kinds whose writes of `<R>` abaplint reports as write
positions, so a key written by them is seen: `MOVE`, `MOVE-CORRESPONDING`,
`CLEAR`, `CONCATENATE`, `CONDENSE`, `SPLIT`, `TRANSLATE`, `SHIFT`, `REPLACE`,
`READ TABLE`, `LOOP`, `APPEND`, `INSERT`, `MODIFY` (internal table), `ASSIGN`,
and the read-only conditions `IF`, `ELSEIF`, `CHECK`, `CASE`, `WHEN`, `WHILE`.
`test/lift-r2.mjs` writes a key with each write-capable one and expects the
refusal to name the write. `OVERLAY <R>-kind` is the case that shows why the
list is needed: abaplint reports no write for it, and before the allow-list it
was accepted.

## Scope and evidence

The accepted order is intentionally narrow: only `ORDER BY PRIMARY KEY` is
proved. R2 does not accept an unordered SELECT or try to infer that a body is
order-insensitive. The SELECT list may omit primary-key fields; AFTER fetches
those fields to keep FAE rows distinct and projects them away while rebuilding
`lt_x`.

The local differential cannot show whether the explicit `SORT` is needed:
this runtime sorts FOR ALL ENTRIES results as part of duplicate removal. SAP
does not guarantee that order, so the template's `SORT` by correlation keys
then primary-key fields is required on a real system. A4H was not measured for
this order claim; see [`ANORMALIES.md`](../../ANORMALIES.md).

The model leaves these environmental assumptions open: the source table is
not concurrently changed while the loop runs; reads are confined to one
client; and a prior body statement may skip a later row's SELECT even though
the bulk prefetch can already have fetched its key. When `T` is an attribute
or a by-reference parameter, two more are open, because neither can be seen
from inside the method: no data reference into `T` was set outside it (by
another method, into an attribute `T`), and no other by-reference parameter
or attribute aliases `T` or one of its rows (a caller may pass the same table
twice). The body guards refuse every write through such a reference that they
can see: a dereference write (`MODIFY gr->*`, `gr->kind = ...`, a `LOOP` or
`ASSIGN` over `gr->*`), a field symbol assigned from one, and every call that
could write through one. What stays open is a write the method makes directly
to another parameter or attribute that happens to be `T`'s alias, which is not
a dereference, and is the second assumption. The template does not
claim to preserve database side effects between iterations.

`test/lift-r2.mjs` checks model refusals, template rendering (including the
rendered sort columns), comment retention, `sy-tabix` restoration, and
database-call counts. Its differential builds an accepted variant of BEFORE
into a class of its own with AFTER rendered from the model, transpiles it in
the test and compares the rows, system fields and reads of both methods; the
accepted field-symbol forms and a local `T` go through it. The demo's ABAP Unit test compares BEFORE and AFTER for multiple hits
in primary-key order, a miss, a repeated key, an empty driver, and rows both
matching and failing the extra `active = 'X'` condition. It also compares the
emulated system fields. On this runtime a nonempty driver is one FAE database
call; BEFORE makes one SELECT call per loop row.
