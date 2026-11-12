import {expect} from "chai";
import {createRequire} from "node:module";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HanaDatabaseClient} from "../tools/hana-client.mjs";
import {ddicTables, synonymSql, tableFrom259, viewSql} from "../tools/hana-shadow-schema.mjs";

// The shadow schema (tools/hana-shadow-schema.mjs, H3 B+C): the client lives
// in a schema of our own, over the tenant's tables, with SESSION_CONTEXT
// doing per-connection what the transpiler has no implicit MANDT for
// (ANOMALY-2026-09-11-no-implicit-mandt, docs/db-backends.md, "Shadow schema:
// the client lives in HANA"). Everything here runs against a fake hdb driver
// recording what reaches it; the schemas are ZOSD_H3_OWN (ours) and
// ZOSD_H3_TENANT (somebody else's), both invented for this fixture.
describe("the HANA shadow schema", () => {
  // DD02L says which of the generation's tables exist in the tenant and
  // which of them are client-dependent; the SYS catalog answers what our own
  // schema already holds. The shapes are the contract of the module.
  const DD02L_ROWS = [
    {TABNAME: "ZOSD_H3_CLI", CLIDEP: "X"},
    {TABNAME: "ZOSD_H3_FREE", CLIDEP: ""},
    {TABNAME: "ZOSD_H3_LAZY", CLIDEP: "X"},
  ];
  const fakeHdb = ({views = [], synonyms = [], failName, failTimes = 0} = {}) => {
    const sent = [];
    const options = [];
    let failed = 0;
    const require = createRequire(import.meta.url);
    const path = require.resolve("hdb");
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: {createClient: (opts) => {
        options.push(opts);
        return {
          connect: (cb) => cb(undefined),
          setAutoCommit: () => undefined,
          exec: (sql, cb) => {
            sent.push(sql);
            if (/^\s*SELECT/i.test(sql) === false) return cb(undefined, 1); // SET SCHEMA and DDL
            if (failName !== undefined && failed < failTimes &&
                new RegExp(`FROM\\s+"?${failName}"?`, "i").test(sql) && !/DD02L/i.test(sql)) {
              failed += 1;
              const error = new Error(`invalid table name: ${failName}`);
              error.code = 259;
              return cb(error);
            }
            if (/FROM\s+SYS\.VIEWS/i.test(sql)) return cb(undefined, views);
            if (/FROM\s+SYS\.SYNONYMS/i.test(sql)) return cb(undefined, synonyms);
            if (/DD02L/i.test(sql)) {
              const pinned = /TABNAME\s*=\s*'([A-Z0-9_]+)'/.exec(sql)?.[1];
              return cb(undefined, DD02L_ROWS.filter((row) => pinned === undefined || row.TABNAME === pinned));
            }
            return cb(undefined, []);
          },
          commit: (cb) => cb(undefined),
          rollback: (cb) => cb(undefined),
          end: () => undefined,
        };
      }},
    };
    return {sent, options};
  };

  const connect = async (input = {}, fake = {}) => {
    const hdb = fakeHdb(fake);
    const db = new HanaDatabaseClient({existingSchema: true, schema: "ZOSD_H3_TENANT",
      ownSchema: "ZOSD_H3_OWN", client: "001", ...input});
    await db.connect();
    return {db, ...hdb};
  };

  it("a view with the CLIENT predicate for a client-dependent table, a synonym otherwise", async () => {
    const {db, sent} = await connect({shadowTables: ["ZOSD_H3_CLI", "ZOSD_H3_FREE"]});
    try {
      expect(sent).to.include(
        `CREATE VIEW "ZOSD_H3_OWN"."ZOSD_H3_CLI" AS SELECT * FROM "ZOSD_H3_TENANT"."ZOSD_H3_CLI" WHERE MANDT = SESSION_CONTEXT('CLIENT')`);
      expect(sent).to.include(
        `CREATE SYNONYM "ZOSD_H3_OWN"."ZOSD_H3_FREE" FOR "ZOSD_H3_TENANT"."ZOSD_H3_FREE"`);
    } finally {
      await db.disconnect();
    }
  });

  it("connect() points the session at our own schema, after the shadow DDL", async () => {
    const {db, sent} = await connect({shadowTables: ["ZOSD_H3_CLI"]});
    try {
      expect(sent[sent.length - 1], "SET SCHEMA own is the last statement").to.equal(`SET SCHEMA "ZOSD_H3_OWN"`);
      expect(sent.indexOf(`SET SCHEMA "ZOSD_H3_OWN"`))
        .to.be.greaterThan(sent.indexOf(`CREATE VIEW "ZOSD_H3_OWN"."ZOSD_H3_CLI"`));
    } finally {
      await db.disconnect();
    }
  });

  it("existing objects are left alone: a second connect sends no DDL at all", async () => {
    const there = {
      views: [{VIEW_NAME: "ZOSD_H3_CLI", DEFINITION: viewSql("ZOSD_H3_CLI", "ZOSD_H3_OWN", "ZOSD_H3_TENANT")}],
      synonyms: [{SYNONYM_NAME: "ZOSD_H3_FREE"}],
    };
    const {db, sent} = await connect({shadowTables: ["ZOSD_H3_CLI", "ZOSD_H3_FREE"]}, there);
    try {
      expect(sent.filter((s) => /^\s*CREATE/i.test(s)), "nothing created twice").to.deep.equal([]);
    } finally {
      await db.disconnect();
    }
  });

  it("a view whose definition drifted is recreated; a synonym is not touched", async () => {
    const drifted = {
      views: [{VIEW_NAME: "ZOSD_H3_CLI", DEFINITION: `CREATE VIEW "OLD"."SHAPE" AS SELECT 1 FROM DUMMY`}],
      synonyms: [{SYNONYM_NAME: "ZOSD_H3_FREE"}],
    };
    const {db, sent} = await connect({shadowTables: ["ZOSD_H3_CLI", "ZOSD_H3_FREE"]}, drifted);
    try {
      expect(sent).to.include(
        `CREATE OR REPLACE VIEW "ZOSD_H3_OWN"."ZOSD_H3_CLI" AS SELECT * FROM "ZOSD_H3_TENANT"."ZOSD_H3_CLI" WHERE MANDT = SESSION_CONTEXT('CLIENT')`);
      expect(sent.some((s) => /ZOSD_H3_FREE/.test(s) && /^\s*(CREATE|DROP)/i.test(s)), "the synonym stays").to.equal(false);
    } finally {
      await db.disconnect();
    }
  });

  it("a 259 for a tenant table creates the shadow and retries once, and only once", async () => {
    const {db, sent} = await connect({shadowTables: []}, {failName: "ZOSD_H3_LAZY", failTimes: 1});
    try {
      const rows = await db.query(`SELECT * FROM zosd_h3_lazy`);
      expect(rows).to.deep.equal([]);
      const attempts = sent.filter((s) => /FROM\s+zosd_h3_lazy/i.test(s) && /^\s*SELECT/i.test(s));
      expect(attempts.length, "the failed statement and exactly one retry").to.equal(2);
      expect(sent).to.include(
        `CREATE VIEW "ZOSD_H3_OWN"."ZOSD_H3_LAZY" AS SELECT * FROM "ZOSD_H3_TENANT"."ZOSD_H3_LAZY" WHERE MANDT = SESSION_CONTEXT('CLIENT')`);
    } finally {
      await db.disconnect();
    }
  });

  it("a 259 that keeps failing is retried once and then propagates", async () => {
    const {db, sent} = await connect({shadowTables: []}, {failName: "ZOSD_H3_LAZY", failTimes: 5});
    try {
      let error;
      try {
        await db.query(`SELECT * FROM zosd_h3_lazy`);
      } catch (e) { error = e; }
      expect(error?.code ?? Number(/invalid table name/.test(error?.message ?? ""))).to.not.equal(undefined);
      expect(error, "the 259 reaches the caller").to.not.equal(undefined);
      const attempts = sent.filter((s) => /FROM\s+zosd_h3_lazy/i.test(s) && /^\s*SELECT/i.test(s));
      expect(attempts.length, "no third attempt").to.equal(2);
    } finally {
      await db.disconnect();
    }
  });

  it("a 259 for a name the tenant does not hold is not our table: no retry", async () => {
    const {db, sent} = await connect({shadowTables: []}, {failName: "ZOSD_H3_GHOST", failTimes: 1});
    try {
      let error;
      try {
        await db.query(`SELECT * FROM zosd_h3_ghost`);
      } catch (e) { error = e; }
      expect(error).to.not.equal(undefined);
      const attempts = sent.filter((s) => /FROM\s+zosd_h3_ghost/i.test(s) && /^\s*SELECT/i.test(s));
      expect(attempts.length, "the statement was not retried").to.equal(1);
    } finally {
      await db.disconnect();
    }
  });

  it("the 259 wire text measured on the bed names the table, not the first word", () => {
    // bed acceptance 2026-11-12 (REPORT open question 1, answered): the
    // runtime's `SELECT * FROM sflight` failed with this, and the first-word
    // read after "invalid table name:" took "Could" -- DD02L was asked for
    // COULD, found nothing, and the lazy fallback never fired.
    const error = new Error("invalid table name:  Could not find table/view SFLIGHT in schema OSD: line 1 col 15 (at pos 14)");
    error.code = 259;
    expect(tableFrom259(error), "the table, not the first word of the sentence").to.equal("SFLIGHT");
  });

  it("a /-namespaced 259 name keeps its namespace, quoted or not", () => {
    const bare = new Error("invalid table name:  Could not find table/view /DMO/TRAVEL in schema OSD: line 1 col 15 (at pos 14)");
    bare.code = 259;
    expect(tableFrom259(bare)).to.equal("/DMO/TRAVEL");
    const quoted = new Error(`invalid table name:  Could not find table/view "/DMO/TRAVEL" in schema OSD: line 1 col 15 (at pos 14)`);
    quoted.code = 259;
    expect(tableFrom259(quoted), "the quotes come off, the namespace stays").to.equal("/DMO/TRAVEL");
  });

  it("the client is a node-hdb session variable, set at connect, not by SET", async () => {
    const {db, options} = await connect({shadowTables: []});
    try {
      expect(options[0]["SESSIONVARIABLE:CLIENT"], "the connect option, measured on the bed").to.equal("001");
      expect(options[0].host).to.be.a("string");
    } finally {
      await db.disconnect();
    }
  });

  it("the guard lets our shadow DDL through and still refuses DDL on the tenant schema", async () => {
    const {db, sent} = await connect({shadowTables: []});
    try {
      // ours: allowed, and it reaches the driver
      await db.execute(viewSql("ZOSD_H3_OK", "ZOSD_H3_OWN", "ZOSD_H3_TENANT"));
      expect(sent).to.include(viewSql("ZOSD_H3_OK", "ZOSD_H3_OWN", "ZOSD_H3_TENANT"));
      // the tenant's: refused before the driver, with the guard's own code
      let error;
      try {
        await db.execute(`CREATE VIEW "ZOSD_H3_TENANT"."X" AS SELECT 1 FROM DUMMY`);
      } catch (e) { error = e; }
      expect(error?.code).to.equal("HANA_READONLY");
      // even on our own schema, what is not shadow DDL stays refused
      try {
        await db.execute(`CREATE TABLE "ZOSD_H3_OWN"."X" (A INT)`);
        error = undefined;
      } catch (e) { error = e; }
      expect(error?.code).to.equal("HANA_READONLY");
    } finally {
      await db.disconnect();
    }
  });

  it("existing-schema mode refuses to start without a client, naming OSD_CLIENT", async () => {
    delete process.env.OSD_CLIENT;
    const db = new HanaDatabaseClient({existingSchema: true, schema: "ZOSD_H3_TENANT"});
    let error;
    try {
      await db.connect();
    } catch (e) { error = e; }
    expect(error?.message).to.include("HANA_EXISTING_SCHEMA");
    expect(error?.message).to.include("OSD_CLIENT");
  });

  it("the session client is the sy-mandt the ABAP reads", async () => {
    let mandt;
    globalThis.abap = {builtin: {sy: {get: () => ({
      dbsys: {set: () => undefined},
      mandt: {set: (value) => { mandt = value; }},
    })}}};
    try {
      const db = new HanaDatabaseClient({existingSchema: true, schema: "ZOSD_H3_TENANT", client: "042"});
      await db.connect();
      expect(mandt, "sy-mandt is the logon client").to.equal("042");
      await db.disconnect();
    } finally {
      delete globalThis.abap;
    }
  });

  it("the DDIC set the build knows is the layers' TABL names", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-shadow-ddic-"));
    const write = (rel, body) => {
      mkdirSync(join(root, rel.split("/").slice(0, -1).join("/")), {recursive: true});
      writeFileSync(join(root, rel), body);
    };
    try {
      write("abap_transpile.json", JSON.stringify({input_folder: ["gen/hana-ddic", "src"]}));
      write("src/zosd_h3_a.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_A</TABNAME></abapGit>");
      write("gen/hana-ddic/zosd_h3_b.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_B</TABNAME></abapGit>");
      write("src/zcl_h3_c.clas.abap", "CLASS zcl_h3_c DEFINITION PUBLIC FINAL CREATE PUBLIC.\nENDCLASS.\nCLASS zcl_h3_c IMPLEMENTATION.\nENDCLASS.");
      expect(ddicTables(root)).to.deep.equal(["ZOSD_H3_A", "ZOSD_H3_B"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the DDL builders are the measured shapes", () => {
    expect(viewSql("ZOSD_H3_T", "ZOSD_H3_OWN", "ZOSD_H3_TENANT"))
      .to.equal(`CREATE VIEW "ZOSD_H3_OWN"."ZOSD_H3_T" AS SELECT * FROM "ZOSD_H3_TENANT"."ZOSD_H3_T" WHERE MANDT = SESSION_CONTEXT('CLIENT')`);
    expect(synonymSql("ZOSD_H3_T", "ZOSD_H3_OWN", "ZOSD_H3_TENANT"))
      .to.equal(`CREATE SYNONYM "ZOSD_H3_OWN"."ZOSD_H3_T" FOR "ZOSD_H3_TENANT"."ZOSD_H3_T"`);
  });
});
