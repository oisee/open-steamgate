import {expect} from "chai";
import {randomUUID} from "node:crypto";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import express from "express";
import {BatchRuns, runPersistedBatch, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {batchMonitorHandler} from "../tools/osd-batch-monitor.mjs";
import {migrateOneStepJobFile} from "./setup.mjs";
import {fingerprintOf} from "../tools/osd-persist.mjs";

const root = resolve(".");

describe("durable one-shot batch runs", function () {
  let dir;
  let env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-batch-runs-"));
    env = {...process.env, OSD_OPERATIONS_DB: join(dir, "operations.sqlite")};
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("migrates the one-step business outbox file additively", () => {
    const path = join(dir, "business.sqlite");
    const db = new DatabaseSync(path);
    try {
      const oldParent = "CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT, program TEXT)";
      const parent = "CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT, program TEXT, 'step_count' NCHAR(2))";
      const create = `CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT, program TEXT,
        PRIMARY KEY(mandt, intent_id, step_no))`;
      const other = "CREATE TABLE other_business_table (id TEXT)";
      const old = [oldParent, other];
      const ddl = [parent, create, other];
      const previous = fingerprintOf(old);
      const wanted = fingerprintOf(ddl);
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
        CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT, program TEXT);
        INSERT INTO zosd_job_outbox VALUES ('123', 'saved-intent', 'ZGG_EX_012')`);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(previous);
      // A different target DDIC still follows the ordinary drift path.
      const unrelated = [...ddl, "CREATE TABLE unrelated_change (id TEXT)"];
      expect(migrateOneStepJobFile(db, previous, fingerprintOf(unrelated), unrelated, fingerprintOf)).to.equal(false);
      expect(db.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint).to.equal(previous);
      expect(db.prepare("PRAGMA table_info(zosd_job_outbox)").all().some((row) => row.name === "step_count")).to.equal(false);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'zosd_job_step'").get()).to.equal(undefined);
      expect(migrateOneStepJobFile(db, previous, wanted, ddl, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT program FROM zosd_job_outbox WHERE intent_id = 'saved-intent'").get().program).to.equal("ZGG_EX_012");
      expect(db.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint).to.equal(wanted);
      expect(db.prepare("PRAGMA table_info(zosd_job_outbox)").all().some((row) => row.name === "step_count")).to.equal(true);
      expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_job_step").get().n).to.equal(0);
      // A second process may still hold the pre-migration stamp it read.
      const second = new DatabaseSync(path);
      try { expect(migrateOneStepJobFile(second, previous, wanted, ddl, fingerprintOf)).to.equal(true); }
      finally { second.close(); }
    } finally { db.close(); }
  });

  it("reopens a finished run and its output on a fresh SQLite connection", async () => {
    const first = new BatchRuns(root, env);
    const run = await runPersistedBatch(root,
      {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20251231"}]},
      first, async () => ({status: "COMPLETED", lines: ["20251231"]}));
    first.close();
    expect(run.state).to.equal("COMPLETED");
    expect(run.input).to.deep.equal([{name: "P_DATE"}]);
    expect(run.generation).to.match(/^[0-9a-f]{16}$/);
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(run.id)).to.deep.equal(run);
      expect(reopened.output(run.id).lines).to.deep.equal(["20251231"]);
    } finally {
      reopened.close();
    }
  });

  it("keeps a failed result, redacts selection values on reads, and detects changed output", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = await runPersistedBatch(root,
        {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "private-value"}]},
        store, async () => ({status: "INVALID_INPUT", detail: "bad date", lines: ["partial"]}));
      expect(run.state).to.equal("FAILED");
      expect(run.input).to.deep.equal([{name: "P_DATE"}]);
      expect(store.get(run.id, {revealInput: true}).input[0].value).to.equal("private-value");
      expect(store.output(run.id).lines).to.deep.equal(["partial"]);
      writeFileSync(join(dir, "batch-output", `${run.id}.json`), "tampered");
      expect(() => store.output(run.id)).to.throw(/digest check/);
    } finally {
      store.close();
    }
  });

  it("records a thrown report error without claiming it completed", async () => {
    const store = new BatchRuns(root, env);
    try {
      let id;
      try {
        await runPersistedBatch(root, {program: "ZGG_EX_012"}, store, async () => {
          throw new Error("report dumped");
        });
      } catch (error) {
        id = error.runId;
      }
      expect(id).to.be.a("string");
      expect(store.get(id).resultStatus).to.equal("DUMP");
      expect(store.get(id).state).to.equal("FAILED");
      expect(store.output(id)).to.equal(undefined);
    } finally {
      store.close();
    }
  });

  it("keeps an interrupted run visible for a later doctor", () => {
    const first = new BatchRuns(root, env);
    const started = first.start({program: "ZGG_EX_012"});
    first.close();
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(started.id).state).to.equal("RUNNING");
      expect(reopened.get(started.id).endedAt).to.equal(null);
      expect(reopened.output(started.id)).to.equal(undefined);
    } finally {
      reopened.close();
    }
  });

  it("claims queued work in order and admits only one BGR run across connections", async () => {
    const first = new BatchRuns(root, env);
    const second = new BatchRuns(root, env);
    try {
      const a = first.enqueue({program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20260101"}],
        generation: "test-generation"});
      const b = first.enqueue({program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20260102"}],
        generation: "test-generation"});
      expect(a.state).to.equal("QUEUED");
      expect(a.startedAt).to.equal(null);
      const claim = first.claimNext();
      expect(claim.kind).to.equal("claimed");
      expect(claim.run.id).to.equal(a.id);
      expect(claim.run.input[0].value).to.equal("20260101");
      expect(second.claimNext()).to.deep.equal({kind: "busy", id: a.id});
      first.finish(a.id, {status: "COMPLETED", lines: ["first"]});
      expect(second.claimNext().run.id).to.equal(b.id);
      second.finish(b.id, {status: "COMPLETED", lines: ["second"]});
      expect(first.list().map((run) => run.state)).to.deep.equal(["COMPLETED", "COMPLETED"]);
      expect(first.output(b.id).lines).to.deep.equal(["second"]);
    } finally {
      second.close();
      first.close();
    }
  });

  it("refuses to run queued work against a changed generation", async () => {
    const store = new BatchRuns(root, env);
    try {
      const queued = store.enqueue({program: "ZGG_EX_012", generation: "obsolete"});
      let called = false;
      const outcome = await workQueuedBatch(root, store, async () => { called = true; });
      expect(called).to.equal(false);
      expect(outcome.kind).to.equal("failed");
      expect(store.get(queued.id).resultStatus).to.equal("GENERATION_CHANGED");
      expect(store.claimNext().kind).to.equal("empty");
    } finally {
      store.close();
    }
  });

  it("a worker crash leaves the claimed run visible and blocks another claim", () => {
    const store = new BatchRuns(root, env);
    const a = store.enqueue({program: "ZGG_EX_012"});
    const b = store.enqueue({program: "ZGG_EX_012"});
    expect(store.claimNext().run.id).to.equal(a.id);
    store.close();
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(a.id).state).to.equal("RUNNING");
      expect(reopened.claimNext()).to.deep.equal({kind: "busy", id: a.id});
      expect(reopened.interruptQueued(a.id).state).to.equal("INTERRUPTED");
      expect(reopened.claimNext().run.id).to.equal(b.id);
      expect(() => reopened.interruptQueued(a.id)).to.throw(/not RUNNING/);
    } finally {
      reopened.close();
    }
  });

  it("opens a saved-run database from the preceding slice without losing its rows", () => {
    const old = new DatabaseSync(env.OSD_OPERATIONS_DB);
    old.exec(`CREATE TABLE batch_runs (
      id TEXT PRIMARY KEY, program TEXT NOT NULL, generation TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL,
      result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
      output_sha256 TEXT, output_bytes INTEGER
    )`);
    const id = randomUUID();
    old.prepare("INSERT INTO batch_runs (id, program, generation, started_at, state, input_json) VALUES (?, 'ZGG_EX_012', 'old', '2026-09-28T00:00:00Z', 'RUNNING', '[]')").run(id);
    old.close();
    const upgraded = new BatchRuns(root, env);
    try {
      expect(upgraded.get(id).program).to.equal("ZGG_EX_012");
      expect(upgraded.get(id).queuedAt).to.equal(null);
      expect(upgraded.enqueue({program: "ZGG_EX_012"}).state).to.equal("QUEUED");
    } finally {
      upgraded.close();
    }
  });

  it("guards the read API and returns redacted runs plus digest-checked output", async () => {
    const store = new BatchRuns(root, env);
    const run = await runPersistedBatch(root,
      {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "private-value"}]},
      store, async () => ({status: "COMPLETED", lines: ["visible list"]}));
    store.close();
    const token = randomUUID().replaceAll("-", "");
    const app = express();
    app.get("/osd/batch-runs", batchMonitorHandler(root, {...env, OSD_BATCH_READ_TOKEN: token}));
    app.get("/closed", batchMonitorHandler(root, env));
    const server = await new Promise((done) => {
      const listener = app.listen(0, "127.0.0.1", () => done(listener));
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const auth = {Authorization: `Bearer ${token}`};
      expect((await fetch(`${url}/closed`, {headers: auth})).status).to.equal(404);
      expect((await fetch(`${url}/osd/batch-runs`)).status).to.equal(401);
      expect((await fetch(`${url}/osd/batch-runs`, {headers: {Authorization: "Bearer wrong"}})).status).to.equal(401);
      const listed = await fetch(`${url}/osd/batch-runs?limit=1`, {headers: auth});
      expect(listed.status).to.equal(200);
      expect(listed.headers.get("cache-control")).to.equal("no-store");
      const body = await listed.json();
      expect(body.runs.map((item) => item.id)).to.deep.equal([run.id]);
      expect(JSON.stringify(body)).not.to.include("private-value");
      const detail = await (await fetch(`${url}/osd/batch-runs?id=${run.id}`, {headers: auth})).json();
      expect(detail.run.input).to.deep.equal([{name: "P_DATE"}]);
      const output = await (await fetch(`${url}/osd/batch-runs?id=${run.id}&output=1`, {headers: auth})).json();
      expect(output.output.lines).to.deep.equal(["visible list"]);
      expect((await fetch(`${url}/osd/batch-runs?output=1`, {headers: auth})).status).to.equal(400);
      writeFileSync(join(dir, "batch-output", `${run.id}.json`), "tampered");
      expect((await fetch(`${url}/osd/batch-runs?id=${run.id}&output=1`, {headers: auth})).status).to.equal(500);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});
