# pAMDP / eAMDP handover, 2026-09-24

A snapshot of where the portable AMDP work stands at the end of two long
days, what is where, and how to pick it up. The facts are as of the evening
of 2026-09-24; check `gh pr list` before acting on the PR list.

## Where it stands, in numbers

The corpus oracle (`tools/amdp-corpus-oracle.mjs`) creates every AMDP body
of the exported corpus on HANA Express and compiles the same body with the
portable compiler.

| | count |
| --- | ---: |
| bodies in the corpus | 399 |
| need a HANA library neither A4H nor HXE has (APL, UMML) | 34 |
| reachable: bodies a HANA we can reach could create | 365 |
| created on HXE | 327 (90% of reachable) |
| **compiled by the portable compiler** | **39** (32 at the start of the day) |
| compiled by us and refused by HANA | 0 |

**What 39 means and what it does not.** "Compiled" means the portable
compiler accepts the body and HANA creates it. **No value of a corpus body
has been compared between HANA and the portable engines.** Every "HXE
answered X, we answer X" in this work is a hand-written case of a few rows
(`test/sqlscript-*.mjs`, the probes quoted in
`docs/sqlscript-hana-observed.md`). A value-parity run over the corpus is the
open question in "What next" below.

## What was done on 2026-09-23/24

Merged into `main`, portable pipeline:

- #55: packed columns bound as strings. #56 and #59: numeric FOR. #57:
  host relations.
- #62: DECLARE DEFAULT and CONSTANT, and a leading minus. #63: DML with its
  LUW. #64: UPSERT.
- #66: RAW columns.
- #68: decimal arithmetic typed as HANA types it.
- Oracle and stand: #58 (HXE refuses 28 → 0), #61 (the types a signature
  names), #70 (the `library-absent` class).
- #72: table functions called in FROM, run as nested calls on every engine.
- Host and runtime: #75, one dialog step at a time (a FIFO work-process
  lock; APC events are steps too; WAIT gives the lock up).

Open at the time of writing:

- #78, output shapes: procedures with no output, several scalar OUTs, and
  `outputs` as the only source of truth. Critic passed, merging on green CI.
- #80, `SELECT … FOR UPDATE`: no critic yet.

The measurements behind each rule are in `docs/sqlscript-hana-observed.md`
(sections per topic), and the IR rules a port has to follow are in
`docs/pamdp-ir-portability.md`.

## What is where

- **The pipeline.** Lexer and combinators (`tools/sqlscript/lexer.mjs`,
  `combi.mjs`, grammar in `tools/sqlscript/expressions/index.mjs`) → binder
  (`tools/sqlscript/to-ir.mjs`) → procedure compiler
  (`tools/sqlscript-to-procedure-ir.mjs`) → runtime
  (`tools/sqlscript-procedure-ir.mjs`) → lowering per dialect
  (`tools/sqlscript-lower.mjs`, hana / postgres / duckdb / sqlite).
- **The oracle.** `tools/amdp-corpus-oracle.mjs`, run from the repository
  root (it reads `.local/a4h-export` and `.local/a4h-ddic`). It needs a
  HANA Express:

  ```
  HXE_HOST=127.0.0.1 HXE_PORT=39017 HXE_PASSWORD="$(cat .local/hxe-password)" \
    node tools/amdp-corpus-oracle.mjs --out <dir>
  ```

  It takes about 20 minutes. The report (`<dir>/report.json`) names corpus
  objects, so `<dir>` is under `.local/` (the default is
  `.local/amdp-oracle/`), never a tracked path. The HXE catalogue it uses is
  `.local/amdp-oracle/a4h-catalog.txt`.
