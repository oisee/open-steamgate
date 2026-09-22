# Portable AMDP / SQLScript runtime

Branch plan for `feat/amdp-portable-ir`, started from `integration/devux` on
2026-09-21.

## Outcome

An ordinary ABAP Unit test calls an ordinary `FOR HDB LANGUAGE SQLSCRIPT`
AMDP method. In an off-stack OSG runtime the unchanged SQLScript body executes
without HANA and returns the same supported values and types. HANA remains a
native target and a differential oracle, but it is not required to run the
supported test.

The first proof is deliberately small and end to end:

```text
ZCL_OSD_AMDP_DEMO=>SQUARES
  original SQLScript body
    DECLARE + scalar assignment + WHILE
    table assignment + UNION ALL
        ↓
  portable AMDP runtime
        ↓
  PostgreSQL
        ↓
  original ABAP call and assertions
```

No HANA connection or fallback may be available during this test. A refusal
is a valid result for an unsupported construct; silently returning an
approximation is not.

## What already exists

This is not a second compiler project. The repository already contains the
lower half of the design:

- `tools/amdp-extract.mjs` extracts AMDP signatures and original bodies.
- `tools/amdp-gen.mjs` rewrites only the generated transpiler input and keeps
  the repository's ABAP source unchanged.
- the `AMDP` RFC destination is already the dispatch seam used by transpiled
  ABAP;
- `tools/sqlscript/lexer.mjs` and `tools/sqlscript/expressions/index.mjs`
  parse the declarative core and recognise `DECLARE`, scalar assignments,
  `IF` and balanced `WHILE` syntax;
- `tools/sqlscript/to-ir.mjs` binds and types relational plans, but currently
  refuses the imperative statements by name;
- `tools/sqlscript-ir.mjs` carries typed relational operations, schemas,
  parameters and effects;
- `tools/sqlscript-lower.mjs` lowers those plans strictly for HANA, DuckDB and
  SQLite;
- `native()`, relation handles and the fused/eager comparison instrument
  already exist for the supported engines;
- a measured HANA oracle, portable conformance cases and explicit refusal
  tests already protect many expression semantics;
- `ZCL_OSD_AMDP_DEMO=>SQUARES` is exactly the first imperative example we
  need.

The missing pieces are therefore bounded:

1. PostgreSQL support at the parameterised relational seam.
2. A typed procedural IR above the existing relational IR.
3. An interpreter for that procedural IR.
4. Routing an AMDP call to the native HANA executor or portable executor by
   explicit policy.
5. One shared execution context for ABAP SQL and nested AMDP work.

Two existing test behaviours must also be removed from this proof. The AMDP
unit test currently returns immediately when `sy-dbsys <> 'HDB'`, and
`UnitRun.runDetached()` currently changes every non-DuckDB child to
`STG_DB=file`. A green result while either behaviour is active does not prove
portable PostgreSQL AMDP execution.

## Architecture

```text
AMDP source + extracted signature
              │
              ▼
    SQLScript parser and binder
              │
       typed procedure IR
       ├─ scalar/control nodes ───────► TypeScript interpreter
       └─ relational nodes ──────────► existing relational IR
                                                │
                                                ▼
                                     backend-specific lowering
                                                │
                                   PostgreSQL / DuckDB / ...
```

JavaScript/TypeScript is the execution platform, not the semantic IR. The IR
must preserve source spans, SQLScript types, explicit conversions, nullable
state, reads/writes, relation dependencies and observable barriers.

The relational IR remains the only input to dialect lowering. Procedural
nodes must not contain generated SQL strings.

### Initial procedural nodes

The first slice needs only:

- `procedure(parameters, locals, body, outputs)`;
- `declareScalar(name, type, initial?)`;
- `assignScalar(name, expression)`;
- `assignRelation(name, relationPlan)`;
- `while(condition, body)`;
- `returnRelation(name | relationPlan)`;
- source span and inferred/effective type on every executable node.

`IF`, nested calls, handlers and data-changing statements are reserved node
kinds, not half-implemented behaviours. Encountering one before it is
implemented produces a typed `UNSUPPORTED_SQLSCRIPT` diagnostic with its
source location.

### Values and relation versions

Scalar expressions are evaluated according to SQLScript types, not normal
JavaScript coercion. The runtime captures the scalar value used by each
relational assignment at the moment that version is created.

A table variable is a binding to an immutable relation version, not a mutable
JavaScript array and not an untyped saved SQL string. This makes the loop in
`SQUARES` unambiguous:

```text
et_square@0 = empty typed relation
et_square@1 = union(et_square@0, row(lv_i = 1))
et_square@2 = union(et_square@1, row(lv_i = 2))
...
```

The backend may later fuse, materialise or replace these versions with a more
efficient recursive plan, but the binding semantics do not change.

