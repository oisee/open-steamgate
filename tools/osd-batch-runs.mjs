// Durable one-shot report runs. This is an operations store, separate from
// the ABAP business database and from a replaceable transpiled generation.
import {randomUUID, createHash} from "node:crypto";
import {chmodSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {setTimeout as delay} from "node:timers/promises";
import {dialogStep} from "./osd-dialog-step.mjs";
import {drainJobOutbox} from "./osd-job-outbox.mjs";
import {runsAs} from "./osd-main.mjs";

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export function operationsPath(root = process.cwd(), env = process.env) {
  if (env.OSD_OPERATIONS_DB) return resolve(env.OSD_OPERATIONS_DB);
  if (env.STG_DB_PATH) return join(dirname(resolve(env.STG_DB_PATH)), "osd-operations.sqlite");
  return join(resolve(root), ".local", "osd-operations.sqlite");
}

function inputOf(input) {
  if (!Array.isArray(input)) throw new TypeError("input must be an array of {name, value}");
  const names = new Set();
  return input.map((row) => {
    if (row === null || typeof row !== "object" || !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(row.name)
        || typeof row.value !== "string") throw new TypeError("selection input needs a name and string value");
    const name = row.name.toUpperCase();
    if (names.has(name)) throw new TypeError(`duplicate selection field ${name}`);
    names.add(name);
    return {name, value: row.value};
  });
}

function publicRun(row, {revealInput = false} = {}) {
  if (!row) return undefined;
  const input = JSON.parse(row.input_json);
  return {
    id: row.id, program: row.program, generation: row.generation,
    jobName: row.job_name ?? null, jobCount: row.job_count ?? null,
    queuedAt: row.queued_at, startedAt: row.started_at || null, endedAt: row.ended_at,
    state: row.state, resultStatus: row.result_status, detail: row.detail,
    input: revealInput ? input : input.map(({name}) => ({name})),
    outputSha256: row.output_sha256, outputBytes: row.output_bytes,
  };
}

function publicStep(row, {revealInput = false} = {}) {
  return {number: row.step_no, program: row.program, state: row.state,
    startedAt: row.started_at || null, endedAt: row.ended_at,
    resultStatus: row.result_status, detail: row.detail,
    input: revealInput ? JSON.parse(row.input_json) : JSON.parse(row.input_json).map(({name}) => ({name})),
    outputSha256: row.output_sha256, outputBytes: row.output_bytes};
}

export class BatchRuns {
  constructor(root = process.cwd(), env = process.env) {
    this.path = operationsPath(root, env);
    mkdirSync(dirname(this.path), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(this.path);
    chmodSync(this.path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS batch_runs (
      id TEXT PRIMARY KEY, program TEXT NOT NULL, generation TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL,
      result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
      output_sha256 TEXT, output_bytes INTEGER, queued_at TEXT,
      source_db TEXT, source_client TEXT, source_sysid TEXT, source_owner TEXT,
      job_name TEXT, job_count TEXT
    )`);
    // Existing operations files from the saved-run slice stay readable.
    // Serialize the check and ALTER: two first-start workers can arrive together.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "queued_at")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN queued_at TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "source_db")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN source_db TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "source_client")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN source_client TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "source_sysid")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN source_sysid TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "source_owner")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN source_owner TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "job_name")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN job_name TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "job_count")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN job_count TEXT");
      }
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "step_count")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN step_count INTEGER NOT NULL DEFAULT 0");
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS batch_imports (
        intent_id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, run_id TEXT NOT NULL
      )`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS batch_run_steps (
        run_id TEXT NOT NULL, step_no INTEGER NOT NULL, program TEXT NOT NULL,
        state TEXT NOT NULL, started_at TEXT, ended_at TEXT,
        result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
        output_sha256 TEXT, output_bytes INTEGER,
        PRIMARY KEY (run_id, step_no)
      )`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS batch_job_log (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, step_no INTEGER,
        occurred_at TEXT NOT NULL, event_code TEXT NOT NULL,
        severity TEXT NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      )`);
      if (!this.db.prepare("PRAGMA table_info(batch_runs)").all().some((column) => column.name === "after_job_name")) {
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN after_job_name TEXT");
        this.db.exec("ALTER TABLE batch_runs ADD COLUMN after_job_count TEXT");
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS batch_job_events (
        run_id TEXT PRIMARY KEY, source_db TEXT NOT NULL, source_client TEXT NOT NULL,
        source_sysid TEXT NOT NULL, source_owner TEXT NOT NULL,
        job_name TEXT NOT NULL, job_count TEXT NOT NULL, occurred_at TEXT NOT NULL
      )`);
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS batch_job_events_key ON batch_job_events
        (source_db, source_client, source_sysid, source_owner, job_name, job_count)`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.artifacts = join(dirname(this.path), "batch-output");
    mkdirSync(this.artifacts, {recursive: true, mode: 0o700});
  }

  close() { this.db.close(); }

  // Call only inside the transaction that changes the corresponding run or
  // step. BEGIN IMMEDIATE serializes sequence allocation across workers.
  #appendJobLog(id, step, event, at = new Date().toISOString()) {
    const messages = {
      IMPORTED: ["I", "Job imported for dispatch"],
      STEP_STARTED: ["I", "Report step started"],
      STEP_COMPLETED: ["I", "Report step completed"],
      STEP_FAILED: ["E", "Step failed or result recording failed; review detail and business effects"],
      STEP_INTERRUPTED: ["E", "Worker stopped before recording the step result; review business effects"],
      JOB_COMPLETED: ["I", "Job completed"],
      JOB_FAILED: ["E", "Job failed"],
      JOB_INTERRUPTED: ["E", "Worker stopped before recording a result; review business effects"],
    };
    const message = messages[event];
    if (!message) throw new Error(`invalid job log event ${event}`);
    this.db.prepare(`INSERT INTO batch_job_log
      (run_id, seq, step_no, occurred_at, event_code, severity, text)
      VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM batch_job_log WHERE run_id = ?), ?, ?, ?, ?, ?)`)
      .run(id, id, step, at, event, ...message);
  }

  // Called within the terminal-success transaction. The event and all
  // already imported dependents become visible together with completion.
  #emitCompletion(id, at) {
    const run = this.db.prepare(`SELECT source_db, source_client, source_sysid, source_owner,
      job_name, job_count FROM batch_runs WHERE id = ?`).get(id);
    if (!run?.source_db) return; // locally queued runs have no durable job identity
    this.db.prepare(`INSERT INTO batch_job_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, run.source_db, run.source_client, run.source_sysid, run.source_owner,
        run.job_name, run.job_count, at);
    const waiting = this.db.prepare(`SELECT id, step_count FROM batch_runs WHERE state = 'WAITING'
      AND source_db = ? AND source_client = ? AND source_sysid = ? AND source_owner = ?
      AND after_job_name = ? AND after_job_count = ?`).all(run.source_db, run.source_client,
        run.source_sysid, run.source_owner, run.job_name, run.job_count);
    for (const child of waiting) {
      if (child.step_count > 0) {
        const ready = this.db.prepare(`UPDATE batch_run_steps SET state = 'READY'
          WHERE run_id = ? AND step_no = 1 AND state = 'PENDING'`).run(child.id).changes;
        if (ready !== 1) throw new Error(`waiting job ${child.id} has no first pending step`);
      }
      this.db.prepare("UPDATE batch_runs SET state = 'QUEUED' WHERE id = ? AND state = 'WAITING'").run(child.id);
    }
  }

  start({program, input = [], generation = "unknown"}) {
    if (typeof program !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(program)) {
      throw new TypeError("program must be a static ABAP report name");
    }
    const run = {
      id: randomUUID(), program: program.toUpperCase(), generation: String(generation),
      startedAt: new Date().toISOString(), input: inputOf(input),
    };
    this.db.prepare(`INSERT INTO batch_runs
      (id, program, generation, started_at, state, input_json) VALUES (?, ?, ?, ?, 'RUNNING', ?)`)
      .run(run.id, run.program, run.generation, run.startedAt, JSON.stringify(run.input));
    return run;
  }

  enqueue({program, input = [], generation = "unknown"}) {
    if (typeof program !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(program)) {
      throw new TypeError("program must be a static ABAP report name");
    }
    const run = {
      id: randomUUID(), program: program.toUpperCase(), generation: String(generation),
      queuedAt: new Date().toISOString(), input: inputOf(input),
    };
    this.db.prepare(`INSERT INTO batch_runs
      (id, program, generation, started_at, queued_at, state, input_json)
      VALUES (?, ?, ?, '', ?, 'QUEUED', ?)`)
      .run(run.id, run.program, run.generation, run.queuedAt, JSON.stringify(run.input));
    return this.get(run.id);
  }

  // The ledger and queued run are one SQLite transaction. A retry after an
  // operations commit but before the business outbox acknowledgement verifies
  // the immutable intent and returns the existing run, even if its lifecycle
  // has since advanced. The ledger is retained if run retention changes.
  importIntent(intent) {
    const id = String(intent.intentId ?? "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id)) throw new TypeError("invalid outbox intent ID");
    const runId = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    const program = String(intent.program ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(program)) throw new TypeError("invalid report in outbox");
    const steps = intent.steps === undefined ? undefined : intent.steps.map((step, i) => {
      const name = String(step.program ?? "").trim().toUpperCase();
      if (step.number !== i + 1 || !/^[A-Z][A-Z0-9_]{0,39}$/.test(name)) throw new TypeError("invalid ordered report step");
      return {number: i + 1, program: name};
    });
    if (steps && (steps.length < 1 || steps.length > 16 || steps[0].program !== program)) {
      throw new TypeError("invalid outbox step count or first report");
    }
    const sourceDb = resolve(String(intent.sourceDb ?? ""));
    const after = intent.afterEvent;
    if (after !== undefined && (!steps || typeof after !== "object" || after === null ||
        Object.keys(after).sort().join(",") !== "jobcount,jobname" ||
        typeof after.jobname !== "string" || !after.jobname || after.jobname.length > 32 ||
        after.jobname !== after.jobname.trim() || after.jobname !== after.jobname.toUpperCase() ||
        !/^\d{8}$/.test(after.jobcount) ||
        (after.jobname === intent.jobname && after.jobcount === intent.jobcount))) {
      throw new TypeError("invalid predecessor job event");
    }
    const base = {sourceDb, client: intent.client, sysid: intent.sysid,
      jobname: intent.jobname, jobcount: intent.jobcount, owner: intent.owner,
      program, generation: intent.generation};
    const payload = after ? JSON.stringify({version: 3, ...base, steps, afterEvent: after}) :
      steps ? JSON.stringify({version: 2, ...base, steps}) : JSON.stringify(base);
    const digest = createHash("sha256").update(payload).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT payload_sha256, run_id FROM batch_imports WHERE intent_id = ?").get(id);
      if (old) {
        if (old.payload_sha256 !== digest || old.run_id !== runId) throw new Error(`outbox intent ${id} changed after import`);
        this.db.exec("COMMIT");
        return {kind: "duplicate", run: this.get(runId)};
      }
      const queuedAt = new Date().toISOString();
      const released = !after || !!this.db.prepare(`SELECT 1 FROM batch_job_events
        WHERE source_db = ? AND source_client = ? AND source_sysid = ? AND source_owner = ?
        AND job_name = ? AND job_count = ?`).get(sourceDb, String(intent.client), String(intent.sysid),
          String(intent.owner), after.jobname, after.jobcount);
      this.db.prepare(`INSERT INTO batch_runs
        (id, program, generation, started_at, queued_at, state, input_json,
         source_db, source_client, source_sysid, source_owner, job_name, job_count, step_count,
         after_job_name, after_job_count)
        VALUES (?, ?, ?, '', ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, program, String(intent.generation), queuedAt,
          released ? "QUEUED" : "WAITING",
          sourceDb, String(intent.client), String(intent.sysid), String(intent.owner),
          String(intent.jobname), String(intent.jobcount), steps?.length ?? 0,
          after?.jobname ?? null, after?.jobcount ?? null);
      this.db.prepare("INSERT INTO batch_imports (intent_id, payload_sha256, run_id) VALUES (?, ?, ?)")
        .run(id, digest, runId);
      if (steps) {
        const insert = this.db.prepare(`INSERT INTO batch_run_steps
          (run_id, step_no, program, state, input_json) VALUES (?, ?, ?, ?, '[]')`);
        for (const step of steps) insert.run(runId, step.number, step.program,
          step.number === 1 && released ? "READY" : "PENDING");
      }
      this.#appendJobLog(runId, null, "IMPORTED", queuedAt);
      this.db.exec("COMMIT");
      return {kind: "imported", run: this.get(runId)};
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // BEGIN IMMEDIATE makes two independent worker processes serialize the
  // decision. A RUNNING queued job blocks a second worker, even if its
  // process vanished: replay requires an explicit decision about side effects.
  claimNext(source) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const scoped = source === undefined ? "" : source.legacyOnly ? " AND source_db IS NULL" :
        " AND (source_db IS NULL OR (source_db = ? AND source_client = ? AND source_sysid = ? AND source_owner = ?))";
      const params = source === undefined || source.legacyOnly ? [] : [source.db, source.client, source.sysid, source.owner];
      // A job for another owner cannot be claimed, but it still holds this
      // business instance's single worker until manually resolved.
      const busyScope = source === undefined ? "" : source.legacyOnly ? " AND source_db IS NULL" :
        " AND (source_db IS NULL OR (source_db = ? AND source_client = ? AND source_sysid = ?))";
      const busyParams = source === undefined || source.legacyOnly ? [] : [source.db, source.client, source.sysid];
      const busy = this.db.prepare(`SELECT id FROM batch_runs WHERE state = 'RUNNING' AND queued_at IS NOT NULL${busyScope} LIMIT 1`).get(...busyParams);
      if (busy) {
        this.db.exec("COMMIT");
        return {kind: "busy", id: busy.id};
      }
      const row = this.db.prepare(`SELECT id, step_count FROM batch_runs WHERE state = 'QUEUED'${scoped} ORDER BY queued_at, rowid LIMIT 1`).get(...params);
      if (!row) {
        this.db.exec("COMMIT");
        return {kind: "empty"};
      }
      const children = this.db.prepare("SELECT step_no, state FROM batch_run_steps WHERE run_id = ? ORDER BY step_no").all(row.id);
      const ready = children.filter((item) => item.state === "READY");
      if (row.step_count === 0 && children.length !== 0) throw new Error(`legacy queued run ${row.id} has unexpected steps`);
      if (row.step_count > 0 && (children.length !== row.step_count || ready.length !== 1 ||
          children.some((item, index) => item.step_no !== index + 1 ||
            (index < ready[0]?.step_no - 1 ? item.state !== "COMPLETED" :
              index > ready[0]?.step_no - 1 ? item.state !== "PENDING" : false)))) {
        throw new Error(`queued run ${row.id} has inconsistent ordered steps`);
      }
      const step = ready[0];
      const startedAt = new Date().toISOString();
      const claimed = this.db.prepare(`UPDATE batch_runs SET state = 'RUNNING',
        started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END
        WHERE id = ? AND state = 'QUEUED'`).run(startedAt, row.id).changes;
      if (claimed !== 1) throw new Error(`queued run ${row.id} changed before claim`);
      if (step) {
        const active = this.db.prepare(`UPDATE batch_run_steps SET state = 'RUNNING', started_at = ?
          WHERE run_id = ? AND step_no = ? AND state = 'READY'`).run(startedAt, row.id, step.step_no).changes;
        if (active !== 1) throw new Error(`queued step ${row.id}/${step.step_no} changed before claim`);
      }
      this.#appendJobLog(row.id, step?.step_no ?? 1, "STEP_STARTED", startedAt);
      this.db.exec("COMMIT");
      return {kind: "claimed", run: this.get(row.id, {revealInput: true}), step: step?.step_no};
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  interruptQueued(id) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new TypeError("expected a queued run ID");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const endedAt = new Date().toISOString();
      const changed = this.db.prepare(`UPDATE batch_runs SET state = 'INTERRUPTED',
        result_status = 'INTERRUPTED', ended_at = ?,
        detail = 'Worker stopped before recording a result; business effects must be inspected before resubmission'
        WHERE id = ? AND state = 'RUNNING' AND queued_at IS NOT NULL`)
        .run(endedAt, id).changes;
      if (changed !== 1) throw new Error(`queued run ${id} is not RUNNING`);
      const activeStep = this.db.prepare(`SELECT step_no FROM batch_run_steps
        WHERE run_id = ? AND state = 'RUNNING'`).all(id);
      const active = this.db.prepare(`UPDATE batch_run_steps SET state = 'INTERRUPTED', ended_at = ?,
        result_status = 'INTERRUPTED' WHERE run_id = ? AND state = 'RUNNING'`).run(endedAt, id).changes;
      const stepCount = this.db.prepare("SELECT step_count FROM batch_runs WHERE id = ?").get(id).step_count;
      if (active !== (stepCount > 0 ? 1 : 0) || activeStep.length !== active) {
        throw new Error(`queued run ${id} has inconsistent active step`);
      }
      this.db.prepare(`UPDATE batch_run_steps SET state = 'SKIPPED', ended_at = ?
        WHERE run_id = ? AND state IN ('READY', 'PENDING')`).run(endedAt, id);
      this.#appendJobLog(id, activeStep[0]?.step_no ?? 1, "STEP_INTERRUPTED", endedAt);
      this.#appendJobLog(id, null, "JOB_INTERRUPTED", endedAt);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(id);
  }

  finish(id, result) {
    const row = this.db.prepare("SELECT state, step_count FROM batch_runs WHERE id = ?").get(id);
    if (!row || row.state !== "RUNNING") throw new Error(`batch run ${id} is not running`);
    // Refuse before writing a parent artifact, then check again in the write
    // transaction: only finishStep may settle an imported ordered job.
    if (row.step_count > 0) throw new Error(`batch run ${id} requires step result recording`);
    const body = Buffer.from(JSON.stringify({
      lines: result.lines ?? [], messages: result.messages ?? [],
      terminal: result.terminal ?? "", navigation: result.navigation ?? {},
    }));
    if (body.length > MAX_OUTPUT_BYTES) {
      const error = new Error(`batch output exceeds ${MAX_OUTPUT_BYTES} bytes`);
      error.code = "OUTPUT_TOO_LARGE";
      throw error;
    }
    const hash = createHash("sha256").update(body).digest("hex");
    const file = join(this.artifacts, `${id}.json`);
    const temp = join(this.artifacts, `.${id}.${process.pid}.tmp`);
    writeFileSync(temp, body, {mode: 0o600, flag: "wx"});
    linkSync(temp, file);
    unlinkSync(temp);
    const status = String(result.status ?? "FAILED");
    const success = status === "COMPLETED";
    const state = success ? "COMPLETED" : "FAILED";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT step_count FROM batch_runs WHERE id = ?").get(id)?.step_count > 0) {
        throw new Error(`batch run ${id} requires step result recording`);
      }
      const endedAt = new Date().toISOString();
      const changed = this.db.prepare(`UPDATE batch_runs SET ended_at = ?, state = ?, result_status = ?,
        detail = ?, output_sha256 = ?, output_bytes = ? WHERE id = ? AND state = 'RUNNING'`)
        .run(endedAt, state, status, String(result.detail ?? ""), hash, body.length, id).changes;
      if (changed !== 1) throw new Error(`batch run ${id} changed state while its output was written`);
      const queued = this.db.prepare("SELECT queued_at FROM batch_runs WHERE id = ?").get(id).queued_at !== null;
      if (queued) {
        this.#appendJobLog(id, 1, success ? "STEP_COMPLETED" : "STEP_FAILED", endedAt);
        this.#appendJobLog(id, null, success ? "JOB_COMPLETED" : "JOB_FAILED", endedAt);
        if (success) this.#emitCompletion(id, endedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(id);
  }

  fail(id, error) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT step_count FROM batch_runs WHERE id = ?").get(id)?.step_count > 0) {
        throw new Error(`batch run ${id} requires step result recording`);
      }
      const endedAt = new Date().toISOString();
      const changed = this.db.prepare(`UPDATE batch_runs SET ended_at = ?, state = 'FAILED',
        result_status = ?, detail = ? WHERE id = ? AND state = 'RUNNING'`)
        .run(endedAt, String(error?.code ?? "DUMP"), String(error?.message ?? error), id).changes;
      if (changed !== 1) throw new Error(`batch run ${id} is not running`);
      const queued = this.db.prepare("SELECT queued_at FROM batch_runs WHERE id = ?").get(id).queued_at !== null;
      if (queued) {
        this.#appendJobLog(id, 1, "STEP_FAILED", endedAt);
        this.#appendJobLog(id, null, "JOB_FAILED", endedAt);
      }
      this.db.exec("COMMIT");
    } catch (failure) { this.db.exec("ROLLBACK"); throw failure; }
    return this.get(id);
  }

  finishStep(id, number, result) {
    const body = Buffer.from(JSON.stringify({lines: result.lines ?? [], messages: result.messages ?? [],
      terminal: result.terminal ?? "", navigation: result.navigation ?? {}}));
    if (body.length > MAX_OUTPUT_BYTES) {
      const error = new Error(`batch output exceeds ${MAX_OUTPUT_BYTES} bytes`);
      error.code = "OUTPUT_TOO_LARGE";
      throw error;
    }
    const hash = createHash("sha256").update(body).digest("hex");
    const file = join(this.artifacts, `${id}-${number}.json`);
    const temp = join(this.artifacts, `.${id}-${number}.${process.pid}.tmp`);
    writeFileSync(temp, body, {mode: 0o600, flag: "wx"});
    linkSync(temp, file);
    unlinkSync(temp);
    const status = String(result.status ?? "FAILED");
    const success = status === "COMPLETED";
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    let transition;
    try {
      const changed = this.db.prepare(`UPDATE batch_run_steps SET state = ?, ended_at = ?,
        result_status = ?, detail = ?, output_sha256 = ?, output_bytes = ?
        WHERE run_id = ? AND step_no = ? AND state = 'RUNNING'`)
        .run(success ? "COMPLETED" : "FAILED", now, status, String(result.detail ?? ""), hash, body.length, id, number).changes;
      if (changed !== 1) throw new Error(`batch step ${id}/${number} is not running`);
      const next = this.db.prepare("SELECT step_no FROM batch_run_steps WHERE run_id = ? AND step_no > ? ORDER BY step_no LIMIT 1")
        .get(id, number);
      if (success && next) {
        const readied = this.db.prepare("UPDATE batch_run_steps SET state = 'READY' WHERE run_id = ? AND step_no = ? AND state = 'PENDING'")
          .run(id, next.step_no).changes;
        const queued = this.db.prepare("UPDATE batch_runs SET state = 'QUEUED' WHERE id = ? AND state = 'RUNNING'").run(id).changes;
        if (readied !== 1 || queued !== 1) throw new Error(`batch step ${id}/${number} transition failed`);
        this.#appendJobLog(id, number, "STEP_COMPLETED", now);
        transition = "advanced";
      } else {
        if (!success) this.db.prepare(`UPDATE batch_run_steps SET state = 'SKIPPED', ended_at = ?
          WHERE run_id = ? AND state = 'PENDING'`).run(now, id);
        const terminal = this.db.prepare(`UPDATE batch_runs SET state = ?, ended_at = ?, result_status = ?, detail = ?,
          output_sha256 = ?, output_bytes = ? WHERE id = ? AND state = 'RUNNING'`)
          .run(success ? "COMPLETED" : "FAILED", now, status, String(result.detail ?? ""), hash, body.length, id).changes;
        if (terminal !== 1) throw new Error(`batch run ${id} changed state during terminal step`);
        this.#appendJobLog(id, number, success ? "STEP_COMPLETED" : "STEP_FAILED", now);
        this.#appendJobLog(id, null, success ? "JOB_COMPLETED" : "JOB_FAILED", now);
        if (success) this.#emitCompletion(id, now);
        const parent = join(this.artifacts, `${id}.json`);
        const parentTemp = join(this.artifacts, `.${id}.${process.pid}.tmp`);
        writeFileSync(parentTemp, body, {mode: 0o600, flag: "wx"});
        linkSync(parentTemp, parent);
        unlinkSync(parentTemp);
        transition = success ? "completed" : "failed";
      }
      // Capture the outcome while this writer still owns the transaction.
      // Another worker may claim the newly READY step immediately after COMMIT.
      const run = this.readRun(id);
      this.db.exec("COMMIT");
      return {kind: transition, run};
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  failStep(id, number, error) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db.prepare(`UPDATE batch_run_steps SET state = 'FAILED', ended_at = ?,
        result_status = ?, detail = ? WHERE run_id = ? AND step_no = ? AND state = 'RUNNING'`)
        .run(now, String(error?.code ?? "DUMP"), String(error?.message ?? error), id, number).changes;
      if (changed !== 1) throw new Error(`batch step ${id}/${number} is not running`);
      this.db.prepare(`UPDATE batch_run_steps SET state = 'SKIPPED', ended_at = ? WHERE run_id = ? AND state = 'PENDING'`)
        .run(now, id);
      const terminal = this.db.prepare(`UPDATE batch_runs SET state = 'FAILED', ended_at = ?, result_status = ?, detail = ?
        WHERE id = ? AND state = 'RUNNING'`)
        .run(now, String(error?.code ?? "DUMP"), String(error?.message ?? error), id).changes;
      if (terminal !== 1) throw new Error(`batch run ${id} changed state during failure`);
      this.#appendJobLog(id, number, "STEP_FAILED", now);
      this.#appendJobLog(id, null, "JOB_FAILED", now);
      this.db.exec("COMMIT");
    } catch (failure) { this.db.exec("ROLLBACK"); throw failure; }
    return this.get(id);
  }

  readSnapshot(work) {
    this.db.exec("BEGIN");
    try {
      const answer = work();
      this.db.exec("COMMIT");
      return answer;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  get(id, options = {}) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return undefined;
    return this.readSnapshot(() => this.readRun(id, options));
  }

  // Internal caller already owns BEGIN IMMEDIATE. Public get() takes its own
  // read snapshot, without relying on Node's newer DatabaseSync.isTransaction.
  readRun(id, options = {}) {
    const run = publicRun(this.db.prepare("SELECT * FROM batch_runs WHERE id = ?").get(id), options);
    if (run) run.steps = this.steps(id, options);
    return run;
  }

  steps(id, options = {}) {
    return this.db.prepare("SELECT * FROM batch_run_steps WHERE run_id = ? ORDER BY step_no")
      .all(id).map((row) => publicStep(row, options));
  }

  list(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limit must be 1..200");
    return this.readSnapshot(() => this.db.prepare("SELECT * FROM batch_runs ORDER BY COALESCE(queued_at, started_at) DESC, id DESC LIMIT ?")
      .all(limit).map((row) => ({...publicRun(row), steps: this.steps(row.id)})));
  }

  output(id) {
    const run = this.get(id);
    if (!run?.outputSha256) return undefined;
    const bytes = readFileSync(join(this.artifacts, `${id}.json`));
    if (createHash("sha256").update(bytes).digest("hex") !== run.outputSha256) {
      throw new Error(`batch output ${id} failed its digest check`);
    }
    return JSON.parse(bytes.toString("utf8"));
  }

  stepOutput(id, number) {
    const step = this.steps(id).find((item) => item.number === number);
    if (!step?.outputSha256) return undefined;
    const bytes = readFileSync(join(this.artifacts, `${id}-${number}.json`));
    if (createHash("sha256").update(bytes).digest("hex") !== step.outputSha256) {
      throw new Error(`batch step output ${id}/${number} failed its digest check`);
    }
    return JSON.parse(bytes.toString("utf8"));
  }
}

