// The lock server on Node (tools/osd-enq.mjs) against the measured contract
// (ENQ E0, test/fixtures/enq/contract.json): every case gives what the
// system gave, as tools/gogen/go/enq/contract_test.go checks the Go one.
//
// What the system does asynchronously is the harness's to model, not the
// lock server's: the update task that releases the update owner's locks
// after a COMMIT WORK, and the teardown of an ended session. Both are queued
// and happen at the next WAIT UP TO or at a read with a deadline
// (eventuallyWithinMs); an update with durationMs and an END_SESSION with
// async fire on a fake clock, so _WAIT runs in no real time. Informational
// steps run and are not checked.
import {readFileSync} from "node:fs";
import {expect} from "chai";
import {LockServer, garg} from "../tools/osd-enq.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/enq/contract.json", import.meta.url), "utf8"));
const CLIENT = "001";

class Harness {
  constructor() {
    this.srv = new LockServer("osdhost_OSD_00");
    this.owners = new Map();
    this.updated = new Map();
    this.duration = new Map();
    this.ended = new Map(); // the update owner before the last COMMIT or ROLLBACK
    this.renewed = new Map(); // and whether it had to be renewed there
    this.pending = [];
    this.timed = [];
    this.now = 0;
    this.released = undefined; // when the last timed END_SESSION ran
  }

  session(name) {
    if (!this.owners.has(name)) this.owners.set(name, this.srv.open("<USER>"));
    return this.owners.get(name);
  }

  advance(ms) {
    this.now += ms;
    this.timed.sort((a, b) => a.at - b.at);
    while (this.timed.length > 0 && this.timed[0].at <= this.now) this.timed.shift().run();
  }

  flush() {
    for (const run of this.pending) run();
    this.pending = [];
  }

  request(call, p) {
    const object = call.slice(call.indexOf("_") + 1);
    const r = {client: CLIENT, table: contract.lockObject.table, object, mode: p.MODE_ZOSD_PRB || "E", fields: []};
    for (const a of contract.lockObject.args) {
      if (a.name === "MANDT") continue;
      let v = p[a.name];
      if (v === undefined && a.name === "K2") v = "K"; // the fixture's notation for a K2 left out
      v = v ?? "";
      r.fields.push({value: v, generic: v.trim() === "" && p[`X_${a.name}`] !== "X", length: a.length});
    }
    if (p._SCOPE) r.scope = Number(p._SCOPE);
    return r;
  }

  stamp(sid, r) {
    const arg = garg(r.client, r.fields);
    return this.srv.read({client: r.client, table: r.table}).find((w) => w.session === sid && w.arg === arg && w.mode === r.mode)?.update ?? "";
  }

  renewal(expected, before, sid) {
    if (expected?.newUpdateOwner === undefined) return "";
    const got = this.srv.updateOwner(sid) !== before;
    return got === expected.newUpdateOwner ? "" : `newUpdateOwner ${got}`;
  }

