import {expect} from "chai";
import {createRequire} from "node:module";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {run, tablesFromValidation} from "../tools/hana-ddic-gen.mjs";
import {layers} from "../tools/osd-inputs.mjs";

// DDIC from the real DD03L for the build (tools/hana-ddic-gen.mjs, H3 A).
//
// Two seams are tested without a HANA. The transpile side is pure: the names
// the generation references but no input folder defines surface in the
// transpiler's own validation error, and extracting them is parsing that
// output, not ABAP. The database side is the probe's mapping behind a fake
// driver: the fixture tables are ZOSD_H3_*, and the XML written is the tree's
// own abapGit TABL shape, asserted piece by piece.
describe("hana-ddic-gen: DDIC from the real DD03L for the build", () => {
  it("reads the unresolved table names out of the transpile's own words", () => {
    // the two shapes a missing DDIC name surfaces in, verbatim from a thrown
    // transpiler validation (measured in .local/h3-exp1.mjs, 2026-11-11): a
    // check_syntax line naming the table of a SELECT, an unknown_types line
    // naming the type of a variable. Everything else in the same error --
    // here a made-up third issue -- names no table and is ignored.
    const message = [
      `check_syntax, Database table or view "zosd_h3_head" not found, zcl_h3_ref.clas.abap:8`,
      `unknown_types, Variable "LT_FLAT" contains unknown: ZOSD_H3_FLAT not found, lookup, zcl_h3_ref.clas.abap:9`,
      `check_syntax, Database table or view "scarr" not found, zcl_h3_ref.clas.abap:12`,
      `check_datasets, Open ABAP Cloud shapes only, zcl_h3_ref.clas.abap:3`,
    ].join("\n");
    expect(tablesFromValidation(message)).to.deep.equal(["SCARR", "ZOSD_H3_FLAT", "ZOSD_H3_HEAD"]);
  });

  it("an empty validation names nothing", () => {
    expect(tablesFromValidation("")).to.deep.equal([]);
  });

  it("a /-namespaced name is extracted with its namespace", () => {
    // critic SHOULD 4 at f0a248af1: the filter admitted `/`, the captures
    // refused it -- a dead branch. Both shapes of the validation line now
    // carry a /ZOSD/ namespace through.
    const message = [
      `check_syntax, Database table or view "/zosd/carrier" not found, zcl_h3_ref.clas.abap:8`,
      `unknown_types, Variable "LT_FLAT" contains unknown: /ZOSD/H3_FLAT not found, lookup, zcl_h3_ref.clas.abap:9`,
    ].join("\n");
    expect(tablesFromValidation(message)).to.deep.equal(["/ZOSD/CARRIER", "/ZOSD/H3_FLAT"]);
  });

  // the fake answers what the probe's reads ask, the way HANA answers: the
  // rows of the table the statement names, projected to the columns it
  // selected, filtered to the TABNAME the WHERE pinned. ZOSD_H3_* fixtures;
  // ZOSD_H3_HEAD carries MANDT as the first key, ZOSD_H3_FLAT is
  // client-independent.
  const ROWS = {
    DD02L: [
      {TABNAME: "ZOSD_H3_HEAD", TABCLASS: "TRANSP", CLIDEP: "X"},
      {TABNAME: "ZOSD_H3_FLAT", TABCLASS: "TRANSP", CLIDEP: ""},
    ],
    DD03L: [
      {TABNAME: "ZOSD_H3_HEAD", POSITION: "1", FIELDNAME: "MANDT", KEYFLAG: "X", ROLLNAME: "MANDT", DATATYPE: "CLNT", LENG: "3", DECIMALS: "0", INTTYPE: "C", INTLEN: "000006", NOTNULL: "X"},
      {TABNAME: "ZOSD_H3_HEAD", POSITION: "2", FIELDNAME: "ZOSD_H3_KEY", KEYFLAG: "X", ROLLNAME: "", DATATYPE: "CHAR", LENG: "10", DECIMALS: "0", INTTYPE: "C", INTLEN: "000020", NOTNULL: "X"},
      {TABNAME: "ZOSD_H3_FLAT", POSITION: "1", FIELDNAME: "ZOSD_H3_NAME", KEYFLAG: "", ROLLNAME: "", DATATYPE: "CHAR", LENG: "30", DECIMALS: "0", INTTYPE: "C", INTLEN: "000060", NOTNULL: ""},
    ],
    DD04L: [],
    DD01L: [],
    DD02T: [
      {TABNAME: "ZOSD_H3_HEAD", DDTEXT: "gen fixture head"},
      {TABNAME: "ZOSD_H3_FLAT", DDTEXT: "gen fixture flat"},
    ],
  };
  const rowsFor = (sql) => {
    const table = /^\s*SELECT\s+.+?\s+FROM\s+"?[A-Za-z_][A-Za-z_0-9]*"?(\s|$)/i.exec(sql)?.[0] === undefined ? undefined
      : /FROM\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/i.exec(sql)?.[1]?.toUpperCase();
    if (table === undefined || table === "DUMMY") return [];
    const pinned = /TABNAME\s*=\s*'([A-Z0-9_]+)'/.exec(sql)?.[1];
    return (ROWS[table] ?? []).filter((row) => pinned === undefined || row.TABNAME === pinned);
  };
  // the fake stands in through the CJS cache a real require uses; the
  // suites runner runs a shard's files in ONE process, so the stand-in is
  // given back after every test -- the next hdb consumer in the shard
  // otherwise gets a driver without prepare (FIX-4, the sqlscript suites).
  // the give-back is a DELETE, not a restore: at the first fakeHdb call the
  // real driver has never been required (hana-client loads hdb inside
  // connect()), so a saved original would be undefined and every restore
  // would return early -- the stand-in then survived the suite (the second
  // hold's GREEN 3: sqlscript-eager connected through it, prepare missing).
  // The next require after the delete loads the real driver fresh.
  afterEach(() => {
    const req = createRequire(import.meta.url);
    delete req.cache[req.resolve("hdb")];
  });

  const fakeHdb = () => {
    const sent = [];
    const require = createRequire(import.meta.url);
    const path = require.resolve("hdb");
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: {createClient: () => ({
        connect: (cb) => cb(undefined),
        setAutoCommit: () => undefined,
        exec: (sql, cb) => {
          sent.push(sql);
          if (/^\s*SELECT/i.test(sql) === false) return cb(undefined, 1); // SET SCHEMA
          cb(undefined, rowsFor(sql));
        },
        commit: (cb) => cb(undefined),
        rollback: (cb) => cb(undefined),
        end: () => undefined,
      })},
    };
    return sent;
  };

  it("--tables runs the probe's mapping and writes the tree's TABL XML", async () => {
    const sent = fakeHdb();
    const out = mkdtempSync(join(tmpdir(), "hana-ddic-gen-"));
    process.env.OSD_CLIENT = "001";
    let code;
    try {
      code = await run(["--tables", "ZOSD_H3_HEAD,ZOSD_H3_FLAT", "--out", out]);
    } finally {
      delete process.env.OSD_CLIENT;
    }
    try {
      expect(code, "the run is clean").to.equal(0);
      expect(existsSync(join(out, "zosd_h3_head.tabl.xml")), "the head table was written").to.equal(true);
      expect(existsSync(join(out, "zosd_h3_flat.tabl.xml")), "the flat table was written").to.equal(true);
      const head = readFileSync(join(out, "zosd_h3_head.tabl.xml"), "utf8");
      expect(head).to.include(`<TABNAME>ZOSD_H3_HEAD</TABNAME>`);
      expect(head).to.include(`<CLIDEP>X</CLIDEP>`);
      expect(head).to.include(`<DDTEXT>gen fixture head</DDTEXT>`);
      expect(head).to.include(`<TABCLASS>TRANSP</TABCLASS>`);
      // MANDT in the shape this tree writes it everywhere, as the first key
      expect(head).to.match(/<FIELDNAME>MANDT<\/FIELDNAME>\s*<KEYFLAG>X<\/KEYFLAG>\s*<ROLLNAME>MANDT<\/ROLLNAME>/);
      expect(head).to.match(/<FIELDNAME>ZOSD_H3_KEY<\/FIELDNAME>[\s\S]*?<DATATYPE>CHAR<\/DATATYPE>[\s\S]*?<LENG>000010<\/LENG>/);
      const flat = readFileSync(join(out, "zosd_h3_flat.tabl.xml"), "utf8");
      expect(flat).to.include(`<TABNAME>ZOSD_H3_FLAT</TABNAME>`);
      expect(flat).to.not.include(`<CLIDEP>X</CLIDEP>`);
      expect(flat).to.include(`<FIELDNAME>ZOSD_H3_NAME</FIELDNAME>`);
      // the run read the DD* tables, never wrote: the mode is a reader
      expect(sent.some((s) => /^\s*(CREATE|DROP|INSERT|UPDATE|DELETE)/i.test(s)), "no write reached the driver").to.equal(false);
    } finally {
      rmSync(out, {recursive: true, force: true});
    }
  });

  it("gen/hana-ddic is an input the hand-written src/ shadows, and the gen walk does not swallow it", () => {
    // the layering decision of H3 A, held as a test: gen/hana-ddic goes FIRST
    // in input_folder, so a hand-written src/**/<same>.tabl.xml -- a later
    // folder -- wins, and the real system's DDIC loses to an override only on
    // purpose. The plain "gen" walk must not pick the same files up a second
    // time: the owner would flip to gen and the build would hide both copies.
    const root = mkdtempSync(join(tmpdir(), "hana-ddic-layers-"));
    const write = (rel, body) => {
      mkdirSync(join(root, rel.split("/").slice(0, -1).join("/")), {recursive: true});
      writeFileSync(join(root, rel), body);
    };
    try {
      write("abap_transpile.json", JSON.stringify({input_folder: ["gen/hana-ddic", "src", "gen"]}));
      write("gen/hana-ddic/zosd_h3_a.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_A</TABNAME></abapGit>");
      write("src/zosd_h3_a.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_A</TABNAME><DDTEXT>hand-written wins</DDTEXT></abapGit>");
      write("gen/hana-ddic/zosd_h3_b.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_B</TABNAME></abapGit>");
      write("gen/zosd_h3_keep.tabl.xml", "<abapGit><TABNAME>ZOSD_H3_KEEP</TABNAME></abapGit>");
      const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
      const stack = layers(root, config);
      expect(stack.owner.get("TABL ZOSD_H3_A"), "the hand-written file wins").to.equal("src");
      expect(stack.hidden, "only the generated copy is hidden").to.deep.equal(["gen/hana-ddic/zosd_h3_a.tabl.xml"]);
      expect(stack.duplicates).to.deep.equal([]);
      expect(stack.total, "each object counted once: the gen walk skipped its nested input").to.equal(3);
      expect(stack.owner.get("TABL ZOSD_H3_B")).to.equal("gen/hana-ddic");
      expect(stack.owner.get("TABL ZOSD_H3_KEEP")).to.equal("gen");
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
