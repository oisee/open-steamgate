# DSL L2: a domain rule compiled to L1

Status: slices 1, 2 and 3, 2026-09-30. Built on L1 (`docs/dsl-l1.md`) and the template engine
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

## Slice 3: or, not, several exists, require

### The language

```yaml
when: ship.status = 'M' or ship.status = 'D'
forbid:
  exists: ZOSD_L2_CREW as crew
  where: crew.ship_id = ship.ship_id
    and not (crew.role = 'K' or crew.since > $date)
```

```
condition   := disjunction
disjunction := conjunction ('or' conjunction)*
conjunction := negation ('and' negation)*
negation    := 'not' negation | '(' disjunction ')' | comparison
```

`not` binds tighter than `and`, `and` tighter than `or`; parentheses group. The model keeps the
tree (`when.tree`, `clauses[n].tree`: `{op: and | or, items}`, `{op: not, item}`,
`{op: cmp, index}`), and the comparisons stay a list in the order written, each with its own
`@id` (`when/2`, `forbid/where/3`) and **its own rule line**: a condition written over several
lines (a plain scalar continued on more indented lines, or `|` / `>`) gives each comparison the
line it stands on. When the lines, joined the way YAML joins them, are not the value js-yaml read
(quotes, escapes, blank lines, indentation kept by `|`), every comparison takes the key's line.
An alias may not be `and`, `or`, `not` or `as`.

**Several exists.** `forbid:` holds one clause (`exists` + `where`, as before), or a list of two
or three under `all:` or `any:`:

```yaml
forbid:
  all:                                   # every clause matches: one alert per combination
    - exists: ZOSD_L2_VOY as voy
      where: voy.ship_id = ship.ship_id and voy.dep_date > $date
    - exists: ZOSD_L2_CREW as crew
      where: crew.ship_id = ship.ship_id and (crew.role = 'C' or crew.role = 'P')
alert: "{ship.ship_id}: voyage {voy.voyage_id}, crew {crew.crew_id}"
```

Under `all` the alert may name every alias. Under `any` each matching row of each clause is one
alert: a clause may carry its own `alert:` (holes from `for` and its own alias), and the rule's
`alert:` is shared by the clauses that do not, and may name only `for` fields. A clause's `where`
sees `for` and its own alias, not another clause's. Under `any` two clauses may read the same
table under different aliases (each is its own query; in the derived cases each clause gets a row
of its own in that table, and a case whose rows would share a key is skipped). Under `all` and
`forbid` every table is read once: a clause's `zero` case empties its table, which would empty
the other clause too.

**`require:`** is the dual of `forbid:`: one `exists` + `where`, and the alert fires for a `for`
row that meets `when` when **no** row matches. Its alert names only `for` fields (there is no row
of the other table to name).

**Duplicates** in one conjunction (or disjunction) are an error at the second one's line. Two
comparisons are the same after the mirroring every comparison gets anyway (the selected table's
field on the left: `a = b` and `b = a`, `a < b` and `b > a` meet), the other side compared as the
field holds it (CHAR without trailing blanks, `12.5` and `12.50` in a DEC alike). The same
comparison in two different groups (`(a and b) or (a and c)`) is fine. A `not` and a group are
compared as units, the items of a group in any order: `not a and not a` is refused, and so is
`(a or b) and (b or a)`; `a and not a` is not a duplicate.

### The lowering

- Every `where` needs, among its top-level conjuncts (joined by `and`, not under `or` or `not`),
  an equality with a `for` field: it becomes the clause's `ON` (for `require`, the correlation of
  the subquery). A clause without one is refused with the reason; for `all` the reason says that
  every clause joins the `for` table in the one query.
- `when` and the rest of each `where` are one `and` in `WHERE`, one comparison per line.
  A group inside a group is parenthesised, and so is everything after a `NOT`, so the lines never
  lean on Open SQL's precedence (which is the rule language's). A line holds one comparison and
  its parentheses.
