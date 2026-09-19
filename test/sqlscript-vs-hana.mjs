// The HANA-against-HANA instrument, tested on everything that is not HANA.
//
// The live half needs a HANA and runs where one is reachable. Everything that
// decides what the measurement MEANS - what counts as agreement, what is
// neither agreement nor a divergence, whether the body reaches the engine
// unedited - is decided here, in a file that runs everywhere, because those
// are the parts that were wrong in every earlier instrument on this project.
import {expect} from "chai";
import {wrapperFor, selfContained, sameRows, verdictOf, returnsTable, isOrdered} from "../tools/sqlscript-vs-hana.mjs";
import {T, col, scan, project, order, filter, bin, lit} from "../tools/sqlscript-ir.mjs";

describe("the body reaches HANA unedited, or the comparison is ours against ours", () => {
  it("puts the body in verbatim, whitespace and all", () => {
    const body = "  lt_x = SELECT  a ,  b\n    FROM src;\n  RETURN :lt_x;";
    expect(wrapperFor('"F"', body, 'TABLE("A" INTEGER)').sql).to.contain(body);
  });

  it("and the wrapper says SQLSCRIPT, since a wrapper in plain SQL would compile the body as SQL", () => {
    expect(wrapperFor('"F"', "RETURN :x;", "TABLE()").sql).to.contain("LANGUAGE SQLSCRIPT");
  });

  // Two shapes exist because turning one into the other means appending a
  // RETURN, and an appended RETURN is an edit - after which both halves of
  // the comparison are ours.
  it("a body ending in RETURN is a table function", () => {
    const w = wrapperFor('"F"', "lt = SELECT a FROM src;\n  RETURN :lt;", 'TABLE("A" INTEGER)');
    expect(w.kind).to.equal("function");
    expect(w.read).to.contain("()");
  });

  it("a body ending in a bare SELECT is a procedure with a result set, not a rewritten function", () => {
    const w = wrapperFor('"P"', "lt = SELECT a FROM src;\n  SELECT a FROM :lt ORDER BY a;", 'TABLE("A" INTEGER)');
    expect(w.kind).to.equal("procedure");
    expect(w.sql).to.contain("CREATE PROCEDURE");
    expect(w.sql, "nothing may be appended to make it return").to.not.match(/RETURN/i);
  });

  it("and a body that is neither is refused rather than made to fit", () => {
    const w = wrapperFor('"X"', "lv_x = 1;", "TABLE()");
    expect(w.kind).to.equal("unwrappable");
    expect(w.why).to.contain("without editing it");
  });
});

describe("a body that is not self-contained is skipped rather than guessed at", () => {
  it("names the free parameters it reads", () => {
    const verdict = selfContained("lt_x = SELECT a FROM src WHERE k = :iv_key; RETURN :lt_x;");
    expect(verdict.ok).to.equal(false);
    expect(verdict.free).to.contain("iv_key");
  });

  it("but a reference to the body's own variable is not a free parameter", () => {
    expect(selfContained("lt_x = SELECT a FROM src; RETURN :lt_x;").ok).to.equal(true);
  });

  // The first body ever put in front of this instrument was skipped by it,
  // wrongly: the check knew the corpus's `lt_` house style and took that for
  // the language. A variable is local because the body BINDS it.
  it("a local is one the body assigns to, whatever it is called", () => {
    const verdict = selfContained("lt = SELECT k FROM src;\n  SELECT k FROM :lt ORDER BY k;");
    expect(verdict.free, "`lt` is assigned one line above, so it is not free").to.deep.equal([]);
    expect(verdict.ok).to.equal(true);
  });

  it("and a DECLARE binds a name too", () => {
    expect(selfContained("DECLARE lv_n INTEGER = 1;\n  RETURN SELECT :lv_n AS N FROM dummy;").ok).to.equal(true);
  });
});

