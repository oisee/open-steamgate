# DSL L3: a set of rules, run as one unit

Status: slice 1, 2026-10-01; ports and adapters; piles and set parameters (slice 3a), 2026-10-02; stages, filter stages with a worklist, and a schedule (slice 3b), 2026-10-02. Built on L2 (`docs/dsl-l2.md`) and the background job facade
(`docs/job-standard-fms.md`, `docs/gui-reports.md`).

L2 compiles one rule into a check class, `check( iv_date ) RETURNING rt_alerts`. L3 is the layer
above it: a **rule set** that runs as one unit, a durable alert log, and a trace from every alert
to its rule line.

## The manifest

A set is one YAML file, `<set>.l3.yaml`, beside (or anywhere relative to) its rules:

```yaml
set: fleet                       # a-z, 0-9, _; at most 13 characters
title: Every fleet rule, checked for one date
date: $date                      # or `today`: $date, the current date when the caller passes none
class: zcl_l3_fleet              # optional; default ZCL_L3_<SET>
report: zl3_fleet                # optional; default ZL3_<SET>, at most 19 characters
rules:
  - rule: maintenance_ship.l2.yaml
  - rule: ship_max_cargo.l2.yaml
    enabled: false               # optional; default true
```

`node tools/dsl-l3.mjs build|check <set.l3.yaml> --out <dir>` compiles it. Every error names the
manifest file and line (`file:line: message`):

- unknown keys, a set name, class or report that does not fit, a `date` other than `$date` or
  `today` (other parameters are `params:`, see "Piles and set parameters");
- a rule file that does not exist; the same rule twice, whether as the same file by two paths,
  two files holding the same `rule:` name, or two rules generating the same class;
- a rule that does not compile: the message carries the L2 compiler's own `file:line: message`;
- a rule whose generated check class is missing or **stale**: the model hash the class's trace
  carries must equal the hash the rule compiles to now, so the runner never names a version the
  deployed class is not;
- every rule disabled, or a name too long for the log's columns.

A disabled rule is still compiled and checked; the runner does not call it and names it in a
comment that traces to its manifest line.

The YAML is read the way L2 reads a rule (js-yaml, FAILSAFE schema, `lineIndex` for the lines).

## What is generated

Through ZCL_OSD_TPL (`recipes/l3-set/template.tpl`, `recipes/l3-job/template.tpl`), each with a
trace sidecar (`.clas.trace.json`, `.prog.trace.json`): one entry per output line, `line` ->
`template_line` -> `node` -> `set_line`. A line about one rule (its constants, its entry in
`rules( )`, its branch of `run_rule`) traces to the rule's line in the manifest; the date handling
to `date:`; the rest to `set:`. The sidecar also lists each rule's file, class and model hash.

**`ZCL_L3_<SET>`**, 7.02 ABAP:

- `CONSTANTS c_rule_<n>` and `c_hash_<n>`: the rule's name and its L2 model hash, the
  `sha256:<hex>` the rule's own trace sidecars carry (`modelHash(renderModel(compiled))` in
  `tools/dsl-l2.mjs`, the function the L2 sidecars are written with);
- `run( iv_date, iv_mode ) RETURNING rs_result`: a run id (`CL_SYSTEM_UUID`), then per rule either
  `run_rule` in this step (mode `S`) or `submit` (mode `P`); `rs_result-rules` has a row per
  rule with its status and alert count;
- `run_rule( iv_rule, iv_date, iv_run )`: one rule by name, a static `CASE` over the rules (no
  dynamic call), its `check`, then `write`;
- `collect( is_result )`: mode P's second step (below);
- `rules( )`: the enabled rules, their hashes and job names.

**`ZL3_<SET>`**, a classic report with `P_RULE`, `P_DATE`, `P_RUN`, calling `run_rule`. It ends
with `MESSAGE ... TYPE 'E'` when the rule did not end `DONE`, which aborts its job.

## The alert log

`ZOSD_L3_ALERT` (`src/dsl/zosd_l3_alert.tabl.xml`):

| key | field |
|---|---|
| MANDT, SET_NAME (CHAR 16), MODEL_HASH (CHAR 71), CHECK_DATE, PILE_NO (INT4), ALERT_SEQ | RULE_NAME (CHAR 60), ALERT_TEXT (STRG), RUN_ID, RUN_TS, RULE_CLASS, RULE_FILE, RULE_LINE |

The rule is not part of the key: its model hash already names it. The hash is a SHA-256 of the
compiled rule, which holds the rule's name, and a set refuses two rules of one name, so one hash
is one rule of one set. A system refuses a key longer than 120 ("Key length > 120 (restricted
functions)"), and it counts the key as the sum of the key fields' DD03P `LENG`: a CHAR its
characters, an INT4 **10** (its LENG, not its four bytes), MANDT 3. Measured on A4H on
2026-10-02, when `ZOSD_L3_PILE` was refused at 121 by exactly that count; earlier text here
counted an INT4 as 4 and was wrong. Leaving the rule out keeps this key at 3 + 16 + 71 + 8 + 10
(ALERT_SEQ) = 108; with the rule in the key (and a 30-character set name) it was 176, and A4H said
so. Since the pile planner the key also holds `PILE_NO` (INT4) after `CHECK_DATE`: **118**
(3 + 16 + 71 + 8 + 10 + 10). That passes, and it is tight: one more key field of any width, or a
wider set name, does not fit. `tools/osd-ddic-reserved.mjs` now checks this count for every
customer table in the tree. A set without `piles:` writes pile 0.
The set name is 16 wide because a set name has at most 13 characters.

The column is `RULE_NAME`, not `RULE`: `RULE` is a reserved word in a system's dictionary, and
A4H refused to activate the table with it ("RULE is a reserved word (choose another field
name)", 2026-10-01). `tools/osd-ddic-reserved.mjs` now refuses such a field name before it
leaves the tree.

`ALERT_SEQ` is the position of the alert in the rule's `check` answer, which is ordered (L2's
`ORDER BY` plus `SORT`). `RULE_FILE` and `RULE_LINE` are the rule file and its `alert:` line.

**Writes are idempotent per (rule, model hash, check date)**, and per pile in a piled set.
`write` does a `MODIFY` per alert on the full key, then `DELETE`s the rows of the same (set, rule,
hash, date, and pile when the set has `piles:`) past the last alert of this run, all in the caller's LUW (one dialog step in mode S, the job's own step in mode P). A
rerun, or a retried job, leaves exactly that run's alerts under that rule version, each row naming
the latest run. A rerun that finds fewer alerts (the data changed) drops the rows it no longer
finds.

**Old versions are kept, not superseded.** A changed rule has a new model hash; its rows are a
new (rule, hash, date) group, and the rows under the old hash stay as they were (with the run
that wrote them). The log is a history per rule version. Nothing here deletes the rows of
another hash or date.

A sequence key rather than an alert hash: two identical alert lines of one rule stay two rows, and
`MODIFY` on the sequence plus the tail `DELETE` makes the group equal to the latest answer even
when its alerts changed. With a primary key, an `INSERT` in place of the `MODIFY` cannot create a
duplicate row; what it does instead is fail on the rerun (`sy-subrc` 4, counted in
`ty_rule-failed`, status `WRITE-FAILED`) and leave the first run's rows in place. The test
asserts both.

The rows carry no client: the kernel adds it on a system; this runtime is single-client by a
settled decision (ANORMALIES `no-implicit-mandt`).

## Mode P: one background job per rule

(With `piles:`, one job per rule and pile, `L3_<SET>_<nn>_<pppp>`, and `collect( )` reads the
plan: see "Piles and set parameters". This section is the set without piles.)

