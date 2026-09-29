import {EventEmitter} from "node:events";
import {expect} from "chai";
import {randomBytes} from "node:crypto";
import {serveChannel, frame} from "../tools/osd-apc.mjs";
import {apcTimerSession} from "../tools/osd-apc-timers.mjs";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";
import {applyRuntimeHotSwap} from "../tools/osd-hot.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Socket extends EventEmitter {
  writes = [];
  ended = false;
  write(value) {
    this.writes.push(value);
    this.emit("write");
  }
  end(value) {
    if (value !== undefined) this.write(value);
    this.ended = true;
    this.emit("close");
  }
  messages() {
    return this.writes.filter(Buffer.isBuffer).filter((bytes) => (bytes[0] & 15) === 1)
      .map((bytes) => bytes.subarray(2).toString());
  }
  async until(count, timeout = 300) {
    const deadline = Date.now() + timeout;
    while (this.messages().length < count && Date.now() < deadline) await sleep(2);
    expect(this.messages().length, `frames: ${this.messages().join(", ")}`).to.be.at.least(count);
    return this.messages();
  }
  send(text) {
    const source = frame(text);
    const mask = randomBytes(4);
    const body = Buffer.from(source.subarray(2));
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.emit("data", Buffer.concat([Buffer.from([source[0], source[1] | 0x80]), mask, body]));
  }
}

