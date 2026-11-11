import {expect} from "chai";
import {createRequire} from "node:module";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {run} from "../tools/hana-ddic-probe.mjs";

// The DDIC probe's reads, against the columns a real schema actually has.
//
// Fix round 1: the first run of tools/hana-ddic-probe.mjs against a real
// system died on its first DD04L read with `invalid column name: INTTYPE` --
// the DD* column lists had been guessed. INTTYPE and INTLEN live on DD03L
// only; DD04L and DD01L carry DATATYPE, LENG, DECIMALS. The fixture below is
// the measured list (SYS.TABLE_COLUMNS of a real schema, **column names
// only** -- DD* table and column names are public SAP DDIC documentation, so
// they may live here; no data rows from any system do). The fake driver
// reads that list before it answers a statement and refuses any column the
// list does not carry, with HANA's own words -- so a guessed column fails
// here instead of on a system somebody owns.
describe("the DDIC probe's reads name only measured columns", () => {
  // the measured lists, in the order the measurement recorded them
  const DD_COLUMNS = {
    DD02L: [
      "TABNAME", "AS4LOCAL", "AS4VERS", "TABCLASS", "SQLTAB", "DATMIN", "DATMAX",
      "DATAVG", "CLIDEP", "BUFFERED", "COMPRFLAG", "LANGDEP", "ACTFLAG", "APPLCLASS",
      "AUTHCLASS", "AS4USER", "AS4DATE", "AS4TIME", "MASTERLANG", "MAINFLAG",
      "CONTFLAG", "RESERVETAB", "GLOBALFLAG", "PROZPUFF", "VIEWCLASS", "VIEWGRANT",
      "MULTIPLEX", "SHLPEXI", "PROXYTYPE", "EXCLASS", "WRONGCL", "ALWAYSTRP",
      "ALLDATAINCL", "WITH_PARAMETERS", "EXVIEW_INCLUDED", "KEYMAX_FEATURE",
      "KEYLEN_FEATURE", "TABLEN_FEATURE", "NONTRP_INCLUDED", "VIEWREF",
      "VIEWREF_ERR", "VIEWREF_POS_CHG", "TBFUNC_INCLUDED", "IS_GTT",
      "SESSION_VAR_EX", "FROM_ENTITY", "PK_IS_INVHASH", "USED_SESSION_VARS",
      "ABAP_LANGUAGE_VERSION", "HDB_ONLY_ENTITY_INCLUDED", "FIELD_SUFFIX",
      "QUOTA_MAX_FIELDS", "QUOTA_MAX_BYTES", "QUOTA_SHARE_PARTNER",
      "QUOTA_SHARE_CUSTOMER",
    ],
    DD03L: [
      "TABNAME", "FIELDNAME", "AS4LOCAL", "AS4VERS", "POSITION", "KEYFLAG",
      "MANDATORY", "ROLLNAME", "CHECKTABLE", "ADMINFIELD", "INTTYPE", "INTLEN",
      "REFTABLE", "PRECFIELD", "REFFIELD", "CONROUT", "NOTNULL", "DATATYPE",
      "LENG", "DECIMALS", "DOMNAME", "SHLPORIGIN", "TABLETYPE", "DEPTH",
      "COMPTYPE", "REFTYPE", "LANGUFLAG", "DBPOSITION", "ANONYMOUS",
      "OUTPUTSTYLE", "SRS_ID",
    ],
    DD04L: [
      "ROLLNAME", "AS4LOCAL", "AS4VERS", "DOMNAME", "ROUTPUTLEN", "MEMORYID",
      "LOGFLAG", "HEADLEN", "SCRLEN1", "SCRLEN2", "SCRLEN3", "ACTFLAG",
      "APPLCLASS", "AUTHCLASS", "AS4USER", "AS4DATE", "AS4TIME", "DTELMASTER",
      "RESERVEDTE", "DTELGLOBAL", "SHLPNAME", "SHLPFIELD", "DEFFDNAME",
      "DATATYPE", "LENG", "DECIMALS", "OUTPUTLEN", "LOWERCASE", "SIGNFLAG",
      "CONVEXIT", "VALEXI", "ENTITYTAB", "REFKIND", "REFTYPE", "PROXYTYPE",
      "LTRFLDDIS", "BIDICTRLC", "NOHISTORY", "ABAP_LANGUAGE_VERSION",
    ],
    DD01L: [
      "DOMNAME", "AS4LOCAL", "AS4VERS", "DATATYPE", "LENG", "OUTPUTLEN",
      "DECIMALS", "LOWERCASE", "SIGNFLAG", "LANGFLAG", "VALEXI", "ENTITYTAB",
      "CONVEXIT", "MASK", "MASKLEN", "ACTFLAG", "APPLCLASS", "AUTHCLASS",
      "AS4USER", "AS4DATE", "AS4TIME", "DOMMASTER", "RESERVEDOM", "DOMGLOBAL",
      "APPENDNAME", "APPEXIST", "PROXYTYPE", "OUTPUTSTYLE", "AMPMFORMAT",
      "ABAP_LANGUAGE_VERSION",
    ],
    DD02T: ["TABNAME", "DDLANGUAGE", "AS4LOCAL", "AS4VERS", "DDTEXT"],
    DD09L: [
      "TABNAME", "AS4LOCAL", "AS4VERS", "TABKAT", "TABART", "PUFFERUNG",
      "SCHFELDANZ", "PROTOKOLL", "SPEICHPUFF", "AS4USER", "AS4DATE", "AS4TIME",
      "TRANSPFLAG", "RESERVE", "UEBERSETZ", "ACTFLAG", "BUFALLOW", "JAVAONLY",
      "ROWORCOLST", "SHARINGTYPE", "LOAD_UNIT",
    ],
  };
  // what the measurement counted; a transcription slip in the fixture above
  // fails here, by name, instead of passing quietly
  const DD_COLUMN_COUNTS = {DD02L: 55, DD03L: 31, DD04L: 39, DD01L: 30, DD02T: 5, DD09L: 21};

  // `SELECT A, B FROM T WHERE ...` -- every DD* read the probe sends is a
  // plain column list; a future read that is not should fail here loudly
  // rather than parse half-way.
  const selectOf = (sql) => {
    const match = /^\s*SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][A-Za-z_0-9]*)(\s|$)/i.exec(sql);
    if (match === null) return undefined;
    return {
      table: match[2].toUpperCase(),
      columns: match[1].split(",").map((c) => c.trim().toUpperCase()),
    };
  };

  // invented rows (ZOSD_H1_*), projected to the columns the statement named:
  // the fake answers what was asked, the way HANA does. ZOSD_H1_ELEM is typed
  // only through its data element and that element's domain, so the DD04L and
  // DD01L reads -- the ones the guess broke -- are exercised on every run.
  const DD_ROWS = {
    DD02L: [{TABNAME: "ZOSD_H1_PROBE", TABCLASS: "TRANSP", CLIDEP: "X"}],
    DD03L: [
      {POSITION: "1", FIELDNAME: "MANDT", KEYFLAG: "X", ROLLNAME: "MANDT", DATATYPE: "CLNT", LENG: "3", DECIMALS: "0", INTTYPE: "C", INTLEN: "000006", NOTNULL: "X"},
      {POSITION: "2", FIELDNAME: "ZOSD_H1_KEY", KEYFLAG: "X", ROLLNAME: "", DATATYPE: "CHAR", LENG: "10", DECIMALS: "0", INTTYPE: "C", INTLEN: "000020", NOTNULL: "X"},
      {POSITION: "3", FIELDNAME: "ZOSD_H1_ELEM", KEYFLAG: "", ROLLNAME: "ZOSD_H1_DTEL", DATATYPE: "", LENG: "", DECIMALS: "", INTTYPE: "", INTLEN: "", NOTNULL: ""},
    ],
    DD04L: [{ROLLNAME: "ZOSD_H1_DTEL", DOMNAME: "ZOSD_H1_DOMA", DATATYPE: "", LENG: "", DECIMALS: ""}],
    DD01L: [{DOMNAME: "ZOSD_H1_DOMA", DATATYPE: "DEC", LENG: "9", DECIMALS: "2"}],
    DD02T: [{TABNAME: "ZOSD_H1_PROBE", DDTEXT: "probe fixture table"}],
  };
  const rowsFor = (select) => (DD_ROWS[select.table] ?? []).map((row) => {
    const projected = {};
    for (const column of select.columns) projected[column] = row[column] ?? "";
    return projected;
  });

  // connect() reaches the driver through createRequire("hdb"); the same CJS
  // cache a real require would use is pointed at a stand-in first (the way
  // test/hana-existing-schema.mjs does it). No prepare: query() takes the
  // plain exec path.
  const fakeHdb = () => {
    const sent = [];
    const refused = [];
    const require = createRequire(import.meta.url);
    const path = require.resolve("hdb");
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: {createClient: () => ({
        connect: (cb) => cb(undefined),
        setAutoCommit: () => undefined,
        exec: (sql, cb) => {
          sent.push(sql);
          const select = selectOf(sql);
          if (select === undefined) return cb(undefined, 1); // SET SCHEMA
          const known = DD_COLUMNS[select.table];
          if (known === undefined) {
            refused.push(`${select.table} (whole table outside the measured list)`);
            return cb(new Error(`table ${select.table} is not in this test's measured list`));
          }
          const unknown = select.columns.find((c) => known.includes(c) === false);
          if (unknown !== undefined) {
            refused.push(`${select.table}.${unknown}`);
            return cb(new Error(`invalid column name: ${unknown}`));
          }
          cb(undefined, rowsFor(select));
        },
        commit: (cb) => cb(undefined),
        rollback: (cb) => cb(undefined),
        end: () => undefined,
      })},
    };
    return {sent, refused};
  };

  it("the fixture is the measured list: the measured counts, no duplicate names", () => {
    for (const [table, count] of Object.entries(DD_COLUMN_COUNTS)) {
      expect(DD_COLUMNS[table], table).to.have.lengthOf(count);
      expect(new Set(DD_COLUMNS[table]).size, `${table}: duplicate names`).to.equal(count);
    }
  });

  it("the fake refuses a guessed column the way HANA refused INTTYPE", () => {
    // the check that would have caught fix round 1's failure, demonstrated on
    // its own: INTTYPE is not among DD04L's measured columns, so the read
    // that asked DD04L for it is refused before any row moves
    fakeHdb();
    const require = createRequire(import.meta.url);
    const client = require.cache[require.resolve("hdb")].exports.createClient();
    let error;
    client.exec(`SELECT INTTYPE FROM DD04L WHERE ROLLNAME = 'ZOSD_H1_DTEL'`, (e) => { error = e; });
    expect(error?.message).to.equal("invalid column name: INTTYPE");
  });

  it("reads the DD* tables naming only measured columns, active versions only", async () => {
    const fake = fakeHdb();
    const out = mkdtempSync(join(tmpdir(), "hana-ddic-probe-"));
    const lines = [];
    const say = console.log;
    console.log = (line) => lines.push(String(line));
    let code;
    try {
      code = await run(["--tables", "ZOSD_H1_PROBE", "--out", out, "--mandt"]);
    } finally {
      console.log = say;
    }
    try {
      expect(code, "the probe exits clean").to.equal(0);
      expect(fake.refused, "the fake refused nothing").to.deep.equal([]);
      // one read per DD* table, in the order the probe makes them
      const selects = fake.sent.map(selectOf).filter((s) => s !== undefined);
      expect(selects.map((s) => s.table), "the reads")
        .to.deep.equal(["DD02L", "DD03L", "DD04L", "DD01L", "DD02T"]);
      for (const select of selects) {
        const outside = select.columns.filter((c) => DD_COLUMNS[select.table].includes(c) === false);
        expect(outside, `${select.table}: columns outside the measured list`).to.deep.equal([]);
      }
      // pinned to the active version: a table carrying an inactive version
      // would otherwise yield its fields twice
      for (const sql of fake.sent.filter((s) => /FROM DD/i.test(s))) {
        expect(sql, sql).to.include(`AS4LOCAL = 'A'`);
        expect(sql, sql).to.include(`AS4VERS = '0000'`);
      }
      // the run was the real run: XML written, MANDT answered
      expect(existsSync(join(out, "zosd_h1_probe.tabl.xml")), "--out wrote the table").to.equal(true);
      expect(lines.join("\n")).to.include("MANDT as the first key field: yes");
      // where INTTYPE/INTLEN came from, said out loud: ZOSD_H1_ELEM's DD03L
      // row leaves both blank, so they were derived and the probe says so;
      // the other two fields carry DD03L's own values and are not mentioned
      const said = lines.join("\n");
      expect(said).to.match(/ZOSD_H1_ELEM.*derived/);
      expect(said).to.not.match(/MANDT.*derived/);
      expect(said).to.not.match(/ZOSD_H1_KEY.*derived/);
    } finally {
      rmSync(out, {recursive: true, force: true});
    }
  });
});