  async step(owner, call, p, expected, delay) {
    const sid = this.session(owner);
    const e = expected ?? {};
    if (call.startsWith("ENQUEUE_") && call !== "ENQUEUE_READ") {
      if (Object.keys(p).length === 0) p = {K1: "NEWOWNER"};
      const start = this.now;
      const r = this.request(call, p);
      const res = await this.srv.enqueue(sid, r, {wait: p._WAIT === "X", sleep: async (ms) => this.advance(ms)});
      // the GUSRVB the row just taken carries against the one before the last
      // COMMIT or ROLLBACK: new after a ROLLBACK or a COMMIT that queued an
      // update, the same after one that did not
      if (this.ended.has(owner) && res.subrc === 0 && r.scope !== 1) {
        const before = this.ended.get(owner);
        const stamped = this.stamp(sid, r);
        if (e.newUpdateOwner !== undefined && (stamped !== before) !== e.newUpdateOwner) return `newUpdateOwner ${stamped !== before}`;
        if ((stamped !== before) !== this.renewed.get(owner)) return `update owner renewed ${stamped !== before}`;
        this.ended.delete(owner);
      }
      if (e.subrc !== undefined && e.subrc !== res.subrc) return `subrc ${res.subrc}, msgno ${res.msgno}`;
      if (e["sy-msgno"] !== undefined && e["sy-msgno"] !== res.msgno) return `msgno ${res.msgno}`;
      if (e["sy-msgv1"] !== undefined && e["sy-msgv1"] !== res.holder) return `holder ${res.holder}`;
      if (e.elapsedMs) {
        const took = this.now - start;
        if ((e.elapsedMs.min !== undefined && took < e.elapsedMs.min) || (e.elapsedMs.max !== undefined && took > e.elapsedMs.max)) return `elapsed ${took} ms`;
      }
      if (e.grantedWithinMsOfRelease !== undefined && (this.released === undefined || this.now - this.released > e.grantedWithinMsOfRelease)) {
        return `granted at ${this.now}, released at ${this.released}`;
      }
    } else if (call.startsWith("DEQUEUE_ALL")) {
      this.srv.dequeueAll(sid);
    } else if (call.startsWith("DEQUEUE_")) {
      this.srv.dequeue(sid, this.request(call, p));
    } else if (call === "ENQUEUE_READ") {
      if (e.eventuallyWithinMs !== undefined) {
        // released by the deadline: the queued teardowns run, the clock goes to it
        this.flush();
        this.advance(e.eventuallyWithinMs);
      }
      return this.read(p, e);
    } else if (call.startsWith("CALL FUNCTION") && call.includes("IN UPDATE TASK")) {
      this.updated.set(owner, true);
      this.duration.set(owner, Number(p.durationMs ?? 0));
    } else if (call === "COMMIT WORK" || call === "COMMIT WORK AND WAIT") {
      const updated = this.updated.get(owner) ?? false;
      this.ended.set(owner, this.srv.updateOwner(sid));
      this.renewed.set(owner, updated);
      const before = this.srv.updateOwner(sid);
      const ended = this.srv.commit(sid, updated);
      const took = updated ? this.duration.get(owner) ?? 0 : 0;
      this.updated.set(owner, false);
      if (call === "COMMIT WORK AND WAIT") {
        this.advance(took);
        this.srv.updateDone(sid, ended);
      } else if (took > 0) {
        this.timed.push({at: this.now + took, run: () => this.srv.updateDone(sid, ended)});
      } else {
        this.pending.push(() => this.srv.updateDone(sid, ended));
      }
      return this.renewal(expected, before, sid);
    } else if (call === "ROLLBACK WORK") {
      this.ended.set(owner, this.srv.updateOwner(sid));
      this.renewed.set(owner, true);
      this.updated.set(owner, false);
      const before = this.srv.updateOwner(sid);
      this.srv.rollback(sid);
      return this.renewal(expected, before, sid);
    } else if (call.startsWith("WAIT UP TO")) {
      this.flush();
      this.advance(Number(/WAIT UP TO (\d+)/.exec(call)[1]) * 1000);
    } else if (call === "END_SESSION") {
      if (delay >= 0) {
        this.timed.push({at: this.now + delay, run: () => { this.srv.end(sid); this.released = this.now; }});
      } else {
        this.pending.push(() => this.srv.end(sid));
      }
    } else if (call.startsWith("RFC_CONNECTION_CLOSE")) {
      const m = /\(ends (\w+)\)/.exec(call);
      if (!m) return `which session the close ends: ${call}`;
      const closed = this.session(m[1]);
      this.pending.push(() => this.srv.end(closed));
    } else if (call.startsWith("return from the RFC call")) {
      // a stateful connection: the session goes on
    } else {
      return `unknown call ${call}`;
    }
    return "";
  }

  read(p, e) {
    const rows = this.srv.read({client: CLIENT, table: p.GNAME});
    if (e.NUMBER !== undefined && e.NUMBER !== rows.length) return `NUMBER ${rows.length}: ${JSON.stringify(rows.map((r) => [r.arg, r.mode, r.dialogs, r.updates]))}`;
    const used = new Set();
    for (const want of e.rows ?? []) {
      const i = rows.findIndex((r, j) => !used.has(j) && this.matches(r, want));
      if (i < 0) return `no row ${JSON.stringify(want)}`;
      used.add(i);
    }
    return "";
  }