describe("stateful APC timers", function () {
  this.timeout(30000);
  let Host;
  before(async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    Host = (await import("../output/zcl_apc_host.clas.mjs")).zcl_apc_host;
    await import("../output/zcl_osd_timer_probe.clas.mjs");
    await initializeABAP();
  });
  async function channel() {
    const socket = new Socket();
    await serveChannel({
      req: {headers: {"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ=="}, url: "/timers"},
      socket, head: Buffer.alloc(0), host: Host,
      channel: {path: "/timers", name: "TIMERS", handler: "ZCL_OSD_TIMER_PROBE", stateful: true},
      log: (message) => { throw new Error(message); },
    });
    return socket;
  }
  async function dueBehindLock(action) {
    const abap = globalThis.abap;
    let fired = 0;
    const timers = apcTimerSession(abap, (work) => work(), (error) => { throw error; });
    const handler = {if_abap_timer_handler$on_timeout: async () => { fired++; }};
    await timers.step(() => timers.session.manager.if_abap_timer_manager$start_timer({
      i_timer_handler: {get: () => handler}, i_timeout: {get: () => 0},
    }));
    let unlock;
    let locked;
    const lockReady = new Promise((resolve) => { locked = resolve; });
    const lock = dialogStep(async () => {
      locked();
      await new Promise((resolve) => { unlock = resolve; });
    });
    await lockReady;
    const deadline = Date.now() + 1000;
    while (workProcess().waiting === 0 && Date.now() < deadline) await sleep(1);
    expect(workProcess().waiting).to.be.greaterThan(0);
    await action(timers, handler);
    unlock();
    await lock;
    await sleep(20);
    expect(fired).to.equal(0);
    timers.close();
  }

  it("raises the measured text IDs for duplicate start and inactive stop", async () => {
    const abap = globalThis.abap;
    const timers = apcTimerSession(abap, (work) => work(), (error) => { throw error; });
    const manager = timers.session.manager;
    const handler = {if_abap_timer_handler$on_timeout: async () => {}};
    const args = {i_timer_handler: {get: () => handler}, i_timeout: {get: () => 1000}};
    try {
      await timers.step(() => manager.if_abap_timer_manager$start_timer(args));
      try {
        await timers.step(() => manager.if_abap_timer_manager$start_timer(args));
        throw new Error("duplicate start did not raise");
      } catch (error) {
        expect(error.textid.get()).to.equal(abap.Classes.CX_ABAP_TIMER_ERROR.timer_already_active.get());
        expect((await error.if_message$get_text()).get()).to.equal("Timer object is already active.");
      }
      await timers.step(() => manager.if_abap_timer_manager$stop_timer({i_timer_handler: args.i_timer_handler}));
      try {
        await timers.step(() => manager.if_abap_timer_manager$stop_timer({i_timer_handler: args.i_timer_handler}));
        throw new Error("inactive stop did not raise");
      } catch (error) {
        expect(error.textid.get()).to.equal(abap.Classes.CX_ABAP_TIMER_ERROR.timer_object_not_active.get());
        expect((await error.if_message$get_text()).get()).to.equal("Timer objects is not active.");
      }
    } finally {
      timers.close();
    }
  });

  it("releases startup timers when the socket closes before on_start completes", async () => {
    let fired = false;
    let resume;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    class SlowHost extends Host {
      async open(...args) {
        const manager = globalThis.abap.Classes.CL_ABAP_TIMER_MANAGER;
        const ref = await manager.get_timer_manager();
        await ref.get().if_abap_timer_manager$start_timer({
          i_timer_handler: {get: () => ({if_abap_timer_handler$on_timeout: async () => { fired = true; }})},
          i_timeout: {get: () => 0},
        });
        entered();
        await new Promise((resolve) => { resume = resolve; });
        return super.open(...args);
      }
    }
    const socket = new Socket();
    const serving = serveChannel({
      req: {headers: {"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ=="}, url: "/timers"},
      socket, head: Buffer.alloc(0), host: SlowHost,
      channel: {path: "/timers", name: "TIMERS", handler: "ZCL_OSD_TIMER_PROBE", stateful: true},
    });
    await started;
    socket.end();
    resume();
    await serving;
    await sleep(20);
    expect(fired).to.equal(false);
    expect(socket.writes).to.have.length(0);
  });

  it("does not arm a timer requested after the socket closes during on_start", async () => {
    let resume;
    let entered;
    let timeoutReads = 0;
    let fired = false;
    const started = new Promise((resolve) => { entered = resolve; });
    class SlowHost extends Host {
      async open(...args) {
        const ref = await globalThis.abap.Classes.CL_ABAP_TIMER_MANAGER.get_timer_manager();
        entered();
        await new Promise((resolve) => { resume = resolve; });
        await ref.get().if_abap_timer_manager$start_timer({
          i_timer_handler: {get: () => ({if_abap_timer_handler$on_timeout: async () => { fired = true; }})},
          i_timeout: {get: () => { timeoutReads++; return 100; }},
        });
        return super.open(...args);
      }
    }
    const socket = new Socket();
    const serving = serveChannel({
      req: {headers: {"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ=="}, url: "/timers"},
      socket, head: Buffer.alloc(0), host: SlowHost,
      channel: {path: "/timers", name: "TIMERS", handler: "ZCL_OSD_TIMER_PROBE", stateful: true},
    });
    await started;
    socket.end();
    resume();
    await serving;
    await sleep(120);
    expect(timeoutReads, "a closed session must not schedule a timer").to.equal(0);
    expect(fired).to.equal(false);
    expect(socket.writes).to.have.length(0);
  });

  it("does not write a startup error after the socket closes", async () => {
    let resume;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    class FailingHost extends Host {
      async open() {
        entered();
        await new Promise((resolve) => { resume = resolve; });
        throw new Error("startup failed");
      }
    }
    const socket = new Socket();
    const serving = serveChannel({
      req: {headers: {"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ=="}, url: "/timers"},
      socket, head: Buffer.alloc(0), host: FailingHost,
      channel: {path: "/timers", name: "TIMERS", handler: "ZCL_OSD_TIMER_PROBE", stateful: true},
    });
    await started;
    socket.end();
    resume();
    await serving;
    expect(socket.writes).to.have.length(0);
  });

  it("fires after arming returns, in due order, including zero, negative and an unreferenced handler", async () => {
    const socket = await channel();
    const started = Date.now();
    socket.send("arm:35:late");
    socket.send("orphan:5:early");
    expect(await socket.until(4)).to.deep.equal(["armed", "armed", "early", "late"]);
    expect(Date.now() - started, "the 35 ms timer is not early").to.be.at.least(35);
    socket.send("arm:0:zero");
    socket.send("orphan:-5:negative");
    expect(await socket.until(8)).to.deep.equal(["armed", "armed", "early", "late", "armed", "armed", "zero", "negative"]);
    socket.end();
  });

  it("pins the measured errors and cancels stopped and closed timers", async () => {
    const socket = await channel();
    socket.send("idle-stop:0:x");
    socket.send("double:80:first");
    socket.send("stop:0:x");
    expect(await socket.until(4)).to.deep.equal([
      "Timer objects is not active.", "Timer object is already active.", "armed", "stopped",
    ]);
    await sleep(100);
    expect(socket.messages()).to.have.length(4);
    socket.send("double:15:first-survives");
    expect((await socket.until(7)).slice(4)).to.deep.equal([
      "Timer object is already active.", "armed", "first-survives",
    ]);
    socket.send("arm:100:closed");
    await socket.until(8);
    socket.end();
    await sleep(120);
    expect(socket.messages()).to.have.length(8);
  });

  it("cancels a due callback before dispatch on close", async () => {
    await dueBehindLock(async (timers) => timers.close());
  });
  it("cancels a due callback before dispatch on swap", async () => {
    await dueBehindLock(async () => applyRuntimeHotSwap({swap: async () => ({swaps: 1})},
      {generation: "timer-due-next"}, globalThis.abap));
  });
  it("lets STOP_TIMER cancel a due callback before dispatch", async () => {
    await dueBehindLock(async (timers, handler) => {
      await timers.session.manager.if_abap_timer_manager$stop_timer({i_timer_handler: {get: () => handler}});
    });
  });

  it("rearms and stops timers through ABAP callbacks, and arms 1000 ABAP handlers", async () => {
    const socket = await channel();
    socket.send("rearm:0:x");
    expect(await socket.until(3)).to.deep.equal(["armed", "tick", "tick"]);
    socket.send("stop-other:0:x");
    expect((await socket.until(5)).slice(3)).to.deep.equal(["armed", "controller"]);
    await sleep(65);
    expect(socket.messages()).to.have.length(5);
    socket.send("bulk:0:x");
    const messages = await socket.until(1006, 10000);
    expect(messages[5]).to.equal("armed");
    expect(messages.slice(6)).to.have.length(1000);
    expect(messages.slice(6).every((message) => message === "bulk")).to.equal(true);
    socket.end();
  });

  it("runs a timeout under the work-process lock and rolls back only the dumping timeout", async () => {
    const abap = globalThis.abap;
    const db = abap.context.databaseConnections.DEFAULT;
    await db.execute('CREATE TABLE "TIMER_STEP_PROBE" ("ID" INTEGER)');
    const events = [];
    let failed;
    const dump = new Promise((resolve) => { failed = resolve; });
    const timers = apcTimerSession(abap, (work) => work(), failed);
    const manager = timers.session.manager;
    const handler = {if_abap_timer_handler$on_timeout: async () => {
      events.push("timeout start");
      await db.insert({table: "TIMER_STEP_PROBE", columns: ["ID"], values: ["1"]});
      await sleep(25);
      events.push("timeout dump");
      throw new Error("timeout dump");
    }};
    await timers.step(() => manager.if_abap_timer_manager$start_timer({
      i_timer_handler: {get: () => handler}, i_timeout: {get: () => 0},
    }));
    while (events.length === 0) await sleep(1);
    await dialogStep(async () => {
      events.push("next step");
      await db.insert({table: "TIMER_STEP_PROBE", columns: ["ID"], values: ["2"]});
    });
    await dump;
    expect(events).to.deep.equal(["timeout start", "timeout dump", "next step"]);
    expect((await db.select({select: 'SELECT "ID" FROM "TIMER_STEP_PROBE"'})).rows.map((r) => Number(r.ID)))
      .to.deep.equal([2]);
    expect(workProcess()).to.include({held: false, waiting: 0});
    timers.close();
  });

  it("queues a due timer behind its arming callback and holds 1000 handlers", async () => {
    const abap = globalThis.abap;
    const fired = [];
    const timers = apcTimerSession(abap, (work) => work(), (error) => { throw error; });
    const manager = timers.session.manager;
    await timers.step(async () => {
      for (let i = 0; i < 1000; i++) {
        const handler = {if_abap_timer_handler$on_timeout: async () => fired.push(i)};
        await manager.if_abap_timer_manager$start_timer({
          i_timer_handler: {get: () => handler}, i_timeout: {get: () => 0},
        });
      }
      await sleep(30);
      expect(fired, "a due timer cannot enter its arming callback").to.have.length(0);
    });
    const deadline = Date.now() + 5000;
    while (fired.length < 1000 && Date.now() < deadline) await sleep(5);
    expect(fired).to.have.length(1000);
    timers.close();
  });

  it("drops old-generation timers on a hot swap", async () => {
    const timers = apcTimerSession(globalThis.abap, (work) => work(), (error) => { throw error; });
    let fired = false;
    await timers.step(() => timers.session.manager.if_abap_timer_manager$start_timer({
      i_timer_handler: {get: () => ({if_abap_timer_handler$on_timeout: async () => { fired = true; }})},
      i_timeout: {get: () => 25},
    }));
    await applyRuntimeHotSwap({swap: async () => ({swaps: 1})}, {generation: "timer-next"}, globalThis.abap);
    await sleep(40);
    expect(fired).to.equal(false);
    timers.close();
  });
});
