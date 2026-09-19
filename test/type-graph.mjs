import {expect} from "chai";
import {ObjectStore} from "../tools/osd-store.mjs";
import {resolveType, typeGraph} from "../tools/osd-type-graph.mjs";

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
