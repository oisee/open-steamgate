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
| `transform` | `IF`/`ELSEIF`, regex and session context | procedural `IF` |
| `mix_rows` | table inputs, joins, subqueries, dynamic limit | parameterised `LIMIT` |
| `rank_rows` | grouping, windows and ranking | grouped/window typing rule |
| `control_rows` | cursor declaration, block and conditional | cursor/table declaration |
| `scalar_value` | scalar function return | scalar-return procedure shape |

The current ledger is intentionally `0 executable / 10 named refusals / 0
crashes`. Parser success is not reported as runtime support. This baseline is
useful because each later capability must move a named row from refusal to a
value-level HANA↔HANA and DuckDB test.

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
- full SQLScript regression: more than 320 passing tests, with only explicit
  live-HANA cases skipped in the ordinary offline run;
- ABAP lint: zero issues;
- clean-room focused suite and leak scan: green.

## Next coverage order

1. Parameterised `LIMIT` and typed table fixtures, targeting `mix_rows`.
2. Correct grouped/window typing, targeting `rank_rows`.
3. Procedural `IF`, targeting the safe branches of `transform`.
4. Scalar returns and optional INTEGER inputs.
5. `EXCEPT` as its own relational node and backend lowering.
6. Session identity, arrays, fuzzy search, dynamic SQL, controlled errors and
   cursor execution only as separately measured capabilities.

SQLite and further PostgreSQL integration remain parked until the HANA and
DuckDB corpus paths are useful and stable. The already completed PostgreSQL
native seam is retained; it does not sit on the present critical path.
