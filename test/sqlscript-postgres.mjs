import {expect} from "chai";
import {compile, CATALOGUE, BODY} from "../tools/sqlscript/end-to-end.mjs";
import {OsdPostgresClient} from "../tools/postgres-client.mjs";
import {T, param, scan, project, bin} from "../tools/sqlscript-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";

describe("the PostgreSQL SQLScript device seam", () => {
  it("lowers bound values to numbered placeholders", () => {
    const {sql, params} = compile("SELECT k FROM src WHERE k <> 'x' ORDER BY k;", "postgres", CATALOGUE);
    expect(sql).to.contain("$1::varchar(1)");
    expect(sql).to.not.contain("'x'");
    expect(params.map((one) => one.value)).to.deep.equal(["x"]);
  });

  it("does not inherit PostgreSQL integer division", () => {
    const {sql} = compile("SELECT n / 2 AS v FROM src;", "postgres", CATALOGUE);
    expect(sql).to.contain("AS NUMERIC");
  });

  it("does not inherit function claims measured only on the first three engines", () => {
    expect(() => compile("SELECT LOWER(k) AS v FROM src;", "postgres", CATALOGUE))
      .to.throw(/LOWER has not been measured on postgres/);
  });

  it("types host values and replaces HANA DUMMY with a one-row source", () => {
    const value = (name, type, value) => ({...param(name, type), value});
    const rel = project(scan("DUMMY"), [
      {as: "ID", expr: value("lv_i", T.int, 3)},
      {as: "SQUARE", expr: bin("*", value("lv_i", T.int, 3), value("lv_i", T.int, 3), T.int)},
    ]);
    const {sql, params} = lower(rel, "postgres");
    expect(sql).to.contain("$1::integer");
    expect(sql).to.contain("$2::integer * $3::integer");
    expect(sql).to.contain("FROM (SELECT 1) AS dummy");
    expect(params.map((one) => one.value)).to.deep.equal([3, 3, 3]);
  });

  it("binds native parameters and reports engine column types", async () => {
    let request;
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async (input) => {
      request = input;
      return {rows: [{n: "12.30", label: "ok"}], rowCount: 1,
        fields: [{name: "n", dataTypeID: 1700}, {name: "label", dataTypeID: 25}]};
    }};
    const answer = await client.native({sql: "SELECT $1::numeric AS n, $2::text AS label, $3 AS absent",
      params: [{name: "n", type: "P(15,2)", value: "12.30"},
               {name: "label", type: "STRING", value: "ok"},
               {name: "absent", type: "I", value: 7, isNull: true}]});
    expect(request.values).to.deep.equal(["12.30", "ok", null]);
    expect(answer.rows).to.deep.equal([{n: "12.30", label: "ok"}]);
    expect(answer.columns).to.deep.equal([{name: "n", type: 1700}, {name: "label", type: 25}]);
  });

  it("keeps native work on the active ABAP transaction connection", async () => {
    let poolCalls = 0;
    let transactionCalls = 0;
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async () => { poolCalls += 1; return {rows: []}; }};
    client.client = {query: async (input) => {
      transactionCalls += 1;
      if (typeof input === "string") return {rows: []};
      return {rows: [{v: 1}], rowCount: 1, fields: []};
    }};
    expect((await client.native({sql: "SELECT 1 AS v"})).rows).to.deep.equal([{v: 1}]);
    expect(transactionCalls).to.equal(3);
    expect(poolCalls).to.equal(0);
  });

  it("rolls a failed native statement back to its savepoint", async () => {
    const calls = [];
    const failure = Object.assign(new Error("bad value"), {code: "22012"});
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async () => ({rows: []})};
    client.client = {query: async (input) => {
      calls.push(typeof input === "string" ? input : input.text);
      if (typeof input !== "string") throw failure;
      return {rows: []};
    }};
    let error;
    try { await client.native({sql: "SELECT 1 / 0"}); } catch (caught) { error = caught; }
    expect(error).to.equal(failure);
    expect(calls).to.deep.equal(["SAVEPOINT osd_native", "SELECT 1 / 0",
      "ROLLBACK TO SAVEPOINT osd_native; RELEASE SAVEPOINT osd_native;"]);
  });

  it("refuses native work after a failed COMMIT poisoned the LUW", async () => {
    let calls = 0;
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async () => { calls += 1; return {rows: []}; }};
    client.fatal = new Error("PG: COMMIT failed, the changes of the current LUW are lost");
    let error;
    try { await client.native({sql: "SELECT 1"}); } catch (caught) { error = caught; }
    expect(error).to.equal(client.fatal);
    expect(calls).to.equal(0);
  });

  it("materialises bound relations and gives lowering a quoted reference", async () => {
    const calls = [];
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async (input) => {
      calls.push(input);
      return {rows: [], rowCount: 0, fields: []};
    }};
    const handle = await client.defineRelation({name: "loop step", sql: "SELECT $1::integer AS n",
      params: [{name: "n", type: "I", value: 3}], materialise: "loop-barrier"});
    expect(client.relationRef(handle)).to.match(/^"OSD_LOOP_STEP_/);
    expect(client.relationKind(handle)).to.deep.equal({kind: "materialised", reason: "loop-barrier"});
    expect(calls[0].text).to.match(/^CREATE TABLE .* AS SELECT \$1::integer AS n$/);
    expect(calls[0].values).to.deep.equal([3]);
    await client.dropRelation(handle);
    expect(calls[1].text).to.match(/^DROP TABLE /);
  });

  it("gives concurrent clients different relation namespaces", async () => {
    const input = {host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"};
    const first = new OsdPostgresClient(input);
    const second = new OsdPostgresClient(input);
    const connectFake = (client) => {
      client.pool = {query: async () => ({rows: [], rowCount: 0, fields: []})};
    };
    connectFake(first);
    connectFake(second);
    const a = await first.defineRelation({name: "same", sql: "SELECT 1", materialise: "test"});
    const b = await second.defineRelation({name: "same", sql: "SELECT 1", materialise: "test"});
    expect(a.ref).to.not.equal(b.ref);
    expect(a.ident.length).to.be.at.most(63);
  });

  it("bounds relation identifiers even when a caller supplies a long name", async () => {
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    client.pool = {query: async () => ({rows: [], rowCount: 0, fields: []})};
    const handle = await client.defineRelation({name: "a".repeat(200), sql: "SELECT 1", materialise: "test"});
    expect(handle.ident.length).to.be.at.most(63);
  });

  it("refuses a parameterised view because its values have no lifetime", async () => {
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    let error;
    try {
      await client.defineRelation({sql: "SELECT $1", params: [{name: "p", type: "I", value: 1}]});
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.match(/params are not supported/);
  });

  it("does not hide relation cleanup failures other than an already missing object", async () => {
    const client = new OsdPostgresClient({host: "unused", port: 5432, user: "unused", password: "unused", database: "unused"});
    const denied = Object.assign(new Error("denied"), {code: "42501"});
    client.native = async () => { throw denied; };
    let error;
    try { await client.dropRelation({kind: "materialised", ref: '"OSD_X"'}); } catch (caught) { error = caught; }
    expect(error).to.equal(denied);
    client.native = async () => { throw Object.assign(new Error("missing"), {code: "42P01"}); };
    await client.dropRelation({kind: "materialised", ref: '"OSD_X"'});
  });
});

