# DSL L2: a domain rule compiled to L1

Status: slices 1 and 2, 2026-09-30. Built on L1 (`docs/dsl-l1.md`) and the template engine
(`docs/abap-templates.md`).

## What L2 is

L1 is a typed model a generator fills; nobody writes it by hand. L2 is what a person writes: a
rule in the terms of a domain -- its tables, its fields, its words. The L2 compiler turns a rule
into an L1 model, and from there the chain is L1's: templates render ABAP, and every output
line keeps its provenance down to the line of the rule it came from.

The compiler (`tools/dsl-l2.mjs`, with the interpreter and the case derivation in
`tools/dsl-l2-eval.mjs`) knows the rule language and the DDIC, and nothing of any domain: tables,
fields and the words of the alert come from the rule. A test greps both files for the demo's
domain words and fails on a hit.

## Slice 1: the language

A rule is one YAML file, `<name>.l2.yaml`:

```yaml
rule: maintenance-ship-no-future-voyage
class: zcl_l2_maintenance_ship        # optional; default ZCL_L2_<RULE>, at most 30 characters
title: A ship in maintenance has no voyage departing after the check date
for: ZOSD_L2_SHIP as ship
when: ship.status = 'M'               # optional
forbid:
  exists: ZOSD_L2_VOY as voy
  where: voy.ship_id = ship.ship_id and voy.dep_date > $date
alert: "{ship.ship_id} {ship.name}: in maintenance, voyage {voy.voyage_id} departs {voy.dep_date}"
boundaries: auto                      # optional, slice 2: auto, or a list such as [when/1, forbid/where/2]
examples:
  - name: flagged
    date: 20261001
    rows:
      ZOSD_L2_SHIP: [{ship_id: S001, name: Albatross, status: M}]
      ZOSD_L2_VOY: [{voyage_id: V00001, ship_id: S001, dep_date: 20261005}]
    expect:
      - "S001 Albatross: in maintenance, voyage V00001 departs 20261005"
```

It reads: for every row of the `for` table matching `when`, every row of the `exists` table
matching `where` is a violation, and each is one alert line.

Grammar (the expressions are parsed by a small recursive-descent parser over tokens):

```
source      := TABLE 'as' ALIAS
conjunction := comparison ('and' comparison)*
comparison  := operand ('=' | '<>' | '<' | '>' | '<=' | '>=') operand
operand     := ALIAS '.' FIELD | 'literal' | NUMBER | '$date'
alert       := text with {ALIAS.FIELD} holes
```

Checked against the DDIC (`tools/dsl-ddic.mjs`, abaplint's registry, `DDIC_PROVIDER` and its
`literalType`), every error naming the rule file and line (`file:line: message`):

