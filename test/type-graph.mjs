import {expect} from "chai";
import {ObjectStore} from "../tools/osd-store.mjs";
import {resolveType, typeGraph} from "../tools/osd-type-graph.mjs";
import {ddicCatalogue, ddicKeys} from "../tools/sqlscript-ddic-catalogue.mjs";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// D.3, the signature → metadata graph. `/sap/bc/osd/rfc/functions/<NAME>`
// answers a module's parameters with the **names** of their DDIC types, and a
// caller that has to encode a value needs to know what a name is. The bridge
// builds such a graph by hand today, for one function.
describe("a DDIC type name, resolved to what it is", () => {
  const store = new ObjectStore();

  it("follows a data element to its domain, which is where the type lives", () => {
    // ZOSD_TEST_STATUS carries `<DOMNAME>` and **no** `<DATATYPE>` — reading
    // the element alone answers "", which is how a CHAR(1) reads as an empty
    // type. `tools/adt-documents.mjs` does exactly that for a table field,
    // and this is the hop it is missing.
    const t = resolveType(store, "ZOSD_TEST_STATUS");
    expect(t.KIND).to.equal("DTEL");
    expect(t.DOMAIN).to.equal("ZOSD_TEST_STATUS");
    expect({type: t.DATATYPE, length: t.LENG}).to.deep.equal({type: "CHAR", length: 1});
    expect(t.LETTER, "and the ABAP letter a codec encodes with").to.equal("C");
  });

  it("walks a structure into its components, each resolved in turn", () => {
    const t = resolveType(store, "ZOSD_TEST_ITEM");
    expect(t.KIND).to.equal("STRUCTURE");
    expect(t.FIELDS.length, "the table has fields").to.be.greaterThan(2);
    const mandt = t.FIELDS.find((f) => f.NAME === "MANDT");
    expect(mandt.KEY, "the key flag survives").to.equal(true);
    expect(mandt.TYPE.DATATYPE, "a component names a data element and it is resolved too")
      .to.equal("CLNT");
  });

  it("answers a built-in without looking in the dictionary", () => {
    // STRING is not a DTEL and a lookup for it would fail; it is a type all
    // the same, and a codec needs its letter
    expect(resolveType(store, "STRING")).to.include({KIND: "BUILTIN", LETTER: "g"});
  });

  it("says a type is unresolved rather than guessing CHAR at it", () => {
    // the alternative is what a caller would then encode with, and encoding a
    // packed number as characters is the silent kind of wrong
    const t = resolveType(store, "ZNO_SUCH_TYPE");
    expect(t.KIND).to.equal("UNRESOLVED");
    expect(t.REASON, "and says where it looked").to.match(/DTEL, TABL or TTYP/);
  });

  it("does not loop on a type that contains itself", () => {
    const seen = new Set(["ZOSD_TEST_ITEM"]);
    expect(resolveType(store, "ZOSD_TEST_ITEM", seen).KIND).to.equal("CYCLE");
  });

  it("a signature becomes one entry per type, however many parameters use it", () => {
    const graph = typeGraph(store, [
      {NAME: "IV_A", TYPE: "ZOSD_TEST_STATUS"},
      {NAME: "IV_B", TYPE: "ZOSD_TEST_STATUS"},
      {NAME: "EV_T", TYPE: "STRING"},
    ]);
    expect(Object.keys(graph).sort()).to.deep.equal(["STRING", "ZOSD_TEST_STATUS"]);
    expect(graph.ZOSD_TEST_STATUS.LENG).to.equal(1);
  });
});

describe("the typed catalogue at the Portable-AMDP boundary", () => {
  const store = new ObjectStore();

  it("carries only requested USING tables and preserves fixed RAW", () => {
    const catalogue = ddicCatalogue(store, ["ZVDB_100_VEC"]);
    expect(Object.keys(catalogue)).to.deep.equal(["ZVDB_100_VEC"]);
    expect(catalogue.ZVDB_100_VEC.MANDT).to.deep.equal({abap: "C", len: 3});
    expect(catalogue.ZVDB_100_VEC.DIMS).to.deep.equal({abap: "I"});
    expect(catalogue.ZVDB_100_VEC.QBITS).to.deep.equal({abap: "X", len: 192});
  });

  it("ignores a called procedure in USING rather than mistaking it for DDIC", () => {
    expect(ddicCatalogue(store, ["ZCL_OSD_AMDP_DEMO=>TOTAL_AMOUNT"])).to.deep.equal({});
  });
});

