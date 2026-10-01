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
| Before the loop, any statement naming `T` together with `ASSIGNING`, `REFERENCE INTO`, `REF #`, `GET REFERENCE`, or `ASSIGN` is refused, regardless of statement kind; any dynamic `ASSIGN (` is refused. In the body, `GET REFERENCE OF` and `REF #` involving `T` or `<R>`, dynamic `ASSIGN (`, writes through a field symbol other than `<R>`, and writes through a dereference are refused. `T` is also refused in any body statement outside the SELECT, and no correlation field may be written through `<R>` before the SELECT. Method calls are refused when `T` is a class or instance attribute or a by-reference `IMPORTING` / `CHANGING` parameter. | the prefetch reads the driver rows before the loop and cannot follow row aliases, indirect writes, or prove what a method mutates | `modelR2FromSource` token and write-position guards; `loop table alias`, `loop row reference`, `dynamic ASSIGN`, `field-symbol write`, `dereference write`, `loop table method call`, `key not written before the read`, or `shape/loops` |
| `T` is not empty before `FOR ALL ENTRIES` | an empty FAE driver reads the whole source table | the generated `IF T IS NOT INITIAL` guard; the host test counts zero calls for empty `T` |
| Generated names are unused | declarations must not shadow the method's locals or parameters | `requireNamesFree` in `tools/lift.mjs`; `names` |

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
the bulk prefetch can already have fetched its key. The template does not
claim to preserve database side effects between iterations.

`test/lift-r2.mjs` checks model refusals, template rendering (including the
rendered sort columns), comment retention, `sy-tabix` restoration, and
database-call counts. The demo's ABAP Unit test compares BEFORE and AFTER for multiple hits
in primary-key order, a miss, a repeated key, an empty driver, and rows both
matching and failing the extra `active = 'X'` condition. It also compares the
emulated system fields. On this runtime a nonempty driver is one FAE database
call; BEFORE makes one SELECT call per loop row.
