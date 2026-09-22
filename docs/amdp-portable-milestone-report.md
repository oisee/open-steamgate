# Portable AMDP milestone report

Status of `feat/amdp-portable-ir` on 2026-09-22.

## Live progress demo

The milestone is visible without HANA or a server:

```sh
npm run amdp:demo
```

This executes the original `SQUARES` body and every tracked clean-room method
through the real compiler and DuckDB runtime. It writes a self-contained
master-detail report to `.local/amdp-demo/index.html`; the terminal shows the
same `executed / partial / refused` ledger. A refusal is part of the result,
not a hidden skipped test. To make the report reachable on the local network:

```sh
npm run amdp:demo -- --serve 3037
```

The page is deliberately a generated report rather than a second execution
API. Native HANA comparison will occupy the already reserved Native column in
the same report contract when explicitly enabled; DuckDB remains sufficient
to open and regenerate the progress surface.

## The result

The repository's original
`ZCL_OSD_AMDP_DEMO=>SQUARES` method now runs through two independent paths:

1. HANA executes the unchanged body as native SQLScript.
2. OSG parses that same body into a typed procedural IR, executes control flow
   in JavaScript, lowers the relational result to ordinary SQL, and sends it
   either to the same HANA or to DuckDB.

Native SQLScript and portable-on-HANA return the same values for zero and four
iterations. The identical compiled program returns the expected rows and a
typed empty result on DuckDB with `fallback=false`. HANA is therefore an
oracle, not a hidden dependency of the DuckDB result.

This is the first end-to-end proof. It is deliberately not a claim that all
SQLScript is implemented.

The second vertical proof is now the unchanged clean-room `mix_rows` method.
It carries two typed table inputs, scalar state, inner and left joins, a
derived table, a correlated `EXISTS`, `DISTINCT`, ordering and a bound limit.
Native SQLScript and portable-on-HANA return the same values for zero and a
populated fixture; the identical portable program also passes empty, zero,
bounded and full-result cases on DuckDB.

The third proof executes the tracked `rank_rows` method body directly, without
runtime or test-harness rewriting: grouping and `HAVING`,
`ROW_NUMBER`, `RANK`, `DENSE_RANK`, window partition/order, a subquery filter
and `UNION DISTINCT`. A tie fixture distinguishes rank-with-gap from dense
rank. `ROW_NUMBER` has a complete tie breaker over the grouped row, so its
two independently inlined UNION branches cannot manufacture distinct rows.

The fourth proof makes session identity part of the execution contract rather
than an accidental property of whichever database happens to run the final
query. `CURRENT_USER`, `CURRENT_SCHEMA` and literal-key `SESSION_CONTEXT`
become typed IR nodes and are captured as bound values from an explicit AMDP
session. Missing facts refuse before database I/O. Native HANA and portable
HANA now agree for the identity method and for every `transform` branch; the
same bodies execute on DuckDB with deliberately supplied portable facts.

## How it works under the hood

```text
original ABAP class
  src/amdp/zcl_osd_amdp_demo.clas.abap
          │
          ▼
AMDP extractor: original body + ABAP signature
  tools/amdp-extract.mjs
          │
          ▼
SQLScript lexer/parser: syntax tree, including nested WHILE
  tools/sqlscript/lexer.mjs
  tools/sqlscript/expressions/index.mjs
          │
          ▼
shared expression and relational binder
  tools/sqlscript/to-ir.mjs
          │
          ▼
typed procedural IR
  tools/sqlscript-to-procedure-ir.mjs
  tools/sqlscript-procedure-ir.mjs
       ├── scalar declarations and assignments
       ├── WHILE and SQL three-valued conditions
       └── immutable table-variable versions
          │
          ▼
one typed relational plan
  tools/sqlscript-ir.mjs
          │
          ▼
dialect lowering + bound parameters
  tools/sqlscript-lower.mjs
       ├── ordinary HANA SQL
       └── DuckDB SQL
```

JavaScript owns only orchestration and typed scalar state. Rows do not become
mutable JavaScript arrays inside the procedure. A table variable names an
immutable relation version, and the selected database performs relational
work.

For the loop in `SQUARES`, this means:

```text
et_square@0 = typed empty relation
et_square@1 = UNION ALL(et_square@0, row captured with lv_i=1)
et_square@2 = UNION ALL(et_square@1, row captured with lv_i=2)
...
```

Each assignment captures the scalar values of that iteration. It does not
retain a JavaScript closure that later reads the final counter value.

## What is already enforced

- SQL `NULL` is not converted to JavaScript/INTEGER zero.
- INTEGER inputs, declarations and assignments use one checked boundary.
- integer overflow is refused before reaching a database.
- boolean operators accept only boolean or `NULL` values.
- `WHILE` parentheses must balance.
- host-step, expanded-plan, nesting and bound-parameter budgets are checked
  before SQL rendering or database execution.
