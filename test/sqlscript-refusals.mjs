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
// **These were refusals for one commit, and are now carried.**
//
// fable-osd found GROUP BY, HAVING and DISTINCT parsed and not read, by
// running a body's own SQLScript on HANA beside our lowering of it, and
// refused all three by name so the numerator would stop lying. The IR had
// `aggregate(input, groupBy, aggs)` all along and the lowering rendered it;
// nothing read a GROUP BY into it. So the refusals lasted one commit and this
// block asserts the carrying instead -- a test written against a refusal ages
// with the refusal, and keeping it would have meant keeping the refusal.
//
// What each one lowered to before, which is why "it parsed" was never the
// question:
//
//   SELECT DISTINCT k  ->  SELECT "DISTINCT" AS "K"   (a COLUMN called DISTINCT)
//   ... GROUP BY n     ->  the grouping silently gone
//   ... HAVING c > 1   ->  the condition moved into the WHERE
describe("the three clauses are carried now, and what is still refused is named", () => {
  const plan = (body) => toIr(parse(new Body(), lex(body)), {catalogue: {}}).rel;
  const sqlOf = (body) => lower(plan(body), "hana").sql;

  it("GROUP BY becomes the aggregate rather than disappearing", () => {
    expect(sqlOf("RETURN SELECT n, COUNT(*) AS c FROM src GROUP BY n;")).to.contain('GROUP BY "N"');
  });

  it("HAVING becomes a HAVING, not a WHERE", () => {
    const sql = sqlOf("RETURN SELECT n, COUNT(*) AS c FROM src GROUP BY n HAVING COUNT(*) > 1;");
    expect(sql).to.match(/GROUP BY .* HAVING /);
    expect(sql).to.not.contain("WHERE");
  });

  it("DISTINCT is the keyword, whatever case it is written in", () => {
    for (const body of ["RETURN SELECT DISTINCT k FROM src;", "RETURN SELECT distinct k FROM src;"]) {
      const sql = sqlOf(body);
      expect(sql, body).to.contain("SELECT DISTINCT");
      expect(sql, body).to.not.contain('"DISTINCT"');
    }
  });

  it("a body without any of them still lowers, so nothing was traded for this", () => {
    const sql = sqlOf("RETURN SELECT k FROM src WHERE n > 1;");
    expect(sql).to.contain('FROM "SRC"');
    expect(sql).to.not.contain("DISTINCT");
  });

  it("but a column that is neither an aggregate nor a key is refused, by name", () => {
    // every engine rejects it too; rejecting it here says which column
    expect(() => plan("RETURN SELECT k, n FROM src GROUP BY k;"))
      .to.throw(/N is neither an aggregate nor one of the GROUP BY columns/);
  });

  it("and a HAVING with no GROUP BY is refused rather than treated as a WHERE", () => {
    expect(() => plan("RETURN SELECT k FROM src HAVING COUNT(*) > 1;"))
      .to.throw(/HAVING without a GROUP BY/);
  });
});

// The second sweep of the grammar, one day after the first, and it found two
// more -- one of them the worst shape this project has produced.
describe("a set operation the IR cannot express is refused, not turned into another one", () => {
  const plan = (body) => toIr(parse(new Body(), lex(body)), {catalogue: {}}).rel;

  it("EXCEPT is refused, because lowering it as UNION returns the OPPOSITE set", () => {
    expect(() => plan("RETURN SELECT k FROM src EXCEPT SELECT k FROM other;"))
      .to.throw(/EXCEPT is parsed and the IR has only UNION/);
  });

  it("INTERSECT likewise", () => {
    expect(() => plan("RETURN SELECT k FROM src INTERSECT SELECT k FROM other;"))
      .to.throw(/INTERSECT is parsed/);
  });

  it("and UNION, which the IR does carry, still lowers - both with and without ALL", () => {
    for (const body of ["RETURN SELECT k FROM src UNION SELECT k FROM other;",
                        "RETURN SELECT k FROM src UNION ALL SELECT k FROM other;"]) {
      expect(lower(plan(body), "hana").sql).to.contain("UNION");
    }
  });
});

describe("a qualified column is the column, not the qualifier", () => {
  const sqlOf = (body) => lower(toIr(parse(new Body(), lex(body)), {catalogue: {}}).rel, "hana").sql;

  // `nameOf` took the first Name of `s.k`, so every qualified reference
  // lowered to the alias: bodies with a join counted as lowered and could
  // not run.
  it("s.k is K", () => {
    expect(sqlOf("RETURN SELECT s.k FROM src AS s;")).to.contain('"K" AS "K"');
  });

  it("and two qualified columns are two different columns, not one twice", () => {
    const sql = sqlOf("RETURN SELECT s.k, s.a FROM src AS s;");
    expect(sql).to.contain('"K"');
    expect(sql).to.contain('"A"');
  });

  it("a table qualifier works the same as an alias", () => {
    expect(sqlOf("RETURN SELECT src.k FROM src;")).to.contain('"K" AS "K"');
  });

  it("and an unqualified column is untouched", () => {
    expect(sqlOf("RETURN SELECT k FROM src;")).to.contain('"K" AS "K"');
  });
});