export function liveGeneration(root) {
  const path = join(root, "build", "live");
  return existsSync(path) ? basename(realpathSync(path)) : "unknown";
}

const plainMessage = (row) => Object.fromEntries(Object.entries(row.get()).map(([key, value]) => [key, value.get()]));

// The same generated registry used by SUBMIT, with the same ABAP dialog-step
// transaction boundary. Every invocation gets a fresh converted report.
export async function runConvertedBatch(root, program, input = [], expectedGeneration) {
  const answer = await dialogStep(async () => {
    if (expectedGeneration !== undefined &&
        (globalThis.abap?.context?.osdGeneration ?? liveGeneration(root)) !== expectedGeneration) {
      const error = new Error(`Queued for ${expectedGeneration}; loaded generation changed before dispatch`);
      error.code = "GENERATION_CHANGED";
      throw error;
    }
    // The initialized runtime owns the loaded generation. Resolving output/
    // here could follow a newly switched symlink before this process swaps.
    const report = globalThis.abap?.Classes?.ZCL_OSD_BATCH_REPORT;
    const types = globalThis.abap?.Classes?.ZIF_GG_SELECTION_SCREEN_TYPES;
    if (!report || !types) throw new Error("batch report runtime is not initialized");
    const values = types.ty_values.clone();
    for (const item of inputOf(input)) {
      const row = types.ty_value.clone();
      row.get().name.set(item.name);
      row.get().value.set(item.value);
      values.append(row);
    }
    return report.run({iv_program: program, it_input: values, iv_batch: "X"});
  }, `batch report ${program}`);
  const fields = answer.get();
  return {
    status: fields.status.get(), detail: fields.detail.get(),
    lines: fields.lines.array().map((line) => line.get()),
    messages: fields.messages.array().map(plainMessage),
    terminal: fields.terminal.get(),
    navigation: plainMessage(fields.navigation),
  };
}

