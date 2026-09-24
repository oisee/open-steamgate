import {expect} from "chai";
import {execFileSync, fork, spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import initSqlJs from "sql.js";
import {TABLES, WIDTHS, applyRows, insertStatements} from "../tools/osd-xref-seed.mjs";

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

  before(function () {
    for (const table of TABLES) {
      const file = `data/${table.toLowerCase()}.tabu.json`;
      expect(existsSync(file), `${file} is a leftover of osd-xref --write; delete it, every host seeds the table now`).to.equal(false);
    }
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
    const db = {
      execute: async (text) => sql.run(text),
      select: async ({select}) => {
        const [result] = sql.exec(select);
        return {rows: (result?.values ?? []).map((v) => Object.fromEntries(result.columns.map((c, i) => [c, v[i]])))};
      },
    };
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
  });

  it("the Node server (test/start.mjs, inline) seeds WBCROSSGT at start", async () => {
    const n = await child(`
      await import(${JSON.stringify(new URL("./start.mjs", import.meta.url).href)});
      const r = await globalThis.abap.context.databaseConnections.DEFAULT.select({select: "SELECT COUNT(*) AS n FROM wbcrossgt"});
      process.send({n: Number(Object.values(r.rows[0])[0])});`, {STG_SERVE: "inline"});
    expect(n).to.be.greaterThan(500);
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
      expect(count(body)).to.be.greaterThan(500);
    } finally {
      serve.kill();
    }
  });

  it("the browser preview: the build ships the rows and the backend applies them", async () => {
    // the build's own generation step, without the minute of webpack
    execFileSync(process.execPath, ["scripts/build-preview.mjs"], {env: {...process.env, OSD_PREVIEW_GENERATE_ONLY: "1"}, stdio: "ignore"});
    const {xref} = await import(`../web/generated/xref.mjs?${Date.now()}`);
    expect(xref.WBCROSSGT.length).to.be.greaterThan(500);
    // and the worker's backend, run under node: the same module the service
    // worker bundles, over sql.js, seeded from the bundle and not from files
    const n = await child(`
      const b = await import(${JSON.stringify(new URL("../web/preview-backend.mjs", import.meta.url).href)});
      await b.startBackend(undefined, {mount: "/preview/"});
      const r = await globalThis.abap.context.databaseConnections.DEFAULT.select({select: "SELECT COUNT(*) AS n FROM wbcrossgt"});
      process.send({n: Number(Object.values(r.rows[0])[0])});`);
    expect(n).to.equal(xref.WBCROSSGT.length);
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
