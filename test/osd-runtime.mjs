import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
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
        expect(await settles(Promise.all([settles(a), settles(b)]).then(([x, y]) => (x === "settled" && y === "settled" ? undefined : Promise.reject()))), order).to.equal("settled");
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
    // and a stop that arrives while one is still coming up stops it
    const late = new ServingRuntime();
    const coming = late.start();
    await late.stop();
    const first = await coming;
    expect(alive(first.pid), "the child that was coming up is stopped too").to.equal(false);
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
});
