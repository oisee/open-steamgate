import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";

describe("operations job tail events", () => {
  let dir, store;
  const intent = (name, count, extra = {}) => ({intentId: randomUUID().replaceAll("-", ""),
    sourceDb: join(dir, "business.sqlite"), client: "123", sysid: "OSG", owner: "ALICE",
    jobname: name, jobcount: count, program: "Z_FIRST", generation: "test",
    steps: [{number: 1, program: "Z_FIRST"}], ...extra});
  const eventCount = () => store.db.prepare("SELECT COUNT(*) AS n FROM batch_job_events").get().n;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-tail-event-"));
    store = new BatchRuns(dir, {OSD_OPERATIONS_DB: join(dir, "operations.sqlite")});
  });
  afterEach(() => { store.close(); rmSync(dir, {recursive: true, force: true}); });

  it("holds an imported dependent until terminal success, then releases it once", () => {
    const parent = intent("PARENT", "00000001");
    const child = intent("CHILD", "00000002", {afterEvent: {jobname: "PARENT", jobcount: "00000001"}});
    const first = store.importIntent(parent).run;
    const second = store.importIntent(child).run;
    assert.equal(second.state, "WAITING");
    assert.equal(second.steps[0].state, "PENDING");
    assert.equal(store.claimNext().run.id, first.id);
    assert.equal(store.get(second.id).state, "WAITING");
    store.finishStep(first.id, 1, {status: "COMPLETED"});
    assert.equal(eventCount(), 1);
    assert.equal(store.get(second.id).state, "QUEUED");
    assert.equal(store.get(second.id).steps[0].state, "READY");
    assert.equal(store.importIntent(child).kind, "duplicate");
    assert.throws(() => store.importIntent({...child, afterEvent: {jobname: "OTHER", jobcount: "00000003"}}),
      /changed after import/);
    assert.equal(eventCount(), 1);
  });

  it("catches a prior completion and scopes events to business instance and owner", () => {
    const parent = store.importIntent(intent("PARENT", "00000001")).run;
    store.claimNext();
    store.finishStep(parent.id, 1, {status: "COMPLETED"});
    const afterEvent = {jobname: "PARENT", jobcount: "00000001"};
    assert.equal(store.importIntent(intent("LATE", "00000002", {afterEvent})).run.state, "QUEUED");
    assert.equal(store.importIntent(intent("OTHER_OWNER", "00000003", {owner: "BOB", afterEvent})).run.state, "WAITING");
    assert.equal(store.importIntent(intent("OTHER_DB", "00000004", {
      sourceDb: join(dir, "other.sqlite"), afterEvent})).run.state, "WAITING");
    assert.equal(store.importIntent(intent("OTHER_CLIENT", "00000005", {client: "999", afterEvent})).run.state, "WAITING");
  });

  it("binds ABAP predecessor events to the exact intent across recycled job keys", () => {
    const old = intent("PARENT", "00000001");
    const completed = store.importIntent(old).run;
    store.claimNext();
    store.finishStep(completed.id, 1, {status: "COMPLETED"});
    const same = intent("CHILD", "00000002", {afterEvent: {
      jobname: "PARENT", jobcount: "00000001", intentId: old.intentId}});
    assert.equal(store.importIntent(same).run.state, "QUEUED");
    const recycled = intent("NEW_CHILD", "00000003", {afterEvent: {
      jobname: "PARENT", jobcount: "00000001", intentId: randomUUID().replaceAll("-", "")}});
    assert.equal(store.importIntent(recycled).run.state, "WAITING");
    assert.throws(() => store.importIntent({...same, afterEvent: recycled.afterEvent}), /changed after import/);
  });

  it("rejects an ambiguous legacy key after two completed intents reused it", () => {
    const first = store.importIntent(intent("PARENT", "00000001")).run;
    store.claimNext();
    store.finishStep(first.id, 1, {status: "COMPLETED"});
    const second = store.importIntent(intent("PARENT", "00000001")).run;
    store.claimNext();
    store.finishStep(second.id, 1, {status: "COMPLETED"});
    assert.equal(eventCount(), 2);
    assert.throws(() => store.importIntent(intent("OLD_CHILD", "00000003", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001"}})), /ambiguous predecessor job event/);
    assert.equal(store.importIntent(intent("NEW_CHILD", "00000004", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001", intentId: second.id.replaceAll("-", "")}})).run.state,
    "QUEUED");
  });

  it("emits only after the last successful step", () => {
    const parent = store.importIntent(intent("PARENT", "00000001", {
      steps: [{number: 1, program: "Z_FIRST"}, {number: 2, program: "Z_SECOND"}]})).run;
    const child = store.importIntent(intent("CHILD", "00000002", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001"}})).run;
    store.claimNext();
    assert.equal(store.finishStep(parent.id, 1, {status: "COMPLETED"}).kind, "advanced");
    assert.equal(eventCount(), 0);
    assert.equal(store.get(child.id).state, "WAITING");
    assert.equal(store.claimNext().step, 2);
    store.finishStep(parent.id, 2, {status: "COMPLETED"});
    assert.equal(eventCount(), 1);
    assert.equal(store.get(child.id).state, "QUEUED");
  });

  it("rejects parent finish and fail while imported ordered steps are active", () => {
    const parent = store.importIntent(intent("PARENT", "00000001", {
      steps: [{number: 1, program: "Z_FIRST"}, {number: 2, program: "Z_SECOND"}]})).run;
    const child = store.importIntent(intent("CHILD", "00000002", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001"}})).run;
    store.claimNext();
    assert.throws(() => store.finish(parent.id, {status: "COMPLETED"}), /requires step result recording/);
    assert.throws(() => store.fail(parent.id, new Error("dump")), /requires step result recording/);
    assert.equal(existsSync(join(dir, "batch-output", `${parent.id}.json`)), false);
    assert.equal(store.get(parent.id).state, "RUNNING");
    assert.deepEqual(store.get(parent.id).steps.map((step) => step.state), ["RUNNING", "PENDING"]);
    assert.equal(store.get(child.id).state, "WAITING");
    assert.equal(eventCount(), 0);
  });

  it("does not emit an event or release a dependent on terminal failure", () => {
    const parent = store.importIntent(intent("PARENT", "00000001")).run;
    const child = store.importIntent(intent("CHILD", "00000002", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001"}})).run;
    store.claimNext();
    store.finishStep(parent.id, 1, {status: "FAILED"});
    assert.equal(eventCount(), 0);
    assert.equal(store.get(child.id).state, "WAITING");
    assert.equal(store.claimNext().kind, "empty");
  });

  it("rolls terminal state back with the event when event recording fails", () => {
    const parent = store.importIntent(intent("PARENT", "00000001")).run;
    const child = store.importIntent(intent("CHILD", "00000002", {
      afterEvent: {jobname: "PARENT", jobcount: "00000001"}})).run;
    store.claimNext();
    store.db.exec(`CREATE TRIGGER reject_tail_event BEFORE INSERT ON batch_job_events
      BEGIN SELECT RAISE(ABORT, 'event ledger unavailable'); END`);
    assert.throws(() => store.finishStep(parent.id, 1, {status: "COMPLETED"}), /event ledger unavailable/);
    assert.equal(store.get(parent.id).state, "RUNNING");
    assert.equal(store.get(parent.id).steps[0].state, "RUNNING");
    assert.equal(store.get(child.id).state, "WAITING");
    assert.equal(eventCount(), 0);
  });
});
