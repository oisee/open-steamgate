// The lock server through the ABAP (tools/osd-enq-host.mjs): every case of
// the measured contract (test/fixtures/enq/contract.json) run through the
// transpiler's generated ENQUEUE_EZOSD_PRB / DEQUEUE_EZOSD_PRB (and the
// second lock object's), DEQUEUE_ALL, ENQUEUE_READ and the ABAP COMMIT WORK
// and ROLLBACK WORK, each step a dialog step of its owner's session
// (test/integration/zosd_prb.tabl.xml, ezosd_prb*.enqu.xml).
//
// Not run here, and said so: the cases of an update that takes time
// (durationMs). The runtime runs CALL FUNCTION ... IN UPDATE TASK when it is
// called, so there is no window between COMMIT WORK and the update; the Go
// and Node cores pass those cases (test/osd-enq.mjs).
import {readFileSync} from "node:fs";
import {expect} from "chai";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {bindEnqSession, endEnqSession, noteUpdateTask} from "../tools/osd-enq-host.mjs";

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
});