- **The corpus** (`.local/a4h-export`, `.local/a4h-ddic`) is SAP's code:
  local only. Names from it never go into tracked files (CLAUDE.md, "The SAP
  corpus stays local"). `npm run leak` catches their return.
- **Probing HANA by hand.** A throwaway schema on HXE through the node `hdb`
  client. `CREATE COLUMN TABLE … AS (SELECT …)` plus `SYS.TABLE_COLUMNS`
  gives an expression's type; a procedure created and CALLed gives its
  behaviour; the schema is dropped afterwards. Every rule added in these two
  days was measured that way first and quoted with its numbers.
- **The Go port** of the same IR is foreman-dell's (`spike/go-backend`). It
  reads the pairs in `test/fixtures/ir-pairs/`. A change to the IR's shape or
  to a lowering changes those pairs, and the Go side has to be told.

## The walls, as the oracle sees them now

Of the 327 bodies HANA creates, 288 do not compile yet. Each body usually has
more than one wall, so a fix moves fewer bodies than its group size, as the
table-function registry showed (22 blocked, 5 moved).

| wall | bodies | note |
| --- | ---: | --- |
| a column not in the typed query scope | ~20 | at least partly `ORDER BY` a column the SELECT does not list, which HANA takes (found while testing #80) |
| `SYS.*` and other system views | ~16 | not portable by nature; a catalogue facade could stand in for some |
| DDIC types with no portable mapping | ~15 | per data element |
| XMLNAMESPACE / XMLTABLE | ~11 | never portable |
| `:lt.INSERT(…)` table-variable methods | ~9 | measurable, ordered |
| DECLARE EXIT HANDLER | ~7 | error semantics |
| `EXEC :stmt` dynamic SQL | ~6 | not portable unless the text is known |
| CALL with named arguments and several parameters | ~6 | behind it, a nested CALL takes one table in and one out |
| `FOR UPDATE` | 5 | #80 |
| MERGE INTO | 3 | |

## Where pAMDP leads, honestly

- **What it is good for.** A portable body runs the same SQLScript on
  SQLite, DuckDB and PostgreSQL, and in the Go port. So a Z AMDP, the kind
  a customer writes, can run and be tested with no HANA at all. The rules it
  runs by are measured, not guessed. That is a real result, and the
  clean-room corpus and the demo pack show it.
- **What it is not.** The SAP-delivered corpus is not a target to cover.
  Much of it depends on HANA itself (system views, XML, dynamic SQL, APL),
  and after 32 → 39 each further body costs more than the one before. The
  corpus is the instrument that tells us which constructs real code uses
  and in what order to build them. It is not a score to maximise.
- **What is missing to call it trustworthy.** A value-parity run: the same
  input rows, the body run on HXE and on the portable engines, and the
  answers compared. Until then "compiles" is the only number, and it says
  nothing about whether the answer is right.

## What next, in order

1. **Value parity over the compiled bodies.** Seed the tables each body
   reads with synthetic rows from the catalogue's types, including NULL,
   empty strings and type edges. Run the body on HXE and on SQLite and
   DuckDB, and compare rows and scalars, normalising order where the body
   does not fix it and DECIMAL trailing zeros (HANA prints them, the others
   do not). This turns "39 compile" into "N agree", and every disagreement
   is a finding.
2. **`ORDER BY` a column outside the select list.** Cheap, and probably the
   larger half of the column-scope group.
3. **`:lt.INSERT(…)`**, then **EXIT HANDLER**. Measure each first, as every
   rule so far was.
4. Leave `SYS.*`, XML and dynamic SQL refused by name. Refusing them is the
   honest answer.

## Picking the session up

- The working copy for this work is the worktree
  `.local/worktrees/amdp-corpus`. Run commands from it, except the oracle,
  which runs from the repository root.
- `npm test` takes about 6 minutes. Run it before every commit, not after:
  twice today a commit went in before its tests had passed.
- Every PR goes through a critic (a separate agent, or foreman-dell) before
  it merges. Upstream issues and PRs go through the same gate
  (CLAUDE.md). Merges are squash, and a PR stacked on a squash-merged one
  needs its tree rebuilt as main plus its own commits; `git merge` of
  main alone conflicts.
- An agent that starts servers stops only its own, by PID. On 2026-09-24 a
  `pkill -f` pattern killed a docker container's server.
