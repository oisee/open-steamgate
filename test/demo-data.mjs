// The synthetic taxi facts on every Node host, and the rule that makes them
// the same: ZCL_OSD_DEMO_DATA decides the rows, tools/osd-demo-data.mjs only
// carries OSD_DEMO_ROWS to it. The browser preview is checked in Chromium
// (test/e2e/taxi.preview.spec.mjs), OSGo by tools/gogen's semantics table,
// and the class itself by its ABAP Unit tests.
import {expect} from "chai";
import {fork, spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";

const runtimeFixture = runtimeRootFixture();

// the class's answer for its default size and seed, measured on Node, OSGo
// and A4H (docs/demo-data.md); a host makes it only when the knob asks
const DEFAULT = {rows: 20000, checksum: 163171580};
const SYNTHETIC = "fact_id >= '9000000000'";
const SUMS = `SELECT COUNT(*) AS n, SUM(trips) AS trips FROM zosd_taxifact WHERE ${SYNTHETIC}`;

describe("demo data: ZCL_OSD_DEMO_DATA on every host", function () {
  this.timeout(180000);

  it("the class answers the pinned checksum for the default size and seed", async () => {
    const got = await child(`
      await import(${JSON.stringify(new URL("../output/init.mjs", import.meta.url).href)}).then((m) => m.initializeABAP());
      const {zcl_osd_demo_taxi: k} = await import(${JSON.stringify(new URL("../output/zcl_osd_demo_taxi.clas.mjs", import.meta.url).href)});
      const rows = await k.generate({iv_rows: 20000, iv_seed: k.c_default_seed});
      process.send({n: {rows: rows.array().length, checksum: (await k.checksum({it_facts: rows})).get()}});`);
    expect(got).to.deep.equal(DEFAULT);
  });

  // Until 2026-09-27 every start made DEFAULT.rows synthetic rows (3.8 s of
  // a packaged first start); a year is made on request now (ZOSD_TAXI_SRV).
  // This fails if the start makes them again.
  it("the inline host (test/start.mjs) makes none at start; the sample rows are there", async () => {
    const got = await child(`
      await import(${JSON.stringify(new URL("./start.mjs", import.meta.url).href)});
      const db = globalThis.abap.context.databaseConnections.DEFAULT;
      const s = (await db.select({select: ${JSON.stringify(SUMS)}})).rows[0];
      const real = (await db.select({select: "SELECT COUNT(*) AS n FROM zosd_taxifact WHERE fact_id < '9000000000'"})).rows[0];
      process.send({n: {rows: Number(s.n), real: Number(real.n)}});`, {STG_SERVE: "inline", OSD_DEMO_ROWS: ""});
    expect(got).to.deep.equal({rows: 0, real: 4});
  });

  it("the serving runtime says it made none at start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-demo-data-"));
    try {
      const started = await serve({STG_DB: "file", STG_DB_PATH: join(dir, "osd.sqlite"), OSD_DEMO_ROWS: ""});
      expect(started.said.find((l) => l.startsWith("demo data:"))).to.match(/nothing generated at start/);
      expect(started.rows).to.equal(0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("the knob: OSD_DEMO_ROWS=0 leaves only the sample rows, a number sets the size", async () => {
    const at = (rows) => child(`
      await import(${JSON.stringify(new URL("./start.mjs", import.meta.url).href)});
      const r = (await globalThis.abap.context.databaseConnections.DEFAULT.select({select: "SELECT COUNT(*) AS n FROM zosd_taxifact"})).rows[0];
      process.send({n: Number(r.n)});`, {STG_SERVE: "inline", OSD_DEMO_ROWS: rows});
    expect(await at("0")).to.equal(4);
    expect(await at("250")).to.equal(254);
  });

  it("the serving runtime (tools/osd-serve.mjs, the binary's `osd serve`) makes them, and a second start over the same file writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-demo-data-"));
    try {
      const env = {STG_DB: "file", STG_DB_PATH: join(dir, "osd.sqlite"), OSD_DEMO_ROWS: "3000"};
      const first = await serve(env);
      expect(first.said.find((l) => l.startsWith("demo data:"))).to.match(/3000 synthetic rows .* written/);
      expect(first.rows).to.equal(3000);
      const second = await serve(env);
      expect(second.said.find((l) => l.startsWith("demo data:"))).to.match(/3000 synthetic rows .* unchanged/);
      expect(second.rows).to.equal(3000);
      expect(second.trips).to.equal(first.trips);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

/** tools/osd-serve.mjs on a port of its own: what it said, and the rows */
async function serve(env) {
  const proc = fork("tools/osd-serve.mjs", ["0"], {cwd: runtimeFixture.root, stdio: ["ignore", "ignore", "inherit", "ipc"], env: {...process.env, ...env}});
  const said = [];
  try {
    const port = await new Promise((resolve, reject) => {
      proc.on("message", (m) => {
        if (m?.type === "say") said.push(m.line);
        if (m?.type === "ready") resolve(m.port);
      });
      proc.on("exit", (code) => reject(new Error(`osd-serve exited ${code}`)));
    });
    const answer = await fetch(`http://127.0.0.1:${port}/osd/sql`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({sql: SUMS, max: 1}),
    });
    const body = await answer.json();
    expect(answer.status, JSON.stringify(body)).to.equal(200);
    const row = body.rows[0];
    return {said, rows: Number(row.n ?? row.N), trips: Number(row.trips ?? row.TRIPS)};
  } finally {
    const gone = new Promise((resolve) => proc.on("exit", resolve));
    proc.kill();
    await gone;
  }
}

/** a host in a process of its own: each one installs its own global runtime */
function child(source, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--input-type=module", "-e", `${source}\nprocess.exit(0);`], {
      cwd: runtimeFixture.root,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {...process.env, ...env},
    });
    let got;
    proc.on("message", (m) => {
      got = m.n;
    });
    proc.on("exit", (code) => code === 0 && got !== undefined ? resolve(got) : reject(new Error(`host exited ${code}`)));
  });
}