- the tables exist, and their key resolves (the provider's own refusals pass through); `for` and
  `exists` are two different tables, and `where` holds at least one equality between a field of
  each (the join condition of slice 2's one query);
- `class` and `title` are text, the title one line;
- every `alias.field` exists; `when` may name only the `for` alias, `where` both;
- each comparison names a field of the table being selected on one side (a condition written the
  other way round is mirrored); the other side is a literal, `$date`, or a field of the outer
  alias, never a second field of the same table;
- both sides have compatible DDIC types: the same built-in type field against field, DATS against
  `$date`, and a literal that fits the field by the rules of the engine's `literal` filter (a
  CHAR literal no longer than the field, a DATS literal eight digits, an integer within the range
  of INT1/INT2/INT4/INT8, a packed number within its digits and decimals, one source line and at
  most 255 characters once quotes are doubled). The rules are written twice, in the filter and in
  `misfit`, so that an error names the rule line; `test/dsl-l2.mjs` runs boundary values of every
  type through both and fails when they disagree;
- every `{hole}` names a field of a declared alias;
- a rule carries its proof: it has at least one example, and every example states `expect`
  (`expect: []` when it expects no alert; a missing key is an error);
- example rows name only the rule's own tables, give every key field, and their values fit.

The YAML is read by js-yaml (the reader `tools/stg-compile.mjs` uses) with its FAILSAFE schema,
so a value stays the text written. js-yaml keeps no positions, so `lineIndex` reads each key's
and list item's line from the file's text; what sits inside a flow collection (`[{...}]`) takes
the line of the key holding it.

## The chain

1. **L1 model** (`compileRule`): plain data. Every node has `@id` (`rule/<name>`, `.../for`,
   `.../when/<n>`, `.../forbid`, `.../forbid/where/<n>`, `.../alert/text/<n>`,
   `.../alert/hole/<n>`, `.../example/<name>`, its rows, fields and expected lines) and
   `rule_line`. Every literal carries its sibling `@type` in DDIC terms (`value@type`,
   `date@type`, `label@type`), so the templates print it with `| literal`. Names the templates
   print (`lt_<alias>`, `ls_<alias>`, `mt_<table>`, test method names) are decided here.
   A table node carries the line where its table enters the rule (`for:` or `exists:`).
2. **ABAP** through `ZCL_OSD_TPL`: `recipes/l2-check/template.tpl` renders `ZCL_L2_<RULE>` with
   `check( iv_date ) RETURNING rt_alerts TYPE string_table`: **one Open SQL statement** (slice 2),
   `SELECT ... FROM <for> AS a INNER JOIN <exists> AS b ON <the equalities between their fields>
   INTO CORRESPONDING FIELDS OF TABLE ... WHERE <the rest> ORDER BY <the for key> <the exists
   key>`, ABAP 7.02 (`~`, no `@`), one condition per line so each line traces to its own node; the
   alert lines are built from the joined rows, which come back in that stable order.
   `recipes/l2-check-test/template.tpl` renders its test class: one method per example and per
   derived case (below) that inserts the rows, calls `check` and `check_reference`, compares the
   two, compares `check` with `expect` order-insensitively, and deletes its rows again in
   `teardown` (RISK LEVEL DANGEROUS, the rule's own tables only). The generated SELECTs carry no MANDT condition:
   that is correct ABAP, because on a system the kernel adds the logon client to Open SQL. This
   runtime is single-client by a settled decision (ANORMALIES `no-implicit-mandt`, upstream
   abaplint/transpiler#606), so do not add a MANDT condition to the template. Both pass the `abap` profile
   (`ZCL_OSD_DSL_PROFILE`); `build` exits nonzero on an error finding.
3. **Trace**: `<class>.clas.trace.json` (and `<class>.clas.testclasses.trace.json`), one entry per
   output line: `line` -> `template_line` -> `node` (the nearest `@id` on the data path) ->
   `rule_line`. The `AND dep_date > iv_date` line of the demo traces to the rule's `where:` line,
   the alert text lines to its `alert:` line, and in the test class the `check( iv_date = ... )`
   call to its example's `date:` line.
4. **Proof**: the generated test class runs with every other ABAP Unit test. `test/dsl-l2.mjs`
   builds the rule, changes `>` to `>=` in the generated ABAP (the query and the reference alike,
   the expectations staying those of the unmutated rule), transpiles it alone and runs the tests:
   the example departing on the check date fails and so does the derived `b_dep_date_eq`; with
   that example cut from a copy of the rule, the derived case alone still fails. The same for
   `status = 'M'` changed to `<>`, and for a JOIN that lost its ON equality, which the comparison
   with `check_reference` catches.

## Slice 2: one query, and the boundaries found by the compiler

### One query instead of a SELECT per row

Slice 1 rendered `for` plus `forbid.exists ... where` as a SELECT on the `exists` table for every
row of the `for` table: the pattern recipe R1 (verified lift) exists to remove. Slice 2 renders
`check` as one statement with an INNER JOIN. The `where` equalities between a field of each table
become the `ON`; `when` and every other `where` comparison go in `WHERE`, qualified `alias~column`.
The columns the alert and the order need are selected under the names `<alias>_<column>` (at most
30 characters; the compiler says so when an alias makes one longer) into one result line, and
`ORDER BY` the `for` key and then the `exists` key. `test/dsl-l2.mjs` counts the database calls
as `test/lift-r1.mjs` does: one per `check`, however many `for` rows; 1 + n for the reference.

The direct form stays as the reference: the slice-1 nested form is rendered into the generated
test class as `check_reference` (private to the test). Every example and every derived case runs
both, asserts that they answer alike **in the same order**, and then asserts the case's `expect`
against `check`. The optimised translation is proven equal to the obvious one, the way verified
lift proves AFTER equal to BEFORE.

### The interpreter

`evaluate(rule, rows, params)` (`tools/dsl-l2-eval.mjs`) runs the compiled rule in JavaScript:
the `for` rows that meet `when`, each checked against the `exists` rows that meet `where`, one
alert per pair, the text from the holes. It compares by DDIC type: CHAR ignoring trailing blanks,
DATS / TIMS / NUMC as their digit strings, INT and DEC numerically. The generated tests prove
that the ABAP agrees with it.

- At build time every hand-written example runs through it: when it disagrees with the
  example's `expect`, the build fails with the example's line (`file:line: example "x" expects
  [...] but the rule gives [...]`). A wrong example never reaches ABAP.
- What it does not model: a negative number or a packed (DEC / CURR / QUAN) field **in an alert
  hole**. It prints `10.50`, as a system does; this runtime prints `10.5`
  (`ANOMALY-2026-09-30-concat-packed-drops-decimals`), so such a rule fails its generated test
  here instead of passing quietly. Conditions on packed fields are fine.

### Boundaries

`boundaries: auto` selects every comparison of the rule; a list selects some by their place,
`when/1`, `forbid/where/2` (the numbers of the `@id`s in the model and the trace). For each the
compiler derives cases from the field's DDIC type and the operator:

| comparison | cases |
|---|---|
| ordered type (DATS, TIMS, NUMC, INT*, DEC, CURR, QUAN) against a literal or `$date` | `lt`, `eq`, `gt`: the value one step below, equal, one step above. A step is a day, a second, 1, or 10^-decimals; DATS arithmetic is calendar correct (month ends, 29 February), and a step that leaves the type (255 + 1 in INT1, 99991231 + 1) is skipped and listed under `skipped` |
| equality (or any operator) on a CHAR-like type | `eq`, `ne` (a different value of the same length), `blank` (initial) |
| field = field, the join | `match`, `nomatch` |
| a field compared with an outer field by another operator | `lt`, `eq`, `gt` around the outer value |
| each `exists` | `zero` (no exists row) and `two` (two exists rows for one `for` row, the second with another value in the first key field that no equality fixes) |

A case is a small row set: one row per table, from a base that satisfies every other condition so
that only the condition under test decides. The base is the first example's first rows when they
make the rule fire exactly once, else rows generated from the field types (a value for every
field that satisfies every condition on it). The check date is the first example's. A case
changes one field, then restores the join equalities that are not under test. The expected alerts
come from the interpreter.

**A case must discriminate.** Before a case is emitted the compiler evaluates its rows with
mutants of the condition it targets (every other operator, the literal or parameter one step
either way, the condition dropped); if none changes the alerts, the case would pass whether the
translation is right or wrong, so it is not emitted and is listed under `skipped` ("does not
isolate <condition>"). A changed field keeps its tested value and the other row is adjusted
(the inner field of a join follows an outer one and the other way round; other conditions on the
exists row are re-solved). The `two` case picks a second key value that still satisfies the whole
`where` and needs exactly two alerts, else it is skipped. A field-to-field comparison needs equal
type, length and decimals (the query compares columns, the nested form a converted host value).
NUMC values, literals and alert holes are read at the DDIC length (`'12'` in NUMC 4 is `0012`).

The cases become test methods `b_<column>_<lt|eq|gt|ne|blank|match|nomatch|zero|two>`, in the test
class after the hand-written examples; `<column>` is the field (`<alias>_<column>` when two
conditions name the same field, `c<n>` when that is too long), the whole name at most 30
characters. Every node of a case traces to the rule line of its condition. Every JOIN line
traces to its condition too (`ON` and `WHERE`: the `where:` or `when:` line).

```
node tools/dsl-l2.mjs cases <rule.l2.yaml>      # the derived cases, rows and expected alerts
```

prints the reviewer's view: for each case its method, condition, rows and the alerts expected.
The demo rule derives ten cases (`status`: eq, ne, blank; the join: match, nomatch; `dep_date`:
lt, eq, gt; the `exists`: zero, two).

## Commands

```
node tools/dsl-l2.mjs build <rule.l2.yaml> --out <dir> [--ddic <folder>]...
node tools/dsl-l2.mjs check <rule.l2.yaml> --out <dir> [--ddic <folder>]...
node tools/dsl-l2.mjs cases <rule.l2.yaml> [--ddic <folder>]...
```

`build` writes the class (`.clas.abap`, `.clas.testclasses.abap`, `.clas.xml`) and both traces.
`check` regenerates into a scratch folder and compares byte for byte; exit 1 on drift. Both need
a built tree (`npm run transpile`): the templates render in the ABAP runtime. `--ddic` defaults to
`src` and open-abap-core's DDIC.

## Adding a rule

1. Put the tables it reads under `src/` (abapGit TABL XML), if they are not there.
2. Write `src/<folder>/<name>.l2.yaml` with examples that pass, and `boundaries: auto`; the
   compiler derives the boundary cases itself (`node tools/dsl-l2.mjs cases <file>` shows them).
3. `node tools/dsl-l2.mjs build src/<folder>/<name>.l2.yaml --out src/<folder>`, then
   `npm run transpile` and `node tools/osd-unit-run.mjs`.
4. Commit the rule and the generated files together; `check` keeps them in step.

`*.l2.yaml` and `*.trace.json` are excluded from the transpile and from abaplint
(`abap_transpile.json`, `abaplint.jsonc`): abaplint would read a trace as a file of the class and
a rule file as an object of an unknown type.

## Not yet

More than one `exists`, `or`, `not`, parameters other than `$date`, aggregates, a condition on
the outer table inside `where` beyond the join (a comparison of an `exists` field with an outer
field is allowed; one of only outer fields is not), a `for` and an `exists` on the same table, a
join without an equality, a message class for the alert, derived cases for `or`/`not`, and
running a rule on A4H. The interpreter's agreement with a system is measured here only, on this
runtime (NUMC comparisons against a literal, for one, are the interpreter's reading of the DDIC
and are not exercised by an ABAP test).