Only the public jobs API, as a caller (agreed with the jobs code's owner):

- per rule `JOB_OPEN` (job name `L3_<SET>_<nn>`), `SUBMIT ZL3_<SET> WITH p_rule ... WITH p_date
  ... WITH p_run ... VIA JOB ... NUMBER ... AND RETURN`, `JOB_CLOSE` with `STRTIMMED = 'X'`; the
  caller's step commits, and each job then runs in its own step and LUW;
- `collect( )` finds the run's jobs with `BP_JOB_SELECT` (`BTCSELECT-JOBNAME = 'L3_<SET>_*'`,
  `USERNAME = sy-uname`), matches them by name and count, reads each state with `SHOW_JOBSTATE`
  (`FINISHED`, `ABORTED`, `RUNNING`, `READY`, `SCHEDULED`, `PRELIMINARY`, `NO-JOB`), and for a
  finished rule counts the rows its job wrote under this run id. It is one read, not a wait loop:
  the caller calls it when the jobs have run. Nothing polls.
- The rules of a set do not depend on each other, so no job waits for another; an order between
  rules would be a predecessor (`PRED_JOBNAME` / `PRED_JOBCOUNT`) on `JOB_CLOSE`, not a poll.
  `BP_JOB_RELEASE` is not used.

**One generic report per set, with the rule as a parameter**, rather than a report per rule: the
dispatch from rule name to check class is the runner's static `CASE`, so mode S and mode P run the
same `run_rule`, the set adds one program instead of one per rule, and the job's input names the
rule in plain text. A fully generic report for all sets would need a dynamic call to a class named
at run time; the static form keeps everything visible to the syntax check and the trace.

This runtime executes jobs on a durable file database only (`STG_DB=file`); the in-memory,
DuckDB, HANA, PostgreSQL and browser modes refuse `JOB_CLOSE`. Mode S runs everywhere.

Building the runner found `ANOMALY-2026-10-01-submit-via-job-char-operands`: the SUBMIT lowering
passed a job name and count of SAP's own types (`TBTCJOB-JOBNAME`, `-JOBCOUNT`) by reference to
STRING parameters, a syntax error here and correct ABAP on a system. The lowering now converts
them, as it already did for selection values.

## Explain

```
node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<check date>/<pile>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]
```

prints alert -> set manifest line -> rule and version -> rule line -> the lines of the generated
check that trace to that line -> the alert's pile -> the runner lines that trace to the rule's
manifest line. The hash may be cut to eight or more hex digits. The pile is the alert row's
`PILE_NO`; the five-part key of before piles (`<set>/<rule>/<hash>/<date>/<seq>`) means pile 0.
The `pile` line says whether the rule is piled; with `--db` it adds the plan row's range and
status. `--db` reads the alert's text and run from a file
database. A hash that is not the current version's is looked up in git history (`git log -S` on
the check class's sidecar), and the rule and class are read at that commit; a hash no version
carried is an error.

## Proof

`test/dsl-l3.mjs` (registered in `test/suites.d/infra-misc.json`, 107 tests, the ports' and the piles' among them, see "Ports and adapters" and "Piles and set parameters"):

- the committed runner and report are a fresh build, and `check` notices a changed byte; the
  compiler names no domain word; each refusal above at its line;
- the trace: one entry per line, every line naming a rule traces to its manifest line;
- on a file database, rows that make six rules alert (seven alerts): mode S's log is exactly the
  union of the six `check` answers called directly; a rerun leaves it identical with every row on
  the new run; a rerun with fewer alerts drops the tail; mode P submits six jobs, `collect` sees
  them `READY`, the worker runs them as six steps, `collect` sees them `FINISHED` with the same
  counts, and the log equals mode S's; a second parallel run leaves it again;
- a changed rule (a copy of one rule with another alert text, so another hash) adds its rows under
  the new hash and keeps the old version's rows with their old run;
- `explain` resolves an alert to the rule's `alert:` line and the check lines tracing to it, from
  the API and from the command with `--db`; an unknown hash is refused; an older hash is found
  in git history (skipped in a clone without that history);
- mutants of the generated runner, each transpiled alone under another class name, with a control
  copy that passes the same check: `INSERT` for `MODIFY`, one rule dropped from `rules( )`, and a
  wrong model hash constant. Each makes the log check report a problem.

### The ABAP Unit proof, for this runtime and a system

`ZCL_L3_FLEET_PROOF` (`src/l3proof/`, its own folder and package so the deploy unit can name it
without the rest of `src/l2demo`) carries a local test class `ltcl_proof`, `RISK LEVEL DANGEROUS`
(it commits) and `DURATION MEDIUM`. Not `LONG`: vsp runs ABAP Unit with short and medium tests
only unless `include_long` is passed, and `tools/osd-prove-on-system.mjs` passes
`include_dangerous` alone, so a long class would not run on the system at all. The source is the
same on both sides; nothing in it asks which system it is on.

- `setup` inserts the mocha proof's fleet again under keys that start with `L30` (no generated L2
  test uses them) and commits; every run uses the check date `20991001`
  (`ZCL_L3_FLEET_PROOF=>C_CHECK_DATE`), which no other log group uses, so a run's `MODIFY` and
  tail `DELETE` touch only the proof's rows. `teardown` deletes the seed and every alert row of
  the runs the method made, by run id, and commits. Job logs and SM37 history stay.
- `mode_s`: the six rules' own `check` answers (the classes called directly) hold seven alerts
  about the seeded keys, from six rules; `run( 'S' )` reports six rules `DONE` and as many alerts,
  and the log of that run equals the union of the answers.
- `rerun`: a second run is a run of its own, every rule `DONE`, the log identical and still the
  union, and no row of the date naming another run.
- `rerun_fewer_piles`, `partial_keeps_old`: see "Piles and set parameters".
- `mode_p`: `run( 'P' )` reports six rules `SUBMITTED`; the caller commits; a bounded loop calls
  `collect( )`, then `WAIT UP TO 1 SECONDS`, until every job is `FINISHED` or `ABORTED`, and gives
  up after 180 s with each rule's job name, count and status in the failure. Then every rule is
  `FINISHED`, each counts the alerts mode S counted, and the log of the parallel run equals mode S's.

**Where its jobs run.** On a system the background work processes run the jobs while the test
session sits in `WAIT`. On this runtime three things stand in the way inside the ABAP Unit loop
(`output/index.mjs`, and `UnitRun` in `tools/osd-unit.mjs`): `JOB_OPEN` goes through the `JOBS`
destination, which needs a dialog step (`tools/osd-job-port.mjs`: "JOB_* requires a dialog step"),
and no test method runs in one; that destination also needs `STG_DB=file`, and `npm run unit`
runs in memory; and nothing executes a released job in that process, since the outbox drain and the
queue are worked by `osd-batch-runs worker` or by a test (`drainJobOutbox`, `workQueuedBatch`).
Making the unit loop give every method a step, a file and a worker would change every test's
LUW and is not small, so it is not done. Instead:

- `npm run unit` runs every method but `mode_p`, which it skips by configuration
  (`options.skip` in `abap_transpile.json`, printed as "skipped due to configuration");
- `test/dsl-l3.mjs` runs the whole class, `mode_p` included, on its file database: each method
  (setup, method, teardown) as one dialog step, with the worker's own loop (drain the outbox, work
  the queue) running beside it in the process. That loop takes the work process like any step, so a
  job runs only while the proof's `WAIT` has given it up. The suite checks that the six jobs ran,
  that the proof passed and that it left no seed and no log rows behind.

The same suite runs three mutants through the proof: a runner that drops a rule (`mode_s` fails,
six rules expected; `rerun` fails, the log is not the union), `INSERT` for `MODIFY` (`mode_s`
passes, `rerun` fails with the rules `WRITE-FAILED`), and a proof whose wait loop has no `WAIT`
(collect reads the jobs before they ran; it fails naming six jobs `READY`, and the released jobs
then run after the teardown, which is the case the next paragraph warns about).

If `mode_p` gives up on a system, the jobs it released may still run after `teardown` and write
rows under the run id it deleted; delete `ZOSD_L3_ALERT` rows of check date `20991001` by hand.

