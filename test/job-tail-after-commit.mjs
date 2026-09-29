import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";

describe("job-owned named tail event", () => {
  let dir, store, env;
  const uuid = () => randomUUID().replaceAll("-", "");
  const instance = uuid();
  const intent = (name, extra = {}) => ({intentId: uuid(), sourceDb: join(dir, "business.sqlite"),
    client: "123", sysid: "OSG", owner: "ALICE", jobname: name,
    jobcount: name === "VOYAGE" ? "00000001" : "00000002", program: "Z_FIRST",
    generation: "test", steps: [{number: 1, program: "Z_FIRST"}], ...extra});
  const parent = () => intent("VOYAGE", {tailEvent: {id: "VOYAGE_DONE", param: "RUN_17", sourceInstance: instance}});
  const child = (seq) => intent("READY", {namedEvent: {
    id: "VOYAGE_DONE", param: "RUN_17", sourceInstance: instance, seq}});
  const count = () => store.db.prepare("SELECT count(*) AS n FROM batch_named_events").get().n;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-tail-after-commit-"));
    env = {OSD_OPERATIONS_DB: join(dir, "operations.sqlite")};
    store = new BatchRuns(dir, env);
  });
  afterEach(() => { store.close(); rmSync(dir, {recursive: true, force: true}); });

  it("commits one signal with a confirmed successful result and releases the successor", () => {
    const voyage = store.importIntent(parent()).run;
    const seq = store.reserveSignalSeq();
    const ready = store.importIntent(child(seq)).run;
    assert.equal(ready.state, "WAITING");
    store.claimNext();
    store.finishStep(voyage.id, 1, {status: "COMPLETED"});
    assert.equal(store.get(voyage.id).state, "COMPLETED");
    assert.equal(count(), 1);
    assert.equal(store.get(ready.id).state, "QUEUED");
    assert.equal(store.claimNext().run.id, ready.id);
    assert.equal(store.claimNext().kind, "busy");
    store.finishStep(ready.id, 1, {status: "COMPLETED"});
    assert.equal(store.claimNext().kind, "empty");
    assert.equal(count(), 1);
  });

  it("keeps the successor waiting after failure or interruption", () => {
    const completed = store.importIntent(parent()).run;
    store.claimNext();
    store.finishStep(completed.id, 1, {status: "COMPLETED"});
    assert.equal(count(), 1);
    for (const terminal of ["FAILED", "INTERRUPTED"]) {
      const voyage = store.importIntent(parent()).run;
      const ready = store.importIntent(child(store.reserveSignalSeq())).run;
      store.claimNext();
      if (terminal === "FAILED") store.finishStep(voyage.id, 1, {status: "FAILED"});
      else store.interruptQueued(voyage.id);
      assert.equal(store.get(ready.id).state, "WAITING");
      assert.equal(count(), 1);
    }
  });

  it("survives a restart at result commit and deduplicates repeated delivery", () => {
    const request = parent();
    const voyage = store.importIntent(request).run;
    const ready = store.importIntent(child(store.reserveSignalSeq())).run;
    store.claimNext();
    store.finishStep(voyage.id, 1, {status: "COMPLETED"});
    store.close();
    store = new BatchRuns(dir, env);
    assert.equal(count(), 1);
    assert.equal(store.importIntent(request).kind, "duplicate");
    assert.equal(store.get(ready.id).state, "QUEUED");
    const event = store.db.prepare("SELECT intent_id, signal_seq FROM batch_named_events").get();
    assert.equal(event.intent_id, request.intentId);
    assert.equal(store.importNamedEvent({intentId: request.intentId,
      sourceDb: request.sourceDb, sourceInstance: instance, client: request.client,
      sysid: request.sysid, owner: request.owner, id: "VOYAGE_DONE", param: "RUN_17",
      seq: event.signal_seq}).kind, "duplicate");
    assert.equal(store.claimNext().run.id, ready.id);
    store.finishStep(ready.id, 1, {status: "COMPLETED"});
    assert.equal(store.claimNext().kind, "empty");
    assert.throws(() => store.finishStep(voyage.id, 1, {status: "COMPLETED"}), /already exists|not running/);
    assert.equal(count(), 1);
  });

  it("rolls back result and event together if successor release fails", () => {
    const voyage = store.importIntent(parent()).run;
    const ready = store.importIntent(child(store.reserveSignalSeq())).run;
    store.claimNext();
    store.db.exec(`CREATE TRIGGER reject_release BEFORE UPDATE ON batch_run_steps
      WHEN NEW.state = 'READY' BEGIN SELECT RAISE(ABORT, 'blocked'); END`);
    assert.throws(() => store.finishStep(voyage.id, 1, {status: "COMPLETED"}), /blocked/);
    assert.equal(store.get(voyage.id).state, "RUNNING");
    assert.equal(store.get(ready.id).state, "WAITING");
    assert.equal(count(), 0);
  });
});
