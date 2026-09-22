import {expect} from "chai";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {HanaDatabaseClient} from "../tools/hana-client.mjs";
import {extract, parameterType, procedure as hanaProcedure} from "../tools/amdp-extract.mjs";
import {call as callAmDP, connection} from "../tools/amdp-run.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {T, limit, param, project, refTo, scan, seamType} from "../tools/sqlscript-ir.mjs";

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

  it("use HANA's bound-value grammar in LIMIT without an illegal CAST wrapper", () => {
    const compiled = lower(limit(scan("DUMMY"), param("N", T.int)), "hana");
    expect(compiled.sql).to.match(/LIMIT \?$/);
    expect(compiled.sql).to.not.contain("LIMIT CAST");
    expect(compiled.params).to.deep.equal([{name: "N", value: undefined, type: "I", isNull: false}]);
  });

  liveIt("records that HANA rejects a cast-wrapped LIMIT placeholder", async function () {
    this.timeout(60000);
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    await client.connect();
    try {
      let failure;
      try {
        await client.native({sql: "SELECT * FROM DUMMY LIMIT CAST(? AS INTEGER)",
          params: [{name: "N", value: 1, type: "I", isNull: false}], expect: "rows"});
      } catch (error) {
        failure = error;
      }
      expect(failure, "the negative oracle query must be rejected by HANA").to.be.instanceOf(Error);
    } finally {
      await client.disconnect();
    }
  });
});

describe("mix_rows: clean-room SQLScript against portable HANA SQL", function () {
  this.timeout(60000);

  liveIt("returns the same typed values and accepts the bound INTEGER LIMIT", async () => {
    if (process.env.STG_DB_FRESH === "1") {
      throw new Error("live AMDP differential refuses STG_DB_FRESH=1 because it must never reset a schema");
    }
    const source = readFileSync(new URL("fixtures/amdp-cleanroom/neutral_matrix.clas.abap.txt", import.meta.url), "utf8");
    const seed = JSON.parse(readFileSync(new URL("fixtures/amdp-cleanroom/seed-data.json", import.meta.url), "utf8"));
    const extracted = extract(source, "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "mix_rows");
    const portable = compileProcedure(method, extracted.types);
    const schemas = Object.fromEntries(portable.relationParameters.map((one) => [one.name, one.schema]));
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    const suffix = randomBytes(6).toString("hex").toUpperCase();
    const disposableClass = `ZOSD_M_${suffix}`;
    const procedureName = `"${schema}"."${disposableClass}=>MIX_ROWS"`;
    const tables = [];
    let created = false;

    const table = async (logical, parameter, rows, relationSchema) => {
      const name = `"${schema}"."ZOSD_${logical}_${suffix}"`;
      const definition = parameterType(parameter.abapType, extracted.types);
      const columns = /^TABLE\s*\((.*)\)$/is.exec(definition)?.[1];
      if (columns === undefined) throw new Error(`${parameter.abapType} did not resolve to a HANA table type`);
      await client.native({sql: `CREATE COLUMN TABLE ${name} (${columns})`, expect: "none"});
      tables.push(name);
      const fields = Object.entries(relationSchema);
      for (const row of rows) {
        await client.native({sql: `INSERT INTO ${name} VALUES (${fields.map(() => "?").join(", ")})`,
          params: fields.map(([field, type]) => ({name: field, value: row[field.toLowerCase()] ?? null,
            type: seamType(type), isNull: row[field.toLowerCase()] == null})), expect: "none"});
      }
      return refTo({ref: name, kind: "materialised", reason: "typed clean-room fixture"}, relationSchema);
    };
    const normalized = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row)
      .map(([key, value]) => [key.toUpperCase(), value == null ? null : String(value)])))
      .sort((left, right) => Number(left.KEY_ID) - Number(right.KEY_ID));

    await client.connect();
    try {
      await client.native({sql: hanaProcedure(disposableClass, method, schema, extracted.types), expect: "none"});
      created = true;
      const left = await table("LEFT", method.parameters[0], seed.leftRows, schemas.IT_LEFT);
      const right = await table("RIGHT", method.parameters[1], seed.rightRows, schemas.IT_RIGHT);
      for (const count of [0, 10]) {
        const native = await callAmDP(client.client, procedureName, method,
          {it_left: seed.leftRows, it_right: seed.rightRows, iv_limit: count}, extracted.types);
        const lowered = await runProcedure(portable, {client, dialect: "hana", inputs: {IV_LIMIT: count},
          relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
        expect(normalized(lowered.rows), `iv_limit=${count}`).to.deep.equal(normalized(native.et_mix));
        expect(lowered.columns.map((one) => one.name)).to.deep.equal([
          "KEY_ID", "GROUP_ID", "AMOUNT", "DAY_VALUE", "NOTE_TEXT", "CODE_TEXT", "FACTOR",
        ]);
        expect(lowered.trace).to.include({engine: "hana", fallback: false, databaseStatements: 1});
      }
    } finally {
      try {
        if (created) await client.native({sql: `DROP PROCEDURE ${procedureName}`, expect: "none"}).catch(() => undefined);
        for (const name of tables.reverse()) {
          await client.native({sql: `DROP TABLE ${name}`, expect: "none"}).catch(() => undefined);
        }
      } finally {
        await client.disconnect();
      }
    }
  });
});

