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

  it("widens textual COALESCE to the longer fixed character operand", () => {
    expect(schemaOf(ir("SELECT COALESCE(txt, 'x') AS value FROM src;").rel, CATALOGUE).VALUE)
      .to.deep.equal({abap: "C", len: 10});
    expect(schemaOf(ir("SELECT COALESCE(txt, 'abcdefghijkl') AS value FROM src;").rel, CATALOGUE).VALUE)
      .to.deep.equal({abap: "C", len: 12});
    expect(() => ir("SELECT COALESCE(txt, 'x') AS value FROM src;", {SRC: {TXT: {abap: "C"}}}))
      .to.throw(BindError, /COALESCE arguments require identical measured types/);
    expect(() => ir("SELECT COALESCE(a, b) AS value FROM src;", {SRC: {A: {abap: "C"}, B: {abap: "C"}}}))
      .to.throw(BindError, /COALESCE arguments require identical measured types/);
    expect(() => ir("SELECT COALESCE(a, b) AS value FROM src;", {
      SRC: {A: {abap: "STRING", len: 3}, B: {abap: "STRING", len: 3}},
    })).to.throw(BindError, /COALESCE arguments require identical measured types/);
  });

  it("types LOWER and LOCATE only for exact measured text descriptors", () => {
    const plan = ir("SELECT LOWER(txt) AS folded, LOCATE(txt, k) AS position FROM src;");
    const nodes = walk(plan.rel);
    expect(nodes.find((one) => one.node === "call" && one.fn === "LOWER").type)
      .to.deep.equal({abap: "C", len: 10});
    expect(nodes.find((one) => one.node === "call" && one.fn === "LOCATE").type)
      .to.deep.equal({abap: "I"});
    for (const malformed of [{abap: "C"}, {abap: "STRING", len: 3}]) {
      expect(() => ir("SELECT LOWER(a) AS value FROM src;", {SRC: {A: malformed}}), JSON.stringify(malformed))
        .to.throw(BindError, /LOWER requires exactly one measured text argument/);
      expect(() => ir("SELECT LOCATE(a, b) AS value FROM src;", {SRC: {A: malformed, B: malformed}}),
        JSON.stringify(malformed)).to.throw(BindError, /LOCATE requires exactly two measured text arguments/);
    }
  });

  it("types fixed-binary Hamming primitives without degrading them to text", () => {
    const catalogue = {VECTORS: {A: {abap: "X", len: 96}, B: {abap: "X", len: 96}}};
    const plan = ir("SELECT BITCOUNT(BITXOR(a, b)) AS distance FROM vectors;", catalogue);
    const nodes = walk(plan.rel);
    expect(nodes.find((one) => one.node === "call" && one.fn === "BITXOR").type)
      .to.deep.equal({abap: "X", len: 96});
    expect(nodes.find((one) => one.node === "call" && one.fn === "BITCOUNT").type)
      .to.deep.equal({abap: "I"});
    expect(() => ir("SELECT BITXOR(a, b) AS bad FROM vectors;", {
      VECTORS: {A: {abap: "X", len: 96}, B: {abap: "X", len: 95}},
    })).to.throw(BindError, /same length/);
  });

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

  it("keeps identity values distinct from columns and refuses the unmodelled clock", () => {
    for (const [name, kind] of [["CURRENT_USER", "user"], ["CURRENT_SCHEMA", "schema"]]) {
      const plan = ir(`SELECT ${name} AS v FROM src;`, {SRC: {[name]: {abap: "C", len: 20}}});
      const value = walk(plan.rel).find((one) => one.node === "session");
      expect(value, name).to.deep.include({node: "session", kind, name});
      expect(walk(plan.rel).some((one) => one.node === "col" && one.name === name), name).to.equal(false);
    }
    for (const expression of ["s.CURRENT_USER", "s.\"CURRENT_USER\"", "\"CURRENT_USER\""]) {
      const plan = ir(`SELECT ${expression} AS v FROM src AS s;`,
        {SRC: {CURRENT_USER: {abap: "C", len: 20}}});
      expect(walk(plan.rel).some((one) => one.node === "session"), expression).to.equal(false);
      expect(walk(plan.rel).some((one) => one.node === "col" && one.name === "CURRENT_USER"), expression).to.equal(true);
    }
    for (const name of ["CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP"]) {
      expect(() => ir(`SELECT ${name} AS v FROM src;`), name)
        .to.throw(BindError, /portable clock semantics are not implemented/);
    }
  });

  it("models only literal-key SESSION_CONTEXT calls", () => {
    const plan = ir("SELECT SESSION_CONTEXT('NEUTRAL_MODE') AS v FROM src;");
    expect(walk(plan.rel).find((one) => one.node === "session"))
      .to.deep.include({node: "session", kind: "context", name: "NEUTRAL_MODE"});
    expect(() => ir("SELECT SESSION_CONTEXT(k) AS v FROM src;"))
      .to.throw(BindError, /requires one literal string key/);
  });

  // The `str()` trap, third occurrence, as a table rather than an example:
  // every form in which a `*` can appear. Each of the first two was found by
  // a failing corpus body rather than by a test, because every test used a
  // column list -- the shape that cannot expose it.
  for (const body of ["SELECT * FROM src;", "SELECT COUNT(*) FROM src;",
    "lt = SELECT k FROM src;\nSELECT * FROM :lt;"]) {
    it(`reads ${body.replace(/\n/g, " ")} without falling through to undefined`, () => {
      expect(() => ir(body)).to.not.throw();
    });
  }
});
