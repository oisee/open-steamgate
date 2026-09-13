import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ServingRuntime} from "../tools/osd-runtime.mjs";

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
      expect(first).to.include({generation: 1, started: true});
      expect(runtime.url).to.match(/^http:\/\/127\.0\.0\.1:\d+$/);

      const alive = await get(runtime.url, "/osd/serving");
      expect(JSON.parse(alive.text)).to.include({ready: true, generation: "1"});

      // the real front, not only the health answer
      const metadata = await get(runtime.url, "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata");
      expect(metadata.status).to.equal(200);
      expect(metadata.text).to.contain('Namespace="ZSTG_DEMO_SRV"');

      // starting twice is the same runtime, not a second process
      expect(await runtime.start()).to.include({started: false, generation: 1});
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

      expect(again.generation).to.equal(2);
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

  it("rows written through one runtime survive the next, when they have a file to live in", async () => {
    // a recycle would otherwise eat what a client created: the database here
    // is sql.js, which is memory only, so STG_DB_PATH is what carries it
    const folder = mkdtempSync(join(tmpdir(), "osd-db-"));
    const runtime = new ServingRuntime({env: {STG_DB_PATH: join(folder, "osd.sqlite")}});
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
