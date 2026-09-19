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

// **A clause the parser reads and the binder drops is the worst kind, because
// it counts as success.**
//
// The sentence was already in to-ir.mjs, written about ORDER BY. Three more
// clauses were in that state and nothing noticed, because nothing compared
// what the body MEANS against anything: the corpus count called them lowered
// and moved on. They were found on 2026-09-19 by giving one HANA the body's
// own SQLScript and our lowering of it at the same time, which is the only
// arrangement where the engine cannot be blamed.
//
// Each of these three lowered, silently, to a different program:
//
//   SELECT DISTINCT k   ->  SELECT "DISTINCT" AS "K"   a column called DISTINCT
//   ... GROUP BY n      ->  no grouping at all
//   ... HAVING c > 1    ->  the condition moved into the WHERE
//
// They are refused by name until the IR grows an aggregate. A refusal is a
// number going down and a claim becoming true.
describe("a clause the grammar reads and the IR does not carry is refused, not dropped", () => {
  const plan = (body) => toIr(parse(new Body(), lex(body)), {catalogue: {}}).rel;

  it("GROUP BY: refused, rather than lowering to an ungrouped select", () => {
    expect(() => plan("RETURN SELECT n FROM src GROUP BY n;")).to.throw(/GROUP BY is parsed but not carried/);
  });

  it("HAVING: refused, rather than becoming a WHERE", () => {
    expect(() => plan("RETURN SELECT n FROM src GROUP BY n HAVING COUNT(*) > 1;")).to.throw(/not carried into the IR/);
  });

  it("DISTINCT: refused, and the refusal says the grammar is ambiguous rather than blaming the body", () => {
    expect(() => plan("RETURN SELECT DISTINCT k FROM src;")).to.throw(/read as a column name/);
  });

  it("and a body without any of them still lowers, so the refusals are narrow", () => {
    const sql = lower(plan("RETURN SELECT k FROM src WHERE n > 1;"), "hana").sql;
    expect(sql).to.contain('FROM "SRC"');
    expect(sql).to.not.contain("DISTINCT");
  });

  it("a column that is merely CALLED distinct in lower case is still the keyword's shape, and is refused once", () => {
    // the check is on the name, not on the spelling in the source: both
    // parses produce a column named DISTINCT and neither is what was written
    expect(() => plan("RETURN SELECT distinct k FROM src;")).to.throw(/read as a column name/);
  });
});