- **No line over 255 characters.** An alert text (up to 255 characters as a literal) is cut into
  pieces of at most 100, each its own `&&` line; an expected alert of a test method that does not
  fit one literal is built in `lv_exp` the same way (`APPEND` takes no expression in 7.02). What
  the `abap` profile still refuses (a long example name in the assert call's line, a long CHAR
  literal after its column) is a `RuleError` at the rule line of the node the line traces to,
  raised by `renderRule` before any file is written, so `build`, `check` and the API refuse it
  alike. Before, the profile's error only made the `build` command exit 1, after writing the
  files, and `check` and `buildRule` did not look at it.
- `forbid` with one clause or `all:` is **one** `SELECT`: `for INNER JOIN` each clause in turn,
  ordered by the `for` key and each clause's key. `any:` is **one query per clause** (7.02 Open SQL
  has no `UNION`), each into its own table (`lt_join1`, `lt_join2`), and the alerts come clause
  by clause, each clause in key order. `check` makes as many database calls as the rule has
  clauses, whatever the number of rows; `test/dsl-l2.mjs` counts them.
- `require` is **one** `SELECT` on the `for` table with a correlated subquery:
  `WHERE <when> AND NOT EXISTS ( SELECT * FROM <table> AS <alias> WHERE <where> )`, the outer
  field written `for_alias~field`. **Chosen after measuring** (2026-09-30): the transpiler takes
  the 7.02 form, passes the subquery through to SQL with its correlation, and SQLite answers it;
  a probe over five ships and five voyages gave the expected rows for `OR`, `NOT ( ... )` and
  `NOT EXISTS` against the nested form. So the FOR ALL ENTRIES fallback the spec named was not
  needed, and no anomaly was found. (The SQLite client of the runtime turns every `~` of the
  statement into `.`, which is how `ship~ship_id` inside the subquery reaches the database.)
- `check_reference` stays the direct nested form for every construct: a `SELECT` per row of the
  table before it, `LOOP` for `forbid`, `IF lt_x IS INITIAL` for `require`, one pass per clause for
  `any` (clause by clause, the order `check` answers in).

### The interpreter and the derived cases

`evaluate` walks the trees. Two-valued logic is enough: a field is never NULL here (every row is
written by an ABAP `INSERT`, which fills every column, and every join is an inner join), so
`not` is plain negation.

