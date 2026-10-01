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
| MANDT, SET_NAME, RULE, MODEL_HASH, CHECK_DATE, ALERT_SEQ | ALERT_TEXT (STRG), RUN_ID, RUN_TS, RULE_CLASS, RULE_FILE, RULE_LINE |

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

`test/dsl-l3.mjs` (registered in `test/suites.d/infra-misc.json`, 30 tests):

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

## Not yet

Ordering between rules, a set parameter other than the date, a schedule, running on A4H, a log
retention policy (old versions are kept forever), and a monitor page over the log.
