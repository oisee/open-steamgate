# Portable AMDP milestone report

Status of `feat/amdp-portable-ir` on 2026-09-22.

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
| `search_cells` | approximate scoring, null substitution, mapping, hint | non-INTEGER scalar input |
| `difference_cells` | set difference | `EXCEPT` absent from relational IR |
| `expand_values` | array/row expansion shape | array input semantics |
| `identity_cells` | execution identity | session values not implemented |
| `optional_value` | optional input and scalar return | scalar-return procedure shape |
| `transform` | `IF`/`ELSEIF`, regex and session context | LOWER/regex branches execute; selected session context refuses |
| `mix_rows` | table inputs, scoped joins, correlated subquery, dynamic limit | **executable on HANA and DuckDB** |
| `rank_rows` | grouping, windows and ranking | **executable on HANA and DuckDB** |
| `control_rows` | cursor declaration, block and conditional | cursor/table declaration |
| `scalar_value` | scalar function return | scalar-return procedure shape |

The current ledger is `2 fully executable / 1 partially executable / 7 named
refusals / 0 crashes`. `transform` is deliberately not promoted while its
`SESSION_CONTEXT` branch remains a selected-path refusal. Parser
success is not reported as runtime support: a tracked method body moves only
after it executes directly, without runtime or harness rewriting, at value
level on HANA↔HANA and DuckDB.

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

HANA `CONTAINS(..., FUZZY(...))` combines approximate matching, tokenisation,
linguistic options and relevance scoring. Other databases expose useful
neighbours, but their scores are not interchangeable: PostgreSQL `pg_trgm`
measures trigram similarity, while DuckDB FTS and SQLite FTS5 rank full-text
matches with BM25-style machinery.

The portable runtime must therefore not translate the HANA spelling directly
and pretend that an unrelated score has the same meaning. The planned boundary
is a versioned search capability:

1. define a small deterministic profile (normalisation, tokenizer, similarity
   rule, threshold, score range and tie ordering);
2. keep HANA native fuzzy search as the oracle and accelerated implementation
   only where differential cases prove that profile equivalent;
3. implement the same profile explicitly for DuckDB, rather than relabelling
   DuckDB BM25 as a HANA score;
4. refuse unsupported HANA linguistic/options profiles by name.

This makes approximate search reproducible without claiming that all of HANA's
linguistic engine has been cloned. `search_cells` remains a named refusal until
that contract and its cross-engine corpus exist.

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
- direct-source `transform`: DuckDB covers the zero/NULL and 1..9 branches;
  native and portable HANA agree for switches 0, 1 and 9, while selecting the
  session-context branch produces a named refusal before database I/O. Regex
  support is intentionally the single measured literal replacement in this
  fixture, not a claim of general HANA/DuckDB regex equivalence;
- full SQLScript regression: 363 passing tests, with only explicit live-HANA
  cases skipped in the ordinary offline run;
- live HANA focused suite: 7 passing, including the positive `LIMIT ?` and
  negative `LIMIT CAST(? AS INTEGER)` oracle probes;
- ABAP lint: zero issues;
- clean-room focused suite and leak scan: green.

## Next coverage order

1. Scalar returns and optional INTEGER inputs.
2. `EXCEPT` as its own relational node and backend lowering.
3. Session identity (which completes `transform`), arrays, fuzzy search,
   dynamic SQL, controlled errors and
   cursor execution only as separately measured capabilities.

SQLite and further PostgreSQL integration remain parked until the HANA and
DuckDB corpus paths are useful and stable. The already completed PostgreSQL
native seam is retained; it does not sit on the present critical path.