**On A4H.** The deploy unit `l3demo` (`deploy/manifest.json`) lists exactly what the proof needs:
the four L2 tables and `ZOSD_L2_WEIGHT`, the six enabled rule classes (with their own generated
tests, which the run will report too), `ZCL_L3_FLEET` with its ports (below), `ZL3_FLEET`, `ZOSD_L3_ALERT`,
`ZOSD_L3_PILE`, `ZOSD_L3_RUN` and the proof; since slice 3b also the two-stage set `ZCL_L3_FLEET2`
with its keys rule, report, ports and worklist variant, `ZOSD_L3_WORK` and `ZOSD_L3_STAGE` (see
"Stages, filters and a schedule").
The objects live in three folders and the tool takes one flat folder, so stage them first:

```
rm -rf .local/stage/l3demo && mkdir -p .local/stage/l3demo && cp \
  src/l2demo/zosd_l2_ship.tabl.xml src/l2demo/zosd_l2_voy.tabl.xml src/l2demo/zosd_l2_crew.tabl.xml \
  src/l2demo/zosd_l2_cargo.tabl.xml src/l2demo/zosd_l2_weight.dtel.xml src/dsl/zosd_l3_alert.tabl.xml src/dsl/zosd_l3_pile.tabl.xml src/dsl/zosd_l3_run.tabl.xml \
  src/l2demo/zcl_l2_maintenance_ship.clas.* src/l2demo/zcl_l2_grounded_ship_crew.clas.* \
  src/l2demo/zcl_l2_ship_captain.clas.* src/l2demo/zcl_l2_ship_voyage_limit.clas.* \
  src/l2demo/zcl_l2_ship_min_crew.clas.* src/l2demo/zcl_l2_ship_cargo_limit.clas.* \
  src/l2demo/zcl_l3_fleet.clas.* src/l2demo/zcl_l3_fleet_ports.clas.* src/l2demo/zcl_l3_fleet_ships_*.clas.* \
  src/l2demo/zcl_l3_fleet_alerts_*.clas.* src/l2demo/zif_l3_fleet_*.intf.* src/l2demo/zcx_l3_fleet_port.clas.* \
  src/l2demo/zl3_fleet.prog.* src/l3proof/zcl_l3_fleet_proof.clas.* \
  src/dsl/zosd_l3_work.tabl.xml src/dsl/zosd_l3_stage.tabl.xml src/l2demo/zcl_l2_ship_busy.clas.* \
  src/l2demo/zcl_l3_fleet2.clas.* src/l2demo/zcl_l3_fleet2_*.clas.* src/l2demo/zif_l3_fleet2_*.intf.* \
  src/l2demo/zcx_l3_fleet2_port.clas.* src/l2demo/zl3_fleet2.prog.* \
  .local/stage/l3demo/
node tools/osd-prove-on-system.mjs .local/stage/l3demo --unit l3demo --manifest deploy/manifest.json
```

The trace sidecars are copied and left out of the zip like every sidecar; anything else in the
folder that the unit does not list refuses the zip. Keep `--osg` at its default, `count`: `--osg
run` runs the class through `UnitRun` in the tool's own process, where `mode_p` has neither step,
file nor worker and fails.

The first run (2026-10-01) stopped at the import: A4H refused to activate `ZOSD_L3_ALERT`, whose
rule column was then named `RULE`, a reserved word, and warned that its key was longer than 120.
Both are fixed above (the alert log section); nothing else had run.

The second run (2026-10-01, after the rename) passed end to end on A4H:
- the import of 15 objects;
- 109 ABAP Unit methods, all green: the six rule classes' own tests and the three proof methods, mode S, rerun and mode P;
- **mode P ran on the system's own job scheduler**: six background jobs, `L3_FLEET_01` to `L3_FLEET_06`, all with status F (finished), within about a second. The log equals mode S's. This is the first check of this runtime's job emulation against a real scheduler;
- cleanup by receipt removed every object and the package. The jobs stay in SM37's history, as a system keeps them.

## Ports and adapters

A **port** is a typed interface the runner talks to instead of a table: a `source` it reads rows
from, a `sink` it writes rows through. Each port has **variants**, classes that implement the
interface, and a **binding** says which variant a run uses. Real code of this shape writes each
port as an interface with several hand-written implementations (local, remote, dummy) and picks one
with a hard-coded `CREATE OBJECT`; the dummy and zero-footprint variants are copies. Here the
interface, the dummy and capture variants and the factory are generated, through the same engine
and with the same trace as the runner, and the choice is data.

### The YAML

In the set file (one file, so every port, variant and binding has its own line for the trace;
a set without `ports:` gets the implicit `alerts` sink with the `log` variant and behaves as before):

```yaml
ports:
  ships:
    kind: source
    table: ZOSD_L2_SHIP          # the row type: a DDIC table, checked against the DDIC given
    key: ship_id                 # the field a key range is over
    variants:
      table: generated           # reads the table the rules read
      capture: generated         # replays the rows it was given
  alerts:
    kind: sink
    table: ZOSD_L3_ALERT         # the alert log: the one table the runner knows how to fill
    group: [set_name, rule_name, model_hash, check_date]   # the key of one rule version and date
    seq: alert_seq
    variants:
      log: generated             # today's MODIFY plus tail DELETE
      dummy: generated           # takes the rows, counts them, writes nothing
      capture: generated         # keeps the rows in memory for a test
bindings:                        # the default variant of each port
  ships: table
  alerts: log
```

A variant is `generated` (a source: `table`, `dummy`, `capture`; a sink: `log`, `dummy`, `capture`)
or the name of a **hand-written class** (`remote: zcl_my_ships_remote`). The compiler finds the
class beside the set or under `src/` and reads it with abaplint: the named class itself must
declare `INTERFACES zif_l3_<set>_<port>` and implement the port's method in its own
IMPLEMENTATION (a source: `read`; a sink: `put`); a helper class in the same file counts for
nothing. It is refused at the class's own file and line otherwise. A generated name over 30
characters, a binding to a variant the port does not have, a port without a binding, a second sink
and a field the table lacks are each refused at their manifest line. The runner knows exactly one
sink (the alert log), so the set has exactly one.

**A hand-written class is never bound in a replay, and nothing scans it to decide so.** An earlier
draft let a class declare `replay_safe` and checked it for COMMIT and friends. That cannot be
made sound: `WAIT UP TO` commits, a helper the class calls can commit, and a static scan of one
file sees neither. So the rule is structural: a run whose source binding is a replay may bind only
generated variants on every port, and the factory refuses any hand-written variant in that run
before anything is created, read or swapped.

### What is generated

Per port `ZIF_L3_<SET>_<PORT>`:

