import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";

describe("durable named job events", () => {
  let dir, store, env;
  const uuid = () => randomUUID().replaceAll("-", "");
  const sourceInstance = uuid();
  const base = () => ({sourceDb: join(dir, "business.sqlite"), client: "123",
    sysid: "OSG", owner: "ALICE"});
  const event = (seq, param = "A", extra = {}) => ({intentId: uuid(), ...base(),
    sourceInstance, id: "DONE", param, seq, ...extra});
  const job = (seq, param = "A", extra = {}) => ({intentId: uuid(), ...base(),
    jobname: `CHILD_${seq}`, jobcount: String(seq).padStart(8, "0"),
    program: "Z_FIRST", generation: "test", steps: [{number: 1, program: "Z_FIRST"}],
    namedEvent: {id: "DONE", param, sourceInstance, seq}, ...extra});
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-named-events-"));
    env = {OSD_OPERATIONS_DB: join(dir, "operations.sqlite")};
    store = new BatchRuns(dir, env);
  });
  afterEach(() => { store.close(); rmSync(dir, {recursive: true, force: true}); });

  it("does not replay an event raised before the dependent was closed", () => {
    store.importNamedEvent(event(1));
    const child = store.importIntent(job(2)).run;
    assert.equal(child.state, "WAITING");
    assert.equal(store.claimNext().kind, "empty");
    assert.equal(store.importNamedEvent(event(3)).released, 1);
    assert.equal(store.get(child.id).state, "QUEUED");
  });

  it("catches an event after close even when the event imports first", () => {
    const raised = event(3);
    assert.equal(store.importNamedEvent(raised).released, 0);
    const child = job(2);
    assert.equal(store.importIntent(child).run.state, "QUEUED");
    assert.equal(store.importIntent(child).kind, "duplicate");
    assert.equal(store.importNamedEvent(raised).kind, "duplicate");
    assert.throws(() => store.importNamedEvent({...raised, param: "B"}), /changed after import/);
    const reopened = new BatchRuns(dir, env);
    try { assert.equal(reopened.get(store.importIntent(child).run.id).state, "QUEUED"); }
    finally { reopened.close(); }
  });

  it("orders an accepted uncommitted close before a concurrent raise", () => {
    const waitSeq = store.reserveSignalSeq();
    assert.equal(waitSeq, 1);
    const raised = store.importNamedEvent({...event(0), seq: undefined});
    assert.equal(raised.seq, 2);
    assert.equal(raised.released, 0);
    assert.equal(store.importIntent(job(waitSeq)).run.state, "QUEUED");
  });

  it("deduplicates a direct raise ID without advancing the durable clock", () => {
    const raised = {...event(0), seq: undefined};
    assert.equal(store.importNamedEvent(raised).seq, 1);
    assert.equal(store.importNamedEvent(raised).kind, "duplicate");
    assert.equal(store.db.prepare("SELECT last_seq FROM batch_signal_clock").get().last_seq, 1);
  });

  it("matches a blank waiting parameter to any raise, but blank raise only to blank wait", () => {
    const blank = store.importIntent(job(1, "")).run;
    const specific = store.importIntent(job(2, "A")).run;
    const other = store.importIntent(job(3, "B")).run;
    assert.equal(store.importNamedEvent(event(4, "")).released, 1);
    assert.equal(store.get(blank.id).state, "QUEUED");
    assert.equal(store.get(specific.id).state, "WAITING");
    assert.equal(store.get(other.id).state, "WAITING");
    const laterBlank = store.importIntent(job(5, "")).run;
    assert.equal(store.importNamedEvent(event(6, "A")).released, 2);
    assert.equal(store.get(specific.id).state, "QUEUED");
    assert.equal(store.get(laterBlank.id).state, "QUEUED");
    assert.equal(store.get(other.id).state, "WAITING");
  });

  it("scopes signals to owner, client and source instance", () => {
    const alice = store.importIntent(job(1)).run;
    const bob = store.importIntent(job(2, "A", {owner: "BOB"})).run;
    const otherInstance = store.importIntent(job(3, "A", {namedEvent: {
      id: "DONE", param: "A", sourceInstance: uuid(), seq: 3}})).run;
    const otherClient = store.importIntent(job(4, "A", {client: "999"})).run;
    assert.equal(store.importNamedEvent(event(5)).released, 1);
    assert.equal(store.get(alice.id).state, "QUEUED");
    for (const run of [bob, otherInstance, otherClient]) assert.equal(store.get(run.id).state, "WAITING");
  });

  it("does not claim or let a prior instance's running job block a replacement", () => {
    const old = store.importIntent(job(1)).run;
    store.importNamedEvent(event(2));
    const source = {db: base().sourceDb, client: "123", sysid: "OSG", owner: "ALICE"};
    assert.equal(store.claimNext({...source, instance: sourceInstance}).run.id, old.id);
    const nextInstance = uuid();
    assert.equal(store.claimNext({...source, instance: nextInstance}).kind, "empty");
    const newEvent = {...event(4), sourceInstance: nextInstance};
    store.importNamedEvent(newEvent);
    const replacement = store.importIntent(job(3, "A", {namedEvent: {
      id: "DONE", param: "A", sourceInstance: nextInstance, seq: 3}})).run;
    assert.equal(replacement.state, "QUEUED");
    assert.equal(store.claimNext({...source, instance: nextInstance}).run.id, replacement.id);
  });

  it("rolls the occurrence and fanout back when release fails", () => {
    assert.equal(store.reserveSignalSeq(), 1);
    const child = store.importIntent(job(1)).run;
    store.db.exec(`CREATE TRIGGER reject_named_release BEFORE UPDATE ON batch_run_steps
      WHEN NEW.state = 'READY' BEGIN SELECT RAISE(ABORT, 'release blocked'); END`);
    assert.throws(() => store.importNamedEvent({...event(2), seq: undefined}), /release blocked/);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM batch_named_events").get().n, 0);
    assert.equal(store.db.prepare("SELECT last_seq FROM batch_signal_clock").get().last_seq, 1);
    assert.equal(store.get(child.id).state, "WAITING");
  });
});