export async function runPersistedBatch(root, request, store, execute = runConvertedBatch) {
  const owned = store === undefined;
  store ??= new BatchRuns(root);
  try {
    const run = store.start({...request, generation: request.generation ?? liveGeneration(root)});
    let result;
    try {
      result = await execute(root, run.program, run.input);
    } catch (error) {
      try { store.fail(run.id, error); }
      catch (recordError) { throw resultRecordingError(run.id, undefined, recordError, error); }
      throw Object.assign(error, {runId: run.id});
    }
    try { return store.finish(run.id, result); }
    catch (error) { throw resultRecordingError(run.id, undefined, error); }
  } finally {
    if (owned) store.close();
  }
}

function resultRecordingError(runId, stepNumber, cause, executionError) {
  const step = stepNumber === undefined ? "" : ` step ${stepNumber}`;
  const error = new Error(`Could not confirm result for batch run ${runId}${step}; inspect its state and business effects before resubmission.`, {cause});
  error.code = "RESULT_RECORDING_FAILED";
  error.runId = runId;
  if (stepNumber !== undefined) error.stepNumber = stepNumber;
  if (executionError !== undefined) Object.defineProperty(error, "executionError", {value: executionError});
  return error;
}

export async function workQueuedBatch(root, store, execute = runConvertedBatch) {
  const businessDb = globalThis.abap?.context?.databaseConnections?.DEFAULT?.path;
  const sy = globalThis.abap?.builtin?.sy?.get?.();
  const source = businessDb && businessDb !== ":memory:" && sy ?
    {db: resolve(businessDb), client: String(sy.mandt.get()).trim(), sysid: String(sy.sysid.get()).trim(),
      owner: String(sy.uname.get()).trim()} : undefined;
  const next = store.claimNext(source ?? {legacyOnly: true});
  if (next.kind !== "claimed") return next;
  const {run} = next;
  const step = next.step ? run.steps.find((item) => item.number === next.step) : undefined;
  const generation = globalThis.abap?.context?.osdGeneration ?? liveGeneration(root);
  if (run.generation !== generation) {
    const error = {code: "GENERATION_CHANGED",
      message: `Queued for ${run.generation}; worker runs ${generation}. Submit a new run after reviewing the change.`};
    try {
      if (step) store.failStep(run.id, step.number, error);
      else store.fail(run.id, error);
    } catch (recordError) { throw resultRecordingError(run.id, step?.number, recordError); }
    return {kind: "failed", run: store.get(run.id)};
  }
  let result;
  try {
    result = await execute(root, step?.program ?? run.program, step?.input ?? run.input, run.generation);
  } catch (error) {
    try {
      if (step) store.failStep(run.id, step.number, error);
      else store.fail(run.id, error);
    } catch (recordError) { throw resultRecordingError(run.id, step?.number, recordError, error); }
    return {kind: "failed", run: store.get(run.id)};
  }
  try {
    if (step) return store.finishStep(run.id, step.number, result);
    const finished = store.finish(run.id, result);
    return {kind: finished.state === "COMPLETED" ? "completed" : "failed", run: finished};
  } catch (error) { throw resultRecordingError(run.id, step?.number, error); }
}

