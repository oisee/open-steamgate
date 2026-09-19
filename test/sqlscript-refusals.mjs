import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr} from "../tools/sqlscript/to-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {schemaOf, adversarialRows, tableShapesPerTable, effects} from "../tools/sqlscript-ir.mjs";

// **Every refusal has to be a refusal, not a crash.**
//
// Five corpus bodies were filed under "Cannot read properties of undefined
// (reading 'children')", which is not a message about them: it names the line
// that fell over, not the thing that was wrong. A histogram of those is a
// histogram of where the walkers stand. `c_is_active := 'X'` is an assignment
// to a **scalar**, and saying so points at the defect; the TypeError pointed
// at `kids`.
//
// Measured rather than grepped, because grepping for `.children` finds the
// walkers and not the call sites that hand them nothing. This suite puts
// shapes the binder does not expect through **six** entry points and asserts
// that none of them throws a TypeError. Run against the code before the
// guards, it reports 24 crashes; after, none.
const SHAPES = [
  ["an assignment to a scalar", "c_is_active := 'X';"],
  ["a scalar from a function call", "ex_cnt_svers = record_count( svers );"],
  ["arithmetic into a scalar", "lv := 1 + 2;"],
  ["a relation and then a scalar", "lt = SELECT k FROM src; lv := 'x';"],
  ["a RETURN of an unassigned variable", "RETURN SELECT * FROM :nothing;"],
  ["ORDER BY over an expression", "lt = SELECT k FROM src ORDER BY n + 1;"],
  ["a star mixed with names", "SELECT *, k FROM src;"],
  ["a CASE with no ELSE behind a variable", "lt = SELECT k FROM src; SELECT CASE k WHEN 1 THEN 2 END FROM :lt;"],
];

const STAGES = {
  toIr: (tree) => toIr(tree, {catalogue: {}}),
  lower: (tree) => lower(toIr(tree, {catalogue: {}}).rel, "hana"),
  schemaOf: (tree) => schemaOf(toIr(tree, {catalogue: {}}).rel, {}),
  effects: (tree) => effects(toIr(tree, {catalogue: {}}).rel),
  shapes: (tree) => tableShapesPerTable(toIr(tree, {catalogue: {}}).rel),
  adversarialRows: (tree) => adversarialRows(toIr(tree, {catalogue: {}}).rel, {}),
};

describe("a shape the binder does not expect is refused by name, never crashed on", () => {
  for (const [label, body] of SHAPES) {
    it(label, () => {
      const tree = parse(new Body(), lex(body));
      for (const [stage, run] of Object.entries(STAGES)) {
        try {
          run(tree);
        } catch (error) {
          expect(error, `${stage}: ${error.message}`).to.not.be.an.instanceof(TypeError);
          expect(error.message, `${stage} said nothing a reader can act on`).to.have.length.greaterThan(10);
        }
      }
    });
  }

  it("and the refusal names the thing, not the line that fell over", () => {
    const tree = parse(new Body(), lex("c_is_active := 'X';"));
    expect(() => toIr(tree, {catalogue: {}})).to.throw(/is of a scalar, and this IR carries relations/);
  });
});
