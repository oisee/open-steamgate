# DSL L2: a domain rule compiled to L1

Status: slice 1, 2026-09-30. Built on L1 (`docs/dsl-l1.md`) and the template engine
(`docs/abap-templates.md`).

## What L2 is

L1 is a typed model a generator fills; nobody writes it by hand. L2 is what a person writes: a
rule in the terms of a domain -- its tables, its fields, its words. The L2 compiler turns a rule
into an L1 model, and from there the chain is L1's: templates render ABAP, and every output
line keeps its provenance down to the line of the rule it came from.

The compiler (`tools/dsl-l2.mjs`) knows the rule language and the DDIC, and nothing of any
domain: tables, fields and the words of the alert come from the rule. A test greps the compiler
for the demo's domain words and fails on a hit.

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

- the tables exist, and their key resolves (the provider's own refusals pass through);
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
   `check( iv_date ) RETURNING rt_alerts TYPE string_table` (Open SQL, ABAP 7.02, one WHERE
   condition per line so each line traces to its own node); `recipes/l2-check-test/template.tpl`
   renders its test class: one method per example that inserts the example's rows, calls `check`,
   compares the alerts with `expect` order-insensitively, and deletes its rows again in
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
   builds a copy of the rule with `>` changed to `>=`, transpiles it alone and runs its examples:
   the example departing on the check date fails, so the examples really test the rule.

## Commands

```
node tools/dsl-l2.mjs build <rule.l2.yaml> --out <dir> [--ddic <folder>]...
node tools/dsl-l2.mjs check <rule.l2.yaml> --out <dir> [--ddic <folder>]...
```

`build` writes the class (`.clas.abap`, `.clas.testclasses.abap`, `.clas.xml`) and both traces.
`check` regenerates into a scratch folder and compares byte for byte; exit 1 on drift. Both need
a built tree (`npm run transpile`): the templates render in the ABAP runtime. `--ddic` defaults to
`src` and open-abap-core's DDIC.

## Adding a rule

1. Put the tables it reads under `src/` (abapGit TABL XML), if they are not there.
2. Write `src/<folder>/<name>.l2.yaml` with examples that pass and one that would fail if the rule
   were written wrong -- a boundary, as the demo's check-date example is.
3. `node tools/dsl-l2.mjs build src/<folder>/<name>.l2.yaml --out src/<folder>`, then
   `npm run transpile` and `node tools/osd-unit-run.mjs`.
4. Commit the rule and the generated files together; `check` keeps them in step.

`*.l2.yaml` and `*.trace.json` are excluded from the transpile and from abaplint
(`abap_transpile.json`, `abaplint.jsonc`): abaplint would read a trace as a file of the class and
a rule file as an object of an unknown type.

## Not in slice 1

More than one `exists`, `or`, `not`, parameters other than `$date`, joins, aggregates, a
condition on the outer table inside `where`, a message class for the alert, and running a rule on
A4H.
