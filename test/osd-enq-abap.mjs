// The lock server through the ABAP (tools/osd-enq-host.mjs): every case of
// the measured contract (test/fixtures/enq/contract.json) run through the
// transpiler's generated ENQUEUE_EZOSD_PRB / DEQUEUE_EZOSD_PRB (and the
// second lock object's), DEQUEUE_ALL, ENQUEUE_READ and the ABAP COMMIT WORK
// and ROLLBACK WORK, each step a dialog step of its owner's session
// (test/integration/zosd_prb.tabl.xml, ezosd_prb*.enqu.xml).
//
// Beyond the contract, the host's own lifecycle: a key its host ended stays
// ended (a step queued or parked behind the end cannot open a fresh session
// under it), and a bound session whose step dumps loses its dialog locks, as
// a dump ends the context on a system.
//
// Not run here, and said so: the cases of an update that takes time
// (durationMs). The runtime runs CALL FUNCTION ... IN UPDATE TASK when it is
// called, so there is no window between COMMIT WORK and the update; the Go
// and Node cores pass those cases (test/osd-enq.mjs).
import {readFileSync} from "node:fs";
import {expect} from "chai";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {EnqSessionEnded, bindEnqSession, endEnqSession, enqDrop, enqHolder, noteUpdateTask, onEnqContextEnded} from "../tools/osd-enq-host.mjs";
import {locks} from "../tools/osd-enq.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/enq/contract.json", import.meta.url), "utf8"));
const timed = (tc) => tc.steps.some((st) => st.params?.durationMs !== undefined);