describe("rank_rows: clean-room windows against portable HANA SQL", function () {
  this.timeout(60000);

  liveIt("matches grouped ranking values with a deterministic ROW_NUMBER", async () => {
    if (process.env.STG_DB_FRESH === "1") {
      throw new Error("live AMDP differential refuses STG_DB_FRESH=1 because it must never reset a schema");
    }
    const source = readFileSync(new URL("fixtures/amdp-cleanroom/neutral_matrix.clas.abap.txt", import.meta.url), "utf8");
    const extracted = extract(source, "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "rank_rows");
    const portable = compileProcedure(method, extracted.types);
    const schemas = Object.fromEntries(portable.relationParameters.map((one) => [one.name, one.schema]));
    const leftRows = [
      {key_id: 1, group_id: 9, amount: 5, day_value: "20240101", note_text: "A"},
      {key_id: 2, group_id: 9, amount: 5, day_value: "20240102", note_text: "B"},
      {key_id: 3, group_id: 9, amount: 3, day_value: null, note_text: "C"},
      {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
      {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
    ];
    const rightRows = [1, 2, 3, 4].map((key_id) => ({key_id, code_text: "Q", factor: 1}));
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    const suffix = randomBytes(6).toString("hex").toUpperCase();
    const disposableClass = `ZOSD_R_${suffix}`;
    const procedureName = `"${schema}"."${disposableClass}=>RANK_ROWS"`;
    const tables = [];
    let created = false;

    const table = async (logical, parameter, rows, relationSchema) => {
      const name = `"${schema}"."ZOSD_${logical}_${suffix}"`;
      const definition = parameterType(parameter.abapType, extracted.types);
      const columns = /^TABLE\s*\((.*)\)$/is.exec(definition)?.[1];
      if (columns === undefined) throw new Error(`${parameter.abapType} did not resolve to a HANA table type`);
      await client.native({sql: `CREATE COLUMN TABLE ${name} (${columns})`, expect: "none"});
      tables.push(name);
      const fields = Object.entries(relationSchema);
      for (const row of rows) {
        await client.native({sql: `INSERT INTO ${name} VALUES (${fields.map(() => "?").join(", ")})`,
          params: fields.map(([field, type]) => ({name: field, value: row[field.toLowerCase()] ?? null,
            type: seamType(type), isNull: row[field.toLowerCase()] == null})), expect: "none"});
      }
      return refTo({ref: name, kind: "materialised", reason: "typed clean-room ranking fixture"}, relationSchema);
    };
    const semantic = (rows) => rows.map((row) => ({
      KEY_ID: Number(row.KEY_ID ?? row.key_id),
      GROUP_ID: Number(row.GROUP_ID ?? row.group_id),
      AMOUNT: String(row.AMOUNT ?? row.amount),
      RANK_VALUE: Number(row.RANK_VALUE ?? row.rank_value),
      DENSE_VALUE: Number(row.DENSE_VALUE ?? row.dense_value),
      ROW_VALUE: Number(row.ROW_VALUE ?? row.row_value),
      NOTE_TEXT: String(row.NOTE_TEXT ?? row.note_text),
    })).sort((a, b) => a.KEY_ID - b.KEY_ID);

    await client.connect();
    try {
      await client.native({sql: hanaProcedure(disposableClass, method, schema, extracted.types), expect: "none"});
      created = true;
      const left = await table("RANK_LEFT", method.parameters[0], leftRows, schemas.IT_LEFT);
      const right = await table("RANK_RIGHT", method.parameters[1], rightRows, schemas.IT_RIGHT);
      const native = await callAmDP(client.client, procedureName, method,
        {it_left: leftRows, it_right: rightRows}, extracted.types);
      const lowered = await runProcedure(portable, {client, dialect: "hana",
        relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
      expect(semantic(lowered.rows)).to.deep.equal(semantic(native.et_rank));
      expect(lowered.rows).to.have.length(4);
      expect(lowered.columns.map((one) => one.name)).to.deep.equal([
        "KEY_ID", "GROUP_ID", "AMOUNT", "RANK_VALUE", "DENSE_VALUE", "ROW_VALUE", "NOTE_TEXT",
      ]);
      expect(lowered.trace).to.include({engine: "hana", fallback: false, databaseStatements: 1});
    } finally {
      try {
        if (created) await client.native({sql: `DROP PROCEDURE ${procedureName}`, expect: "none"}).catch(() => undefined);
        for (const name of tables.reverse()) {
          await client.native({sql: `DROP TABLE ${name}`, expect: "none"}).catch(() => undefined);
        }
      } finally {
        await client.disconnect();
      }
    }
  });
});

describe("transform: selected IF branches against portable HANA SQL", function () {
  this.timeout(60000);

  liveIt("matches LOWER and regex branches without evaluating SESSION_CONTEXT", async () => {
    if (process.env.STG_DB_FRESH === "1") {
      throw new Error("live AMDP differential refuses STG_DB_FRESH=1 because it must never reset a schema");
    }
    const source = readFileSync(new URL("fixtures/amdp-cleanroom/neutral_flow.clas.abap.txt", import.meta.url), "utf8");
    const extracted = extract(source, "cl_neutral_flow.clas.abap");
    const method = extracted.methods.find((one) => one.name === "transform");
    const portable = compileProcedure(method, extracted.types);
    const relationSchema = portable.relationParameters[0].schema;
    const rows = [
      {cell_id: 1, bucket_id: 4, amount: 2.5, stamp: "20240229", label_text: "MiXeD"},
      {cell_id: 2, bucket_id: 4, amount: 0, stamp: null, label_text: null},
      {cell_id: 3, bucket_id: 5, amount: -1.25, stamp: "20240301", label_text: "xaxb"},
      {cell_id: 4, bucket_id: 5, amount: 7, stamp: "20240302", label_text: " "},
    ];
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    const suffix = randomBytes(6).toString("hex").toUpperCase();
    const disposableClass = `ZOSD_F_${suffix}`;
    const procedureName = `"${schema}"."${disposableClass}=>TRANSFORM"`;
    const tableName = `"${schema}"."ZOSD_FLOW_${suffix}"`;
    let procedureCreated = false;
    let tableCreated = false;
    const normalized = (value) => value.map((row) => Object.fromEntries(Object.entries(row)
      .map(([key, item]) => [key.toUpperCase(), item == null ? null : String(item)])))
      .sort((a, b) => Number(a.CELL_ID) - Number(b.CELL_ID));

    await client.connect();
    try {
      await client.native({sql: hanaProcedure(disposableClass, method, schema, extracted.types), expect: "none"});
      procedureCreated = true;
      const definition = parameterType(method.parameters[0].abapType, extracted.types);
      const columns = /^TABLE\s*\((.*)\)$/is.exec(definition)?.[1];
      if (columns === undefined) throw new Error("transform input did not resolve to a HANA table type");
      await client.native({sql: `CREATE COLUMN TABLE ${tableName} (${columns})`, expect: "none"});
      tableCreated = true;
      const fields = Object.entries(relationSchema);
      for (const row of rows) {
        await client.native({sql: `INSERT INTO ${tableName} VALUES (${fields.map(() => "?").join(", ")})`,
          params: fields.map(([field, type]) => ({name: field, value: row[field.toLowerCase()] ?? null,
            type: seamType(type), isNull: row[field.toLowerCase()] == null})), expect: "none"});
      }
      const input = refTo({ref: tableName, kind: "materialised", reason: "typed clean-room IF fixture"}, relationSchema);
      for (const value of [0, 1, 9]) {
        const native = await callAmDP(client.client, procedureName, method,
          {it_cells: rows, iv_switch: value}, extracted.types);
        const lowered = await runProcedure(portable, {client, dialect: "hana", inputs: {IV_SWITCH: value},
          relationInputs: {IT_CELLS: input}, inputCatalogue: {DUMMY: {}}});
        expect(normalized(lowered.rows), `iv_switch=${value}`).to.deep.equal(normalized(native.et_cells));
        expect(lowered.trace).to.include({engine: "hana", fallback: false, databaseStatements: 1});
      }
    } finally {
      try {
        if (procedureCreated) await client.native({sql: `DROP PROCEDURE ${procedureName}`, expect: "none"}).catch(() => undefined);
        if (tableCreated) await client.native({sql: `DROP TABLE ${tableName}`, expect: "none"}).catch(() => undefined);
      } finally {
        await client.disconnect();
      }
    }
  });
});

describe("scalar functions: native SQLScript against portable host evaluation", function () {
  this.timeout(60000);

  liveIt("matches scalar RETURNING values and keeps omission distinct from SQL NULL", async () => {
    if (process.env.STG_DB_FRESH === "1") {
      throw new Error("live AMDP differential refuses STG_DB_FRESH=1 because it must never reset a schema");
    }
    const cases = [
      {file: "fixtures/amdp-cleanroom/neutral_matrix.clas.abap.txt", logical: "cl_neutral_matrix.clas.abap",
        method: "scalar_value", values: [-4, 0, 7]},
      {file: "fixtures/amdp-cleanroom/neutral_additions.clas.abap.txt", logical: "cl_neutral_additions.clas.abap",
        method: "optional_value", values: [null, 0, 11]},
    ];
    const schema = process.env.HANA_SCHEMA ?? "OSD_AMDP_PORTABLE";
    const client = new HanaDatabaseClient({...connection(), schema});
    const created = [];
    await client.connect();
    try {
      for (const item of cases) {
        const source = readFileSync(new URL(item.file, import.meta.url), "utf8");
        const extracted = extract(source, item.logical);
        const method = extracted.methods.find((one) => one.name === item.method);
        const portable = compileProcedure(method, extracted.types);
        const cls = `ZOSD_S_${randomBytes(6).toString("hex").toUpperCase()}`;
        const name = `"${schema}"."${cls}=>${method.name.toUpperCase()}"`;
        await client.native({sql: hanaProcedure(cls, method, schema, extracted.types), expect: "none"});
        created.push(name);
        for (const value of item.values) {
          const native = await callAmDP(client.client, name, method, {iv_seed: value}, extracted.types);
          const lowered = await runProcedure(portable, {client, dialect: "hana", inputs: {IV_SEED: value}});
          expect(String(lowered.value), `${item.method}(${value})`).to.equal(String(native.RV_VALUE ?? native.rv_value));
          expect(lowered.trace).to.include({engine: "host", fallback: false, databaseStatements: 0});
        }
        if (item.method === "optional_value") {
          const omitted = await runProcedure(portable, {client, dialect: "hana"});
          expect(omitted.value, "ABAP OPTIONAL integer omission supplies type-initial zero").to.equal(0);
        }
      }
    } finally {
      try {
        for (const name of created) await client.native({sql: `DROP PROCEDURE ${name}`, expect: "none"}).catch(() => undefined);
      } finally {
        await client.disconnect();
      }
    }
  });
});
