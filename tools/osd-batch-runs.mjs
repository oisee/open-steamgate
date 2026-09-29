// Durable one-shot report runs. This is an operations store, separate from
// the ABAP business database and from a replaceable transpiled generation.
import {randomUUID, createHash} from "node:crypto";
import {chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from "node:fs";
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
      this.db.exec(`CREATE TABLE IF NOT EXISTS batch_imports (
        intent_id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, run_id TEXT NOT NULL
      )`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.artifacts = join(dirname(this.path), "batch-output");
    mkdirSync(this.artifacts, {recursive: true, mode: 0o700});
  }

  close() { this.db.close(); }

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
    const sourceDb = resolve(String(intent.sourceDb ?? ""));
    const payload = JSON.stringify({sourceDb, client: intent.client, sysid: intent.sysid,
      jobname: intent.jobname, jobcount: intent.jobcount, owner: intent.owner,
      program, generation: intent.generation});
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
      this.db.prepare(`INSERT INTO batch_runs
        (id, program, generation, started_at, queued_at, state, input_json,
         source_db, source_client, source_sysid, source_owner, job_name, job_count)
        VALUES (?, ?, ?, '', ?, 'QUEUED', '[]', ?, ?, ?, ?, ?, ?)`).run(runId, program, String(intent.generation), queuedAt,
          sourceDb, String(intent.client), String(intent.sysid), String(intent.owner),
          String(intent.jobname), String(intent.jobcount));
      this.db.prepare("INSERT INTO batch_imports (intent_id, payload_sha256, run_id) VALUES (?, ?, ?)")
        .run(id, digest, runId);
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
      const row = this.db.prepare(`SELECT id FROM batch_runs WHERE state = 'QUEUED'${scoped} ORDER BY queued_at, rowid LIMIT 1`).get(...params);
      if (!row) {
        this.db.exec("COMMIT");
        return {kind: "empty"};
      }
      this.db.prepare("UPDATE batch_runs SET state = 'RUNNING', started_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
      this.db.exec("COMMIT");
      return {kind: "claimed", run: this.get(row.id, {revealInput: true})};
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  interruptQueued(id) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new TypeError("expected a queued run ID");
    const changed = this.db.prepare(`UPDATE batch_runs SET state = 'INTERRUPTED',
      result_status = 'INTERRUPTED', ended_at = ?,
      detail = 'Worker stopped before recording a result; business effects must be inspected before resubmission'
      WHERE id = ? AND state = 'RUNNING' AND queued_at IS NOT NULL`)
      .run(new Date().toISOString(), id).changes;
    if (changed !== 1) throw new Error(`queued run ${id} is not RUNNING`);
    return this.get(id);
  }

  finish(id, result) {
    const row = this.db.prepare("SELECT state FROM batch_runs WHERE id = ?").get(id);
    if (!row || row.state !== "RUNNING") throw new Error(`batch run ${id} is not running`);
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
    renameSync(temp, file);
    const status = String(result.status ?? "FAILED");
    const state = status === "COMPLETED" ? "COMPLETED" : "FAILED";
    const changed = this.db.prepare(`UPDATE batch_runs SET ended_at = ?, state = ?, result_status = ?,
      detail = ?, output_sha256 = ?, output_bytes = ? WHERE id = ? AND state = 'RUNNING'`)
      .run(new Date().toISOString(), state, status, String(result.detail ?? ""), hash, body.length, id).changes;
    if (changed !== 1) throw new Error(`batch run ${id} changed state while its output was written`);
    return this.get(id);
  }

  fail(id, error) {
    this.db.prepare(`UPDATE batch_runs SET ended_at = ?, state = 'FAILED',
      result_status = ?, detail = ? WHERE id = ? AND state = 'RUNNING'`)
      .run(new Date().toISOString(), String(error?.code ?? "DUMP"), String(error?.message ?? error), id);
    return this.get(id);
  }

  get(id, options = {}) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return undefined;
    return publicRun(this.db.prepare("SELECT * FROM batch_runs WHERE id = ?").get(id), options);
  }

  list(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limit must be 1..200");
    return this.db.prepare("SELECT * FROM batch_runs ORDER BY COALESCE(queued_at, started_at) DESC, id DESC LIMIT ?")
      .all(limit).map((row) => publicRun(row));
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
}

export function liveGeneration(root) {
  const path = join(root, "build", "live");
  return existsSync(path) ? basename(realpathSync(path)) : "unknown";
}

const plainMessage = (row) => Object.fromEntries(Object.entries(row.get()).map(([key, value]) => [key, value.get()]));

// The same generated registry used by SUBMIT, with the same ABAP dialog-step
// transaction boundary. Every invocation gets a fresh converted report.
export async function runConvertedBatch(root, program, input = []) {
  const answer = await dialogStep(async () => {
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
    try {
      const result = await execute(root, run.program, run.input);
      return store.finish(run.id, result);
    } catch (error) {
      store.fail(run.id, error);
      throw Object.assign(error, {runId: run.id});
    }
  } finally {
    if (owned) store.close();
  }
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
  const generation = globalThis.abap?.context?.osdGeneration ?? liveGeneration(root);
  if (run.generation !== generation) {
    store.fail(run.id, {code: "GENERATION_CHANGED",
      message: `Queued for ${run.generation}; worker runs ${generation}. Submit a new run after reviewing the change.`});
    return {kind: "failed", run: store.get(run.id)};
  }
  try {
    const result = await execute(root, run.program, run.input);
    const finished = store.finish(run.id, result);
    return {kind: finished.state === "COMPLETED" ? "completed" : "failed", run: finished};
  } catch (error) {
    store.fail(run.id, error);
    return {kind: "failed", run: store.get(run.id)};
  }
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
      if (result.kind === "completed" || result.kind === "failed") {
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