- a source: `TYPES tt_rows` (the table's rows) and `tt_range` (a range over the key),
  `read( it_range ) RETURNING rt_rows`;
- a sink: `tt_rows`, `ty_group` (the group's key fields) and `put( it_rows, is_group ) RETURNING
  rv_count` (how many rows it took).

Per generated variant `ZCL_L3_<SET>_<PORT>_<VARIANT>`: `table` selects the key range; `log` is
exactly the old `write` (`MODIFY` per row, then `DELETE` of the group's rows past the last one),
moved out of the runner; `dummy` counts; `capture` appends to a class attribute, with static
`rows( )` and `reset( )` (a source's `dummy` and `capture` have `set_rows( )` and `reset( )`, the
capture also `reads( )`). Also `ZCL_L3_<SET>_PORTS`, the factory, and `ZCX_L3_<SET>_PORT`, its
exception (`CX_NO_CHECK`, with `port`, `variant` and `reason`, so a caller that never names
bindings needs no `RAISING`).

The factory has `get_<port>( iv_variant )`, which returns the implementation and refuses an unknown
name with the exception (no silent default); `variant( iv_port, iv_bind )`, which is the manifest's
binding unless the run's binding names the port; `swaps( iv_port, iv_bind )`; and `check( iv_bind,
iv_parallel, iv_allow_replay )`. **`check` is pure data and creates nothing.** The generator knows
each variant's kind and, for a generated one, whether it is volatile (keeps rows in this session:
`dummy`, `capture`) and whether it replays (a source variant other than `table`); the factory
holds that as plain comparisons on the variant name, and a hand-written class counts as live and
not volatile and is never asked. `check` first resolves and validates every port's binding by
name (unknown port, unknown variant), and only then refuses, in this order: a volatile variant
in mode P, a replay in mode P, a hand-written variant in a replay, and a replay without the
opt-in. No adapter has been created when any of them is raised. `swaps` is the same data: the
runner swaps a table only when the source is bound to a generated replaying variant. Each file has a `.trace.json`: a line of a port's interface traces to the port's
manifest line, a line of a variant class to the variant's line, the default `rv_variant = '...'`
to the binding's line, and the runner's lines about a port (the swap, the write) to the port's line.

### Bindings are data

`run( iv_date, iv_mode, iv_bind )` and `run_rule( ..., iv_bind )` take the binding as a string,
`'ships=capture,alerts=dummy'`; a port it does not name keeps the manifest's binding. The report
has a parameter `P_BIND` and `submit` passes the string on, so a run in jobs carries it too. The
same generated runner therefore runs against the log, in a test against a capture, or with a
hand-written remote variant, with no rebuild. The runner reaches the alert sink through the
factory (`write` builds the rows of one rule version and date and calls `put`), so the log
variant is the only code that touches `ZOSD_L3_ALERT` on a write; mode S and P and the log
behave as before under the default binding (the whole earlier proof is unchanged).

### The replay seam

**Never in production: it swaps table content in the caller's LUW.** It is a test and dev seam.
A run that binds a source that is not live is refused with the typed exception, naming the
source, before anything is read, written or swapped, unless the caller passes
`iv_allow_replay = abap_true` to `run( )`. Only tests pass it.

The L2 check classes read their tables themselves, in one joined `SELECT`, and a rule's rows cannot
be handed to it. So a source bound to a generated variant other than `table` works by **replacing the table's content for the
run**: the runner reads the table into a backup, asks the source for its rows (`read( )`), deletes
the table and inserts those rows (the client field set to the logon client), runs the rules, and
puts the backup back, all in the run's own LUW. The restore also happens when an exception
leaves the run: the swap is in a `TRY` whose `CATCH cx_root` restores and raises again (the
transpiler drops `CLEANUP`, `ANORMALIES.md`). What cannot be restored is a unit of work that was
ended or split inside the swap, so nothing in the window may, and that is checked rather than
promised: every generated check class is asserted by the compiler (with abaplint, on statements)
to hold no COMMIT, ROLLBACK, WAIT, SUBMIT, CALL TRANSACTION, RECEIVE RESULTS, MODIFY, INSERT,
UPDATE, DELETE, MERGE, update task, native SQL, or CALL FUNCTION with `IN UPDATE TASK`, `IN
BACKGROUND`, `DESTINATION`, `STARTING NEW TASK` or a commit/rollback module; the generated runner
and every generated variant are asserted to hold none of the unit-ending or splitting ones (the
log variant writes; the runner's one SUBMIT is in the mode P path, which a replay refuses).
Hand-written classes are not scanned, they are not bound (see above). The rules then see exactly the rows the source
gave, including ones the table does not hold (`test/dsl-l3.mjs` replays two ships, one of them
absent from the table, and finds that ship's alerts and none for the table's other ships), and the
table is as it was afterwards. It is for one session at a time: a run in jobs refuses it (and
refuses every volatile variant: a job of another session would not see in-memory rows). It
swaps only the source port's table; the other tables the rules read stay real, and a source bound
to `table` or to a hand-written class swaps nothing and reads nothing.

### Proof

In `test/dsl-l3.mjs`: explicit default bindings give the default log; `alerts=dummy` reports the
same counts and writes no row; `alerts=capture` holds the log variant's rows (but for the run and
its time) and the log stays empty; `ships=capture` with given rows replays them and the table
comes back; an unknown variant or port is the typed refusal before anything is read or written; a
run in jobs refuses `capture` and `dummy`; the compile-time refusals above, each at its line; the
trace of every generated line to a manifest line. Mutants, each transpiled alone and swapped in
by name, with a control copy that passes (the replay's own mutants: a runner that does not restore
on an exception, caught by a rule that raises mid-replay and a step that looks at the table before
it ends; a factory that ignores the opt-in): a factory that ignores the binding (always the
default) is caught by `alerts=dummy` writing seven rows; a dummy sink that writes is caught the
same way; a capture sink that drops a row is caught by the comparison with the log; a runner that
never swaps the source in is caught by the rows given not being seen; a runner that skips the
restore is caught by the table not being back; a factory that falls back to the default for an
unknown variant is caught by the missing refusal. The ABAP Unit proof (`src/l3proof`) is
unchanged.

### Not here yet

The pipeline around the ports (an audit sink and a provenance row; the pile planner, the stages and
the schedule are below), and remote adapters (a variant that calls another system is a
hand-written class today). A replay that does not touch the table needs the L2 check classes to take their rows from a port, a change in L2; a sink other than
the alert log is not done either.

The third run (2026-10-01, with ports and adapters, commit 65bd6731) passed the same way:
- 24 objects imported and activated on A4H: the two port interfaces, five generated variants, the factory and its exception, plus the regenerated runner;
- 109 tests green, the proof's mode P included, again on real background jobs;
- cleanup by receipt left nothing.

## Piles and set parameters

Slice 3a, 2026-10-02. Two properties a set gets from its YAML alone; nothing in the compiler or the
templates knows the fleet.

```yaml
params:
  active_status: {type: C, default: A}   # L2's type syntax; default optional
piles:
  source: ships                          # a source port of the set
  size: 2                                # keys per pile, an INT4 from 1
```

### Set parameters

A rule receives the set parameters whose names match its own L2 parameters (`docs/dsl-l2.md`,
"Slice 7"). Refused, each at its line: a set parameter no enabled rule declares; one whose type is
not the type every rule declares for that name (written the same: the same data element, or the
same `<TABLE>-<field>`); a bare `C`, `N`, `P` or `X`, which has no length (L2 refuses it too,
below); a default that does not fit; a string-typed parameter (a job receives it through a
selection field, which has a fixed length); and, at the rule's manifest line, an L2 parameter of an
enabled rule that has neither a set parameter nor a default of its own.

Generated: `ty_params` with one component per set parameter, `run( iv_date, iv_mode, iv_bind,
is_params )`, `run_rule( ..., is_params )`, and in the report one `PARAMETERS` line per parameter,
named `P_` and the first six characters of the name, made unique with digits (`p_active`,
`p_activ1`) and never one of the report's own fields (`P_RULE`, `P_DATE`, `P_RUN`, `P_PILE`,
`P_BIND`); `submit` passes them `WITH`, the way it passes `P_DATE`. `run_rule` gives a component
that is **initial** its default: the set's, or, for a set parameter without one, the rule's own
L2 default. The limit this sets, stated: a caller cannot pass a parameter's initial value (`space`,
`0`) on purpose; it reads as "not given". The lines of `ty_params` and `is_params` trace to
`params:`, a component and its default to its own `params:` entry.

**A type with a length.** The demo's parameter was first `{type: C}`, which the compilers took
as CHAR 1 and emitted as `TYPE c`; A4H refused the report ("Lengths must be specified explicitly
when using types C, P, X, and N in the OO context", 2026-10-02, `ZL3_FLEET`), and the same text
in `ty_params` and the check's signature would have failed the same way. A bare `C`, `N`, `P` or
`X` is now refused at its line by both compilers. A parameter names a data element or the table
field it stands for, `<TABLE>-<field>` (L2's params gained that form for this, the smallest
extension that gives a length without a new DDIC object), and the ABAP names it as written:
`iv_active_status TYPE zosd_l2_ship-status`, `active_status TYPE zosd_l2_ship-status`,
`PARAMETERS p_active TYPE zosd_l2_ship-status`.

### The pile planner

A rule is **piled** when its L2 `range:` (`docs/dsl-l2.md`, "Optional driving-key range") is the
source port's `key` on the port's table. The other enabled rules run as one pile, number 0, over
every row; `plan( )` says so in a comment line that traces to the rule, and `explain` says so too.
`piles:` with no piled rule is refused at `piles:`, and so are a size that is not an INT4 from 1,
a source that is not a source port, and a key wider than 40 characters.

`plan( iv_run, iv_date, iv_bind, iv_size )` reads the keys **through the source port**, the
variant `iv_bind` selects, with an empty range (every row the variant gives, so a capture or
replay binding plans over the rows given), sorts them, drops repeats and cuts them into consecutive
chunks of `iv_size` (default `c_pile_size`, the manifest's `size`; a size below one is the
manifest's). A chunk is one pile, `I BT <first> <last>`, or `I EQ <key>` when it holds one key; no
key, no pile, and a piled rule with no pile is `DONE` with no alert. The plan is a function of the
key set and the size; the tests assert the exact plan.

**The plan is data.** `ZOSD_L3_PILE` (`src/dsl/zosd_l3_pile.tabl.xml`), generic for every set:

| key | field |
|---|---|
| MANDT, RUN_ID (CHAR 32), RULE_NAME (CHAR 60), PILE_NO (INT4) | SET_NAME (CHAR 16), MODEL_HASH, CHECK_DATE, RANGE_LOW, RANGE_HIGH (CHAR 40, the key as text), STATUS (CHAR 12: PLANNED, RUNNING, DONE, FAILED), JOB_NAME, JOB_COUNT, ALERTS (INT4), STARTED, ENDED (timestamps) |

The key is **105** (3 + 32 + 60 + 10), counted as a system counts it (the alert log section). It
had SET_NAME in it, 121, and A4H refused it; a run id is a UUID and unique on its own, so the set
name is a field, and every read of the table still names it beside the run.
`tools/osd-ddic-reserved.mjs` finds neither a reserved field name nor a key over 120.

### Running the piles

- `run( )` writes the plan (`PLANNED`) before any pile runs. Mode S then runs every pile of every
  rule in its step; mode P submits one job per (rule, pile), named `L3_<SET>_<nn>_<pppp>` (the
  compiler checks the 32 characters; `<pppp>` is the pile number's last four digits, and a job
  finds its plan row by number, not by name).
- The report has `P_PILE`. A job reads its range from the plan row (set, run, rule, pile): the
  range is data, not a selection field.
- `run_rule` sets the pile `RUNNING` (with `STARTED`) as it starts, and `DONE` or `FAILED` (with
  `ENDED` and its alert count) when the rule's write did or did not land, all in the step's own
  LUW. A pile that dumps leaves its row as it was; in a job the LUW rolls back, and `collect( )`
  reads the job.
- `collect( )` reads the run's plan rows and, for each pile neither `DONE` nor `FAILED`, its job's
  state (`SHOW_JOBSTATE` by the job name and count the plan row holds). A job that ended
  (finished or aborted) without its pile `DONE`, or a pile with no job at all, makes the pile
  `FAILED` (the row is read again first, so a job that finished between the two reads counts as
  done). This replaces matching the jobs by name and count alone.
- `rs_result-rules` has `piles` and `piles_done`. A rule is **`DONE`** when every pile is,
  **`PARTIAL`** when a pile failed, and otherwise shows the state of a job still open (`READY`,
  `RUNNING`, ...), as `collect( )` did before piles. Mode P's `run( )` reports `SUBMITTED`, or
  `PARTIAL` when a submit failed.

### The alert log, per pile, and finalise

The alert sink's group gains `PILE_NO`, so `MODIFY` plus the tail `DELETE` are idempotent per
(set, hash, date, pile): a rerun of one pile replaces that pile's rows only.

**Finalise.** Once every pile of a rule is `DONE` in this run, the rows of the same (set, rule,
model hash, date) whose `RUN_ID` is not this run go: they are an older plan's, whose piles may have
cut the keys elsewhere. Mode S finalises at the end of the rule, mode P in `collect( )`. Only
**the latest run** of the set and date finalises (next section): the alert key has no run id, every
run rewrites the same (set, hash, date, pile, seq) slots, so "another run's row" is not "an older
run's row", and a late `collect( )` of an older run would otherwise delete a newer run's rows. Only the
log keeps older runs, so a run bound to another variant of the sink (`alerts=dummy`,
`alerts=capture`, a hand-written sink) does not finalise and leaves the log as it is;
`ty_result-bind` carries the binding to `collect( )` for that.

**No finalise while a pile is not `DONE`.** The rule is `PARTIAL` and the older run's rows stay
next to the new run's: the log may then hold a row of each for one alert. That is the conservative
choice (an older answer is kept rather than a gap left); a later slice's doctor re-runs the
failed piles, and a complete rerun finalises.

### One run at a time

A piled run takes a lock before it plans: the row of `ZOSD_L3_RUN` for its set and check date
(key MANDT, SET_NAME, CHECK_DATE: 3 + 16 + 8 = **27**; RUN_ID, STATUS `HELD` or `RELEASED`,
STARTED). `lock( )` is one statement either way, so of two runs at once one wins: an `INSERT` for
a set and date never run, or an `UPDATE ... WHERE status = 'RELEASED'` for one whose last run let
go. A run that finds the lock `HELD` answers **`BUSY`** in `rs_result-status` and plans, runs and
writes nothing. Mode S releases at its end (and when an exception leaves `run( )`); mode P holds
it until `collect( )` finds every pile of every rule final (`DONE` or `FAILED`), so a run of the
same set and date cannot start while jobs of another may still write. The row is kept after the
release and names the latest run, which is what finalise compares with.

The stance, stated: runs of one set and date are serialised, not merged. A run that is never
collected, or a holder that died (a dump after the commit of mode P, a caller that never calls
`collect( )`), keeps the lock: release it by hand (`UPDATE zosd_l3_run SET status = 'RELEASED'`
for the set and date). There is no stale-lock timeout here; the doctor of slice 5 takes this over.
Sets without `piles:` take no lock (and have no finalise), as before.

### Explain

`<set>/<rule>/<hash>/<date>/<pile>/<seq>`; the five-part key of before piles is pile 0. The `pile`
line says whether the rule is piled, the size and source, and with `--db` the plan row's range
and status.

### The demo and its proof

`fleet.l3.yaml` is piled, two keys per pile, and passes `active_status` to the captain rule (whose
`when:` was `ship.status = 'A'` and is now `ship.status = $active_status`, default `A`). Every
fleet rule whose `for:` is `ZOSD_L2_SHIP` has `range: ship.ship_id` and an example whose range
keeps one of three flagged ships (`range: [{sign: I, option: BT, low: S002, high: S003}]` over
S001, S002 and S004; the captain rule's uses `EQ`).

In `test/dsl-l3.mjs`, on the file database: mode S plans exactly `[1, S001, S002], [2, S003,
S004]` for every rule and each alert row names the pile of its ship; three keys per pile cut `I BT
S001 S003` and `I EQ S004`; a rerun with one pile (`iv_pile_size = 4`) leaves exactly the rerun's
rows; a source with no rows plans nothing and every rule is `DONE` without an alert; a run bound to
`alerts=dummy` leaves the log as it was; mode S takes the lock and releases it, a run while another
holds it answers `BUSY` and plans nothing, and a late `collect( )` of an older run (the critic's
input (a): run A, then run B completes, then A is collected) leaves B's rows and B's lock alone; a
submitted mode P run holds the lock while its piles are open, a run meanwhile is `BUSY`, and the
final `collect( )` releases it; a log whose pile 2 writes do not land leaves its rules
`PARTIAL`, pile 2 `FAILED` and the older run's pile 2 rows in place, and a complete rerun then
finalises; mode P runs twelve jobs, `collect` reads them `READY` before and `DONE` after; the set
parameter reaches the captain rule in a step and through a job's selection field; the refusals
above, each at its line; and a set without `piles:` or `params:` renders, through the live
templates, exactly what the templates render with every section of this slice taken out.

The ABAP Unit proof (`src/l3proof`) adds to `mode_s` (every rule cut into piles, each run, the log
the union of the rules' answers over all rows) and `mode_p` (more than one pile and job per rule;
24 jobs with the mocha seed beside the proof's):

- `mode_p` also runs the set again while the submitted run is open: `BUSY`, nothing planned; and
  after the final `collect( )` the lock row names the run and is `RELEASED`;
- `rerun_fewer_piles`: a run of two keys per pile, then one with `iv_pile_size = 1000000`, one
  pile per rule: the same alerts, and no row of the date names another run;
- `partial_keeps_old`: a complete run, then a second plan of the same keys whose pile holding the
  proof's `L301` fails for the first rule (its write bound to a sink variant the port does not
  have) while the rule's other piles run; `collect( )` finds that pile `FAILED`, the rule
  `PARTIAL` with one pile short, and the first run's rows in that pile still there.

**Mutation evidence**, each red against the test named:

| mutant | turns red |
|---|---|
| off-by-one in the cut (`lv_count > lv_size`) | the exact plan (`[1, S001, S003], [2, S004, S004]`) |
| finalise deleting this run's rows (`run_id = iv_run`) | the log check: the log is empty, not the union |
| finalise when a pile failed, mode S (`piles_done >= 0`) | the partial test: the older pile 2 row is gone |
| finalise when a pile failed, `collect( )` | the ABAP Unit proof `partial_keeps_old` |
| finalise never deleting | the rerun with fewer piles: the older run's pile 2 stays |
| finalise for any sink | `alerts=dummy` wipes the log |
| a pile reading another pile's range (`pile_no = 1`) | the log check: not the union |
| the range dropped from the WHERE (L2) | the example whose range keeps one of three flagged ships |
| a lock that is always taken | the lock test: the run while another holds it is not `BUSY` |
| mode S that never releases | the lock test: `HELD` after the run |
| finalise without the latest-run check | the lock test, input (a): the late collect empties the log |
| `collect( )` releasing before every pile is final | the lock is gone while the jobs have not run |
| a key over 120 (`ZOSD_L3_PILE` as it was) | `test/ddic-reserved.mjs`: 121, refused |
| a bare `C` parameter type | `test/dsl-l2.mjs`, `test/dsl-l3.mjs`: refused at its line |

**Deviations from the slice's design, with their reason.** `plan( )` takes `iv_date`, `iv_bind`
and `iv_size` beside `iv_run`, so it holds no class state and a caller (the proof, a doctor) can
plan a run of its own. `run( )` takes `iv_pile_size` (default the manifest's size): a rerun with
another pile size needs no second runner class. A rule whose piles are all still open shows its
job's state rather than `PARTIAL`, so `PARTIAL` means a pile failed. Finalise runs only when the
alerts port is bound to `log`.

**Known limits, stated** (the critic's P3s, not changed here):
- set parameters are not in the alert key: two runs of one set and date with different parameter
  values rewrite the same slots, and the latest run's finalise removes the other's rows. The log
  holds one answer per (set, rule version, date), the latest parameters' answer;
- a key inserted between `plan( )` and a pile's run that falls outside every pile's range is not
  checked by that run (a key inside a pile's BT range is); the next run plans it;
- job names carry the pile number's last four digits, so above pile 9999 two jobs of one rule
  share a name; the plan row, found by number, is what a job reads, and `collect( )` reads the job
  by name and count;
- piles cut by the database's order of the key (`SORT` in ABAP on the rows read): on a non-ASCII
  key a system's collation and this runtime's may cut at another key; the plan row records the
  bounds used;
- mode P commits before its jobs start (the caller's step commits the plan and the lock, then the
  jobs run in their own LUWs); a dump in that caller after `run( )` but before its commit leaves no
  plan, no lock and released jobs that find no plan row (`NO-PILE`);
- the alert sink's group carries `PILE_NO` in a piled set, so a hand-written sink sees it in
  `is_group`;
- "a pile that dumps rolls back" is true of mode P (the job's LUW); in mode S an exception leaves
  `run( )` and the caller's step decides, as before piles.

## Stages, filters and a schedule

Slice 3b, 2026-10-02. A set runs as an ordered list of stages: stage n+1 starts only when every
pile of stage n is `DONE`. A stage may be a **filter**: its rules select driving keys into a
**worklist** instead of raising alerts, and a later stage plans its piles over that worklist, not
over the whole source. A set may carry a **schedule**, a periodic background job. All of it comes
from the YAML; the compiler and the templates know no domain (preselect, then check deeply,
expressed on the fleet).

```yaml
stages:
  - stage: candidates            # a stage name: the set-name rules (a-z, 0-9, _; 13 at most)
    filter: true                 # its rules fill a worklist with keys( ), not the alert log
    worklist: busy               # the key set this stage fills
    piles: {source: ships, size: 2}           # optional: a stage may be piled itself
    rules:
      - rule: ship_busy.l2.yaml  # L2 keys: true (docs/dsl-l2.md, "The keys a rule flags")
  - stage: checks
    piles: {source: "worklist:busy", size: 2}  # the worklist's keys, read through the port of their key
    rules:
      - rule: maintenance_ship.l2.yaml
      - rule: ship_voyage_limit.l2.yaml
schedule: {every: 1d, at: "020000"}           # m minutes, h hours, d days, w weeks; never months
```

The demo is `src/l2demo/fleet2.l3.yaml`: the filter `ship_busy` (a ship that is not decommissioned
with a voyage ahead) fills `busy`, and six deep rules run over it. The one-stage `fleet.l3.yaml`
stays as it was (below, "Deviations").

### The manifest

`stages:` replaces `rules:` and `piles:` (both beside it are refused); a set without `stages:` is one
implicit stage and renders the bytes it rendered before (`test/dsl-l3-stages.mjs` renders the
one-stage fleet through the live templates and through the templates with every section of this
slice taken out, and compares; the committed one-stage runner, report and factory are those bytes).
Refused, each at its line (`file:line: message`): a filter stage whose rule has no `keys: true`
(at the rule's line); filter rules over different keys; a filter stage without `worklist:` and a
worklist on a stage that is not a filter; a worklist used before it is filled, or filled twice; a
worklist whose key has no source port of that table and key (it is read through that port); a key
wider than 40; `piles.source: worklist:<w>` with a rule whose `range:` is not the worklist's key
field (over a worklist every rule is piled: one that is not would run over every row and pass the
filter by); an empty stage (no rule, or every rule disabled); more than 9 stages (the stage is one
digit of the job names `L3_<SET>_<s><nn>_<pppp>`); a stage name that does not fit; a schedule in
months or with another unit, a period wider than JOB_CLOSE's field (`PRDMINS` 2, `PRDHOURS` 2,
`PRDDAYS` 3, `PRDWEEKS` 2 digits), an `at` that is not `HHMMSS`, and a schedule on a set without
stages (below).

### What is generated

The runner `ZCL_L3_<SET>`, from the same template as before (new sections `staged`, `stages`,
`schedule`; the plan machinery a piled and a staged set share is `planned`):

- `CONSTANTS c_stage_<n>` (each stage's name) and `c_stages`; `ty_stage` (`stage_no`, `stage`,
  `status`, `piles`, `piles_done`) and `rs_result-stages`; `ty_rule` gains `stage_no`, `filter`
  and `keys` (a filter rule's `alerts` stay 0, its `keys` count what it selected); `rs_result`
  carries the set parameters, so `collect( )` can open a stage with them;
- `run( )`: the lock, a gate row per stage (all `WAITING`), then stage by stage: the gate opens
  (`WAITING` to `OPEN`), `plan( iv_stage )` plans it then (a later stage reads what an earlier one
  filled), and mode S runs its piles in the step; a stage that does not end `DONE` stops the run,
  and the later stages stay `WAITING` in `rs_result` and in the gate table. Mode P submits the piles
  of the first stage that has any (a stage with no pile is `DONE` at once and the next one opens);
- `plan( iv_run, iv_date, iv_stage, iv_bind )`: a piled stage reads its keys through its source
  port, the bound variant, or, over a worklist, through the port's `worklist` variant; cut as
  before; a rule that is not piled is pile 0; the plan rows carry `STAGE_NO`;
- `run_rule( )`: a check rule as before; a **filter** rule calls its `keys( )` with the pile's
  range and writes the keys with `fill( )` into `ZOSD_L3_WORK`, `MODIFY` on the full key, so a
  retried pile writes the same rows. Nothing of a filter goes to the alert log. A pile's `ALERTS`
  column holds, for a filter pile, the number of keys it selected;
- `range_<n>( is_pile )`: the range of a pile of stage n. Over a port it is `I BT low high` (or
  `I EQ`), as before. **Over a worklist it is the worklist's keys between the pile's bounds, each
  `I EQ`**: a key between them that the filter did not select stays out (the BT of the bounds would
  check it; `test/dsl-l3-stages.mjs` seeds such a ship between two busy ones);
- `advance( iv_run, iv_date, iv_stage, iv_bind, is_params ) RETURNING rv_opened`: the gate (next);
- `collect( )`: per stage (below); `schedule( )` and `unschedule( )` (below).

The job report `ZL3_<SET>`: a pile that ends `DONE` commits, then calls `advance( )`. With a
schedule it has `P_MODE` (default `R`, run one rule's pile, as before; `D`, the driver).

The source port of a worklist's key gets a generated variant `worklist`,
`ZCL_L3_<SET>_<PORT>_WORKLIST`: `use( iv_run, iv_worklist )`, then `read( it_range )` selects the
run's worklist keys from `ZOSD_L3_WORK` (`WHERE run_id = ... AND worklist = ...`), builds an `I EQ`
range of them and reads the port's table with `<key> IN` that range `AND <key> IN it_range`, on the
SQL path. An empty worklist is no row (an empty range would be every row). The planner is unchanged:
it plans over a port. Only the planner reads this variant: the factory refuses it as a run's
binding (`ships=worklist`), before anything is read.

### The worklist and the gate

`ZOSD_L3_WORK` (`src/dsl/zosd_l3_work.tabl.xml`), generic for every set:

| key | field |
|---|---|
| MANDT, RUN_ID (CHAR 32), WORKLIST (CHAR 16), KEY_VALUE (CHAR 40) | SET_NAME (CHAR 16), CHECK_DATE |

The key is **91** (3 + 32 + 16 + 40), counted as a system counts it (the alert log section).
`KEY_VALUE` is the key as text, the convention of `RANGE_LOW` and `RANGE_HIGH`. A worklist name has
the set-name rules, 13 characters at most, so 16 is enough. The worklist is kept per run, for audit;
nothing deletes it. Retention (of worklists, gate rows, plan rows and old log versions) is slice 5's.

`ZOSD_L3_STAGE` (`src/dsl/zosd_l3_stage.tabl.xml`), the gate:

| key | field |
|---|---|
| MANDT, RUN_ID (CHAR 32), STAGE_NO (INT4) | SET_NAME, CHECK_DATE, STAGE_NAME (CHAR 16), STATUS (CHAR 12: WAITING, OPEN, DONE, PARTIAL, NOT-RUN), OPENED, ENDED (timestamps) |

The key is **45** (3 + 32 + 10, the INT4 at its `LENG` 10). `ZOSD_L3_PILE` gains `STAGE_NO` (INT4) as
a field, not a key: its key stays 105. `tools/osd-ddic-reserved.mjs` finds neither a reserved word
nor a key over 120, and `test/ddic-reserved.mjs` asserts the three counts.

**The gate.** Each pile job of a staged set, once its pile is `DONE`, commits (so the pile's `DONE`
is visible to every other job) and calls `advance( )` for its stage. `advance( )` counts the stage's
piles that are not `DONE`; if there is one, it returns. Otherwise it marks the stage `DONE` and opens
the next one with **one statement**, `UPDATE zosd_l3_stage SET status = 'OPEN' ... WHERE run_id = ...
AND stage_no = n + 1 AND status = 'WAITING'`: of two jobs that end the stage at once, both may find
every pile `DONE`, but only the one that gets `sy-dbcnt = 1` plans stage n + 1 and submits its
piles; the other returns. A stage that plans no pile is `DONE` at once and the gate of the one after
it is tried in the same call. Past the last stage the run is complete: the job finalises every rule
(each is `DONE`) and releases the lock, so **a staged run in jobs completes itself**: nobody has to
call `collect( )` for the log to be final and the next run of the date to be let in (what the
schedule needs, below).

**`collect( )`** reads the plan and the gates. An open pile's job is read by `SHOW_JOBSTATE`; a job
that ended without its pile `DONE`, or a pile with no job, makes the pile `FAILED`. A gate still
`OPEN` whose piles are all `DONE` (the last job ended before it could advance) is advanced from
`collect( )`. Then, stage by stage: a stage with a `FAILED` pile, once every pile is final, is
`PARTIAL`, and every later stage becomes `NOT-RUN` in the gate table: its gate closes, so no late job
opens it. The run is final when every stage is `DONE`, or when a stage is `PARTIAL` and the rest are
`NOT-RUN`; only then is the lock released. A rule of a stage not opened reports the stage's state
(`WAITING`, `NOT-RUN`); a filter rule reports `keys`, a check rule `alerts`.

**A filter that selects no key**: the later stages plan no pile and are `DONE` with no alert; their
rules are `DONE` with zero piles and finalise, which clears the older run's rows of the date, as zero
keys did before stages.

### The schedule

`schedule: {every: <n><unit>, at: HHMMSS}` generates `schedule( ) RETURNING rv_jobcount`:
`GET TIME`, `JOB_OPEN` of the driver job `L3_<SET>_D`, `SUBMIT ZL3_<SET> WITH p_mode = 'D' VIA JOB
... AND RETURN`, and `JOB_CLOSE` with `SDLSTRTDT` and `SDLSTRTTM` and the one period field of the
unit (`PRDMINS`, `PRDHOURS`, `PRDDAYS`, `PRDWEEKS`). The first start is `at` today in **system
time**, `sy-datum` and `sy-uzeit` (UTC on the sandbox and here; the facade and a system both read
`SDLSTRTDT`/`SDLSTRTTM` as system time, `docs/job-standard-fms.md`, "Periodic jobs"), or tomorrow
when `at` has passed; without `at`, now. Months are refused: the facade refuses `PRDMONTHS`.
`unschedule( ) RETURNING rv_deleted` selects the set's driver jobs with `BP_JOB_SELECT` (`SCHEDUL`)
and deletes the one waiting for its start (status `S`) with `BP_JOB_DELETE`: a periodic job's
successor is made when an instance starts, so deleting the waiting instance ends the chain, as
measured on A4H. The driver, `P_MODE = 'D'`, does `GET TIME` (the date of the moment the instance
starts) and calls `run( iv_date = sy-datum iv_mode = 'P' )`, passing nothing else: no rule, pile,
run, binding or parameter applies to it (the set parameters take their defaults).

A schedule needs `stages:`: it runs the set in jobs, and only a staged set completes in its jobs (the
gate's last job finalises and releases the run); a piled set's mode P waits for a `collect( )`
nobody would call, and would hold its lock for the date. That restriction is stated, not designed
round.

### Explain

The `stage` line names the stage of the alert's rule (its number and name, whether it is a filter and
what it is piled over, and its manifest line); the `pile` line names the stage's plan and, with
`--db`, the plan row's range (over a worklist: "the worklist's keys from <low> <high>").

### Proof

`test/dsl-l3-stages.mjs` (registered in `test/suites.d/infra-misc.json`):

- the manifest: the committed `fleet2` files are a fresh build; the model; a set without stages
  renders the bytes of the templates without this slice's sections; each refusal above at its line;
  the trace (every line of the runner, report, worklist variant and factory has a manifest line, a
  stage's lines trace to the stage, the worklist reads to the `worklist:<w>` line, the driver
  constant to `schedule:`); the runner ends no unit of work (its SUBMIT is in the jobs' path);
- on a file database, mode S: the worklist holds each busy ship once; the log is exactly what the
  check rules answer called directly with `it_range = ZCL_L2_SHIP_BUSY=>keys( )`; S003's cargo alert,
  a ship the filter leaves out, is not in it; the filter wrote no alert; stage 2 plans one pile over
  S001..S002; gates `DONE`, `DONE`; the lock released. With a third busy ship stage 2 has two piles
  per rule. With busy S001 and S004, one pile S001..S004, S003 (between them, not busy) is not
  checked. A filter that selects nothing: stage 2 `DONE` with no pile and the older rows finalised. A
  rerun after the data changed plans over its own worklist only. `ships=worklist` is refused;
- mode P: `run( )` submits stage 1's two piles only, stage 2 `WAITING` and unplanned; after one job
  the gate is still shut; the rest: stage 1's last job opens stage 2, whose six jobs run, and the
  last completes the run (lock released, nobody collected); the log equals mode S's; the gate called
  twice opens stage 2 once (the second call answers false and plans and submits nothing); a call
  while a pile of stage 1 is open opens nothing; a stage 1 pile whose job aborts keeps stage 2 shut,
  and `collect( )` makes the run final, stage 1 `PARTIAL`, stage 2 `NOT-RUN`, lock released, and a
  late gate call opens nothing;
- the schedule, on the facade's injectable clock (`tools/osd-job-scheduler.mjs`, `manualClock` and
  `installAbapClock`), with the user's own time five hours ahead in `sy-datlo`/`sy-timlo`: at 23:00
  UTC `schedule( )` makes one driver waiting for 02:00 UTC the next day; an hour on, a tick runs
  nothing; at 02:00 one driver runs, makes a run for that date whose jobs complete it (both stages
  `DONE`, lock released) and the next instance waits for 02:00 a day later; a second tick runs
  nothing; `unschedule( )` deletes one and a day later nothing runs.

The ABAP Unit proof (`src/l3proof`) gains three methods of `ltcl_proof` over `ZCL_L3_FLEET2`, on the
same seed and check date: `stages_mode_s` (two stages `DONE`, the worklist has each key `keys( )`
answers, the log equals the check rules over those keys called directly, no filter row in the log,
stage 2 has one pile per two worklist keys for each of its six rules and the worklist is smaller than
the fleet, lock released); `stages_mode_p` (stage 1 submitted, stage 2 `WAITING` and unplanned, then
a bounded wait on `collect( )`: the run `DONE`, stage 2 planned once with a job per pile (a job is the pair name and count: on A4H the six stage 2 jobs of a run share one `JOBCOUNT`, `ANOMALY-2026-10-02-jobcount-unique-per-name`), the log equal
to mode S's, lock released); `stages_partial` (a run as `run( )` leaves it with a stage 1 pile that
never gets a job: the gate stays shut, `collect( )` makes stage 1 `PARTIAL`, stage 2 `NOT-RUN`, the
run final and its lock released, a late gate call opens nothing). `npm run unit` skips
`stages_mode_p` by configuration, as `mode_p`; `test/dsl-l3.mjs` runs the whole class with a worker
beside it (ten jobs of the two stages, every one `COMPLETED`). The deploy unit `l3demo` lists the new
objects.

**Mutation evidence**, each red against the test named:

| mutant | turns red |
|---|---|
| the gate without `status = 'WAITING'` (a double submit) | the gate called twice: the second call opens stage 2 again |
| stage n+1 opening before every pile of stage n is DONE | the gate called while a pile of stage 1 is open answers true |
| the worklist variant ignoring the run id | the rerun plans over the first run's keys too (`["1 S001 S002"]`) |
| `keys( )` returning duplicates (no DISTINCT, no DELETE ADJACENT) | `test/dsl-l2.mjs`: the examples "several voyages one key" and "the range keeps the inner ship" |
| a filter stage writing alerts | mode S: "the filter stage wrote alerts" |
| `unschedule( )` not deleting the waiting instance | the schedule: the driver runs again the next day |
| a schedule computed in user time (`sy-datlo`, `sy-timlo`) | the schedule: the first start waits for 2026-10-03 02:00, not 2026-10-02 |

### Deviations from the slice's design, with their reason

- **The fleet demo stays one stage; the two-stage demo is a second set, `fleet2`.** 107 tests of
  `test/dsl-l3.mjs` and the A4H proof's five methods measure the one-stage piled set (its exact plans,
  its twelve and twenty-four jobs); making it two-staged would have replaced that evidence instead of
  adding to it. `fleet2` uses the same rules, ports and seed, and the proof runs both.
- **`keys: true` is refused on a `limit:` rule** (`docs/dsl-l2.md`): its threshold is decided in
  ABAP over the ordered rows, so its keys are not one `SELECT DISTINCT`. The demo's filter is a new
  `forbid:` rule, `ship_busy`, which the slice allowed.
- **A pile over a worklist is the worklist's keys between its bounds, each `I EQ`**, not `I BT`: the
  bounds alone would check keys the filter did not select (`range_<n>`, above).
- **A staged run in jobs completes itself**: the job that ends the last stage finalises and releases
  (`collect( )` still reports, and advances a gate a job missed). The schedule needs this, so a
  schedule is refused on a set without stages.
- **The job report commits a `DONE` pile before it calls the gate**: in one LUW, two jobs ending the
  stage at once would each see the other's pile not yet `DONE` and neither would open the next stage.
- **`GET TIME` before `sy-datum`** in `schedule( )` and in the driver: a job's step does not refresh
  `sy-datum` on this runtime (and a long dialog step on a system does not either); without it the
  driver ran for the day it was planned.
- The gate has `ENDED` beside `OPENED`; the plan's `STAGE_NO` is a field. Job names carry the stage,
  `L3_<SET>_<s><nn>`; rule numbers stay global.

**Known limits, stated:**
- the worklist variant reads the worklist into an `I EQ` range, so a worklist of many thousand keys
  makes a large `IN` list; a system limits the statement size. Then a join or `FOR ALL ENTRIES` is
  needed (a `KEY_VALUE` of CHAR 40 does not join a key of another type in 7.02 Open SQL); not here;
- a pile whose job dumps after its commit and before the gate, or that fails, leaves the run open
  until `collect( )` (or the doctor of slice 5);
- a driver instance whose date is still held by the previous instance's run (a run slower than the
  period) answers `BUSY` and plans nothing; that run is not retried;
- `unschedule( )` deletes the waiting instance only: an instance running at that moment completes;
- mode S leaves the gates of the stages after a `PARTIAL` one `WAITING` (as the slice's design says);
  `collect( )`, if called, closes them as `NOT-RUN`.

## Not yet

Ordering between rules within a stage, a log retention policy (old versions, worklists, gates and plans are kept forever), a
monitor page over the log, and the doctor that re-runs a `PARTIAL` rule's failed piles (the plan
table is what it will read). A pile planner over more than one source port, or over a key other
than a single field, is not done either.
