import {expect} from "chai";
import {execFileSync, fork, spawn} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import initSqlJs from "sql.js";
import {TABLES, WIDTHS, applyRows, cacheKey, insertStatements, overlong, rows} from "../tools/osd-xref-seed.mjs";

// The cross-reference is filled on every host, by one module
// (tools/osd-xref-seed.mjs). Each host is started here the way it starts
// for real, in a process of its own, and asked for its WBCROSSGT: a host
// that stops calling the module answers 0 and fails its case.
//
// Before this, the tables were filled only by a person running
// `osd-xref.mjs --write` into git-ignored seed files, so such a file left in
// data/ would fill the table whatever the hosts do and hide exactly the
// defect these cases exist for. It is refused rather than tolerated.
describe("tools/osd-xref-seed: the cross-reference on every host", function () {
  this.timeout(300000);

  // **What every host must end with is what the files say now, uncached.**
  // A bound like "> 500" let a stale cache pass every case here: the rows of
  // the tree before `transpile` (no gen/) are still well over 500, and the
  // preview was compared with a file written from that same cache. So the
  // expected number is a parse of its own, with no cache in the way.
  let expected;
  before(async function () {
    for (const table of TABLES) {
      const file = `data/${table.toLowerCase()}.tabu.json`;
      expect(existsSync(file), `${file} is a leftover of osd-xref --write; delete it, every host seeds the table now`).to.equal(false);
    }
    const fresh = await rows(process.cwd(), {cache: false});
    expected = fresh.WBCROSSGT.length - overlong(fresh).filter((o) => o.table === "WBCROSSGT").length;
    expect(expected).to.be.greaterThan(500);
  });

  const count = (answer) => Number(Object.values(answer.rows?.[0] ?? answer[0] ?? {})[0] ?? 0);

  it("the widths it pads to are the ones the DDIC says", () => {
    for (const table of TABLES) {
      const xml = readFileSync(`src/osd/ddic/${table.toLowerCase()}.tabl.xml`, "utf8");
      // client-independent, as on a system: no MANDT, so no client column
      expect(xml, table).to.not.contain("<ROLLNAME>MANDT</ROLLNAME>");
      const fields = [...xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)].map((m) => [
        /<FIELDNAME>([^<]+)</.exec(m[1])[1],
        Number(/<LENG>0*(\d+)</.exec(m[1])[1]),
      ]);
      expect(Object.fromEntries(fields), table).to.deep.equal(WIDTHS[table]);
    }
  });

  it("applying twice leaves the rows of one application", async () => {
    // the two methods of the DatabaseClient that applyRows and this case use,
    // over sql.js, so the case needs no runtime of its own
    const sql = new (await initSqlJs()).Database();
    const db = fakeClient(sql);
    for (const table of TABLES) {
      const columns = Object.keys(WIDTHS[table]).map((c) => `"${c.toLowerCase()}" TEXT`).join(", ");
      await db.execute(`CREATE TABLE "${table.toLowerCase()}" (${columns});`);
    }
    const rows = {
      CROSS: [{TYPE: "F", NAME: "Z_FM", INCLUDE: "ZCL_A"}],
      WBCROSSGT: [{OTYPE: "TY", NAME: "ZCL_B", INCLUDE: "ZCL_A"}, {OTYPE: "TY", NAME: "ZIF_C", INCLUDE: "ZCL_A"}],
      WBCROSSGTX: [],
      D010INC: [{MASTER: "ZCL_A", INCLUDE: "ZCL_A TESTCLASSES", OBSOLETE_IN_VERSION: "0000"}],
    };
    await applyRows(db, rows);
    await applyRows(db, rows);
    for (const table of TABLES) {
      expect(count(await db.select({select: `SELECT COUNT(*) FROM "${table.toLowerCase()}"`})), table).to.equal(rows[table].length);
    }
    // padded the way the runtime stores a CHAR, so an ABAP read of it matches
    const [row] = (await db.select({select: `SELECT "name" FROM "cross"`})).rows;
    expect(Object.values(row)[0]).to.equal("Z_FM".padEnd(30, " "));
    // and a quote in a name is data, not SQL
    expect(insertStatements({CROSS: [{TYPE: "P", NAME: "O'X", INCLUDE: "Y"}]}).join("")).to.contain("'O''X");

    // **All or nothing.** An INSERT that fails after the DELETEs leaves the
    // previous rows, not four tables half-filled
    db.failOn = "BOOM";
    const broken = {...rows, WBCROSSGT: [{OTYPE: "TY", NAME: "BOOM", INCLUDE: "ZCL_A"}]};
    let failed = false;
    try {
      await applyRows(db, broken);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    for (const table of TABLES) {
      expect(count(await db.select({select: `SELECT COUNT(*) FROM "${table.toLowerCase()}"`})), `${table} after a failed apply`).to.equal(rows[table].length);
    }
    db.failOn = undefined;

    // a value longer than its column is left out and named, never cut into
    // another name
    const long = {...rows, CROSS: [...rows.CROSS, {TYPE: "P", NAME: "Z".repeat(31), INCLUDE: "ZCL_A"}]};
    const applied = await applyRows(db, long);
    expect(applied.CROSS).to.equal(1);
    expect(applied.refused.map((o) => `${o.table}.${o.column}`)).to.deep.equal(["CROSS.NAME"]);
    expect(count(await db.select({select: `SELECT COUNT(*) FROM "cross"`}))).to.equal(1);
  });

  it("the cache is per generation: a new object in gen/ is a new key and new rows", async function () {
    const root = process.cwd();
    const before = await cacheKey(root);
    expect(before).to.be.a("string");
    await rows(root);
    // an object only a generator would write, referring to one of ours
    const dir = "gen/xref-seed-probe";
    mkdirSync(dir, {recursive: true});
    try {
      writeFileSync(`${dir}/zcl_osd_xref_probe.clas.abap`, [
        "CLASS zcl_osd_xref_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.",
        "  PUBLIC SECTION.",
        "    DATA mo_source TYPE REF TO zif_stg_cds_source.",
        "ENDCLASS.",
        "CLASS zcl_osd_xref_probe IMPLEMENTATION.",
        "ENDCLASS.", ""].join("\n"));
      writeFileSync(`${dir}/zcl_osd_xref_probe.clas.xml`, readFileSync("src/amdp/zcl_osd_amdp_demo.clas.xml", "utf8")
        .replace("ZCL_OSD_AMDP_DEMO", "ZCL_OSD_XREF_PROBE"));
      const after = await cacheKey(root);
      expect(after, "gen/ changed and the key did not").to.not.equal(before);
      const probed = await rows(root);
      expect(probed.WBCROSSGT.filter((r) => r.INCLUDE === "ZCL_OSD_XREF_PROBE").map((r) => r.NAME)).to.include("ZIF_STG_CDS_SOURCE");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
    expect(await cacheKey(root)).to.equal(before);
    // and a cache file that is not four tables of rows is a miss, not an
    // answer: `{}` used to empty all four tables
    mkdirSync("build/xref", {recursive: true});
    writeFileSync(`build/xref/${before}.json`, "{}");
    const again = await rows(root);
    expect(again.WBCROSSGT.length - overlong(again).filter((o) => o.table === "WBCROSSGT").length).to.equal(expected);
    expect(again.WBCROSSGT.filter((r) => r.INCLUDE === "ZCL_OSD_XREF_PROBE")).to.deep.equal([]);
  });

  it("the Node server (test/start.mjs, inline) seeds WBCROSSGT at start", async () => {
    const n = await child(`
      await import(${JSON.stringify(new URL("./start.mjs", import.meta.url).href)});
      const r = await globalThis.abap.context.databaseConnections.DEFAULT.select({select: "SELECT COUNT(*) AS n FROM wbcrossgt"});
      process.send({n: Number(Object.values(r.rows[0])[0])});`, {STG_SERVE: "inline"});
    expect(n).to.equal(expected);
  });

  it("the serving runtime (tools/osd-serve.mjs, also the binary's `osd serve`) seeds WBCROSSGT at start", async () => {
    const serve = fork("tools/osd-serve.mjs", ["0"], {stdio: ["ignore", "ignore", "inherit", "ipc"]});
    try {
      const port = await new Promise((resolve, reject) => {
        serve.on("message", (m) => m?.type === "ready" && resolve(m.port));
        serve.on("exit", (code) => reject(new Error(`osd-serve exited ${code}`)));
      });
      const answer = await fetch(`http://127.0.0.1:${port}/osd/sql`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({sql: "SELECT COUNT(*) AS n FROM wbcrossgt", max: 1}),
      });
      const body = await answer.json();
      expect(answer.status, JSON.stringify(body)).to.equal(200);
      expect(count(body)).to.equal(expected);
    } finally {
      serve.kill();
    }
  });

  it("the browser preview: the build ships the rows, the backend applies them at start and at reset", async () => {
    // the build's own generation step, without the minute of webpack
    execFileSync(process.execPath, ["scripts/build-preview.mjs"], {env: {...process.env, OSD_PREVIEW_GENERATE_ONLY: "1"}, stdio: "ignore"});
    const {xref} = await import(`../web/generated/xref.mjs?${Date.now()}`);
    expect(xref.WBCROSSGT.length - overlong(xref).filter((o) => o.table === "WBCROSSGT").length).to.equal(expected);
    // and the worker's backend, run under node: the same module the service
    // worker bundles, over sql.js, seeded from the bundle and not from files;
    // then "reset" in the page, which rebuilds the database and must seed it
    // again
    const n = await child(`
      const b = await import(${JSON.stringify(new URL("../web/preview-backend.mjs", import.meta.url).href)});
      const n = async () => Number(Object.values((await globalThis.abap.context.databaseConnections.DEFAULT.select({select: "SELECT COUNT(*) AS n FROM wbcrossgt"})).rows[0])[0]);
      await b.startBackend(undefined, {mount: "/preview/"});
      const started = await n();
      await b.resetBackend();
      process.send({n: {started, reset: await n()}});`);
    expect(n).to.deep.equal({started: expected, reset: expected});
  });
});

/** a host in a process of its own: each one installs its own global runtime */
function child(source, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--input-type=module", "-e", `${source}\nprocess.exit(0);`], {
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

/** the DatabaseClient methods applyRows uses, over sql.js, with a switch
 *  that makes a statement fail */
function fakeClient(sql) {
  const db = {
    failOn: undefined,
    beginTransaction: async () => sql.run("BEGIN"),
    commit: async () => sql.run("COMMIT"),
    rollback: async () => sql.run("ROLLBACK"),
    execute: async (text) => {
      if (db.failOn !== undefined && text.includes(db.failOn)) throw new Error(`refused: ${db.failOn}`);
      sql.run(text);
    },
    select: async ({select}) => {
      const [result] = sql.exec(select);
      return {rows: (result?.values ?? []).map((v) => Object.fromEntries(result.columns.map((c, i) => [c, v[i]])))};
    },
  };
  return db;
}