A case must make its comparison decide. The compiler walks from the tree's root to the
comparison: under an `and` the other items must hold, under an `or` they must not, a `not`
passes the decision through; every other tree of the rule holds. Rows are solved for that (a
tree's ways to come out true or false are enumerated, at most 64 per tree), starting from the
first example's first rows, and then the comparison's field takes its boundary values as in
slice 2. Under a `not` the mutants are the same and the expected result flips (the interpreter
computes it). Under `require` a comparison of `when` is tested with no exists row, since with one
the rule stays silent whatever `when` says.

The discriminate guard stays mandatory. Its mutants of a comparison are: always true (dropped
from an `and`), always false (dropped from an `or`), every other operator, and the literal or
parameter one step either way. The structural cases have a guard of their own: some clause
replaced by one that always matches, or by one that never does, must change the alerts.

| rule | structural cases |
|---|---|
| `forbid`, one clause | `b_exists_zero`, `b_exists_two` (as in slice 2) |
| `all` | per clause `b_<alias>_zero` (that clause unmatched: no alert), `b_<alias>_two` |
| `any` | per clause `b_<alias>_only` (only that clause matches), `b_<alias>_two`; `b_exists_zero` |
| `require` | `b_exists_zero` (no exists row: the alert), `b_exists_one` (one matching row: none) |

`<alias>` falls back to `exists<n>` when a name would pass 30 characters.

### Demo

Beside the slice 1-2 rule, on the same fleet with a crew table (`ZOSD_L2_CREW`):
`src/l2demo/grounded_ship_crew.l2.yaml` (`or` and `not`, its `where` over two lines; 6 examples,
16 derived cases) and `src/l2demo/ship_captain.l2.yaml` (`require`; 6 examples, 13 derived
cases). The slice 1-2 demo's ABAP did not change; its traces did, where a line that named no
value (`TYPES: BEGIN OF`, `ORDER BY`, the reference's `SELECT` lines) traced to the rule's root
and now traces to its query or its level.

`test/dsl-l2.mjs` also builds a synthetic `all` rule and a synthetic `any` rule over the three
fleet tables and runs them, and mutates the generated ABAP once per construct: `OR` made `AND`,
a `NOT` dropped, `NOT EXISTS` made `EXISTS` (the reference's `IS INITIAL` made `IS NOT
INITIAL`), and one clause of `all` taken out of the query and the reference alike; each turns
its cases red.

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

## Slice 4: count with a threshold

`limit:` counts related rows for each `for` row that passes `when`. It takes
`count: TABLE as alias`, a slice-3 `where:` with a top-level equality to the
`for` table, and exactly one threshold: `more_than: n` or `at_least: m`.
Thresholds are non-negative INT4 integers; `at_least: 0` is refused because it
holds for every `for` row. `more_than: 0` and `at_least: 1` mean existence,
with one alert per `for` row. `limit` cannot be combined with `forbid` or
`require`. The alert names fields of the `for` row and may use `{count}`;
the counted table has no single row to name. The interpreter prints the count
with JavaScript's integer decimal conversion. Both generated ABAP methods copy
the integer into a length-12 character field and `CONDENSE ... NO-GAPS`, so
the alert has no padding or leading zeros.

The intended aggregate JOIN lowering was probed first in
`docs/probes/dsl-l2/`. `GROUP BY` and aliased `COUNT( * )` reached generated
SQL, but transpiler 2.13.93 has no `HAVING` support and omitted it. See
`ANORMALIES.md#anomaly-2026-10-01-select-having-dropped`. The chosen lowering
uses one 7.02 Open SQL INNER JOIN ordered by the `for` key. A loop counts
adjacent matching rows and emits one alert after a group exceeds the threshold.
The reference independently selects the `for` rows, then selects matching
count-table rows per row and uses `DESCRIBE TABLE ... LINES`. Each test runs
both methods and compares their ordered alerts, then compares to the
interpreter. Derived cases put the count at `n` and `n + 1` for `more_than`,
or `m - 1` and `m` for `at_least`. A two-group case checks the transition
between distinct `for` rows. Each threshold boundary case must change under a mutant of
its threshold. Per-comparison cases include enough other matching rows for
their own comparison to decide the threshold.
Case generation is bounded to 64 counted rows so a valid INT4 threshold cannot
allocate billions of test rows. Cases needing more rows are reported as skipped
with the cap named. At a threshold of 64 or more, some count boundaries lack
derived coverage (`more_than: 64` cannot derive its violating boundary);
`build` and `check` warn with the rule line, and hand-written examples must
cover the missing boundaries.

The demo is `src/l2demo/ship_voyage_limit.l2.yaml`: zero, two, three and five
future voyages, a ship excluded by `when`, a cross-ship case that exposes a
missing ON equality, and groups inserted out of key order with the last group
both above and below the threshold.

## Not yet

Parameters other than `$date`, `fewer_than` / `exactly` and other zero-count comparisons (which need an outer join or NOT EXISTS),
`sum` / `min` / `max`, grouping by fields of the counted table, `limit` under `all` / `any`, a condition on the outer table inside `where` beyond
the join (a comparison of an `exists` field with an outer field is allowed; one of only outer
fields is not), a `for` and an `exists` on the same table, a join without an equality, an
equality under `or` as a join, a clause of `all` or `any` naming another clause, `require` with
more than one clause, more than three clauses, a message class for the alert, and running a rule
on A4H. The interpreter's agreement with a system is measured here only, on this runtime (NUMC
comparisons against a literal, for one, are the interpreter's reading of the DDIC and are not
exercised by an ABAP test).
