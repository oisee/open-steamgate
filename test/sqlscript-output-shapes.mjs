// The shapes of a procedure's outputs the corpus has and the compiler used
// to refuse: none at all (a procedure that only writes -- eleven bodies of
// the corpus) and several scalar OUTs with no table (four). The first
// answers with what it wrote; the second with each OUT as the body left it,
// an unassigned one at its initial value, as beside a table (measured on
// A4H, docs/sqlscript-hana-observed.md).
import {expect} from "chai";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";

const CATALOGUE = {T: {ID: {abap: "I"}, NAME: {abap: "STRING"}}};
const ENGINES = [["sqlite", () => new FileSqliteClient({path: ":memory:"})], ["duckdb", () => new DuckDBDatabaseClient()]];

for (const [dialect, make] of ENGINES) {
  describe(`procedure output shapes, on ${dialect}`, () => {
    let client;
    beforeEach(async () => {
      client = make();
      await client.connect();
      await client.native({sql: 'CREATE TABLE "T" ("ID" INTEGER, "NAME" VARCHAR(10))', expect: "none"});
      await client.native({sql: `INSERT INTO "T" VALUES (1, 'a'), (2, 'b')`, expect: "none"});
    });
    afterEach(async () => { await client.disconnect(); });
    const rows = async () => (await client.native({sql: 'SELECT "ID", "NAME" FROM "T" ORDER BY "ID"', expect: "rows"})).rows.map((r) => `${Number(r.ID)}${r.NAME}`);

    it("a procedure with no output answers with what it wrote", async () => {
      const program = compileProcedure({name: "M", kind: "METHOD", parameters: [
        {name: "iv_id", direction: "IN", abapType: "i"}, {name: "iv_name", direction: "IN", abapType: "string"}],
      body: "INSERT INTO t VALUES (:iv_id, :iv_name); DELETE FROM t WHERE id = 1;"}, new Map(), {catalogue: CATALOGUE});
      expect(program.outputs).to.deep.equal([]);
      expect(program.output, "outputs is the authority; output names only a single one").to.equal(undefined);
      const out = await runProcedure(program, {client, dialect, inputs: {IV_ID: 3, IV_NAME: "c"}});
      expect(out.outputs).to.deep.equal({});
      await client.commit();
      expect(await rows()).to.deep.equal(["2b", "3c"]);
    });

    it("several scalar OUTs and no table: each as the body left it, an unassigned one initial", async () => {
      const program = compileProcedure({name: "M", kind: "METHOD", parameters: [
        {name: "iv_id", direction: "IN", abapType: "i"},
        {name: "ev_count", direction: "OUT", abapType: "i"},
        {name: "ev_name", direction: "OUT", abapType: "string"},
        {name: "ev_left", direction: "OUT", abapType: "i"}],
      body: "SELECT COUNT(*) INTO ev_count FROM t WHERE id >= :iv_id; SELECT MAX(name) INTO ev_name FROM t;"}, new Map(), {catalogue: CATALOGUE});
      expect(program.outputs.map((one) => one.name)).to.deep.equal(["EV_COUNT", "EV_NAME", "EV_LEFT"]);
      expect([program.output, program.outputSchema, program.outputType]).to.deep.equal([undefined, undefined, undefined]);
      const out = await runProcedure(program, {client, dialect, inputs: {IV_ID: 1}});
      expect(Object.fromEntries(Object.entries(out.outputs).map(([k, v]) => [k, v.value])))
        .to.deep.equal({EV_COUNT: 2, EV_NAME: "b", EV_LEFT: 0});
    });
  });
}