async function main(args) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  process.chdir(root);
  const [command, ...rest] = args;
  if (!["run", "enqueue", "work", "worker", "drain", "list", "show", "interrupt"].includes(command)) {
    console.error("usage: node tools/osd-batch-runs.mjs run|enqueue <PROG> [NAME=value ...] | drain | work | worker | list | show <run-id> | interrupt <run-id> --worker-confirmed-stopped");
    return 2;
  }
  const store = new BatchRuns(root);
  try {
    if (command === "list") {
      console.log(JSON.stringify(store.list(), null, 2));
      return 0;
    }
    if (command === "show") {
      const run = store.get(rest[0]);
      if (!run) throw new Error(`no batch run ${rest[0]}`);
      console.log(JSON.stringify({...run, output: store.output(run.id)}, null, 2));
      return 0;
    }
    if (command === "interrupt") {
      if (rest[1] !== "--worker-confirmed-stopped") {
        throw new Error("interrupt requires --worker-confirmed-stopped; inspect business effects before enqueueing a replacement");
      }
      console.log(JSON.stringify(store.interruptQueued(rest[0]), null, 2));
      return 0;
    }
    if (command === "run" || command === "enqueue") {
      const program = rest.shift();
      const input = rest.map((arg) => {
        const eq = arg.indexOf("=");
        if (eq <= 0) throw new TypeError(`expected NAME=value: ${arg}`);
        return {name: arg.slice(0, eq), value: arg.slice(eq + 1)};
      });
      if (command === "enqueue") {
        console.log(JSON.stringify(store.enqueue({program, input, generation: liveGeneration(root)}), null, 2));
        return 0;
      }
      const {initializeABAP} = await import(pathToFileURL(join(root, "output", "init.mjs")).href);
      await initializeABAP();
      const run = await runPersistedBatch(root, {program, input}, store);
      console.log(JSON.stringify({...run, output: store.output(run.id)}, null, 2));
      return run.state === "COMPLETED" ? 0 : 1;
    }
    const {initializeABAP} = await import(pathToFileURL(join(root, "output", "init.mjs")).href);
    await initializeABAP();
    if (command === "drain") {
      console.log(JSON.stringify(await drainJobOutbox(store), null, 2));
      return 0;
    }
    if (command === "work") {
      if (process.env.STG_DB === "file") await drainJobOutbox(store);
      const result = await workQueuedBatch(root, store);
      console.log(JSON.stringify(result, null, 2));
      return result.kind === "failed" ? 1 : 0;
    }
    let stopping = false;
    process.on("SIGINT", () => { stopping = true; });
    process.on("SIGTERM", () => { stopping = true; });
    while (!stopping) {
      if (process.env.STG_DB === "file") await drainJobOutbox(store);
      const result = await workQueuedBatch(root, store);
      if (result.kind === "completed" || result.kind === "failed" || result.kind === "advanced") {
        console.log(JSON.stringify(result));
      } else {
        await delay(250);
      }
    }
    return 0;
  } catch (error) {
    console.error(`osd-batch-runs: ${error.message}${error.runId ? ` (run ${error.runId})` : ""}`);
    return 1;
  } finally {
    store.close();
  }
}

if (runsAs("osd-batch-runs.mjs")) process.exitCode = await main(process.argv.slice(2));
