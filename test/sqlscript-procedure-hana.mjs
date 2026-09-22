import {expect} from "chai";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {HanaDatabaseClient} from "../tools/hana-client.mjs";
import {extract, procedure as hanaProcedure} from "../tools/amdp-extract.mjs";
import {call as callAmDP, connection} from "../tools/amdp-run.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {T, param, project, scan} from "../tools/sqlscript-ir.mjs";

const live = process.env.OSD_HANA_LIVE === "1";
const liveIt = live ? it : it.skip;

describe("SQUARES: native SQLScript against portable control on the same HANA", function () {
  this.timeout(60000);

  liveIt("returns the same values through both execution paths", async () => {
    if (process.env.STG_DB_FRESH === "1") {
      throw new Error("live AMDP differential refuses STG_DB_FRESH=1 because it must never reset a schema");
    }
    const source = readFileSync(new URL("../src/amdp/zcl_osd_amdp_demo.clas.abap", import.meta.url), "utf8");
    const extracted = extract(source, "zcl_osd_amdp_demo.clas.abap");
    const method = extracted.methods.find((one) => one.name.toUpperCase() === "SQUARES");
    const portable = compileProcedure(method, extracted.types);
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    // Never claim or pre-drop a stable repository object. This run owns a
    // collision-resistant disposable name and may clean up only that name.
    const disposableClass = `ZOSD_P_${randomBytes(6).toString("hex").toUpperCase()}`;
    const name = `"${schema}"."${disposableClass}=>SQUARES"`;
    let created = false;
    await client.connect();
    try {
      await client.native({sql: hanaProcedure(disposableClass, method, schema, extracted.types), expect: "none"});
      created = true;
      const rows = (value) => value.map((row) => Object.fromEntries(Object.entries(row)
        .map(([key, item]) => [key.toUpperCase(), item == null ? null : String(item)])))
        .sort((a, b) => Number(a.ID) - Number(b.ID));
      for (const count of [0, 4]) {
        const native = await callAmDP(client.client, name, method, {iv_count: count}, extracted.types);
        const lowered = await runProcedure(portable, {client, dialect: "hana", inputs: {IV_COUNT: count}});
        expect(rows(lowered.rows), `iv_count=${count}`).to.deep.equal(rows(native.et_square));
        expect(lowered.columns.map((one) => one.name)).to.deep.equal(["ID", "LABEL", "SQUARE"]);
        expect(lowered.trace).to.include({engine: "hana", fallback: false, databaseStatements: 1});
      }
    } finally {
      try {
        if (created) await client.native({sql: `DROP PROCEDURE ${name}`, expect: "none"});
      } finally {
        await client.disconnect();
      }
    }
  });
});

describe("typed HANA placeholders", () => {
  it("do not let concatenation reinterpret an INTEGER host value as text", () => {
    const rel = project(scan("DUMMY"), [{as: "N", expr: param("N", T.int)}]);
    const compiled = lower(rel, "hana");
    expect(compiled.sql).to.contain("CAST(? AS INTEGER)");
    expect(compiled.params).to.deep.equal([{name: "N", value: undefined, type: "I", isNull: false}]);
  });
});
