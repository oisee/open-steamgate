import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse, ParseError} from "../tools/sqlscript/combi.mjs";
import {Body, Select, Assignment} from "../tools/sqlscript/expressions/index.mjs";

// Stage 2 of the SQLScript front end. The constructs arrive in the order
// docs/sqlscript-corpus.md measured -- table-variable assignment (70% of
// working bodies) and SELECT first, then UNION (38%), joins (25%), the
// cross-join idiom (15%).
const tree = (src, expression = new Body()) => parse(expression, lex(src));
const names = (node, found = []) => {
  found.push(node.node);
  for (const c of node.children ?? []) names(c, found);
  return found;
};
const leaves = (node, kind, found = []) => {
  if (node.node === kind) found.push(node.value);
  for (const c of node.children ?? []) leaves(c, kind, found);
  return found;
};

describe("the SQLScript grammar", () => {

  it("parses the shape the corpus is mostly made of: assign, then read", () => {
    const t = tree("lt = SELECT a FROM t;\nSELECT * FROM :lt;");
    expect(names(t)).to.include("Assignment").and.to.include("SetOperation");
  });

  it("chains three assignments into one body, which is what the lowering has to see", () => {
    // HANA showed an assignment is not an observable barrier, so a chain is
    // one plan rather than three (docs/sqlscript-hana-observed.md). The
    // grammar has to hand the lowering all three before it can decide that.
    const t = tree("a = SELECT x FROM t;\nb = SELECT x FROM :a;\nc = SELECT x FROM :b;\nSELECT * FROM :c;");
    const assignments = names(t).filter((n) => n === "Assignment");
    expect(assignments).to.have.length(3);
  });

  it("keeps a WHILE body nested instead of flattening its assignments", () => {
    const source = `DECLARE lv_i INTEGER;
      lv_i = 1;
      WHILE :lv_i <= :iv_count DO
        et_rows = SELECT * FROM :et_rows UNION ALL SELECT :lv_i AS id FROM DUMMY;
        lv_i = :lv_i + 1;
      END WHILE;`;
    const t = tree(source);
    expect(names(t).filter((name) => name === "While")).to.have.length(1);
    const loop = (function find(node) {
      if (node.node === "While") return node;
      for (const child of node.children ?? []) {
        const found = find(child);
        if (found !== undefined) return found;
      }
    })(t);
    expect(names(loop).filter((name) => name === "Assignment")).to.have.length(2);
  });

  it("keeps a measured ARRAY constructor and UNNEST WITH ORDINALITY visible", () => {
    const t = tree(`DECLARE lv_values INTEGER ARRAY = ARRAY(2, 5, NULL);
      lt = UNNEST(:lv_values) WITH ORDINALITY AS (element_value, position_value);
      et = SELECT element_value, position_value FROM :lt;`);
    expect(names(t)).to.include("Declare").and.to.include("UnnestCall");
    expect(leaves(t, "host")).to.include(":lv_values");
  });

  it("accepts HANA's DECLARE CURSOR name order and rejects the reversed synthetic spelling", () => {
    expect(() => tree("DECLARE CURSOR c_rows FOR SELECT id FROM :input;")).not.to.throw();
    expect(() => tree("DECLARE c_rows CURSOR FOR SELECT id FROM :input;")).to.throw(ParseError);
  });

  it("requires balanced parentheses around a WHILE condition", () => {
    expect(() => tree("WHILE (1 = 1 DO END WHILE;")).to.throw(ParseError);
    expect(() => tree("WHILE 1 = 1) DO END WHILE;")).to.throw(ParseError);
    expect(() => tree("WHILE (1 = 1) DO END WHILE;")).not.to.throw();
  });

  it("keeps a quoted name a name and a quoted value a value", () => {
    const t = tree(`SELECT "K" FROM t WHERE v = '{"draft":"kept"}';`);
    expect(leaves(t, "quoted"), "the name").to.deep.equal(["K"]);
    expect(leaves(t, "string"), "the value, its quotes intact").to.deep.equal(['{"draft":"kept"}']);
  });

  it("parses the cross-join idiom, which 60 bodies of the corpus use", () => {
    const t = tree("SELECT s.k, p.v FROM t s CROSS JOIN (SELECT ? AS v) p;");
    expect(names(t)).to.include("Join");
  });

  it("parses UNION ALL, third on the frequency list", () => {
    expect(names(tree("SELECT a FROM t UNION ALL SELECT a FROM u;"))).to.include("SetOperation");
  });

  it("parses a function call, a cast-shaped one included", () => {
    const t = tree("SELECT TO_INTEGER(txt) AS n, LENGTH(ch) FROM t;");
    expect(names(t).filter((n) => n === "FunctionCall")).to.have.length(2);
  });

  it("refuses what it cannot parse, and says where -- the way the engine does", () => {
    try {
      tree("SELECT FROM;", new Select());
      expect.fail("should have refused");
    } catch (error) {
      expect(error).to.be.instanceOf(ParseError);
      expect(error.message, "a position, not just a complaint").to.match(/line \d+ col \d+|at the end of the body/);
    }
  });

  it("does not quietly match a prefix and call it a parse", () => {
    // a parser that consumes half the input and reports success is the same
    // defect as a scan that reads nothing and prints the clean line
    expect(() => tree("SELECT a FROM t; this is not SQLScript")).to.throw(ParseError);
  });
});