describe("the lock server through the generated ENQUEUE_ modules (ENQ E0 as ABAP)", function () {
  this.timeout(60000);
  let abap;
  let client;

  before(async function () {
    this.timeout(180000);
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    abap = globalThis.abap;
    client = String(abap.builtin.sy.get().mandt.get());
    expect(abap.FunctionModules.ENQUEUE_EZOSD_PRB, "the generated module").to.be.a("function");
  });

  const value = (v) => (v && typeof v.get === "function" ? v.get() : v);

  /** one FM call in its owner's session, as a dialog step; the classic
   * exception it raises becomes {subrc, msgno, msgv1} */
  async function call(owner, name, exporting, extra = {}) {
    return dialogStep(async () => {
      bindEnqSession(owner);
      const sy = abap.builtin.sy.get();
      sy.subrc.set(0);
      sy.msgno.set("");
      sy.msgv1.set("");
      const fm = abap.FunctionModules[name];
      if (fm === undefined) throw new Error(`no function module ${name}`);
      const args = {};
      for (const [k, v] of Object.entries(exporting)) args[k.toLowerCase()] = new abap.types.Character(Math.max(1, String(v).length)).set(String(v));
      try {
        await fm({exporting: args, ...extra});
        return {subrc: 0};
      } catch (e) {
        if (e?.classic === undefined) throw e;
        return {subrc: e.classic === "foreign_lock" ? 1 : 2, exception: e.classic.toUpperCase(), msgno: String(sy.msgno.get()).trim(), msgv1: String(sy.msgv1.get()).trim()};
      }
    }, `ENQ E0 ${owner} ${name}`);
  }

  async function read(owner) {
    // ENQUEUE_READ's rows straight from the lock server, through the same
    // module the ABAP calls (TABLES enq left out: the row type is SAP's)
    const {locks} = await import("../tools/osd-enq.mjs");
    return dialogStep(async () => {
      bindEnqSession(owner);
      const rows = locks().read({client, table: "ZOSD_PRB"});
      // and the module itself answers the same NUMBER
      const number = new abap.types.Integer();
      await abap.FunctionModules.ENQUEUE_READ({exporting: {gclient: new abap.types.Character(3).set(client),
        gname: new abap.types.Character(30).set("ZOSD_PRB"), guname: new abap.types.Character(12).set("")}, importing: {number}});
      expect(number.get(), "ENQUEUE_READ NUMBER").to.equal(rows.length);
      return rows;
    }, `ENQ E0 ${owner} ENQUEUE_READ`);
  }

  for (const tc of contract.cases) {
    const run = timed(tc) ? it.skip : it;
    run(timed(tc) ? `${tc.id} (an update that takes time: no update task in the runtime)` : tc.id, async function () {
      const owners = new Set(tc.steps.map((st) => st.owner));
      const key = (o) => `${tc.id}:${o}`;
      const pending = [];
      try {
        for (const [i, st] of tc.steps.entries()) {
          const e = st.informational ? {} : st.expect ?? {};
          const where = `${tc.title}: step ${i + 1} ${st.owner} ${st.call}`;
          const p = Object.fromEntries(Object.entries(st.params ?? {}).map(([k, v]) => [k, String(v)]));
          const owner = key(st.owner);
          if (st.call.startsWith("ENQUEUE_") && st.call !== "ENQUEUE_READ") {
            if (Object.keys(p).length === 0) continue; // a renewal step: the cores check it by id
            if (p.K2 === undefined) p.K2 = "K";
            if (p.MANDT === undefined) p.MANDT = client;
            const res = await call(owner, st.call, p);
            if (e.subrc !== undefined) expect(res.subrc, where).to.equal(e.subrc);
            if (e["sy-msgno"] !== undefined) expect(res.msgno, where).to.equal(e["sy-msgno"]);
            if (e.exception !== undefined) expect(res.exception, where).to.equal(e.exception);
          } else if (st.call.startsWith("DEQUEUE_ALL")) {
            await call(owner, "DEQUEUE_ALL", {});
          } else if (st.call.startsWith("DEQUEUE_")) {
            if (p.K2 === undefined) p.K2 = "K";
            if (p.MANDT === undefined) p.MANDT = client;
            await call(owner, st.call, p);
          } else if (st.call === "ENQUEUE_READ") {
            if (e.eventuallyWithinMs !== undefined) { for (const f of pending.splice(0)) await f(); }
            const rows = await read(owner);
            if (e.NUMBER !== undefined) expect(rows.length, `${where} ${JSON.stringify(rows.map((r) => [r.arg, r.mode, r.dialogs, r.updates]))}`).to.equal(e.NUMBER);
            for (const want of e.rows ?? []) {
              const arg = want.GARG.replaceAll("{MANDT}", client).replace(/ +$/, "");
              const hit = rows.find((r) => r.arg === arg && r.mode === want.GMODE && r.dialogs === want.GUSE && r.updates === want.GUSEVB);
              expect(hit, `${where}: row ${JSON.stringify(want)}`).to.not.equal(undefined);
            }
          } else if (st.call.startsWith("CALL FUNCTION") && st.call.includes("IN UPDATE TASK")) {
            await dialogStep(async () => { bindEnqSession(owner); noteUpdateTask(); }, "update module");
          } else if (st.call === "COMMIT WORK" || st.call === "COMMIT WORK AND WAIT") {
            await dialogStep(async () => { bindEnqSession(owner); await abap.statements.commit(st.call.endsWith("WAIT") ? {wait: true} : undefined); }, "COMMIT WORK");
          } else if (st.call === "ROLLBACK WORK") {
            await dialogStep(async () => { bindEnqSession(owner); await abap.statements.rollback(); }, "ROLLBACK WORK");
          } else if (st.call.startsWith("WAIT UP TO")) {
            for (const f of pending.splice(0)) await f();
          } else if (st.call === "END_SESSION") {
            if (st.async) {
              setTimeout(() => endEnqSession(owner), st.async.delayMs);
            } else {
              pending.push(async () => endEnqSession(owner));
            }
          } else if (st.call.startsWith("RFC_CONNECTION_CLOSE")) {
            const m = /\(ends (\w+)\)/.exec(st.call);
            pending.push(async () => endEnqSession(key(m[1])));
          } else if (st.call.startsWith("return from the RFC call")) {
            // a stateful connection: the session goes on
          } else {
            throw new Error(`unknown call ${st.call}`);
          }
        }
      } finally {
        for (const o of owners) endEnqSession(key(o));
      }
    });
  }

  describe("the host's session lifecycle", function () {
    const dialogLock = (k1) => ({MODE_ZOSD_PRB: "E", K1: k1, K2: "K", MANDT: client, _SCOPE: "1"});
    const held = (k1) => locks().read({client, table: "ZOSD_PRB"}).filter((r) => r.arg.startsWith(`${client}${k1}`));
    const enqueue = (fields) => abap.FunctionModules.ENQUEUE_EZOSD_PRB({exporting: Object.fromEntries(Object.entries(fields)
      .map(([k, v]) => [k.toLowerCase(), new abap.types.Character(Math.max(1, v.length)).set(v)]))});
    // a promise the step resolves just before it parks, so a test acts while
    // it is parked rather than after a guessed delay
    const signal = () => {
      let fire;
      const fired = new Promise((r) => { fire = r; });
      return {fire, fired};
    };

    it("refuses to bind a key its host has ended, and releases its locks at the end", async () => {
      const key = "lifecycle:ended";
      expect((await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCEND"))).subrc).to.equal(0);
      expect(held("LCEND")).to.have.length(1);
      endEnqSession(key);
      expect(held("LCEND")).to.have.length(0);
      let error;
      try {
        await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCEND"));
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an.instanceOf(EnqSessionEnded);
      expect(error.code).to.equal("ENQ_SESSION_ENDED");
      expect(held("LCEND")).to.have.length(0);
    });

    it("takes no lock for a step that was parked in a WAIT when its key ended (logoff racing a LOCK)", async () => {
      const key = "lifecycle:race";
      const parked = signal();
      const step = dialogStep(async () => {
        bindEnqSession(key);
        parked.fire();
        await abap.statements.wait({seconds: {get: () => 0.3}});
        await enqueue(dialogLock("LCRACE"));
      }, "ENQ lifecycle: a LOCK behind a WAIT");
      await parked.fired;
      endEnqSession(key); // the logoff, outside any step, while the LOCK is parked
      let error;
      try {
        await step;
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an.instanceOf(EnqSessionEnded);
      expect(held("LCRACE"), "no lock under a session nobody will end").to.have.length(0);
      // what has nothing to release does nothing under an ended key: the
      // step that ran into the end still finishes its DEQUEUE and COMMIT
      const other = "lifecycle:race2";
      const parked2 = signal();
      const finishing = dialogStep(async () => {
        bindEnqSession(other);
        parked2.fire();
        await abap.statements.wait({seconds: {get: () => 0.3}});
        await abap.FunctionModules.DEQUEUE_ALL({});
        await abap.statements.commit();
        await abap.statements.rollback();
        return "finished";
      }, "ENQ lifecycle: DEQUEUE_ALL, COMMIT and ROLLBACK behind a WAIT");
      await parked2.fired;
      endEnqSession(other);
      expect(await finishing).to.equal("finished");
    });

    it("ends the dialog locks of a bound session whose step dumps, and lets the key start again", async () => {
      const key = "lifecycle:dump";
      try {
        expect((await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCDUMP"))).subrc).to.equal(0);
        let dumped = false;
        try {
          await dialogStep(async () => {
            bindEnqSession(key);
            await enqueue(dialogLock("LCDUMP2"));
            expect(held("LCDUMP2")).to.have.length(1);
            throw new Error("a short dump");
          }, "ENQ lifecycle: a step that dumps");
        } catch (e) {
          dumped = e.message === "a short dump";
        }
        expect(dumped).to.equal(true);
        expect(held("LCDUMP"), "the lock of an earlier step of the context").to.have.length(0);
        expect(held("LCDUMP2"), "the dumped step's own lock").to.have.length(0);
        // the next step of the key is a new context, not a refused one
        expect((await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCDUMP"))).subrc).to.equal(0);
        expect(held("LCDUMP")).to.have.length(1);
      } finally {
        endEnqSession(key);
      }
    });

    it("stops an ENQUEUE that waits for a lock (_WAIT) when its key ends meanwhile", async () => {
      const holder = "lifecycle:holder";
      const waiter = "lifecycle:waiter";
      try {
        expect((await call(holder, "ENQUEUE_EZOSD_PRB", dialogLock("LCWAIT"))).subrc).to.equal(0);
        const started = signal();
        const step = dialogStep(async () => {
          bindEnqSession(waiter);
          started.fire();
          await enqueue({...dialogLock("LCWAIT"), _WAIT: "X"});
        }, "ENQ lifecycle: an ENQUEUE with _WAIT");
        await started.fired;
        await new Promise((r) => setTimeout(r, 50)); // into its first sleep
        endEnqSession(waiter);
        let error;
        try {
          await step;
        } catch (e) {
          error = e;
        }
        expect(error, "the end, not SYSTEM_FAILURE").to.be.an.instanceOf(EnqSessionEnded);
        expect(held("LCWAIT")).to.have.length(1); // the holder's, still
      } finally {
        endEnqSession(holder);
      }
    });

    it("drops a dumped context only when its other step parked in a WAIT is out, and tells the host", async () => {
      const key = "lifecycle:two";
      const heard = [];
      onEnqContextEnded((k) => heard.push(k));
      try {
        const parked = signal();
        let resume;
        const parkedStep = dialogStep(async () => {
          bindEnqSession(key);
          await enqueue(dialogLock("LCTWOA"));
          parked.fire();
          await abap.statements.wait({seconds: {get: () => 0.5}});
          resume = held("LCTWOA").length; // still its own while it ran
        }, "ENQ lifecycle: step A, parked");
        await parked.fired;
        await dialogStep(async () => {
          bindEnqSession(key);
          throw new Error("step B dumps");
        }, "ENQ lifecycle: step B, dumping").catch(() => {});
        expect(held("LCTWOA"), "A is still parked: the drop waits").to.have.length(1);
        expect(heard).to.deep.equal([]);
        await parkedStep;
        expect(resume).to.equal(1);
        expect(held("LCTWOA"), "the last step out dropped the context").to.have.length(0);
        expect(heard).to.deep.equal([key]);
      } finally {
        endEnqSession(key);
      }
    });

    it("gives a step that binds after a dump a new context, which the old one's drop does not take", async () => {
      const key = "lifecycle:after";
      const heard = [];
      onEnqContextEnded((k) => heard.push(k));
      try {
        const parked = signal();
        const parkedStep = dialogStep(async () => {
          bindEnqSession(key);
          await enqueue(dialogLock("LCAFTA"));
          parked.fire();
          await abap.statements.wait({seconds: {get: () => 0.5}});
          // after the WAIT, A still works in its own (old) context
          await enqueue(dialogLock("LCAFTA2"));
          await abap.statements.commit();
        }, "ENQ lifecycle: step A, parked across the dump");
        await parked.fired;
        await dialogStep(async () => {
          bindEnqSession(key);
          throw new Error("step B dumps");
        }, "ENQ lifecycle: step B, dumping").catch(() => {});
        // step C comes after the dump: a new context, not the dead one
        expect((await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCAFTC"))).subrc).to.equal(0);
        expect(held("LCAFTA"), "A's lock while A runs").to.have.length(1);
        await parkedStep;
        expect(held("LCAFTA"), "the old context went with A").to.have.length(0);
        expect(held("LCAFTA2"), "A's lock after the WAIT was the old context's too").to.have.length(0);
        expect(held("LCAFTC"), "C's lock is the new context's").to.have.length(1);
        expect(heard).to.deep.equal([key]);
        // and the new context is the key's: its next step sees the lock as its own (602)
        const again = await call(key, "ENQUEUE_EZOSD_PRB", {...dialogLock("LCAFTC"), MODE_ZOSD_PRB: "X"});
        expect(again.msgno, "602: its own lock, not a foreign one").to.equal("602");
      } finally {
        endEnqSession(key);
      }
      expect(held("LCAFTC"), "the host's end takes the new context's locks").to.have.length(0);
    });

    it("keeps a step that bound and parked before locking in the old context, and a later dump of it spares the new one", async () => {
      const key = "lifecycle:unpinned";
      const heard = [];
      onEnqContextEnded((k) => heard.push(k));
      try {
        // B binds and parks before it locks anything
        const parkedB = signal();
        const lockedB = signal();
        let releaseB;
        const gateB = new Promise((r) => { releaseB = r; });
        const stepB = dialogStep(async () => {
          bindEnqSession(key);
          parkedB.fire();
          await abap.statements.wait({seconds: {get: () => 0.4}});
          await enqueue(dialogLock("LCUNB"));
          lockedB.fire();
          await gateB;
          throw new Error("step B dumps too");
        }, "ENQ lifecycle: step B, bound and parked");
        await parkedB.fired;
        // A dumps: the context B bound to is retired
        await dialogStep(async () => {
          bindEnqSession(key);
          throw new Error("step A dumps");
        }, "ENQ lifecycle: step A, dumping").catch(() => {});
        // C binds after the dump and locks in the new context
        expect((await call(key, "ENQUEUE_EZOSD_PRB", dialogLock("LCUNC"))).subrc).to.equal(0);
        await lockedB.fired; // B is past its WAIT and has locked
        expect(held("LCUNB"), "B locked in the old context").to.have.length(1);
        // the host releases what enqHolder names under the key, retired or not
        expect(enqHolder("ZOSD_PRB", dialogLock("LCUNB"))?.key).to.equal(key);
        enqDrop(key, "ZOSD_PRB", "EZOSD_PRB", dialogLock("LCUNB"));
        expect(held("LCUNB"), "enqDrop reaches the retired session").to.have.length(0);
        releaseB();
        await stepB.catch(() => {});
        expect(held("LCUNB"), "B's dump ended the old context").to.have.length(0);
        expect(held("LCUNC"), "and spared C's new one").to.have.length(1);
        expect(heard, "one context ended, once").to.deep.equal([key]);
      } finally {
        endEnqSession(key);
      }
    });
  });
});
