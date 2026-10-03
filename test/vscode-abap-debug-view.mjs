import {expect} from "chai";
import runtime from "@abaplint/runtime";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {customDescriptionGenerator, customPropertiesGenerator} = require("../editors/vscode/abap-debug-view.js");
const {debuggerConfiguration} = require("../editors/vscode/lib.js");
const description = new Function(`return (${customDescriptionGenerator});`)();
const properties = new Function(`return (${customPropertiesGenerator});`)();
const t = runtime.ABAP ? new runtime.ABAP().types : runtime.types;
const describeValue = (value) => description.call(value, "default JS");
const props = (value) => properties.call(value);

describe("VS Code ABAP values (serialized js-debug generators)", () => {
  const cases = [
    ["Character", () => new t.Character(20).set("ABC"), "'ABC' (c20)"],
    ["String", () => new t.String().set("ABC  "), "'ABC  ' (string)"],
    ["Integer", () => new t.Integer().set(-42), "-42 (i)"],
    ["Integer8", () => new t.Integer8().set("9223372036854775807"), "9223372036854775807 (int8)"],
    ["Packed", () => new t.Packed({length: 8, decimals: 2}).set("12.50"), "12.50 (p8,2)"],
    ["large Packed", () => new t.Packed({length: 16, decimals: 2}).set("12345678901234567890.12"), "12345678901234567890.12 (p16,2)"],
    ["negative Packed", () => new t.Packed({length: 8, decimals: 2}).set("-0.05"), "-0.05 (p8,2)"],
    ["Float", () => new t.Float().set(1.5), new t.Float().set(1.5).get() + " (f)"],
    ["Date", () => new t.Date().set("20261003"), "2026-10-03 (d)"],
    ["Time", () => new t.Time().set("123456"), "12:34:56 (t)"],
    ["XString", () => new t.XString().set("ABCDEF"), "ABCDEF (xstring)"],
    ["Hex", () => new t.Hex({length: 4}).set("ABCD"), "ABCD0000 (x4)"],
  ];
  for (const [name, make, expected] of cases) {
    it(`shows ${name} without runtime fields`, () => {
      const value = make();
      expect(describeValue(value)).to.equal(expected);
      expect(props(value)).to.deep.equal({});
    });
  }
  it("preserves leading CHAR spaces and escapes quotes and control characters", () => {
    expect(describeValue(new t.Character(20).set(" A'B\n"))).to.equal("' A''B\\n' (c20)");
  });
  it("shows initial scalars", () => {
    expect(describeValue(new t.Character(20))).to.equal("'' (c20)");
    expect(describeValue(new t.Packed({length: 8, decimals: 2}))).to.equal("0.00 (p8,2)");
    expect(describeValue(new t.Date())).to.equal("0000-00-00 (d)");
    expect(describeValue(new t.Time())).to.equal("00:00:00 (t)");
  });
  it("expands nested structures by declared component name and identity", () => {
    const nested = new t.Structure({amount: new t.Packed({length: 8, decimals: 2}).set("12.50")});
    const fields = {name: new t.Character(20).set("ABC"), nested};
    const value = new t.Structure(fields);
    expect(describeValue(value)).to.equal("{…} (structure)");
    expect(props(value)).to.equal(fields);
    expect(describeValue(props(value).nested)).to.equal("{…} (structure)");
    expect(describeValue(props(nested).amount)).to.equal("12.50 (p8,2)");
  });
  for (const type of ["STANDARD", "SORTED", "HASHED"]) {
    it(`shows ${type.toLowerCase()} rows from 1 and caps expansion at 100`, () => {
      const options = {primaryKey: {name: "primary_key", type, keyFields: ["TABLE_LINE"], isUnique: true}};
      const value = type === "HASHED" ? new t.HashedTable(new t.Integer(), options) : new t.Table(new t.Integer(), options);
      expect(describeValue(value)).to.equal(`[0 rows] (${type.toLowerCase()} table)`);
      expect(Object.keys(props(value))).to.deep.equal([]);
      for (let i = 1; i <= 103; i++) {
        if (type === "HASHED") value.insert(new t.Integer().set(i));
        else value.append(new t.Integer().set(i));
      }
      expect(describeValue(value)).to.equal(`[103 rows] (${type.toLowerCase()} table)`);
      const shown = props(value);
      expect(Object.keys(shown)).to.have.length(101);
      expect(shown["1"]).to.equal(value.array()[0]);
      expect(describeValue(shown["100"])).to.equal("100 (i)");
      expect(shown["…more"]).to.equal("3 more rows (first 100 shown)");
    });
  }
  it("keeps a table header visible separately from rows", () => {
    const value = new t.Table(new t.Integer(), {withHeader: true});
    expect(props(value).header).to.equal(value.header);
    expect(Object.keys(props(value))).to.deep.equal(["header"]);
  });
  for (const name of ["FieldSymbol", "DataReference"]) {
    it(`shows ${name} targets, initial state and cycles safely`, () => {
      const value = new t[name](new t.Integer());
      expect(describeValue(value)).to.equal(name === "FieldSymbol" ? "-> unassigned (field symbol)" : "-> initial (data reference)");
      expect(props(value)).to.deep.equal({});
      const target = new t.Structure({count: new t.Integer().set(42)});
      value.assign(target);
      expect(describeValue(value)).to.equal("-> {…} (structure)");
      expect(props(value)["->"]).to.equal(target);
      value.assign(new t.Integer().set(42));
      expect(describeValue(value)).to.equal("-> 42 (i)");
      value.assign(value);
      expect(describeValue(value)).to.equal("-> -> … (reference cycle/limit)");
    });
  }
  it("shows object class and public, private and inherited attributes without methods", () => {
    class zcl_demo {
      static INTERNAL_TYPE = "CLAS";
      static INTERNAL_NAME = "ZCL_DEMO";
      count = new t.Integer().set(42);
      me = new t.ABAPObject().set(this);
      FRIENDS_ACCESS_INSTANCE = Object.assign(Object.create({inherited: new t.String().set("base")}), {secret: new t.Character(5).set("abc"), method() {throw Error("must not run");}});
    }
    const object = new zcl_demo();
    const value = new t.ABAPObject({qualifiedName: "ZCL_BASE"}).set(object);
    expect(describeValue(value)).to.equal("ZCL_DEMO (object)");
    expect(describeValue(object)).to.equal("ZCL_DEMO (object)");
    expect(Object.keys(props(value))).to.deep.equal(["count", "secret", "inherited"]);
    expect(props(object).secret).to.equal(object.FRIENDS_ACCESS_INSTANCE.secret);
    expect(describeValue(new t.ABAPObject())).to.equal("initial (object)");
  });
  it("falls back unchanged for unknown objects, primitives and throwing accessors", () => {
    for (const value of [{get() {return 42;}}, new Date(), [], null, undefined, 42, "text", new Proxy({}, {get() {throw Error("no");}})]) {
      expect(describeValue(value)).to.equal("default JS");
      expect(props(value)).to.equal(value);
    }
    const broken = new t.Character(2);
    broken.get = () => {throw Error("broken");};
    expect(describeValue(broken)).to.equal("default JS");
    expect(props(broken)).to.equal(broken);
  });
  it("installs both executable generators for system and ABAP Unit sessions", () => {
    for (const target of ["system", "unit"]) {
      const config = debuggerConfiguration(9400, {target});
      expect(config.customDescriptionGenerator).to.equal(customDescriptionGenerator);
      expect(config.customPropertiesGenerator).to.equal(customPropertiesGenerator);
    }
  });
});
