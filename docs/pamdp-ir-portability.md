# One DB IR for two runtimes: pAMDP and the Go transpiler

*2026-09-23. Status: proposal. No code changes until Alice agrees. The
split below was agreed between the pAMDP session and foreman-dell.*

## The question

Alice asked whether pAMDP being written in JavaScript will be a problem
once the transpiler also exists in Go (OSGo, `tools/gogen` on
`spike/go-backend`), and whether both could share one IR for the database
layer.

## What exists today

**The pAMDP IR is already plain data.** A compiled procedure is a JSON
document with no functions in it. It survives `JSON.stringify` and
`JSON.parse` unchanged. A body with a CTE, TOP and an IF compiles to about
11 KB. The code falls into three parts:

| part | files | lines, about | what it does |
| --- | --- | ---: | --- |
| front end | `tools/sqlscript/lexer.mjs` (277), `combi.mjs` (221), `expressions/index.mjs` (471), `to-ir.mjs` (1,486); `tools/sqlscript-to-procedure-ir.mjs` (563) | 3,018 | SQLScript text into typed IR, with a refusal that names what is missing |
| IR | `tools/sqlscript-ir.mjs` | 617 | the node constructors, the types, `schemaOf`, `effects`, `seamType` |
| lowering | `tools/sqlscript-lower.mjs` | 688 | IR into SQL text for hana, postgres, duckdb, sqlite |
| procedural runtime | `tools/sqlscript-procedure-ir.mjs` | 616 | binds inputs as the kernel binds them, runs IF and WHILE, calls the `DatabaseClient` |

Only the front end is tied to a parser. The lowering and the runtime are
table-driven over a small set of nodes, and both import from the IR module:
the lowering takes `seamType` from it, the runtime `effects`, `schemaOf`,
`col`, `cast` and `project`. A port takes the IR module with them.

**OSGo has no database layer yet.** No SELECT compiles there. In today's
open-steamgate, Open SQL goes from ABAP through the transpiler into
`@abaplint/runtime`, which builds SQL text from the statement at run time
and hands it to the `DatabaseClient` seam (`docs/db-backends.md`). There
is no IR in between. So there is nothing to converge with, and deciding
now costs little.

## The proposal

1. **The pAMDP relational IR becomes the one DB IR.** It gets a JSON
   Schema that is checked in, plus a conformance corpus of pairs: an IR
   document, a dialect, and the SQL expected from it. The corpus also
   records the rows it must answer on each engine. That is worth doing now
   even without Go, because it pins the contract that the tests currently
   check only indirectly.
2. **Two front ends, one IR, two back ends.** When gogen gets SELECT, it
   lowers ABAP Open SQL into these relational nodes, not into SQL text.
   SQLScript stays parsed by the JavaScript front end at build time. That
   front end writes the IR as JSON next to the transpiled program. The Go
   runtime ports the IR module, the lowering and the procedural runtime,
   about 1,900 lines of JavaScript, and must pass the same conformance pairs as the JavaScript one.
3. **Types are one mapping, and the hard rules live in the schema.**
   pAMDP writes `{abap, len, dec}` and gogen writes `{k, len}`. They agree
   on `I`, `INT8`, `C`, `STRING`, `X` and `XSTRING`. They do not yet agree
   everywhere: gogen's `f` has no pAMDP type, and pAMDP's `P` with its
   decimals, `D` and `BOOL` have no gogen type yet. The schema lists these
   gaps rather than hiding them. Packed decimals and the binding
   rules measured on A4H belong in the schema, with the rule written next
   to the type. CHAR right-trimmed, DATS initial `00000000` and RAW padded
   right are examples (`docs/sqlscript-hana-observed.md`). They must not be
   reimplemented in each runtime from memory.
4. **Open SQL needs nodes that SQLScript bodies do not.** They are
   reserved in the schema now, each either as a node or as a refusal that
   names it:
   - **The implicit client (MANDT).** The front end inserts it as an
     explicit filter node, so the lowering never guesses it.
   - **FOR ALL ENTRIES.** A read against an in-memory table, written as a
     values or in-list node, or as a join with a host table.
   - **UP TO n ROWS and SINGLE.** Both are `limit`.
   - **INTO CORRESPONDING FIELDS.** A projection mapping, done by the
     front end.
   - **Host variables.** They are `param` nodes, as in pAMDP.
   - **A dynamic WHERE string.** It is runtime text. It is refused by name,
     or parsed at run time by the same grammar.
5. **The gate for either runtime is the conformance corpus.** A runtime
   that answers a pair differently is wrong until the pair is re-measured.

## The nodes, as they are today

**Relations** (`tools/sqlscript-ir.mjs`):
- `scan`, `alias`, `var` and `ref` name a source.
- `tfcall` calls a table function.
- `filter`, `project`, `join`, `union`, `except`, `aggregate`, `order` and
  `limit` build the query.

**Expressions** carry their type:
- `col`, `lit`, `param` and `session` are leaf values.
- `bin`, `call`, `cast`, `isnull`, `not`, `like`, `in`, `sub` (a
  subquery) and `case` combine them.
- A window function travels on `call` with a `window`.

**Types** are `I`, `INT8`, `P(len, dec)`, `C(len)`, `X(len)`, `XSTRING`,
`STRING`, `D` and `BOOL`.

**Statements** (`tools/sqlscript-procedure-ir.mjs`): `assign-relation`,
`assign-scalar`, `declare-scalar`, `if`, `while` and `call-procedure`.

## What it would cost, and in what order

1. The JSON Schema, generated from the constructors above and checked
   against every IR the test suites produce. It is a test, not a new
   runtime path.
2. The conformance pairs, taken out of the existing value tests
   (`test/sqlscript-values.mjs`, `test/sqlscript-procedure-scope.mjs`) into
   data files that no JavaScript is needed to read.
3. Only then, in OSGo: SELECT lowered into the IR, and a Go port of the
   lowering run against the pairs.

The first two steps need nothing from Go and are useful on their own.
