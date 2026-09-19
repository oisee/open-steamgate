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
