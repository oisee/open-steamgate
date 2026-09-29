// Private read model for a future measured SAP job-read facade. Both files are
// opened read-only; in particular a read never drains the outbox or ends an
// ABAP caller's LUW. No list output, job log, or BAL data is exposed here.
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {operationsPath} from "./osd-batch-runs.mjs";

const value = (row, field) => String(row?.[field] ?? "").trim();
const fail = (reason) => { throw new JobSnapshotError("JOB_SNAPSHOT_INCONSISTENT", reason); };
const runIdOf = (id) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

export class JobSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "JobSnapshotError";
    this.code = code;
  }
}

function readOnly(path, work) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    db.exec("BEGIN");
    try { return work(db); }
    finally { db.exec("ROLLBACK"); } // release a read snapshot; never commit
  } finally { db.close(); }
}

function outboxSnapshot(db, identity, sourceDb, caller) {
  const intentId = value(identity, "intent_id");
  const parent = db.prepare("SELECT * FROM zosd_job_outbox WHERE mandt = ? AND intent_id = ?")
    .get(caller.client, intentId);
  if (!parent) return undefined;
  if (value(parent, "jobname").toUpperCase() !== value(identity, "jobname") ||
      value(parent, "jobcount") !== value(identity, "jobcount") ||
      value(parent, "owner") !== value(identity, "owner") ||
      value(parent, "source_db") !== sourceDb || value(parent, "sysid") !== caller.sid) {
    fail("outbox parent disagrees with retained job identity or business instance");
  }
  const count = Number(value(parent, "step_count"));
  const rows = db.prepare(`SELECT step_no, program FROM zosd_job_step
    WHERE mandt = ? AND intent_id = ? ORDER BY step_no`).all(caller.client, intentId);
  const legacy = count === 0 && rows.length === 0;
  if (!value(parent, "program") || (!legacy &&
      (!Number.isInteger(count) || count < 1 || count > 16 || rows.length !== count ||
       rows.some((row, index) => Number(value(row, "step_no")) !== index + 1 || !value(row, "program")) ||
       value(parent, "program") !== value(rows[0], "program")))) {
    fail("outbox has an invalid ordered step set");
  }
  const programs = legacy ? [value(parent, "program")] : rows.map((row) => value(row, "program"));
  return {
    phase: "OUTBOX", state: "READY", program: value(parent, "program"),
    generation: value(parent, "generation"),
    createdOn: value(parent, "created_on"), createdAt: value(parent, "created_at"),
    queuedAt: null, startedAt: null, endedAt: null, resultStatus: null, detail: null,
    steps: programs.map((program, index) => ({number: index + 1, program,
      state: index === 0 ? "READY" : "PENDING", startedAt: null, endedAt: null,
      resultStatus: null, detail: null})),
  };
}

function checkRunState(state, steps) {
  const active = steps.findIndex((step) => step.state === (state === "QUEUED" ? "READY" : "RUNNING"));
  if (state === "QUEUED" || state === "RUNNING") {
    if (active < 0 || steps.some((step, i) => step.state !==
        (i < active ? "COMPLETED" : i === active ? (state === "QUEUED" ? "READY" : "RUNNING") : "PENDING"))) {
      fail("operations parent and active step states disagree");
    }
  } else if (state === "COMPLETED") {
    if (steps.some((step) => step.state !== "COMPLETED")) fail("completed run has unfinished steps");
  } else if (state === "FAILED" || state === "INTERRUPTED") {
    const terminal = state === "FAILED" ? "FAILED" : "INTERRUPTED";
    const index = steps.findIndex((step) => step.state === terminal);
    if (index < 0 || steps.some((step, i) => step.state !==
        (i < index ? "COMPLETED" : i === index ? terminal : "SKIPPED"))) {
      fail("terminal run and step states disagree");
    }
  } else fail("unknown operations run state");
}

