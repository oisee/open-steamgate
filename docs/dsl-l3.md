# DSL L3: a set of rules, run as one unit

Status: slice 1, 2026-10-01. Built on L2 (`docs/dsl-l2.md`) and the background job facade
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
  `today` (L2 rules know no other parameter);
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
| MANDT, SET_NAME (CHAR 16), MODEL_HASH (CHAR 71), CHECK_DATE, ALERT_SEQ | RULE_NAME (CHAR 60), ALERT_TEXT (STRG), RUN_ID, RUN_TS, RULE_CLASS, RULE_FILE, RULE_LINE |

The rule is not part of the key: its model hash already names it. The hash is a SHA-256 of the
compiled rule, which holds the rule's name, and a set refuses two rules of one name, so one hash
is one rule of one set. Leaving it out keeps the key at 102 characters (3 + 16 + 71 + 8 + the
four bytes of INT4), under the 120 past which a system warns "Key length > 120 (restricted
functions)"; with the rule in the key (and a 30-character set name) it was 176, and A4H said so.
The set name is 16 wide because a set name has at most 13 characters.

The column is `RULE_NAME`, not `RULE`: `RULE` is a reserved word in a system's dictionary, and
A4H refused to activate the table with it ("RULE is a reserved word (choose another field
name)", 2026-10-01). `tools/osd-ddic-reserved.mjs` now refuses such a field name before it
leaves the tree.

`ALERT_SEQ` is the position of the alert in the rule's `check` answer, which is ordered (L2's
`ORDER BY` plus `SORT`). `RULE_FILE` and `RULE_LINE` are the rule file and its `alert:` line.

**Writes are idempotent per (rule, model hash, check date).** `write` does a `MODIFY` per alert on
the full key, then `DELETE`s the rows of the same (set, rule, hash, date) past the last alert of
this run, all in the caller's LUW (one dialog step in mode S, the job's own step in mode P). A
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
node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<check date>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]
```

prints alert -> set manifest line -> rule and version -> rule line -> the lines of the generated
check that trace to that line -> the runner lines that trace to the rule's manifest line. The hash
may be cut to eight or more hex digits. `--db` reads the alert's text and run from a file
database. A hash that is not the current version's is looked up in git history (`git log -S` on
the check class's sidecar), and the rule and class are read at that commit; a hash no version
carried is an error.

## Proof

`test/dsl-l3.mjs` (registered in `test/suites.d/infra-misc.json`, 72 tests, the ports' among them, see "Ports and adapters"):

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

- `npm run unit` runs `mode_s` and `rerun` and skips `mode_p` by configuration
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
tests, which the run will report too), `ZCL_L3_FLEET` with its ports (below), `ZL3_FLEET`, `ZOSD_L3_ALERT` and the proof.
The objects live in three folders and the tool takes one flat folder, so stage them first:

```
rm -rf .local/stage/l3demo && mkdir -p .local/stage/l3demo && cp \
  src/l2demo/zosd_l2_ship.tabl.xml src/l2demo/zosd_l2_voy.tabl.xml src/l2demo/zosd_l2_crew.tabl.xml \
  src/l2demo/zosd_l2_cargo.tabl.xml src/l2demo/zosd_l2_weight.dtel.xml src/dsl/zosd_l3_alert.tabl.xml \
  src/l2demo/zcl_l2_maintenance_ship.clas.* src/l2demo/zcl_l2_grounded_ship_crew.clas.* \
  src/l2demo/zcl_l2_ship_captain.clas.* src/l2demo/zcl_l2_ship_voyage_limit.clas.* \
  src/l2demo/zcl_l2_ship_min_crew.clas.* src/l2demo/zcl_l2_ship_cargo_limit.clas.* \
  src/l2demo/zcl_l3_fleet.clas.* src/l2demo/zcl_l3_fleet_ports.clas.* src/l2demo/zcl_l3_fleet_ships_*.clas.* \
  src/l2demo/zcl_l3_fleet_alerts_*.clas.* src/l2demo/zif_l3_fleet_*.intf.* src/l2demo/zcx_l3_fleet_port.clas.* \
  src/l2demo/zl3_fleet.prog.* src/l3proof/zcl_l3_fleet_proof.clas.* \
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

The pipeline around the ports (a pile planner that splits a key range over several workers, an
order between stages, an audit sink and a provenance row), a schedule, and remote adapters (a
variant that calls another system is a hand-written class today). A replay that does not touch the
table needs the L2 check classes to take their rows from a port, a change in L2; a sink other than
the alert log is not done either.

## Not yet

Ordering between rules, a set parameter other than the date, a schedule, a log
retention policy (old versions are kept forever), and a monitor page over the log.
