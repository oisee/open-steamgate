# Handover: `@abaplint/database-duckdb` for the transpiler monorepo

Written 2026-09-12 for the session working in `~/dev/transpiler`. Everything
below was learned the hard way in open-steamgate; nothing here is guessed.

## What exists already

- `tools/duckdb-client.mjs` (this repo, 205 lines): a working transpiler
  `DatabaseClient` over `@duckdb/node-api`. The whole open-steamgate suite
  (71 ABAP Unit incl. an LUW test, 15 HTTP tests) passes on it unchanged
  (`npm run unit:duckdb`, `npm run integration:duckdb`). Port it, do not
  redesign it.
- `test/setup.mjs` (this repo): how a client is wired in: the generated
  `init.mjs` calls `setup(abap, schemas, insert)`; the client goes into
  `abap.context.databaseConnections["DEFAULT"]`, then `execute(schema)`,
  `execute(insert)`.
- `AGENDA.md` section "DuckDB as the store" and `ANORMALIES.md` for the
  wording of the two runtime facts below.

## The three things without which DuckDB does not work under the transpiler

1. **DDL: take the PostgreSQL flavour.** The transpiler emits four schema
   dialects (`schemas.sqlite`, `.pg`, `.hdb`, `.snowflake`,
   `packages/transpiler/src/db/schema_generation/`). DuckDB speaks the PG one
   with one touch-up: `NCHAR(n)` → `VARCHAR(n)` (`duckdbSchema()`). The seed
   `INSERT`s are written for SQLite with quoted column names as
   `'PROGNAME'`; DuckDB wants `"progname"` (`duckdbInserts()`).
2. **Trailing blanks.** The runtime stores CHAR values padded to the DDIC
   length and pads the literals it puts into SQL. SQLite columns are
   `NCHAR ... COLLATE RTRIM`, so `'A  ' = 'A'` holds there. DuckDB VARCHAR
   keeps and compares the blanks, so every literal in INSERT/UPDATE/DELETE/
   WHERE is right-trimmed on the way in (`trimLiterals()`, a regex over
   `'...'` literals that respects `''`). Without this every `SELECT ... WHERE
   key = 'X   '` returns nothing.
3. **LUW without savepoints.** The runtime opens a transaction on the first
   INSERT/UPDATE/DELETE and ends it on COMMIT WORK / ROLLBACK WORK. A
   statement that fails (duplicate key → `sy-subrc 4`, the ABAP program
   carries on) aborts the whole DuckDB transaction, and DuckDB has no
   `SAVEPOINT` to fence it the way `database-pg` does. The client keeps the
   successful modifying statements of the open LUW and, after a failure,
   does `ROLLBACK; BEGIN; replay`. Deterministic SQL makes this equivalent
   to `ROLLBACK TO SAVEPOINT`. `ltcl_luw` in this repo is the test for it.

Smaller facts:
- `sy-dbcnt` for INSERT/UPDATE/DELETE: DuckDB returns the affected-row count
  as a one-row result of `runAndReadAll`, not as a property.
- BIGINT comes back as `bigint`; the runtime wants `number` (`plain()`).
- `SELECT ... UP TO n ROWS` → `LIMIT n`; `ORDER BY PRIMARY KEY` → the key
  columns the runtime passes as `primaryKey`; `ASCENDING/DESCENDING` →
  `ASC/DESC`; `~` → `.`; drop `LIMIT 0` (`rewrite()`), same as database-pg.
- Errors from SELECT are re-thrown as `CX_SY_DYNAMIC_OSQL_SEMANTICS` when the
  class exists, so dynamic WHERE mistakes surface as ABAP exceptions.
- `openCursor` is a client-side slice over a full read; fine for now.
- `@duckdb/node-api` is native (N-API); it must stay out of any browser
  bundle (open-steamgate's webpack config ignores it).

## Monorepo facts (the transpiler repo)

- Structure: `packages/{runtime,transpiler,cli,extras,database-sqlite,
  database-pg,database-snowflake,rfc-client-soap-xml}`. Copy
  `packages/database-sqlite` for the layout (`package.json` with
  `compile`/`test` = `tsc`, `src/index.ts` exporting one class, `build/`).
  Root `package.json` lists every package in `install`, `compile`,
  `link-local`, `link:*`; add `database-duckdb` to all four.
- Tests: `test/database.ts` runs each case through `runAllDatabases(abap,
  files, callback, {snowflake: false})`; sqlite first, then PG (needs a
  server: locally it fails with `ECONNREFUSED 127.0.0.1:5432`, that is
  expected), snowflake when configured. Add DuckDB with the same opt-out
  shape (`{duckdb: false}`) so cases that cannot pass are excluded
  explicitly, with a reason. Expect DECIMAL/DATE/TIME and SQLite-specific
  cases to need attention; each one is worth a line in the PR.
- Building/running locally: Node 24 via nvm works (`nvm exec 24 ...`),
  Lars's CI is Node 22; Node 26 crashes `snowflake-sdk` (`jwa` /
  `SlowBuffer`). `npm ci --legacy-peer-deps` at the root and in
  `packages/transpiler` (tree-sitter peer conflict). TypeScript 6.0.3,
  `@types/node` 26. Root suite: `npx tsc` then
  `npx mocha --no-config --no-package --timeout 60000 build/test/database.js`
  (the root `package.json` "mocha" section would otherwise pick the wrong
  spec). Package suites: `npm test` inside `packages/<x>`.
- CI: `.github/workflows/ci.yml` provides Postgres as a service; DuckDB is
  embedded, needs nothing, so its tests can run on every PR (an argument
  for Lars: coverage PG cannot give him for free).
- Git: `~/dev/transpiler` has `origin` = `abaplint/transpiler`. Add
  `oisee` (`https://github.com/oisee/transpiler`), branch from
  `origin/main` (2.13.86 = `422319a5`), push to `oisee`, PR to upstream.
  `oisee` is a collaborator on `abaplint/transpiler`, but Lars merges there.
- Git identity for commits in that clone: Alice Vinogradova
  <ooisee@gmail.com>. Commit trailer used today:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## How Lars takes changes (from today's four merged PRs, #1829–#1832)

- One thing per PR, small, with a test in the existing test file and a body
  that states the ABAP semantics and what broke. All four were merged within
  hours and released as 2.13.86 the same day.
- A new package is bigger than a fix: the user asks him first, one sentence
  ("`@abaplint/database-duckdb`, embedded, runs in CI without services,
  modelled on database-sqlite, ok?").
- No LLM-specific files, no rules for agents in the repo; the linter is the
  arbiter. Node is enough (no Bun/Deno).

## Out of scope for the first PR

DuckDB-Wasm (`@duckdb/duckdb-wasm`, Arrow-based async API, worker + big
wasm), ClickHouse (server or `chdb`; mutation-based UPDATE/DELETE, no wasm),
a DuckDB-specific schema generator. If a browser store beyond sql.js is ever
wanted, PGlite (`@electric-sql/pglite`, Postgres in wasm) reuses the PG
dialect and the `database-pg` client shape and is the cheaper path.

## Why open-steamgate wants this

Analytics. SADL-lite serves CDS projections with `sap:semantics="aggregate"`
(`$select` on an aggregate set becomes `GROUP BY`) to analytical Fiori. On
demo-sized tables SQLite is fine; on captured data of real size a columnar
engine is the difference between seconds and milliseconds, and DuckDB also
reads Parquet/CSV straight into tables, which is how a captured dataset gets
in. The package makes that reusable for every transpiler user.