### Execution context

Every ABAP test run owns one explicit context:

```text
backend identity
database connection / transaction
logical-to-physical catalogue
AMDP procedure registry and call stack
temporary relation registry
session values, clock and deterministic trace
```

ABAP Open SQL and every AMDP called by that ABAP execution must use the same
context. A fixture written on one connection and an AMDP read on another is
not a valid passing test. Committing to make it visible would also be wrong.

The first slice is read-only from the AMDP point of view, but it still shares
the caller's connection and transaction.

## Backend contract

A backend capability has three honest outcomes:

1. native equivalent with measured semantics;
2. an explicit compatibility lowering/helper with tests;
3. `UNSUPPORTED_SQLSCRIPT` before execution.

There is no best-effort mode in ABAP Unit.

The minimum portability proof deliberately uses two complementary tracks:

1. native HANA SQLScript versus the portable procedural runtime using plain
   relational SQL on that same HANA database;
2. the same typed procedural IR on DuckDB, called by the unchanged ABAP Unit
   while no HANA fallback is available.

The first isolates our parser/control/runtime from database-dialect changes.
The second is an embedded but strongly typed proof that the architecture
really crosses a database boundary. Passing both does not claim that every
function is portable: each additional backend still has to implement or
explicitly refuse every capability through the conformance layer.

SQLite/browser execution and further PostgreSQL integration are explicitly
parked until both minimum tracks are green. The existing PostgreSQL seam is
retained as finished infrastructure, but it is not on this milestone's
critical path. SQLite is not the semantic authority for fixed decimals,
casts or database-specific error behaviour.

The current inventory shows one prerequisite: PostgreSQL is an OSG runtime
client, but SQLScript lowering currently has only `hana`, `duckdb` and
`sqlite` dialects, and the PostgreSQL client is not yet wired to the same
parameterised `native()` relation seam. That adapter is milestone P0.

## Milestones

### P0 — PostgreSQL device seam

- add a strict `postgres` lowering dialect;
- expose parameterised `native()` and relation lifecycle operations on the
  PostgreSQL client without interpolating values;
- verify typed empty relations, `UNION ALL`, concatenation, multiplication,
  bound scalar values and deterministic row reads;
- add PostgreSQL rows to the relevant conformance table;
- prove unsupported operations fail before a query with changed meaning is
  sent.

Acceptance: the existing declarative end-to-end body executes on PostgreSQL
and agrees by value and output schema with the established local engines.

### P1 — Typed procedural IR

- lower `DECLARE`, scalar assignment and `WHILE` into typed nodes;
- add `WHILE` to the grammar before lowering it;
- retain the existing relational binder rather than duplicate it;
- derive host-parameter types from the extracted AMDP signature instead of
  the binder's current temporary `STRING` default;
- add immutable relation bindings and scalar snapshots;
- implement an interpreter with an explicit step limit and useful trace;
- define integer, string concatenation and comparison behaviour needed by
  `SQUARES`; refuse all unmeasured coercions.

The empty initial relation in `SQUARES` must take its output schema from the
extracted `ET_SQUARE` signature. Inferring only from `0, '', 0` would lose the
declared character width (and can incorrectly invent `C(0)`).

Acceptance is two-stage: parsing and interpreting the original `SQUARES`
body first agrees with native SQLScript while its relational work uses plain
HANA SQL, then yields the same four typed rows on DuckDB for `iv_count = 4`
with no HANA code path loaded. SQLite and PostgreSQL follow only after both
of these tracks are green.

### P2 — AMDP dispatch and ABAP Unit

- select `native-hana | portable | refuse` through an explicit execution
  policy, never an implicit fallback;
- route generated AMDP RFC calls to the portable executor;
- map ABAP input/output values at one typed boundary;
- share the active ABAP database execution context;
- let detached Unit runs preserve an explicitly selected PostgreSQL backend
  while continuing to isolate ordinary file-backed test runs;
- remove the obsolete `sy-dbsys = HDB` skip from the test; the AMDP source
  and call remain unchanged;
- replace the existing `READ TABLE ... INDEX 3` assertion with a key-based
  assertion for `ID = 3`: the AMDP has no final `ORDER BY`, so row position
  is not part of its contract and the bridge must not invent one;
- record an execution trace proving `engine=postgres`, `fallback=false`.

Acceptance: the repository's ABAP Unit call to `SQUARES` passes against
PostgreSQL while HANA credentials and modules are unavailable. Cases cover
`0`, `4`, an empty typed result and the first measured integer boundary.

### P3 — Composition and real data

- fixture written through ABAP SQL and read by AMDP in the same uncommitted
  context;
- join and aggregation over that fixture;
- nested AMDP call with a bounded call stack;
- rollback leaves no test data behind.

