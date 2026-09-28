// Durable one-shot report runs. This is an operations store, separate from
// the ABAP business database and from a replaceable transpiled generation.
import {randomUUID, createHash} from "node:crypto";
import {chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {dialogStep} from "./osd-dialog-step.mjs";
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
    startedAt: row.started_at, endedAt: row.ended_at,
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
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS batch_runs (
      id TEXT PRIMARY KEY, program TEXT NOT NULL, generation TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL,
      result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
      output_sha256 TEXT, output_bytes INTEGER
    )`);
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
    this.db.prepare(`UPDATE batch_runs SET ended_at = ?, state = ?, result_status = ?,
      detail = ?, output_sha256 = ?, output_bytes = ? WHERE id = ?`)
      .run(new Date().toISOString(), state, status, String(result.detail ?? ""), hash, body.length, id);
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
    return this.db.prepare("SELECT * FROM batch_runs ORDER BY started_at DESC, id DESC LIMIT ?")
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
  const {zcl_osd_batch_report} = await import(pathToFileURL(join(resolve(root), "output", "zcl_osd_batch_report.clas.mjs")).href);
  const {zif_gg_selection_screen_types} = await import(pathToFileURL(join(resolve(root), "output", "zif_gg_selection_screen_types.intf.mjs")).href);
  const values = zif_gg_selection_screen_types.ty_values.clone();
  for (const item of inputOf(input)) {
    const row = zif_gg_selection_screen_types.ty_value.clone();
    row.get().name.set(item.name);
    row.get().value.set(item.value);
    values.append(row);
  }
  const answer = await dialogStep(() => zcl_osd_batch_report.run({
    iv_program: program, it_input: values, iv_batch: "X",
  }), `batch report ${program}`);
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

async function main(args) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  process.chdir(root);
  const [command, ...rest] = args;
  if (!["run", "list", "show"].includes(command)) {
    console.error("usage: node tools/osd-batch-runs.mjs run <PROG> [NAME=value ...] | list | show <run-id>");
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
    const program = rest.shift();
    const input = rest.map((arg) => {
      const eq = arg.indexOf("=");
      if (eq <= 0) throw new TypeError(`expected NAME=value: ${arg}`);
      return {name: arg.slice(0, eq), value: arg.slice(eq + 1)};
    });
    const {initializeABAP} = await import(pathToFileURL(join(root, "output", "init.mjs")).href);
    await initializeABAP();
    const run = await runPersistedBatch(root, {program, input}, store);
    console.log(JSON.stringify({...run, output: store.output(run.id)}, null, 2));
    return run.state === "COMPLETED" ? 0 : 1;
  } catch (error) {
    console.error(`osd-batch-runs: ${error.message}${error.runId ? ` (run ${error.runId})` : ""}`);
    return 1;
  } finally {
    store.close();
  }
}

if (runsAs("osd-batch-runs.mjs")) process.exitCode = await main(process.argv.slice(2));