- `NO_INLINE` is refused until a real materialisation barrier exists.
- non-deterministic relations are outside the initial executable subset.
- HANA numeric placeholders carry explicit types; an INTEGER used in both
  concatenation and multiplication keeps one meaning.
- live HANA tests use a random disposable procedure and refuse
  `STG_DB_FRESH=1`; they cannot reset the schema or pre-drop a stable object.
- unsupported outputs, INOUT parameters, narrow scalar declarations,
  trailing result sets and unresolved types are loud
  `UNSUPPORTED_SQLSCRIPT` results.
- session identity/context never falls through to the backend connection:
  its user, schema and values must be supplied explicitly and travel as bound
  parameters; clock values remain unsupported.

## Typed table inputs

The next corpus foundation is also present. An AMDP table input is a typed
relation binding, not a JavaScript array. Before it enters a procedure the
runtime:

1. checks raw-plan size and depth;
2. closes the plan with empty external scalar/table environments;
3. applies unresolved-parameter and `NO_INLINE` refusals;
4. derives its actual schema;
5. compares names and types with the AMDP signature.

Schemas then travel through local table assignments using schema-carrying
`varRef` nodes. A column cannot quietly degrade from INTEGER to STRING merely
because it passed through a local variable.

## What “the corpus” means

The restricted archives are **not** in Git and were not rewritten into near
copies. The clean-room process had two isolated roles:

- an observer could inspect the restricted inputs and produced only an
  abstract list of language/behaviour categories;
- an independent implementer saw only that abstract list and authored new
  identifiers, literals, rows, methods and statement arrangements.

The tracked corpus lives under
`test/fixtures/amdp-cleanroom/`. Its provenance and exclusions are recorded
in `provenance.json`. A leak scan reports zero matches.

It currently contains ten synthetic methods covering these categories:

| synthetic method | represented surface | current honest boundary |
| --- | --- | --- |
| `search_cells` | simple exact/substring score, null substitution, mapping, hint | **executable on HANA and DuckDB; full fuzzy profiles deferred** |
| `difference_cells` | set difference | **executable on HANA and DuckDB** |
| `expand_values` | fixed INTEGER array and ordered row expansion | **executable on HANA and DuckDB** |
| `identity_cells` | execution identity | **executable on HANA and DuckDB with an explicit session** |
| `optional_value` | optional input and scalar return | **executable in the portable host runtime** |
| `transform` | `IF`/`ELSEIF`, regex and session context | **all branches executable on HANA and DuckDB** |
| `mix_rows` | table inputs, scoped joins, correlated subquery, dynamic limit | **executable on HANA and DuckDB** |
| `rank_rows` | grouping, windows and ranking | **executable on HANA and DuckDB** |
| `control_rows` | cursor declaration, block and conditional | cursor/table declaration |
| `scalar_value` | scalar function return | **executable in the portable host runtime** |

The current clean-room ledger is `9 fully executable / 1 named refusal / 0
crashes`; including the original `SQUARES` showcase, the live demo reads
`10 executed / 0 partial / 1 refused`. Parser
success is not reported as runtime support: a tracked method body moves only
after it executes directly, without body rewriting, at value level. Relational
methods must agree on native-versus-portable HANA and DuckDB; scalar-only host
methods must agree with native HANA and prove that they perform no database
statement.

That move required more than accepting `LIMIT :value`. Source aliases now
survive in typed IR, query scopes distinguish unknown and ambiguous columns,
and correlated subqueries can refer to an outer source without collapsing
`inner.key = outer.key` into `key = key`. Join/filter/projection clauses lower
as one query block wherever an author's alias must remain visible.

The test inputs are engine-resident tables with declared INTEGER, DECIMAL,
character and date-storage columns. They are not JavaScript arrays and do not
rely on annotations over inferred UNION literals. This caught a real null
binding defect: a typed null literal previously reached numeric binding as
zero and date binding as the string `"null"`.

## Fuzzy search is a capability, not a spelling substitution

The compatibility policy is recorded canonically in
[ADR 0002](adr/0002-portable-and-native-fuzzy-text-profiles.md).

HANA `CONTAINS(..., FUZZY(...))` combines approximate matching, tokenisation,
linguistic options and relevance scoring. Other databases expose useful
neighbours, but their scores are not interchangeable: PostgreSQL `pg_trgm`
measures trigram similarity, while DuckDB FTS and SQLite FTS5 rank full-text
matches with BM25-style machinery.

The portable runtime must therefore not translate the HANA spelling directly
and pretend that an unrelated score has the same meaning. The boundary is a
versioned search capability with two deliberately different profiles:

1. `portable-deterministic` defines normalisation, similarity, score range,
   thresholds and tie ordering exactly; supported backends must agree on every
   published result and it is the default for ABAP Unit and CI;
