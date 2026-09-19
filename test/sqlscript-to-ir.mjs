import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr, BindError} from "../tools/sqlscript/to-ir.mjs";
import {schemaOf, refTo, scan} from "../tools/sqlscript-ir.mjs";

// Stage 3: the syntax tree into the IR the lowering already eats. Two jobs,
// and the tests are about the two: the binder splices a table variable in
// place (because an assignment is not an observable barrier on HANA), and the
// typer puts a type on every expression (because the lowering picks the form
// by it).
const CATALOGUE = {SRC: {K: {abap: "C", len: 4}, N: {abap: "I"}, TXT: {abap: "C", len: 10}}};
const ir = (src, catalogue = CATALOGUE) => toIr(parse(new Body(), lex(src)), {catalogue});
const walk = (node, found = []) => {
  if (node !== null && typeof node === "object") {
    if (node.node !== undefined || node.rel !== undefined) found.push(node);
    for (const v of Object.values(node)) walk(v, found);
  }
  return found;
};

describe("the SQLScript tree into the IR", () => {

  it("splices a table variable in place rather than leaving a var node", () => {
    // the measurement that decides this: on HANA an assignment is not an
    // observable barrier, so three assignments are one plan
    const {statements, rel} = ir("a = SELECT k FROM src;\nb = SELECT k FROM :a;\nSELECT k FROM :b;");
    expect(statements, "the assignments are known").to.have.length(2);
    expect(JSON.stringify(rel), "and spliced, not referenced").to.not.contain('"var"');
    expect(walk(rel).filter((n) => n.rel === "scan"), "down to the real table").to.have.length(1);
  });

  it("refuses a table variable nobody assigned, by name", () => {
    // a table named like a variable is ordinary, so reading one silently
    // would be plausible and wrong
    expect(() => ir("SELECT k FROM :nope;")).to.throw(BindError, /unknown table variable :nope/);
  });

  // A table, not an example (fable-osd). This stage maps a set of operators
  // onto one representation, and the defect it had -- every comparison
  // collapsing to `=` -- was invisible on `=`, which is exactly the element
  // it collapsed into. A stage that maps many values onto one must be tested
  // across the whole set, because collapsing always looks correct on the
  // value collapsed into.
  for (const op of ["=", "<>", "<", ">", "<=", ">="]) {
    it(`parses ${op} as ${op}, and the whole table is checked because = hid the defect`, () => {
      const found = walk(ir(`SELECT k FROM src WHERE n ${op} 1;`).rel)
        .filter((n) => n.node === "bin").map((n) => n.op);
      expect(found, `${op} survived`).to.include(op);
      if (op !== "=") {
        expect(found, "and did not become equality on the way").to.not.include("=");
      }
    });
  }

  it("types a column from the catalogue and a literal from what it is", () => {
    const nodes = walk(ir("SELECT k FROM src WHERE n > 1;").rel);
    const column = nodes.find((n) => n.node === "col" && n.name === "N");
    const literal = nodes.find((n) => n.node === "lit");
    expect(column.type, "from the dictionary, not from the value").to.deep.equal({abap: "I"});
    expect(literal.type).to.deep.equal({abap: "I"});
  });

  it("makes a division decimal, because that is what HANA answers", () => {
    // measured on HANA Express: 1/2 is 0.500000, not 0
    // (docs/sqlscript-hana-observed.md). The type decides the rendering, so
    // getting it wrong here produces a different number on every engine.
    const division = walk(ir("SELECT n / 2 AS half FROM src;").rel)
      .find((n) => n.node === "bin" && n.op === "/");
    expect(division.type).to.deep.equal({abap: "P", len: 15, dec: 2});
  });

  it("keeps a placeholder a parameter, not merely a plan that validates", () => {
    // the assertion is that it stayed a `param`, not that the plan came out
    // well formed: matched as a word it was invisible as a parameter and the
    // plan was still perfectly valid
    const nodes = walk(ir("SELECT k FROM src CROSS JOIN (SELECT ? AS v) x;").rel);
    expect(nodes.filter((n) => n.node === "param"), "the scalar rides in bound").to.have.length(1);
    expect(JSON.stringify(nodes), "and never as text").to.not.contain('"?"');
  });

  it("refuses a bare ref and accepts one carrying its schema, which is what the binder relies on", () => {
    // `ref` is the one node whose columns cannot be derived from what is
    // under it, because nothing is. The binder's barrier path therefore uses
    // refTo(handle, schemaOf(plan)) -- this asserts the contract that makes
    // that the shorter path, rather than asserting that a function exists,
    // which is a test that cannot fail.
    expect(() => schemaOf({rel: "ref", handle: "h"}, CATALOGUE),
      "a bare ref has nothing to say").to.throw();
    const carried = refTo("h", schemaOf(scan("SRC"), CATALOGUE));
    expect(schemaOf(carried, CATALOGUE), "and one that carries it, answers")
      .to.deep.equal(CATALOGUE.SRC);
  });

  it("takes the catalogue as an argument, so it needs no running system", () => {
    const own = ir("SELECT k FROM other WHERE k = 'x';", {OTHER: {K: {abap: "C", len: 8}}});
    const column = walk(own.rel).find((n) => n.node === "col" && n.name === "K");
    expect(column.type).to.deep.equal({abap: "C", len: 8});
  });
});