Acceptance: unchanged ABAP assertions observe the AMDP result and the test
can prove it used the caller's transaction.

### P4 — Differential corpus

- store small, synthetic programs with inputs, output values, output types
  and expected errors;
- compare portable PostgreSQL execution with versioned HANA observations;
- never include proprietary source in the repository;
- distinguish value differences, type differences, ordering claims,
  unsupported constructs and infrastructure failures.

HXE or another authorised HANA can refresh observations when available, but
the recorded corpus runs offline.

### P5 — DuckDB and optimisation

- run P1–P4 through DuckDB;
- move accidental PostgreSQL assumptions into backend capabilities;
- optimise only after the two portable engines agree: fuse plans, reduce
  materialisation and batch loop work without changing relation versions.

Substrait may later represent the relational half at an interchange boundary.
It is not needed to validate the first runtime and does not represent the
procedural half.

## Test rules

- Compare rows only with an explicit ordering contract. Without `ORDER BY`,
  compare the relation as a bag with duplicate counts and compare schemas
  separately.
- Preserve SQL `NULL` inside SQLScript. Convert to ABAP initial values only at
  the typed AMDP/ABAP boundary where that conversion is required.
- An empty table still has a schema.
- `UNION ALL` preserves duplicates.
- Every portable built-in or coercion has a conformance case.
- A test for the portable route makes HANA physically unavailable and asserts
  the chosen backend in the trace.
- No test passes by skipping on `sy-dbsys` once its construct is supported.
- Resource limits are part of the runtime contract: maximum steps, nested
  calls, rows and temporary relation bytes.

## Non-goals of the first vertical

- all SQLScript constructs or HANA libraries;
- reproducing HANA's optimiser, parallelism or physical plans;
- translating procedures into PL/pgSQL;
- executing table relations as JavaScript arrays;
- transparent cross-database work inside one ABAP LUW;
- approximate decimal, cast, `NULL` or error behaviour;
- dynamic SQL, data-changing AMDP, autonomous transactions, cursors, arrays
  or exception handlers;
- making SQLite the decimal reference;
- requiring a live D15, A4H or HXE to run the supported offline tests.

## Immediate implementation order

1. Pin the current `SQUARES` source and signature as the acceptance fixture.
2. Add the PostgreSQL native seam and relational lowering with focused tests.
3. Introduce procedural IR types independently of execution.
4. Lower and interpret only the constructs present in `SQUARES`.
5. Compare native HANA SQLScript with portable control plus plain HANA SQL.
6. Connect the existing `AMDP` destination to the portable DuckDB executor.
7. Run the ABAP Unit with HANA disabled and publish the trace beside the test
   result.

This order keeps every commit executable and makes the first new language
feature answer a user-visible question rather than merely increasing parser
coverage.

## Progress

### 2026-09-21 — P0 device seam

Implemented the initial PostgreSQL lowering and the parameterised native
channel, including:

- numbered placeholders with explicit PostgreSQL types;
- packed decimals bound as text rather than rounded through JavaScript;
- `DUMMY` represented as a one-row source rather than a physical table;
- native work on the caller's transaction connection, fenced by a savepoint;
- fail-stop behaviour after a poisoned COMMIT;
- bounded, collision-resistant relation names and diagnostic cleanup;
- a live test using a session-local temporary fixture rolled back with the
  transaction.

The live PostgreSQL run passed 14 tests, including the relational pipeline,
typed multiplication, concatenation, decimal division, transaction reuse and
bound values. Functions measured only on the earlier HANA/DuckDB/SQLite
matrix are explicitly refused on PostgreSQL until PostgreSQL gains its own
conformance rows. P1 (procedural IR) is next.

### 2026-09-22 — P1a procedural semantics

The first P1 slice now fixes the execution semantics independently of parser
binding:

- typed procedure, scalar declaration/assignment, relation assignment and
  `WHILE` nodes;
- SQL `NULL` preservation and strict INTEGER/boolean boundaries;
- immutable table-variable versions and assignment-time scalar capture,
  including parameters inside window partitions;
- explicit host-step, expanded-plan, nesting and bound-parameter budgets;
- refusal of `NO_INLINE` until a real materialisation barrier exists, and of
  non-deterministic relations in this initial subset;
- one final parameterised database statement with a trace that names the
  engine and states `fallback=false`.

The hand-built `SQUARES`-equivalent IR passes on DuckDB, including zero rows,
four rows, NULL input, integer overflow and adversarial plan growth. The
grammar retains a nested, balanced `WHILE` tree and the old relational binder
refuses it by name instead of flattening it. P1 is not complete yet: the next
slice maps the parser tree and extracted AMDP signature into these nodes,
then runs the original body on PostgreSQL.