2. `native-fuzzy` permits engine-specific scores but gates each backend on
   behavioural invariants, top-K recall, precision and false-positive limits;
3. every result identifies the profile version, backend and native versus
   compatibility implementation;
4. unsupported linguistic/options profiles are refused by name.

This makes portable tests reproducible without claiming that all native
linguistic engines have identical numbers. Full profile implementation is
deferred in `docs/backlog.md` until the remaining general SQLScript milestones
are complete.

The tracked `search_cells` case no longer blocks that sequence. It now uses a
deliberately modest `simple-search-v0` expressed entirely in ordinary
SQLScript: over its measured ASCII fixture, case-folded equality scores 1000,
substring containment scores 700, and null rows remain visible with score 0.
Empty and NULL queries return no non-null matches. Native SQLScript and
portable ordinary SQL agree on HANA, and DuckDB produces the same published
rows. This is an executable baseline, not a portable linguistic profile or a
fuzzy-search compatibility claim.

## Validation at this milestone

- live HANA differential: native SQLScript equals portable HANA SQL for zero
  and four iterations;
- original-source DuckDB execution: four expected rows, typed empty result,
  `fallback=false`;
- live HANA `mix_rows`: native SQLScript equals portable ordinary HANA SQL;
  this also measures that HANA accepts `LIMIT ?` but rejects a cast-wrapped
  placeholder in that grammar slot;
- DuckDB `mix_rows`: empty, zero, bounded and full-result cases, physical
  result metadata, plus a separate value-level correlated-`EXISTS` case;
- direct-source `rank_rows`: native HANA and portable HANA agree on
  grouped ranking values; DuckDB reproduces `RANK=1,1,3` and
  `DENSE_RANK=1,1,2` for a tie fixture, and the duplicate is collapsed;
- direct-source `transform`: DuckDB covers the zero/NULL, 1..9 and explicit
  session-context branches; native and portable HANA agree for switches 0, 1,
  9 and 10. Missing explicit context refuses before database I/O. Regex
  support is intentionally the single measured literal replacement in this
  fixture, not a claim of general HANA/DuckDB regex equivalence;
- direct-source `identity_cells`: native and portable HANA agree on
  `CURRENT_USER` and `CURRENT_SCHEMA`; DuckDB receives the same semantic
  values from its explicit AMDP session rather than reporting DuckDB facts;
- direct-source `scalar_value` and `optional_value`: native HANA SQLScript and
  portable host evaluation agree for negative, zero, non-default and SQL NULL
  inputs. An omitted ABAP `OPTIONAL TYPE i` is separately checked as its ABAP
  type-initial zero; scalar-only execution performs zero database statements;
- direct-source `difference_cells`: native and portable HANA agree, and
  DuckDB matches `EXCEPT DISTINCT` duplicate elimination and NULL row equality;
- typed ABAP `STRING` input: DuckDB and portable HANA preserve supplied text;
  omitting a portable `OPTIONAL STRING` supplies the ABAP initial empty string,
  which matches native SQLScript given that explicit initial value. A
  non-string value is refused, while an explicit SQL NULL remains distinct.
  STRING-dependent host assignment/control flow remains refused until its
  conversion and collation semantics are measured;
- direct-source `expand_values`: native HANA `INTEGER ARRAY` and `UNNEST WITH
  ORDINALITY` agree with portable ordinary HANA SQL; DuckDB preserves a
  duplicate, a NULL element and one-based positions in one statement;
- textual `COALESCE`: native SQLScript, portable HANA and DuckDB agree for
  NULL fallback and supplied STRING values; fixed character operands widen
  to the longer length, STRING dominates text, and text/numeric mixing refuses;
- direct-source `search_cells`: native and portable HANA agree on exact,
  substring, unrelated, NULL-label, empty-query and NULL-query cases; DuckDB
  returns the same fixed integer scores and mapping values in one statement;
- full SQLScript/AMDP regression: 394 passing tests and 17 explicit live
  integration cases pending in the ordinary offline run;
- live HANA focused suite: 14 passing, including the positive `LIMIT ?` and
  negative `LIMIT CAST(? AS INTEGER)` oracle probes;
- ABAP lint: zero issues;
- clean-room focused suite and leak scan: green.

## Next coverage order

1. Execute the tracked cursor/block/conditional case rather than merely
   parsing its declaration.
2. Continue general composition: nested calls, shared caller transaction and
   the unchanged ABAP Unit entry path.
3. Return to full fuzzy profiles, dynamic SQL and controlled errors only as
   separately measured capabilities.

SQLite and further PostgreSQL integration remain parked until the HANA and
DuckDB corpus paths are useful and stable. The already completed PostgreSQL
native seam is retained; it does not sit on the present critical path.