describe("a SQLScript body on a real PostgreSQL", function () {
  this.timeout(30000);
  const live = process.env.OSD_TEST_POSTGRES === "1" ? it : it.skip;

  live("executes text through the relational IR with bound values", async () => {
    const previousAbap = globalThis.abap;
    globalThis.abap = {Classes: {}, context: {databaseConnections: {}}};
    const client = new OsdPostgresClient({
      host: process.env.PGHOST ?? "127.0.0.1",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "osd",
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE ?? "osd",
    });
    try {
      await client.connect();
      await client.beginTransaction();
      await client.native({sql: 'CREATE TEMP TABLE "SRC" ("K" VARCHAR(4), "N" INTEGER)', expect: "none"});
      for (const [k, n] of [["a", 1], ["b", 2], ["c", 3]]) {
        await client.native({sql: 'INSERT INTO "SRC" VALUES ($1, $2)', expect: "none",
          params: [{name: "k", type: "C(4)", value: k}, {name: "n", type: "I", value: n}]});
      }
      const compiled = compile(BODY, "postgres", CATALOGUE);
      const answer = await client.native(compiled);
      expect(answer.rows).to.deep.equal([{K: "b", N: 2}, {K: "c", N: 3}]);

      const bound = compile("SELECT k FROM src WHERE k <> 'x' ORDER BY k;", "postgres", CATALOGUE);
      expect((await client.native(bound)).rows.map((row) => row.K)).to.deep.equal(["a", "b", "c"]);

      const value = (name, type, value) => ({...param(name, type), value});
      const squaresRow = project(scan("DUMMY"), [
        {as: "ID", expr: value("lv_i", T.int, 3)},
        {as: "LABEL", expr: bin("||", value("prefix", T.char(10), "square of "),
          value("lv_i", T.int, 3), T.str)},
        {as: "SQUARE", expr: bin("*", value("lv_i", T.int, 3), value("lv_i", T.int, 3), T.int)},
      ]);
      expect((await client.native(lower(squaresRow, "postgres"))).rows)
        .to.deep.equal([{ID: 3, LABEL: "square of 3", SQUARE: 9}]);

      const division = project(scan("DUMMY"), [{as: "V", expr: bin("/",
        value("a", T.int, 1), value("b", T.int, 2), T.dec(15, 2))}]);
      const divided = (await client.native(lower(division, "postgres"))).rows[0].V;
      expect(Number(divided)).to.equal(0.5);
    } finally {
      await client.rollback().catch(() => undefined);
      await client.disconnect().catch(() => undefined);
      globalThis.abap = previousAbap;
    }
  });
});