// The same chain, where it had been missing for as long as the data preview
// has existed: a **table field** typed by a data element.
describe("a table field typed by a data element gets the domain's type", () => {
  const store = new ObjectStore();

  it("shows CHAR(1) for a field whose element carries no type of its own", async () => {
    // `tools/adt-documents.mjs` read the element's own `<DATATYPE>` and
    // stopped. A data element usually has none — it names a domain — so the
    // field came back with **no type and no letter at all**, which is what a
    // consumer of the preview and of the ADT documents received.
    const {tableFieldsOf} = await import("../tools/adt-documents.mjs");
    const status = tableFieldsOf(store, store.read("TABL", "ZOSD_TEST_ITEM"))
      .fields.find((f) => f.name === "STATUS");
    expect({type: status.dataType, length: status.length, letter: status.letter})
      .to.deep.equal({type: "CHAR", length: 1, letter: "C"});
  });

  it("leaves no field of any table in this tree without a type", async () => {
    // measured before the fix: six of 1041, among them SOLI-LINE (CHAR 255)
    // and two columns of the demo's own table. Asserted over the whole tree
    // rather than over the one field, because the defect was in the rule and
    // a test on one field would pass again the next time the rule slips
    const {tableFieldsOf} = await import("../tools/adt-documents.mjs");
    const without = [];
    for (const o of store.list().filter((x) => x.type === "TABL")) {
      let table;
      try {
        table = tableFieldsOf(store, store.read("TABL", o.name));
      } catch {
        continue;
      }
      for (const f of table.fields) {
        if (f.element !== "" && f.dataType === "") without.push(`${o.name}-${f.name} (${f.element})`);
      }
    }
    expect(without, without.join("\n")).to.have.length(0);
  });

  it("and the case where the old default would have been wrong, not merely empty", () => {
    // fable-osd's objection, measured before this was written: for all six
    // fields that were actually broken the domain is CHAR, so a default of
    // `C` would have been **accidentally right** and the harm invisible. The
    // harm is visible on a domain that is not CHAR, and the tree has the
    // elements even though no field uses one yet:
    //
    //   TZNTSTMPL / TIMESTAMPL  DEC(21)  -> a packed timestamp as characters
    //   MEINS                   UNIT(3)
    //
    // So the mechanism is asserted on those directly. The day a table field
    // is typed by one of them, this is what stops it being encoded wrong.
    expect(resolveType(store, "TIMESTAMPL")).to.include({DATATYPE: "DEC", LENG: 21, LETTER: "P"});
    expect(resolveType(store, "MEINS")).to.include({DATATYPE: "UNIT", LENG: 3});
  });

  it("and every field has a letter, because an empty letter is not a type", () => {
    // the letter is what a codec encodes with; `C` is the dictionary's own
    // default for a kind it does not know, and "" is not a default at all
    expect(resolveType(store, "ZOSD_TEST_STATUS").LETTER).to.equal("C");
  });
});

