import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {ServingRuntime} from "../tools/osd-runtime.mjs";

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
    const runtime = new ServingRuntime();
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