function operationsSnapshot(db, identity, sourceDb, caller, outbox) {
  const intentId = value(identity, "intent_id");
  const id = runIdOf(intentId);
  const tables = new Set(db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('batch_imports', 'batch_runs', 'batch_run_steps')`)
    .all().map((row) => row.name));
  if (!tables.has("batch_imports")) {
    if (tables.has("batch_runs")) {
      const columns = new Set(db.prepare("PRAGMA table_info(batch_runs)").all().map((row) => row.name));
      if (tables.has("batch_run_steps") !== columns.has("step_count")) fail("incomplete operations schema");
      if (db.prepare("SELECT 1 FROM batch_runs WHERE id = ?").get(id)) {
        fail("operations run has no import ledger table");
      }
    }
    return undefined; // an older operations file may predate queued jobs
  }
  if (!tables.has("batch_runs")) fail("incomplete operations schema");
  const columns = new Set(db.prepare("PRAGMA table_info(batch_runs)").all().map((row) => row.name));
  const v1Columns = ["id", "program", "generation", "started_at", "ended_at", "state",
    "result_status", "detail", "input_json", "output_sha256", "output_bytes", "queued_at",
    "source_db", "source_client", "source_sysid", "source_owner", "job_name", "job_count"];
  if (!v1Columns.every((column) => columns.has(column)) ||
      tables.has("batch_run_steps") !== columns.has("step_count")) {
    fail("incomplete operations schema");
  }
  const oldSchema = !tables.has("batch_run_steps");
  const ledger = db.prepare("SELECT run_id, payload_sha256 FROM batch_imports WHERE intent_id = ?").get(intentId);
  if (!ledger) {
    const stray = db.prepare("SELECT 1 FROM batch_runs WHERE id = ?").get(id);
    if (stray) fail("operations run has no import ledger");
    return undefined;
  }
  if (ledger.run_id !== id) fail("import ledger points to a different run");
  const run = db.prepare("SELECT * FROM batch_runs WHERE id = ?").get(id);
  if (!run) fail("import ledger has no operations run");
  if (value(run, "source_db") !== sourceDb || value(run, "source_client") !== caller.client ||
      value(run, "source_sysid") !== caller.sid || value(run, "source_owner") !== value(identity, "owner") ||
      value(run, "job_name").toUpperCase() !== value(identity, "jobname") ||
      value(run, "job_count") !== value(identity, "jobcount")) {
    fail("operations run disagrees with retained job identity or business instance");
  }
  const base = {sourceDb: run.source_db, client: run.source_client, sysid: run.source_sysid,
    jobname: run.job_name, jobcount: run.job_count, owner: run.source_owner,
    program: run.program, generation: run.generation};
  if (oldSchema) {
    if (outbox && outbox.steps.length !== 1) fail("old operations schema cannot contain ordered steps");
    if (createHash("sha256").update(JSON.stringify(base)).digest("hex") !== ledger.payload_sha256) {
      fail("old operations run differs from immutable import ledger payload");
    }
    throw new JobSnapshotError("JOB_LEGACY_UNSUPPORTED", "imported run needs the multistep operations migration");
  }
  const rows = db.prepare("SELECT * FROM batch_run_steps WHERE run_id = ? ORDER BY step_no").all(id);
  const legacy = run.step_count === 0 && rows.length === 0;
  if (!value(run, "program") || (!legacy &&
      (!Number.isInteger(run.step_count) || run.step_count < 1 || run.step_count > 16 ||
       rows.length !== run.step_count || rows.some((row, index) =>
         row.step_no !== index + 1 || !value(row, "program")) ||
       value(run, "program") !== value(rows[0], "program")))) {
    fail("operations run has an invalid ordered step set");
  }
  const steps = legacy ? [{number: 1, program: value(run, "program"), state: value(run, "state") === "QUEUED" ? "READY" : value(run, "state"),
    startedAt: run.started_at || null, endedAt: run.ended_at ?? null,
    resultStatus: run.result_status ?? null, detail: run.detail ?? null}] :
    rows.map((row) => ({number: row.step_no, program: value(row, "program"),
      state: value(row, "state"), startedAt: row.started_at || null, endedAt: row.ended_at || null,
      resultStatus: row.result_status ?? null, detail: row.detail ?? null}));
  checkRunState(run.state, steps);
  // Reconstruct the importer's versioned payload using the stored bytes, not
  // the canonical key used for identity lookup. Old imported names can be
  // lowercase even when migration uppercased the retained business key.
  const payload = legacy ? JSON.stringify(base) : JSON.stringify({version: 2, ...base,
    steps: rows.map((row) => ({number: row.step_no, program: row.program}))});
  if (createHash("sha256").update(payload).digest("hex") !== ledger.payload_sha256) {
    fail("operations run differs from immutable import ledger payload");
  }
  if (outbox && (outbox.program !== value(run, "program") ||
      outbox.generation !== value(run, "generation") ||
      outbox.steps.length !== steps.length ||
      outbox.steps.some((step, index) => step.program !== steps[index].program))) {
    fail("imported run disagrees with still-pending outbox");
  }
  return {
    phase: "OPERATIONS", state: value(run, "state"), program: value(run, "program"),
    generation: value(run, "generation"), createdOn: outbox?.createdOn ?? null,
    createdAt: outbox?.createdAt ?? null, queuedAt: run.queued_at ?? null,
    startedAt: run.started_at || null, endedAt: run.ended_at ?? null,
    resultStatus: run.result_status ?? null, detail: run.detail ?? null, steps,
  };
}

function checkPreIdentityJob(business, sourceDb, name, count, caller, root, env) {
  const pending = business.prepare(`SELECT owner, jobname FROM zosd_job_outbox
    WHERE mandt = ? AND TRIM(jobcount) = ?`).all(caller.client, count);
  if (pending.some((row) => value(row, "jobname").toUpperCase() === name &&
      value(row, "owner") === caller.user)) {
    throw new JobSnapshotError("JOB_LEGACY_UNSUPPORTED", "job predates retained identity; migrate before reading");
  }
  const file = operationsPath(root, env);
  if (!existsSync(file)) return;
  readOnly(file, (db) => {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'batch_runs'").get();
    if (!table) return;
    const columns = new Set(db.prepare("PRAGMA table_info(batch_runs)").all().map((row) => row.name));
    if (!["source_db", "source_client", "source_sysid", "source_owner", "job_name", "job_count"]
      .every((column) => columns.has(column))) return;
    const old = db.prepare(`SELECT source_owner, job_name FROM batch_runs WHERE source_db = ?
      AND source_client = ? AND source_sysid = ? AND TRIM(job_count) = ?`)
      .all(sourceDb, caller.client, caller.sid, count);
    if (old.some((row) => value(row, "job_name").toUpperCase() === name &&
        value(row, "source_owner") === caller.user)) {
      throw new JobSnapshotError("JOB_LEGACY_UNSUPPORTED", "job predates retained identity; migrate before reading");
    }
  });
}

/** Return one job's durable metadata, or undefined if the key is unknown.
 * `caller` must come from trusted ABAP runtime identity, not request fields.
 */
export function readJobSnapshot({sourceDb, jobName, jobCount, caller, root = process.cwd(), env = process.env} = {}) {
  const name = String(jobName ?? "").trim().toUpperCase();
  const count = String(jobCount ?? "").trim();
  if (!sourceDb || !caller || !name || name.length > 32 || !/^\d{8}$/.test(count) ||
      !caller.client || caller.client.length > 3 || !caller.user || caller.user.length > 12 ||
      !caller.sid || caller.sid.length > 3) {
    throw new JobSnapshotError("JOB_READ_BAD_KEY", "invalid job key or trusted caller identity");
  }
  const source = resolve(sourceDb);
  return readOnly(source, (business) => {
    const identity = business.prepare(`SELECT * FROM zosd_job_identity
      WHERE mandt = ? AND jobname = ? AND jobcount = ?`).get(caller.client, name, count);
    if (!identity) {
      checkPreIdentityJob(business, source, name, count, caller, root, env);
      return undefined;
    }
    if (value(identity, "owner") !== caller.user) {
      throw new JobSnapshotError("JOB_READ_FORBIDDEN", "job belongs to another user");
    }
    const intentId = value(identity, "intent_id");
    if (intentId && !/^[0-9a-f]{32}$/.test(intentId)) fail("retained identity has an invalid intent ID");
    const base = {jobName: name, jobCount: count, client: caller.client, owner: caller.user,
      sid: caller.sid, intentId: intentId || null};
    if (!intentId) {
      const unexpected = business.prepare(`SELECT 1 FROM zosd_job_outbox
        WHERE mandt = ? AND jobname = ? AND jobcount = ? LIMIT 1`).get(caller.client, name, count);
      if (unexpected) fail("unbound identity has an outbox parent");
      return {...base, phase: "RESERVED", state: "RESERVED", program: null,
        generation: null, createdOn: null, createdAt: null, queuedAt: null,
        startedAt: null, endedAt: null, resultStatus: null, detail: null, steps: []};
    }
    const outbox = outboxSnapshot(business, identity, source, caller);
    const operationsFile = operationsPath(root, env);
    const imported = existsSync(operationsFile) ?
      readOnly(operationsFile, (operations) => operationsSnapshot(operations, identity, source, caller, outbox)) : undefined;
    if (!outbox && !imported) fail("bound job has neither outbox nor operations row");
    return {...base, ...(imported ?? outbox)};
  });
}
