import {expect} from "chai";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {spawn} from "node:child_process";
import {ServingRuntime, liveChildren} from "../tools/osd-runtime.mjs";

// is that process still there?
const alive = (pid) => {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The serving runtime, in a process that can be replaced. This is the half
// that makes an activation true: Node pins a module graph for the life of a
// process, so code becomes live in a new process and nowhere else.
describe("tools/osd-runtime: the process that can be replaced", function () {
  // a runtime boots in about a second and a recycle is two of those
  this.timeout(180000);

  const get = async (url, path) => {
    const answer = await fetch(`${url}${path}`);
    return {status: answer.status, text: await answer.text()};
  };

  it("starts, answers OData, and stops", async () => {
    const runtime = new ServingRuntime();
    try {
      const first = await runtime.start();
      expect(first).to.include({epoch: 1, started: true});
      expect(first.generation, "the generation is the live build's name").to.be.a("string");
      expect(runtime.url).to.match(/^http:\/\/127\.0\.0\.1:\d+$/);

      const alive = await get(runtime.url, "/osd/serving");
      expect(JSON.parse(alive.text)).to.include({ready: true, generation: first.generation});

      // the real front, not only the health answer
      const metadata = await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata");
      expect(metadata.status).to.equal(200);
      expect(metadata.text).to.contain('Namespace="ZSTG_DEMO_SRV"');

      // starting twice is the same runtime, not a second process
      expect(await runtime.start()).to.include({started: false, epoch: 1, generation: first.generation});
    } finally {
      await runtime.stop();
    }
    expect(runtime.running).to.equal(false);
    expect(runtime.url).to.equal(undefined);
  });

  // the debugger on demand: an inspector opened on the running child is
  // opened again on the next one after a recycle, on the same port, which is
  // what a debugger attached with `restart` reconnects to; closed stays closed
  it("an inspector opened on request survives a recycle, and a close survives the next", async () => {
    const {createServer: listen} = await import("node:net");
    const port = await new Promise((resolve) => {
      const probe = listen().listen(0, "127.0.0.1", () => {
        const free = probe.address().port;
        probe.close(() => resolve(free));
      });
    });
    const targets = async () => {
      try {
        return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).length;
      } catch {
        return 0;
      }
    };
    const runtime = new ServingRuntime();
    try {
      await runtime.start();
      expect(await runtime.inspector({open: true, port})).to.include({open: true, port});
      expect(await targets()).to.equal(1);
      const recycled = await runtime.recycle();
      expect(await targets(), "the new process opened it at its start").to.equal(1);
      expect(recycled.pid).to.be.a("number");
      expect(await runtime.inspector({open: false})).to.include({open: false});
      expect(await targets()).to.equal(0);
      await runtime.recycle();
      expect(await targets(), "and a closed inspector stays closed").to.equal(0);
    } finally {
      await runtime.stop();
    }
  });

  // node:inspector's close() blocks the child's event loop until every
  // attached debugger has finished the close handshake, forever for one
  // that never answers it (the CI flake of test/osd-child.mjs). The child
  // never calls it: a close, or a move to another port, is a graceful
  // recycle, and a debugger that never answers changes nothing about that
  const freePort = async () => {
    const {createServer: listen} = await import("node:net");
    return new Promise((resolve) => {
      const probe = listen().listen(0, "127.0.0.1", () => {
        const free = probe.address().port;
        probe.close(() => resolve(free));
      });
    });
  };
  // Round 3's recovery/reopen probes, with readiness released by IPC
  // rather than a boot delay: every follow-up lands after spawn captured env.
  for (const change of ["reopen", "close", "move", "stop"]) {
    it(`reconciles an inspector ${change} requested during replacement boot`, async () => {
      const command = [process.execPath, "--input-type=module", "-e", [
        "import inspector from 'node:inspector';",
        "process.on('message', m => {",
        "  if (m.type === 'release') process.send({type: 'ready', port: 1, pid: process.pid, ms: 0});",
        "  if (m.type === 'quiesce') process.exit(0);",
        "  if (m.type === 'inspector') { inspector.open(m.port, '127.0.0.1'); process.send({type: 'inspector-done', id: m.id, ok: true, open: true, port: m.port}); }",
        "});",
        "process.send({type: 'booting', phase: 'gated'});",
      ].join("\n")];
      const runtime = new ServingRuntime({command});
      const gated = async () => {
        const deadline = Date.now() + 5000;
        while (runtime.booting?.phase !== "gated") {
          if (Date.now() >= deadline) throw new Error("child never reached boot gate");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      };
      let release;
      try {
        const starting = runtime.start();
        await gated();
        runtime.bootingChild.send({type: "release"});
        await starting;
        const one = await freePort();
        const two = await freePort();
        const three = await freePort();
        await runtime.inspector({open: true, port: one});
        await runtime.inspector(change === "reopen" ? {open: false} : {open: true, port: two});
        await gated();
        const desired = change === "close" ? {open: false} : {open: true, port: three};
        expect(await runtime.inspector(desired)).to.include({pending: true});
        if (change === "stop") {
          const recovering = runtime.start().catch((error) => error);
          await runtime.stop();
          expect(await recovering).to.be.an("error");
          expect(runtime.running).to.equal(false);
          expect(runtime.bootingChild).to.equal(undefined);
          return;
        }
        // Release this child and any further replacement needed for a close/move.
        release = setInterval(() => {
          if (runtime.booting?.phase === "gated" && runtime.bootingChild?.connected) {
            runtime.bootingChild.send({type: "release"});
          }
        }, 5);
        await runtime.start();
        expect(runtime.child.osdInspectPort).to.equal(desired.open ? three : undefined);
        if (desired.open) {
          expect((await fetch(`http://127.0.0.1:${three}/json/list`)).status).to.equal(200);
        } else {
          expect(await fetch(`http://127.0.0.1:${two}/json/list`).then(() => true, () => false)).to.equal(false);
        }
      } finally {
        clearInterval(release);
        await runtime.stop();
      }
    });
  }

  // a WebSocket upgrade on the inspector, and then silence: the close frame
  // the inspector sends when it closes is never answered
  const silentDebugger = async (port) => {
    const {connect} = await import("node:net");
    const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const socket = connect({host: "127.0.0.1", port});
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(`GET ${new URL(target.webSocketDebuggerUrl).pathname} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`
      + "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    expect(String(await new Promise((resolve) => socket.once("data", resolve)))).to.match(/^HTTP\/1\.1 101/);
    socket.pause();
    return socket;
  };
  const listening = async (port) => {
    const {connect} = await import("node:net");
    return new Promise((resolve) => {
      const probe = connect({host: "127.0.0.1", port}, () => { probe.destroy(); resolve(true); });
      probe.on("error", () => resolve(false));
    });
  };

  it("a close recycles, with a silent debugger attached; the new child serves without an inspector", async () => {
    const port = await freePort();
    const runtime = new ServingRuntime();
    let socket;
    try {
      const first = await runtime.start();
      expect(await runtime.inspector({open: true, port})).to.include({open: true, port});
      socket = await silentDebugger(port);
      const closed = await runtime.inspector({open: false});
      expect(closed).to.include({open: false, recycled: true, recovering: true});
      // answered once the old child has gone, not after the next has
      // booted: a caller with a deadline polls /osd/ready for that
      expect(runtime.running, "the next child is still coming up").to.equal(false);
      expect(alive(first.pid), "the old child is gone").to.equal(false);
      expect(await listening(port), "nothing listens on the inspector's port").to.equal(false);
      await runtime.start();
      expect(runtime.running, "and a new child serves").to.equal(true);
      expect(await listening(port), "and it was started without an inspector").to.equal(false);
      expect((await fetch(`${runtime.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`)).status).to.equal(200);
      // a close of what is closed recycles nothing
      const pid = runtime.child.pid;
      expect(await runtime.inspector({open: false})).to.deep.equal({open: false, port: undefined, url: undefined});
      expect(runtime.child.pid).to.equal(pid);
    } finally {
      socket?.destroy();
      await runtime.stop();
    }
  });

  it("a move to another port recycles onto it, with a silent debugger on the old one", async () => {
    const one = await freePort();
    const two = await freePort();
    const runtime = new ServingRuntime();
    let socket;
    try {
      await runtime.start();
      expect(await runtime.inspector({open: true, port: one})).to.include({open: true, port: one});
      socket = await silentDebugger(one);
      expect(await runtime.inspector({open: true, port: two})).to.include({open: true, port: two, recycled: true, recovering: true});
      await runtime.start();
      expect(await listening(one), "the old port is closed").to.equal(false);
      const targets = await (await fetch(`http://127.0.0.1:${two}/json/list`)).json();
      expect(targets, "the new child opened the new port at its start").to.have.length(1);
      expect((await fetch(`${runtime.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`)).status).to.equal(200);
      // and the same port again is the in-process no-op, no recycle
      const pid = runtime.child.pid;
      expect(await runtime.inspector({open: true, port: two})).to.include({open: true, port: two});
      expect(runtime.child.pid).to.equal(pid);
    } finally {
      socket?.destroy();
      await runtime.stop();
    }
  });

  it("a committed row survives the close on a path-backed sql.js", async () => {
    // sql.js writes its file only at exit: the close is a quiesce, so the
    // exit-time save runs.
    // STG_DB unset with a path is sql.js (test/setup.mjs); "file" is native
    // SQLite, which writes as it goes, and the suite may have set it
    const folder = mkdtempSync(join(tmpdir(), "osd-db-"));
    const port = await freePort();
    const runtime = new ServingRuntime({database: join(folder, "osd.sqlite"), env: {STG_DB: undefined}});
    let socket;
    try {
      await runtime.start();
      const created = await fetch(`${runtime.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({Project: "ZSTG_MAPPED", TravelId: "T7778", Description: "committed before the close", Status: "O", Seats: 1}),
      });
      expect(created.status, await created.text()).to.be.oneOf([201, 200]);
      expect(await runtime.inspector({open: true, port})).to.include({open: true, port});
      socket = await silentDebugger(port);
      expect(await runtime.inspector({open: false})).to.include({open: false, recycled: true});
      expect(existsSync(join(folder, "osd.sqlite")), "the old child saved on its way out").to.equal(true);
      await runtime.start();
      const read = await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T7778')?$format=json");
      expect(read.status, read.text).to.equal(200);
      expect(read.text).to.contain("committed before the close");
    } finally {
      socket?.destroy();
      await runtime.stop();
      rmSync(folder, {recursive: true, force: true});
    }
  });

  // a wrong supervisor leaves children behind, and a child keeps mocha alive
  // long after the case has failed: whatever is left is killed here
  afterEach(() => {
    for (const child of liveChildren()) child.kill("SIGKILL");
  });

  it("a request during a stop waits for the old process to be gone before a new one", async () => {
    // Found by review of #60: #stopChild forgot the child at once and waited
    // up to ten seconds for it to exit, so an ensure() in that window saw
    // nothing running and started a second process on the same database.
    const runtime = new ServingRuntime();
    // how many serving processes existed at once, sampled while it happens
    let most = 0;
    const sampler = setInterval(() => {
      most = Math.max(most, liveChildren().filter((c) => c.exitCode === null && c.signalCode === null).length);
    }, 2);
    try {
      const first = await runtime.start();
      const stopped = runtime.stop();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await runtime.ensure();
      await stopped;
      expect(second.pid).to.not.equal(first.pid);
      expect(alive(first.pid), "the old process is gone").to.equal(false);
      expect(most, "two serving processes at once").to.equal(1);
    } finally {
      clearInterval(sampler);
      await runtime.stop();
    }
  });

  it("a start during a recycle waits for it, and the recycle's readiness is announced", async () => {
    // Found by review of #60: start() did not wait for a recycle, joined its
    // spawn, and the recycle's announcement was lost -- whenReady() hung.
    const runtime = new ServingRuntime();
    try {
      await runtime.start();
      const recycled = runtime.recycle();
      const started = runtime.start();
      const [r, s] = await Promise.all([recycled, started]);
      expect(s.pid).to.equal(r.pid);
      const ready = await Promise.race([runtime.whenReady(), new Promise((resolve) => setTimeout(() => resolve("HANGS"), 5000))]);
      expect(ready).to.not.equal("HANGS");
      expect(ready.pid).to.equal(r.pid);
    } finally {
      await runtime.stop();
    }
  });

  // within a bound: the failure these guard against is a promise that never
  // settles, and a case that hangs reports nothing
  const settles = (promise, ms = 30000) => Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("HANGS"), ms)),
  ]);
  const serving = () => liveChildren().filter((c) => c.exitCode === null && c.signalCode === null).length;

  it("a stop during a recycle, and a recycle during a stop, both settle and leave nothing running", async () => {
    // Found by review of #60: stop() awaited the recycle and the recycle
    // awaited the stop, so `recycle(); stop();` never settled, and every
    // start() and ensure() after it waited behind them.
    for (const order of ["recycle, stop", "stop, recycle"]) {
      const runtime = new ServingRuntime();
      try {
        await runtime.start();
        const [a, b] = order === "recycle, stop"
          ? [runtime.recycle(), runtime.stop()]
          : [runtime.stop(), runtime.recycle()];
        expect([await settles(a), await settles(b)], order).to.deep.equal(["settled", "settled"]);
        expect(serving(), `${order}: a process left running`).to.equal(0);
        expect(runtime.running, order).to.equal(false);
        // and the runtime is usable afterwards, not wedged behind them
        expect(await settles(runtime.ensure()), `${order}: ensure after`).to.equal("settled");
        expect(serving(), order).to.equal(1);
      } finally {
        await settles(runtime.stop());
      }
    }
  });

  it("requests joining a start that fails do not leave an unhandled rejection", async () => {
    // Found by review of #60: a joined spawn attached `.then(undefined,
    // undefined)`, a derived promise nobody caught, and a child that died
    // before "ready" became an unhandled rejection -- which ends a process.
    const unhandled = [];
    const trap = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", trap);
    const runtime = new ServingRuntime();
    runtime.command = [process.execPath, "-e", "process.exit(3)"];
    try {
      const answers = await Promise.allSettled([runtime.ensure(), runtime.ensure(), runtime.start()]);
      expect(answers.map((a) => a.status)).to.deep.equal(["rejected", "rejected", "rejected"]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled.map(String)).to.deep.equal([]);
    } finally {
      process.off("unhandledRejection", trap);
      await settles(runtime.stop());
    }
  });

  it("a start and the requests that arrive while it comes up are one process", async () => {
    // Found by the image's DuckDB check: the facade starts the runtime at
    // listen, an OData request or the status refresh calls ensure() before
    // the child has said "ready", and a second child opened the same
    // database. DuckDB does not survive two writers, and the file could not
    // be opened on the next start.
    const runtime = new ServingRuntime();
    try {
      const answers = await Promise.all([runtime.start(), runtime.ensure(), runtime.ensure(), runtime.start()]);
      expect(new Set(answers.map((a) => a.pid)).size, "one process").to.equal(1);
      expect(answers.map((a) => a.epoch)).to.deep.equal([1, 1, 1, 1]);
      expect(runtime.epoch).to.equal(1);
    } finally {
      await runtime.stop();
    }
    // and a stop that arrives while one is still coming up stops it -- at
    // once, rather than after its boot (minutes on a remote HANA): the start
    // hears "stopped while starting" and no child is left
    const late = new ServingRuntime();
    const coming = late.start().catch((e) => e);
    await late.stop();
    const first = await coming;
    if (first instanceof Error) {
      expect(first.message).to.equal("stopped while starting");
    } else {
      expect(alive(first.pid), "the child that was coming up is stopped too").to.equal(false);
    }
    expect(liveChildren().filter((c) => c.exitCode === null && c.signalCode === null), "no child is left").to.have.lengthOf(0);
  });

  it("a recycle is a new process, and the old one is gone", async () => {
    const runtime = new ServingRuntime();
    try {
      const first = await runtime.start();
      const before = first.port;
      const again = await runtime.recycle();

      expect(again.epoch, "a new process; the same code, so the same generation").to.equal(2);
      expect(again.generation).to.equal(first.generation);
      expect(again.pid).to.not.equal(first.pid);
      expect(again.ms, "a recycle is about a second, not a minute").to.be.lessThan(30000);

      // the new one answers
      expect((await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata")).status).to.equal(200);
      // and the old one does not, which is what makes the code change real
      let reached = true;
      try {
        await fetch(`http://127.0.0.1:${before}/osd/serving`);
      } catch {
        reached = false;
      }
      expect(reached, "the replaced runtime is still answering").to.equal(false);
    } finally {
      await runtime.stop();
    }
  });

  it("changed modules are live after a recycle, and not before it", async () => {
    // the point of the whole exercise, so it is asserted rather than
    // described: a transpile writes output/, and only a new process reads it
    const module = "output/zcl_zstg_demo_mpc.clas.mjs";
    const before = readFileSync(module, "utf8");
    const name = async (url) => (/Name="([A-Za-z]*ancelTravel)"/.exec((await get(url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata")).text) ?? [])[1];
    const runtime = new ServingRuntime();
    try {
      await runtime.start();
      expect(await name(runtime.url)).to.equal("CancelTravel");

      // what a transpile after an activation would have written. The name
      // stays twelve characters because the field is twelve characters, and
      // a longer one would come back truncated and look unchanged.
      writeFileSync(module, before.replace("'CancelTravel'", "'XancelTravel'"));
      expect(await name(runtime.url), "the running process must not see it").to.equal("CancelTravel");

      await runtime.recycle();
      expect(await name(runtime.url), "the new process must see it").to.equal("XancelTravel");
    } finally {
      writeFileSync(module, before);
      await runtime.stop();
    }
  });

  it("every answer names its generation, and the registry knows the process", async () => {
    const {instances} = await import("../tools/osd-runtime.mjs");
    const runtime = new ServingRuntime();
    try {
      const first = await runtime.start();
      const answer = await fetch(`${first.url}/osd/serving`);
      expect(answer.headers.get("x-osd-generation"), "the child names the generation it was started with").to.equal(first.generation);
      expect(first.generation, "a name, not a counter, when there is a live build").to.match(/^[0-9a-f]{16}$|^\d+$/);
      const mine = instances(process.cwd()).filter((e) => e.pid === first.pid);
      expect(mine.length, "registered while running").to.equal(1);
      expect(mine[0]).to.include({port: first.port, generation: first.generation, alive: true});
      await runtime.stop();
      expect(instances(process.cwd()).some((e) => e.pid === first.pid), "gone from the registry once stopped").to.equal(false);
    } finally {
      await runtime.stop();
    }
  });

  it("a supervisor that goes away takes its runtime with it", async () => {
    // found by vsp rather than by anything of ours: eight serving processes
    // reparented to init, one per run, 1.6 GB across three hours. A recycle
    // killed the child it replaced and nothing killed the last one.
    const runner = spawn(process.execPath, ["--input-type=module", "-e", `
      const {ServingRuntime} = await import("${join(process.cwd(), "tools", "osd-runtime.mjs")}");
      const runtime = new ServingRuntime();
      const up = await runtime.start();
      console.log("pid " + up.pid);
      setTimeout(() => undefined, 60000);
    `], {cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"]});

    let pid;
    runner.stdout.on("data", (d) => {
      const found = /pid (\d+)/.exec(d.toString());
      if (found !== null) {
        pid = Number(found[1]);
      }
    });
    for (let waited = 0; pid === undefined && waited < 60000; waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(pid, "the supervisor never reported a child").to.not.equal(undefined);
    expect(alive(pid), "the child should be running").to.equal(true);

    runner.kill("SIGTERM");
    for (let waited = 0; alive(pid) && waited < 10000; waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(alive(pid), "the child outlived the supervisor").to.equal(false);
  });

  it("a runtime that died is not a runtime that is ready", async () => {
    // found by open-steamgate reviewing the seam before wiring it: a stale
    // readiness is a success report for work that is not happening, which
    // is the same shape as the two false greens we closed today
    const runtime = new ServingRuntime();
    try {
      const first = await runtime.start();
      process.kill(first.pid, "SIGKILL");
      await new Promise((resolve) => runtime.child?.once("exit", resolve) ?? resolve());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(runtime.running).to.equal(false);
      expect(runtime.url).to.equal(undefined);
      expect(runtime.died).to.include({signal: "SIGKILL", epoch: 1});

      let resolved;
      await runtime.whenReady().then((a) => {
        resolved = a;
      }, (e) => {
        resolved = e.code;
      });
      expect(resolved, "a dead runtime must not hand out its old address").to.equal("NOT_SERVING");

      // and a proxy that only wants something serving gets it, with a
      // generation that says a crash happened rather than hiding it
      const back = await runtime.ensure();
      expect(back.epoch, "a new process after the crash; the code did not change").to.equal(2);
      expect((await get(runtime.url, "/osd/serving")).status).to.equal(200);
      expect(runtime.died).to.equal(undefined);
    } finally {
      await runtime.stop();
    }
  });

  it("a recycle that cannot come up says so, and then says nothing is serving", async () => {
    const runtime = new ServingRuntime();
    try {
      await runtime.start();
      // the next process will not exist, which is what a broken transpile
      // would look like from here
      runtime.command = [process.execPath, "/nonexistent-osd-serve.mjs"];
      let failed;
      try {
        await runtime.recycle();
      } catch (error) {
        failed = error;
      }
      expect(failed?.code).to.equal("NOT_SERVING");

      // not the old error for ever after, and not a stale address either
      let second;
      await runtime.whenReady().then(() => {
        second = "resolved";
      }, (e) => {
        second = e.code;
      });
      expect(second).to.equal("NOT_SERVING");
    } finally {
      await runtime.stop();
    }
  });

  it("an instance is a tree, a port and a database, and two of them do not collide", async () => {
    // flagged by vsp: a branch under test is its own instance, so nothing
    // here may assume there is one of them
    const folder = mkdtempSync(join(tmpdir(), "osd-two-"));
    const one = new ServingRuntime({database: join(folder, "one.sqlite")});
    const two = new ServingRuntime({database: join(folder, "two.sqlite")});
    try {
      await one.start();
      await two.start();
      expect(one.port).to.not.equal(two.port);

      const first = JSON.parse((await get(one.url, "/osd/serving")).text);
      const second = JSON.parse((await get(two.url, "/osd/serving")).text);
      expect(first.database).to.not.equal(second.database);
      expect(first.root).to.equal(second.root);

      // a row in one instance is not a row in the other
      await fetch(`${one.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({Project: "ZSTG_MAPPED", TravelId: "T7779", Description: "only in the first instance", Status: "O", Seats: 1}),
      });
      expect((await get(one.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T7779')?$format=json")).status).to.equal(200);
      expect((await get(two.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T7779')?$format=json")).status).to.equal(404);
    } finally {
      await one.stop();
      await two.stop();
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it("rows written through one runtime survive the next, when they have a file to live in", async () => {
    // a recycle would otherwise eat what a client created: the database here
    // is sql.js, which is memory only, so STG_DB_PATH is what carries it
    const folder = mkdtempSync(join(tmpdir(), "osd-db-"));
    const runtime = new ServingRuntime({database: join(folder, "osd.sqlite")});
    const body = JSON.stringify({Project: "ZSTG_MAPPED", TravelId: "T7777", Description: "written before a recycle", Status: "O", Seats: 2});
    try {
      await runtime.start();
      const created = await fetch(`${runtime.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body,
      });
      expect(created.status, await created.text()).to.be.oneOf([201, 200]);

      await runtime.recycle();

      const read = await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T7777')?$format=json");
      expect(read.status, read.text).to.equal(200);
      expect(read.text).to.contain("written before a recycle");
    } finally {
      await runtime.stop();
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it("without a file the database is still in memory, so a recycle starts clean", async () => {
    // The host defaults to a file backend; this case explicitly asks for
    // memory so it stays true even when the parent suite uses STG_DB=file.
    const runtime = new ServingRuntime({env: {STG_DB: "sqlite", STG_DB_PATH: ""}});
    try {
      await runtime.start();
      await fetch(`${runtime.url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({Project: "ZSTG_MAPPED", TravelId: "T7778", Description: "gone with the process", Status: "O", Seats: 1}),
      });
      await runtime.recycle();
      const read = await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T7778')?$format=json");
      expect(read.status, "an in-memory database does not carry a row across a recycle").to.equal(404);
    } finally {
      await runtime.stop();
    }
  });

  // docs/debugging-abap.md: the child runs the transpiled ABAP, the
  // supervisor (this process, or the façade in test/start.mjs) never does,
  // so OSD_INSPECT must reach only the child's NODE_OPTIONS -- read from
  // process.env, the way `OSD_INSPECT=9229 npm start` sets it for the whole
  // invocation, not from ServingRuntime's own `env` option (which is the
  // child's env already, not this process's).
  it("OSD_INSPECT opens the V8 inspector on the child, not on this process", async () => {
    const inspectPort = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const {port} = probe.address();
        probe.close(() => resolve(port));
      });
    });
    const before = process.env.NODE_OPTIONS;
    process.env.OSD_INSPECT = String(inspectPort);
    const runtime = new ServingRuntime({env: {STG_DB: "sqlite", STG_DB_PATH: ""}});
    try {
      await runtime.start();
      const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json();
      expect(list, "the child's own inspector answers").to.have.lengthOf.at.least(1);
      expect(list[0].url).to.contain("osd-serve.mjs");
      // this process asked the child to open an inspector; its own
      // NODE_OPTIONS is untouched, because #spawnOne only ever builds an
      // env object for the child -- it never writes back to process.env
      expect(process.env.NODE_OPTIONS).to.equal(before);
    } finally {
      delete process.env.OSD_INSPECT;
      await runtime.stop();
    }
  });
});

describe("tools/osd-inspector: one request, one answer, loopback only", function () {
  const fakeInspector = () => {
    let url;
    const calls = [];
    return {
      calls,
      url: () => url,
      open(port, host) { calls.push(["open", port, host]); url = `ws://${host}:${port}/x`; },
      close() { calls.push(["close"]); url = undefined; },
    };
  };

  it("opens on 127.0.0.1; refuses to move or close, another host and a bad port", async () => {
    const {inspectorRequest} = await import("../tools/osd-inspector.mjs");
    const inspector = fakeInspector();
    expect(inspectorRequest({id: 1, open: true, port: 9300}, inspector))
      .to.deep.equal({type: "inspector-done", id: 1, ok: true, open: true, url: "ws://127.0.0.1:9300/x", port: 9300});
    // the same port again opens nothing twice
    inspectorRequest({id: 2, open: true, port: 9300}, inspector);
    expect(inspector.calls).to.deep.equal([["open", 9300, "127.0.0.1"]]);
    // moving and closing would call close(), which blocks the process until
    // every debugger lets go: refused, the runtime recycles instead
    expect(inspectorRequest({id: 3, open: true, port: 9301}, inspector).error).to.match(/moving it to 9301 is a recycle/);
    expect(inspectorRequest({id: 4, open: false}, inspector)).to.include({ok: false});
    expect(inspector.calls, "close() is never called").to.deep.equal([["open", 9300, "127.0.0.1"]]);
    expect(inspector.url()).to.equal("ws://127.0.0.1:9300/x");
    expect(inspectorRequest({id: 5, open: true, port: 9300, host: "0.0.0.0"}, inspector))
      .to.include({ok: false, error: "the inspector listens on 127.0.0.1 only, not 0.0.0.0"});
    expect(inspectorRequest({id: 6, open: true, port: 0}, inspector)).to.include({ok: false});
    expect(inspectorRequest({id: 7, open: true, port: 9300}, undefined).error).to.match(/no V8 inspector/);
  });

  it("OSD_INSPECT: 1 is 9229, a number is that port, the rest is off", async () => {
    const {inspectPortOf} = await import("../tools/osd-inspector.mjs");
    expect(inspectPortOf("1")).to.equal(9229);
    expect(inspectPortOf("true")).to.equal(9229);
    expect(inspectPortOf("9333")).to.equal(9333);
    for (const off of [undefined, "", "0", "false", "x", "70000"]) expect(inspectPortOf(off), String(off)).to.equal(undefined);
  });

  it("a pool of several work processes refuses to open one inspector", async () => {
    const {RuntimePool} = await import("../tools/osd-pool.mjs");
    const pool = new RuntimePool({size: 2});
    let error;
    try {
      await pool.inspector({open: true, port: 9300});
    } catch (e) {
      error = e;
    }
    expect(String(error?.message)).to.match(/needs one work process, and this system runs 2/);
  });
});

// A boot on a remote HANA takes minutes; the supervisor used to SIGKILL a
// child that had not said "ready" within 60 s, and the next request started
// it again from the top (dell, 2026-09-27: 14 restarts in 900 s). The limit
// is now on silence: a child that keeps saying it is booting (osd-serve sends
// "booting" every 5 s) is waited for, up to an overall boot deadline.
describe("tools/osd-runtime: a slow boot is waited for, a silent one is not", function () {
  this.timeout(30000);
  let dir;
  // a stand-in for tools/osd-serve.mjs: talks every 200 ms if TALK=1, says
  // "ready" after BOOT_MS (never, if unset), then stays up quietly
  const fake = () => {
    dir = mkdtempSync(join(tmpdir(), "osd-boot-"));
    const file = join(dir, "serve.mjs");
    writeFileSync(file, [
      "const talk = process.env.TALK === '1' ? setInterval(() => process.send({type: 'booting', phase: 'seeding over the network'}), 200) : undefined;",
      "if (process.env.BOOT_MS) setTimeout(() => { clearInterval(talk); process.send({type: 'ready', port: 1, pid: process.pid, ms: 0}); "
        + "setTimeout(() => process.send({type: 'say', line: 'runtime error: after ready'}), 300); }, Number(process.env.BOOT_MS));",
      "setInterval(() => {}, 1000);",
      // asked to go (a stop's quiesce): go
      "process.on('message', (m) => { if (m?.type === 'quiesce') process.exit(0); });",
      // DB=<ms>: in the database step, which a SIGTERM waits out (tools/osd-boot-guard.mjs)
      "if (process.env.DB) { setInterval(() => process.send({type: 'booting', phase: 'opening the database', database: true}), 200); "
        + "process.on('SIGTERM', () => setTimeout(() => process.exit(0), Number(process.env.DB))); }",
    ].join("\n"));
    return [process.execPath, file];
  };
  afterEach(() => {
    for (const child of liveChildren()) child.kill("SIGKILL");
    if (dir) rmSync(dir, {recursive: true, force: true});
  });

  // a close is a quiesce: a child still busy in a step is given the normal
  // grace to finish it, and leaves by itself; it is not killed early
  it("a close quiesces a busy child with the normal grace, and does not kill it", async () => {
    const command = fake();
    writeFileSync(command[1], [
      "process.send({type: 'ready', port: 1, pid: process.pid, ms: 0});",
      "setInterval(() => {}, 1000);",
      "process.on('message', (m) => { if (m?.type === 'inspector') process.send({type: 'inspector-done', id: m.id, ok: true, open: true, port: m.port}); });",
      // busy: the step in flight ends 1.5 s after the quiesce, then it goes
      "process.on('message', (m) => { if (m?.type === 'quiesce') setTimeout(() => process.exit(0), 1500); });",
    ].join("\n"));
    const runtime = new ServingRuntime({command, grace: 2000});
    try {
      await runtime.start();
      expect(await runtime.inspector({open: true, port: 9399})).to.include({open: true, port: 9399});
      const child = runtime.child;
      const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({code, signal})));
      const began = Date.now();
      expect(await runtime.inspector({open: false})).to.include({open: false, recycled: true});
      expect(Date.now() - began, "the step was waited for").to.be.at.least(1400);
      expect(await exited, "it left by itself").to.deep.equal({code: 0, signal: null});
    } finally {
      await runtime.stop();
    }
  });

  it("a boot longer than the silence limit, that keeps talking, starts", async () => {
    const runtime = new ServingRuntime({command: fake(), timeout: 2500, bootTimeout: 20000, env: {TALK: "1", BOOT_MS: "6000"}});
    try {
      const starting = runtime.start();
      await new Promise((r) => setTimeout(r, 1000));
      // meanwhile a proxy or /osd/serving can say what it is doing
      expect(runtime.booting?.phase).to.equal("seeding over the network");
      // and when it last said anything, which is what a publish waiting for
      // it waits on (ObjectStore#bounded), not a fixed limit
      expect(Date.now() - runtime.booting.heard, "last heard").to.be.below(1000);
      const answer = await starting;
      expect(runtime.booting, "not booting once ready").to.equal(undefined);
      expect(answer).to.include({started: true});
      expect(runtime.running).to.equal(true);
      // and once serving, quiet is not hung: the silence limit was the boot's
      // it said one line after ready and then nothing for longer than the
      // silence limit: a serving child is not a booting one
      await new Promise((r) => setTimeout(r, 3500));
      expect(runtime.running, "not killed for being quiet after ready").to.equal(true);
    } finally {
      await runtime.stop();
    }
  });

  it("stop() while booting asks the child to go instead of waiting out its boot", async () => {
    const runtime = new ServingRuntime({command: fake(), timeout: 2500, bootTimeout: 20000, env: {TALK: "1"}});
    const starting = runtime.start().catch((e) => e);
    await new Promise((r) => setTimeout(r, 800));
    const before = Date.now();
    await runtime.stop();
    expect(Date.now() - before, "not the boot limit").to.be.lessThan(5000);
    expect(await starting).to.be.an("error");
    expect(runtime.booting).to.equal(undefined);
  });

  it("stop() in the database step lets the child finish it: no SIGKILL at grace + 8 s", async function () {
    this.timeout(40000);
    const runtime = new ServingRuntime({command: fake(), timeout: 5000, bootTimeout: 60000, grace: 0, env: {DB: "10000"}});
    const starting = runtime.start().catch((e) => e);
    await new Promise((r) => setTimeout(r, 800));
    const [child] = liveChildren();
    expect(runtime.booting?.database, "the supervisor knows").to.equal(true);
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({code, signal})));
    await runtime.stop();
    expect(await exited, "ended by itself after the step, not killed").to.deep.equal({code: 0, signal: null});
    expect(await starting).to.be.an("error");
  });

  it("a child that says nothing is given up on after the silence limit", async () => {
    const runtime = new ServingRuntime({command: fake(), timeout: 800, bootTimeout: 10000, env: {TALK: "0"}});
    const started = Date.now();
    let error;
    try {
      await runtime.start();
    } catch (e) {
      error = e;
    }
    expect(String(error?.message)).to.match(/said nothing for 800 ms while starting/);
    expect(Date.now() - started).to.be.lessThan(5000);
  });

  it("a child that talks but never gets ready hits the boot deadline", async () => {
    const runtime = new ServingRuntime({command: fake(), timeout: 800, bootTimeout: 2000, env: {TALK: "1"}});
    let error;
    try {
      await runtime.start();
    } catch (e) {
      error = e;
    }
    expect(String(error?.message)).to.match(/did not start within 2000 ms \(last: seeding over the network\)/);
  });
});

describe("tools/osd-proxy: a request during a long boot is answered 'starting', not held", function () {
  it("503 STG/STARTING with Retry-After and the step, while the boot goes on", async () => {
    const {odataProxy} = await import("../tools/osd-proxy.mjs");
    let finish;
    const runtime = {
      ensure: () => new Promise((resolve) => { finish = resolve; }),
      booting: {phase: "seeding the cross-reference", since: Date.now() - 42000},
    };
    const sent = {headers: {}};
    const res = {
      headersSent: false,
      status(code) { sent.status = code; return this; },
      set(name, value) { sent.headers[name] = value; return this; },
      type() { return this; },
      send(body) { sent.body = JSON.parse(body); return this; },
    };
    await odataProxy(runtime, {startingWaitMs: 100})({originalUrl: "/sap/opu/odata/sap/X/", method: "GET", headers: {}}, res);
    expect(sent.status).to.equal(503);
    expect(sent.headers["Retry-After"]).to.equal("5");
    expect(sent.body.error.code).to.equal("STG/STARTING");
    expect(sent.body).to.include({starting: true, phase: "seeding the cross-reference", seconds: 42});
    finish();
  });
});

describe("tools/osd-proxy: startingAnswer, the one shape of 'not yet'", function () {
  it("names the step and its seconds while booting, 'recycling' during a recycle", async () => {
    const {startingAnswer} = await import("../tools/osd-proxy.mjs");
    expect(startingAnswer({booting: {phase: "demo data", since: Date.now() - 3000, last: "x"}}))
      .to.deep.equal({ready: false, starting: true, phase: "demo data", seconds: 3, last: "x"});
    expect(startingAnswer({recycling: Promise.resolve()})).to.include({ready: false, starting: true, phase: "recycling"});
    expect(startingAnswer({})).to.include({phase: "starting"});
  });

  it("a pool is booting when one of its runtimes is", async () => {
    const {RuntimePool} = await import("../tools/osd-pool.mjs");
    const pool = new RuntimePool({size: 2});
    expect(pool.booting).to.equal(undefined);
    pool.runtimes[1].booting = {phase: "seeding", since: Date.now()};
    expect(pool.booting).to.include({phase: "seeding"});
  });
});

// A boot can be stopped now, and a sql.js file database is written on a
// stop: before its seed is complete that would put a half-built database
// over the last good file. So nothing is written until the file is stamped
// (or was read whole).
describe("tools/osd-persist: a half-built database is not saved on a stop", function () {
  this.timeout(20000);
  it("saves nothing before the stamp, and saves after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-persist-seeded-"));
    const file = join(dir, "osd.sqlite");
    try {
      const script = [
        `const {saveWhenAsked, stamp} = await import(${JSON.stringify(new URL("../tools/osd-persist.mjs", import.meta.url).href)});`,
        "const {existsSync} = await import('node:fs');",
        "const db = {export: () => new Uint8Array([1, 2, 3]), execute: async () => undefined};",
        "const once = saveWhenAsked(db);",
        "once();",
        `const before = existsSync(${JSON.stringify(file)});`,
        "await stamp(db, 'CREATE TABLE t (a INT);');",
        "once();",
        `console.log(JSON.stringify({before, after: existsSync(${JSON.stringify(file)})}));`,
        "process.exit(0);",
      ].join("\n");
      const out = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {env: {...process.env, STG_DB: "file", STG_DB_PATH: file}});
        let text = "";
        child.stdout.on("data", (d) => { text += d; });
        child.stderr.on("data", (d) => { text += d; });
        child.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(text))));
      });
      expect(JSON.parse(out.trim().split("\n").at(-1))).to.deep.equal({before: false, after: true});
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// the child's side: a stop during the boot goes at once, except in the
// database step, where it is honoured when the step ends
describe("tools/osd-boot-guard: a stop waits out the database step only", function () {
  const setup = async () => {
    const {EventEmitter} = await import("node:events");
    const {bootGuard} = await import("../tools/osd-boot-guard.mjs");
    const proc = new EventEmitter();
    const exits = [];
    const guard = bootGuard({proc, exit: (code) => exits.push(code)});
    return {proc, exits, guard};
  };

  it("outside the step: SIGTERM, SIGINT, SIGHUP and quiesce each go at once", async () => {
    for (const ask of ["SIGTERM", "SIGINT", "SIGHUP", "quiesce"]) {
      const {proc, exits} = await setup();
      if (ask === "quiesce") proc.emit("message", {type: "quiesce"});
      else proc.emit(ask);
      expect(exits, ask).to.deep.equal([0]);
    }
  });

  it("inside the step: deferred to its end, also when the step throws", async () => {
    const {proc, exits, guard} = await setup();
    let finish;
    const step = guard.databaseStep(() => new Promise((resolve) => { finish = resolve; }));
    expect(guard.inDatabaseStep).to.equal(true);
    proc.emit("SIGTERM");
    proc.emit("message", {type: "quiesce"});
    expect(exits, "not in the middle of the seed").to.deep.equal([]);
    finish("done");
    expect(await step).to.equal("done");
    expect(guard.inDatabaseStep).to.equal(false);
    expect(exits).to.deep.equal([0]);

    const second = await setup();
    const failing = second.guard.databaseStep(async () => {
      second.proc.emit("SIGINT");
      throw new Error("seed failed");
    });
    let error;
    try { await failing; } catch (e) { error = e; }
    expect(String(error?.message)).to.equal("seed failed");
    expect(second.exits).to.deep.equal([0]);
  });

  it("a step nobody stopped does not exit; serving() hands the signals back", async () => {
    const {proc, exits, guard} = await setup();
    await guard.databaseStep(async () => undefined);
    expect(exits).to.deep.equal([]);
    guard.serving();
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "message"]) {
      expect(proc.listenerCount(signal), signal).to.equal(0);
    }
  });
});
