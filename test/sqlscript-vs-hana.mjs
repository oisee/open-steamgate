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

// The sweep: one body per construct the lowering claims to support, each
// asked of HANA twice -- its own SQLScript, and our lowering of it.
//
// A difference here cannot be blamed on an engine, so this is the only test
// in the tree that can convict the front end of MEANING something else. It
// found three on its first run (GROUP BY, HAVING and DISTINCT, all now
// refused by name) and it is kept as a sweep rather than a handful of probes
// because that is what found them: asking every construct, not the ones
// somebody suspected.
//
// It needs a HANA and says so when there is none, rather than passing.
describe("the lowering means what SQLScript means, construct by construct", function () {
  this.timeout(120000);
  let client;
  let compare;

  const BODIES = {
    projection: "RETURN SELECT k, a FROM src;",
    filter: "RETURN SELECT k FROM src WHERE a > 1;",
    filter_and: "RETURN SELECT k FROM src WHERE a > 0 AND a < 9;",
    filter_or: "RETURN SELECT k FROM src WHERE a = 1 OR a = 3;",
    order_asc: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt ORDER BY k;",
    order_desc: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt ORDER BY k DESC;",
    chain: "lt = SELECT k, a FROM src WHERE a > 0;\n  lu = SELECT k FROM :lt WHERE a < 9;\n  RETURN SELECT k FROM :lu;",
    arith_plus: "RETURN SELECT k, a + 1 AS v FROM src;",
    arith_times: "RETURN SELECT k, a * 2 AS v FROM src;",
    fn_upper: "RETURN SELECT UPPER(k) AS v FROM src;",
    fn_length: "RETURN SELECT LENGTH(k) AS v FROM src;",
    fn_trim: "RETURN SELECT TRIM(k) AS v FROM src;",
    fn_abs: "RETURN SELECT ABS(a) AS v FROM src;",
    fn_round: "RETURN SELECT ROUND(a) AS v FROM src;",
    like: "RETURN SELECT k FROM src WHERE k LIKE 'a%';",
    not_equal: "RETURN SELECT k FROM src WHERE k <> 'a';",
    cast_int: "RETURN SELECT CAST(a AS INTEGER) AS v FROM src;",
    literal: "RETURN SELECT k, 7 AS v FROM src;",
  };

  before(async function () {
    try {
      const {HanaDatabaseClient} = await import("../tools/hana-client.mjs");
      client = new HanaDatabaseClient({schema: process.env.HANA_SCHEMA ?? "OSD_SWEEP"});
      await client.connect();
      ({compareOnHana: compare} = await import("../tools/sqlscript-vs-hana.mjs"));
    } catch (error) {
      console.log(`      (no HANA reachable, so this measured nothing: ${String(error.message).slice(0, 60)})`);
      this.skip();
    }
  });

  after(async () => {
    await client?.disconnect?.();
  });

  it("every construct answers the same both ways, or is named", async () => {
    const ours = [];
    const notMeasured = [];
    let i = 0;
    for (const [label, body] of Object.entries(BODIES)) {
      const verdict = await compare(client, body, {name: `OSD_SWEEP_T${i++}`});
      if (verdict.skipped !== undefined || verdict.kind === "scaffolding"
          || verdict.kind === "both-raised-on-a-guessed-type") {
        // the third value, kept out of both others: a body the scaffolding
        // could not set up says nothing about the lowering either way
        notMeasured.push(`${label}: ${verdict.skipped ?? verdict.why}`);
        continue;
      }
      if (verdict.agree !== true) ours.push(`${label}: ${verdict.kind} ${JSON.stringify(verdict).slice(0, 160)}`);
    }
    // printed rather than swallowed: a green run that measured four of
    // eighteen is not the same result as one that measured eighteen
    if (notMeasured.length > 0) console.log(`      (not measured: ${notMeasured.join("; ")})`);
    expect(ours, "a difference here is OURS: same engine, same rows, same session").to.deep.equal([]);
    expect(Object.keys(BODIES).length - notMeasured.length,
      "too few constructs reached the engine for this to mean anything").to.be.greaterThan(12);
  });
});