// The trap this instrument would otherwise walk into on its first real run.
describe("rows without an ORDER BY have no order, and comparing them as if they did invents divergences", () => {
  const a = [{V: 1}, {V: 2}];
  const b = [{V: 2}, {V: 1}];

  it("unordered: the same rows in another order are the same answer", () => {
    expect(sameRows(a, b, false)).to.equal(true);
  });

  it("ordered: the same rows in another order are a different answer", () => {
    expect(sameRows(a, b, true)).to.equal(false);
  });

  it("and the plan itself says which of the two it is", () => {
    const base = project(scan("T"), [{as: "V", expr: col("A")}]);
    expect(isOrdered(base)).to.equal(false);
    expect(isOrdered(order(base, [{col: "V"}])), "an ORDER BY anywhere under the top makes order part of the answer")
      .to.equal(true);
    expect(isOrdered(filter(order(base, [{col: "V"}]), bin(">", col("V"), lit(0, T.int), T.bool)))).to.equal(true);
  });

  it("a NULL and the string \"null\" are not the same answer", () => {
    expect(sameRows([{V: null}], [{V: "null"}], false)).to.equal(false);
  });
});

describe("the verdict keeps the third value out of the other two", () => {
  it("HANA refusing the wrapper is scaffolding: neither agreement nor a divergence", () => {
    const verdict = verdictOf({refused: "invalid identifier"}, {});
    expect(verdict.kind).to.equal("scaffolding");
    expect(verdict.agree, "it must not claim agreement").to.equal(undefined);
  });

  it("HANA refusing OUR statement is a finding, and never agreement", () => {
    const verdict = verdictOf({rows: []}, {raised: "invalid identifier: SOMETHING not found"});
    expect(verdict.kind).to.equal("our-sql-refused");
    expect(verdict.agree).to.equal(false);
  });

  it("both raising on the data agrees, as it does in the fused/forced comparison", () => {
    expect(verdictOf({rows: undefined, raised: "cannot convert"}, {raised: "cannot convert"}).agree).to.equal(true);
  });

  it("one raising and the other answering is the interesting direction, and is named", () => {
    expect(verdictOf({rows: [{V: 1}]}, {raised: "cannot convert"}).kind).to.equal("lowering-raises-sqlscript-answers");
    expect(verdictOf({raised: "cannot convert"}, {rows: [{V: 1}]}).kind).to.equal("sqlscript-raises-lowering-answers");
  });

  // the half that proves the instrument can convict us
  it("different rows is red, and carries both answers so the difference can be read", () => {
    const verdict = verdictOf({rows: [{V: 1}]}, {rows: [{V: 2}]});
    expect(verdict.agree).to.equal(false);
    expect(verdict.kind).to.equal("different-rows");
    expect(verdict.sqlscript).to.contain("1");
    expect(verdict.lowered).to.contain("2");
  });

  // found on the instrument's first live run, and it was the instrument's own
  // scaffolding rather than a divergence
  it("equal numbers written at different scale is not a different answer, and says why", () => {
    const verdict = verdictOf({rows: [{HALF: "0.50"}]}, {rows: [{HALF: "0.500000"}]});
    expect(verdict.kind).to.equal("same-values-different-scale");
    expect(verdict.agree).to.equal(true);
    expect(verdict.note).to.contain("procedure shape");
  });

  it("but two different numbers are still a divergence, so the collapse is narrow", () => {
    expect(verdictOf({rows: [{HALF: "0.50"}]}, {rows: [{HALF: "0.60"}]}).kind).to.equal("different-rows");
  });

  it("and two different strings are not collapsed by the numeric comparison", () => {
    expect(verdictOf({rows: [{K: "abc"}]}, {rows: [{K: "abcd"}]}).kind).to.equal("different-rows");
  });

  it("and the same rows is quiet", () => {
    expect(verdictOf({rows: [{V: 1}]}, {rows: [{V: 1}]}).agree).to.equal(true);
  });
});

describe("the returned shape comes from our own binder, so a wrong shape is a finding", () => {
  it("types each column the way the plan types it", () => {
    const rel = project(scan("T"), [{as: "V", expr: col("A")}]);
    expect(returnsTable(rel, {T: {A: T.int}})).to.equal('TABLE("V" INTEGER)');
  });

  it("refuses a plan that projects nothing rather than inventing a shape that accepts anything", () => {
    expect(() => returnsTable(project(scan("T"), []), {T: {A: T.int}})).to.throw(/projects no column/);
  });
});