// The include rows of a table. 340 of the 1980 tables in one A4H export
// carry one, and the walk used to skip every row whose name begins with a
// dot -- so those tables were partial schemas, and a column that is not in
// the schema is read as STRING by the non-strict binder. Fixtures are
// written here rather than taken from src/, which has no include.
describe("a table's include rows are its fields too", () => {
  const dtel = (name, datatype, leng) => `<abapGit><asx:abap><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DATATYPE>${datatype}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG><DECIMALS>000000</DECIMALS></DD04V></asx:values></asx:abap></abapGit>`;
  const field = (name, element) => `<DD03P><FIELDNAME>${name}</FIELDNAME><ROLLNAME>${element}</ROLLNAME></DD03P>`;
  const include = (row, structure) => `<DD03P><FIELDNAME>${row}</FIELDNAME><PRECFIELD>${structure}</PRECFIELD><COMPTYPE>S</COMPTYPE></DD03P>`;
  const tabl = (name, rows) => `<abapGit><asx:abap><asx:values><DD02V><TABNAME>${name}</TABNAME><TABCLASS>INTTAB</TABCLASS></DD02V><DD03P_TABLE>${rows.join("")}</DD03P_TABLE></asx:values></asx:abap></abapGit>`;
  let dir;
  let store;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-type-graph-include-"));
    writeFileSync(join(dir, "zflag.dtel.xml"), dtel("ZFLAG", "CHAR", 1));
    writeFileSync(join(dir, "zday.tabl.xml"), tabl("ZDAY", [field("WORK", "ZFLAG"), field("FREE", "ZFLAG")]));
    writeFileSync(join(dir, "zkey.tabl.xml"), tabl("ZKEY", [field("ID", "ZFLAG")]));
    writeFileSync(join(dir, "zplain.tabl.xml"), tabl("ZPLAIN", [field("A", "ZFLAG"), include(".INCLUDE", "ZKEY"), field("B", "ZFLAG")]));
    writeFileSync(join(dir, "zweek.tabl.xml"), tabl("ZWEEK", [include(".INCLU-_MO", "ZDAY"), include(".INCLU-_TU", "ZDAY")]));
    writeFileSync(join(dir, "zappend.tabl.xml"), tabl("ZAPPEND", [field("A", "ZFLAG"), include(".INCLU--AP", "ZKEY")]));
    writeFileSync(join(dir, "zbroken.tabl.xml"), tabl("ZBROKEN", [field("A", "ZFLAG"), include(".INCLUDE", "ZNOWHERE")]));
    writeFileSync(join(dir, "zself.tabl.xml"), tabl("ZSELF", [include(".INCLUDE", "ZSELF")]));
    store = new FolderDdic([dir]);
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("keys every field of an include whose row is a key, and a key field after a non-key one (ddicKeys)", () => {
    const keyField = (name, element) => field(name, element).replace("<FIELDNAME>", "<KEYFLAG>X</KEYFLAG><FIELDNAME>");
    const keyInclude = (row, structure) => include(row, structure).replace("<FIELDNAME>", "<KEYFLAG>X</KEYFLAG><FIELDNAME>");
    writeFileSync(join(dir, "zkeys.tabl.xml"), tabl("ZKEYS", [field("ID", "ZFLAG"), field("POS", "ZFLAG")]));
    writeFileSync(join(dir, "zkeyed.tabl.xml"), tabl("ZKEYED", [keyField("MANDT", "ZFLAG"), keyInclude(".INCLUDE", "ZKEYS"), field("TXT", "ZFLAG")]));
    writeFileSync(join(dir, "zlate.tabl.xml"), tabl("ZLATE", [keyField("A", "ZFLAG"), field("B", "ZFLAG"), keyField("C", "ZFLAG")]));
    // a structure with keys of its own, included by a row that is no key:
    // the row decides, and the table's key is its own fields only
    writeFileSync(join(dir, "zowned.tabl.xml"), tabl("ZOWNED", [keyField("OCL", "ZFLAG"), keyField("OID", "ZFLAG")]));
    writeFileSync(join(dir, "znonkey.tabl.xml"), tabl("ZNONKEY", [keyField("MANDT", "ZFLAG"), keyField("K", "ZFLAG"), include(".INCLUDE", "ZOWNED")]));
    const fresh = new FolderDdic([dir]);
    expect(ddicKeys(fresh, ["ZKEYED", "ZLATE", "ZPLAIN", "ZNOWHERE", "ZNONKEY"])).to.deep.equal({ZKEYED: ["MANDT", "ID", "POS"], ZLATE: ["A", "C"], ZNONKEY: ["MANDT", "K"]});
  });

  it("splices an .INCLUDE where the row stands, in order", () => {
    expect(resolveType(store, "ZPLAIN").FIELDS.map((f) => f.NAME)).to.deep.equal(["A", "ID", "B"]);
  });

  it("appends the suffix of an .INCLU-XXX to every included field, as the export shows (a demo week table: WORK_MO, FREE_MO)", () => {
    expect(resolveType(store, "ZWEEK").FIELDS.map((f) => f.NAME)).to.deep.equal(["WORK_MO", "FREE_MO", "WORK_TU", "FREE_TU"]);
  });

  it("brings an append structure (.INCLU--AP) in under its own names", () => {
    expect(resolveType(store, "ZAPPEND").FIELDS.map((f) => f.NAME)).to.deep.equal(["A", "ID"]);
  });

  it("marks an include it cannot resolve, and the catalogue refuses the table rather than serving part of it", () => {
    const t = resolveType(store, "ZBROKEN");
    expect(t.FIELDS.map((f) => f.NAME)).to.deep.equal(["A", ".INCLUDE ZNOWHERE"]);
    expect(t.FIELDS[1].INCLUDE).to.equal("ZNOWHERE");
    expect(() => ddicCatalogue(store, ["ZBROKEN"])).to.throw(/include ZNOWHERE did not resolve/);
    expect(ddicCatalogue(store, ["ZPLAIN"]).ZPLAIN).to.have.keys(["A", "ID", "B"]);
  });

  it("resolves a data element used by two fields for both of them: a cycle is a name on its own path, not a name seen before", () => {
    const t = resolveType(store, "ZDAY");
    expect(t.FIELDS.map((f) => f.TYPE?.DATATYPE)).to.deep.equal(["CHAR", "CHAR"]);
  });

  it("keeps the first of a field an exporter wrote twice, and records the second", () => {
    writeFileSync(join(dir, "zexpanded.tabl.xml"), tabl("ZEXPANDED", [field("A", "ZFLAG"), include(".INCLUDE", "ZKEY"), field("ID", "ZFLAG"), field("B", "ZFLAG")]));
    const t = resolveType(new FolderDdic([dir]), "ZEXPANDED");
    expect(t.FIELDS.map((f) => f.NAME)).to.deep.equal(["A", "ID", "B"]);
    expect(t.DUPLICATES).to.deep.equal(["ID"]);
    expect(resolveType(store, "ZPLAIN").DUPLICATES).to.equal(undefined);
  });

  it("resolves the same through an ObjectStore, whose read throws for a missing object rather than answering undefined", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-type-graph-store-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
      writeFileSync(join(root, "src", "zflag.dtel.xml"), dtel("ZFLAG", "CHAR", 1));
      writeFileSync(join(root, "src", "zkey.tabl.xml"), tabl("ZKEY", [field("ID", "ZFLAG")]));
      writeFileSync(join(root, "src", "zplain.tabl.xml"), tabl("ZPLAIN", [field("A", "ZFLAG"), include(".INCLUDE", "ZKEY"), field("B", "ZFLAG")]));
      writeFileSync(join(root, "src", "zbroken.tabl.xml"), tabl("ZBROKEN", [field("A", "ZFLAG"), include(".INCLUDE", "ZNOWHERE")]));
      const objectStore = new ObjectStore({root, libs: []});
      expect(resolveType(objectStore, "ZPLAIN").FIELDS.map((f) => f.NAME)).to.deep.equal(["A", "ID", "B"]);
      expect(ddicCatalogue(objectStore, ["ZPLAIN"]).ZPLAIN).to.have.keys(["A", "ID", "B"]);
      expect(() => ddicCatalogue(objectStore, ["ZBROKEN"])).to.throw(/include ZNOWHERE did not resolve/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("does not loop on a table that includes itself", () => {
    const t = resolveType(store, "ZSELF");
    expect(t.KIND).to.equal("STRUCTURE");
    expect(t.FIELDS[0].INCLUDE).to.equal("ZSELF");
  });

  it("looks a name up as a table when no data element of that name exists", () => {
    // a store that answers undefined for a missing object used to make every
    // name a DTEL of no type, so a table was never resolved as one
    expect(resolveType(store, "ZKEY").KIND).to.equal("STRUCTURE");
    expect(resolveType(store, "ZNOWHERE").KIND).to.equal("UNRESOLVED");
  });
});