  matches(r, m) {
    const arg = m.GARG.replaceAll("{MANDT}", CLIENT).replace(/ +$/, "");
    if (r.arg !== arg || r.mode !== m.GMODE || r.dialogs !== m.GUSE || r.updates !== m.GUSEVB) return false;
    const dialogOk = m.GUSR === null ? r.dialog === "" : r.dialog !== "" && this.owners.get(m.GUSR) === r.session;
    // GUSRVB "S" is S's current update owner, "S^" the one S handed to its update task
    let updateOk;
    if (m.GUSRVB === null) {
      updateOk = r.update === "";
    } else {
      const task = m.GUSRVB.endsWith("^");
      const sid = this.owners.get(m.GUSRVB.replace(/\^$/, ""));
      updateOk = r.update !== "" && sid === r.session && (r.update === this.srv.updateOwner(sid)) !== task;
    }
    return dialogOk && updateOk;
  }
}

describe("the lock server on Node answers the measured contract (ENQ E0)", function () {
  it("has cases", () => expect(contract.cases.length).to.be.greaterThan(0));
  for (const tc of contract.cases) {
    it(tc.id, async () => {
      const h = new Harness();
      for (const [i, st] of tc.steps.entries()) {
        const params = Object.fromEntries(Object.entries(st.params ?? {}).map(([k, v]) => [k, String(v)]));
        const msg = await h.step(st.owner, st.call, params, st.informational ? undefined : st.expect, st.async ? st.async.delayMs : -1);
        expect(msg, `${tc.title}: step ${i + 1} ${st.owner} ${st.call} ${JSON.stringify(params)}`).to.equal("");
      }
    });
  }
});

describe("the lock server's own rules beyond the fixtures", function () {
  const lockOn = (k1, mode, scope) => ({client: "001", table: "T", object: "ET", mode, scope,
    fields: [{value: k1, length: 10}, {value: "K", length: 10}]});

  it("keeps the update task's half after End until updateDone, and refuses the session meanwhile", async () => {
    for (const scope of [2, 3]) {
      const srv = new LockServer("i");
      const a = srv.open("U");
      await srv.enqueue(a, lockOn("A", "S", scope));
      const ended = srv.commit(a, true);
      const res = await srv.enqueue(a, lockOn("A", "E", 2));
      expect(res, `scope ${scope}`).to.include({subrc: 1, msgno: "601"});
      srv.end(a);
      expect(srv.read().length, `scope ${scope}`).to.equal(1);
      srv.updateDone(a, ended);
      expect(srv.read().length).to.equal(0);
    }
  });

  it("passes a row it cannot release on DEQUEUE", async () => {
    const srv = new LockServer("i");
    const a = srv.open("U");
    await srv.enqueue(a, lockOn("A", "S", 3));
    const ended = srv.commit(a, true);
    await srv.enqueue(a, lockOn("A", "S", 2));
    srv.dequeue(a, lockOn("A", "S", 2));
    const rows = srv.read();
    expect(rows).to.have.length(1);
    expect(rows[0]).to.include({dialogs: 1, update: ended});
  });

  it("answers SYSTEM_FAILURE after close", async () => {
    const srv = new LockServer("i");
    const a = srv.open("U");
    srv.close();
    expect((await srv.enqueue(a, lockOn("A", "E", 2))).subrc).to.equal(2);
  });

  it("lets one of many concurrent sessions have an E lock", async () => {
    const srv = new LockServer("i");
    const sessions = Array.from({length: 64}, () => srv.open("U"));
    const results = await Promise.all(sessions.map((s) => srv.enqueue(s, lockOn("A", "E", 2))));
    expect(results.filter((r) => r.subrc === 0)).to.have.length(1);
    expect(results.filter((r) => r.msgno === "601")).to.have.length(63);
  });
});
