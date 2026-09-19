// Twenty hand-built IR fixtures, and no parser anywhere.
//
// This suite exists to answer one question before a front end is written:
// can the model express what SQLScript means, and can a lowering render it
// into each engine correctly or refuse? Finding "no" here costs an
// afternoon; finding it after a parser exists costs a parser.
//
// The fixtures are the head of the measured corpus (docs/sqlscript-corpus.md):
// table variables assigned from SELECTs, UNION (51% of bodies), inner join,
// GROUP BY, ORDER BY, the cross-join-with-a-one-row-derived-table idiom (60
// bodies), IFNULL, CONCAT, SUBSTR and TO_INTEGER - plus the two divergences
// that were measured on the engines themselves, integer division and CAST.
import {expect} from "chai";
import {T, col, lit, param, bin, call, cast, scan, ref, filter, project, join, union, aggregate, order, limit, effects} from "../tools/sqlscript-ir.mjs";
import {lower, statementCount, Refused} from "../tools/sqlscript-lower.mjs";

const sqlOf = (rel, dialect, options) => lower(rel, dialect, options).sql;

describe("SQLScript IR: a chain of assignments is one plan", () => {
  // lt1 = SELECT * FROM src;
  // lt2 = SELECT k, n FROM :lt1 WHERE n > 1;
  // lt3 = SELECT k FROM :lt2 ORDER BY k;
  const chain = order(
    project(
      filter(scan("SRC"), bin(">", col("N"), lit(1, T.int), T.bool)),
      [{as: "K", expr: col("K")}]),
    [{col: "K"}]);

  it("lowers to a single statement, because HANA says an assignment is not a barrier", () => {
    const {sql} = lower(chain, "duckdb");
    expect(sql.match(/SELECT/g), sql).to.have.length(3); // nested, not sequential
    expect(sql).to.not.contain(";");
    expect(statementCount(chain)).to.equal(1);
  });

  it("nests rather than sequences, on every dialect we ship", () => {
    for (const dialect of ["hana", "duckdb", "sqlite"]) {
      expect(sqlOf(chain, dialect), dialect).to.match(/^SELECT \* FROM \(SELECT .* FROM \(SELECT \* FROM "SRC" WHERE/);
    }
  });

  it("knows the chain can raise nothing, so nothing has to be materialised", () => {
    expect(effects(chain).mayThrow).to.equal(false);
  });
});

describe("SQLScript IR: the divergences that were measured, not assumed", () => {
  // The oracle corrected this suite: HANA's `/` over two INTEGERs yields a
  // DECIMAL (0.500000, -3.500000), it does not truncate. So DuckDB already
  // matches and the browser engine is the outlier - the opposite of what
  // this file asserted before HANA Express was asked.
  const decDiv = project(scan("SRC"), [{as: "R", expr: bin("/", col("A"), col("B"), T.dec(15, 2))}]);

  it("plain division keeps its decimal result, and only sql.js needs help", () => {
    expect(sqlOf(decDiv, "hana")).to.contain('("A" / "B")');
    expect(sqlOf(decDiv, "duckdb")).to.contain('("A" / "B")');
    // `/` truncates over two integers here, so the decimal has to be forced
    expect(sqlOf(decDiv, "sqlite")).to.contain('* 1.0 /');
  });

  it("integer division is the one that has to be asked for, and is rendered per engine", () => {
    const intDiv = project(scan("SRC"), [{as: "R", expr: bin("/", col("A"), col("B"), T.int)}]);
    expect(sqlOf(intDiv, "duckdb")).to.contain('("A" // "B")');
    expect(sqlOf(intDiv, "sqlite")).to.contain('("A" / "B")');
    expect(sqlOf(intDiv, "hana")).to.contain('DIV("A", "B")');
  });

  // SQLite's CAST cannot raise: 'x' becomes 0. There is no expression that
  // fixes that, so the dialect refuses rather than returning another number
  it("SQLite refuses a cast it cannot make raise, instead of answering differently", () => {
    const c = project(scan("SRC"), [{as: "N", expr: cast(col("TXT"), T.int)}]);
    expect(() => lower(c, "sqlite")).to.throw(Refused, /returns 0 where HANA and DuckDB raise/);
    expect(sqlOf(c, "duckdb")).to.contain('CAST("TXT" AS INTEGER)');
    expect(sqlOf(c, "hana")).to.contain('CAST("TXT" AS INTEGER)');
  });

  it("a cast marks the subtree as able to raise, which is what a barrier decision reads", () => {
    const c = filter(project(scan("SRC"), [{as: "N", expr: cast(col("TXT"), T.int)}]),
                     bin("<>", col("K"), lit("b", T.char(1)), T.bool));
    expect(effects(c).mayThrow).to.equal(true);
  });
});

describe("SQLScript IR: values are bound, identifiers are generated", () => {
  it("a parameter never reaches the text", () => {
    const rel = filter(scan("SRC"), bin("=", col("K"), param("lv_key", T.char(3)), T.bool));
    const {sql, params} = lower(rel, "duckdb");
    expect(sql).to.contain("?");
    expect(params).to.have.length(1);
    expect(params[0].name).to.equal("lv_key");
    expect(params[0].type, "the seam speaks a type string, not our object").to.equal("C(3)");
  });

  it("a string literal is bound too, because a literal in the text is the old defect", () => {
    const rel = filter(scan("SRC"), bin("=", col("K"), lit("it's a value, not ' SQL", T.str), T.bool));
    const {sql, params} = lower(rel, "duckdb");
    expect(sql).to.not.contain("it's");
    expect(params[0].value).to.contain("it's a value");
  });

  it("NULL is said explicitly, because ABAP has no NULL", () => {
    const rel = filter(scan("SRC"), bin("=", col("K"), param("lv_key", T.char(3), true), T.bool));
    expect(lower(rel, "duckdb").params[0].isNull).to.equal(true);
  });

  it("a relation the seam already knows is spliced by the seam's own name", () => {
    const rel = filter(ref("H1"), bin(">", col("N"), lit(0, T.int), T.bool));
    const sql = sqlOf(rel, "duckdb", {relationRef: (h) => `"OSD"."REL_${h}"`});
    expect(sql).to.contain('"OSD"."REL_H1"');
  });
});

describe("SQLScript IR: the shapes the corpus actually contains", () => {
  it("UNION ALL, which is in half the bodies", () => {
    const rel = union([scan("A"), scan("B")]);
    expect(sqlOf(rel, "duckdb")).to.equal('SELECT * FROM "A" UNION ALL SELECT * FROM "B"');
  });

  it("inner join", () => {
    const rel = join(scan("A"), scan("B"), bin("=", col("K"), col("K2"), T.bool));
    expect(sqlOf(rel, "hana")).to.contain("INNER JOIN");
  });

  it("group by with an aggregate", () => {
    const rel = aggregate(scan("SALES"), ["CARRID"], [{as: "TOTAL", expr: call("SUM", [col("PRICE")], T.dec(15, 2))}]);
    const sql = sqlOf(rel, "duckdb");
    expect(sql).to.contain('SUM("PRICE") AS "TOTAL"');
    expect(sql).to.contain('GROUP BY "CARRID"');
  });

  it("a scalar carried into a set - the cross-join idiom, 60 bodies", () => {
    // the idiom is a join against a one-row relation; here the one row is a
    // bound parameter rather than a literal, which is the whole improvement
    const oneRow = project(scan("DUMMY"), [{as: "SIG", expr: param("lv_sig", T.char(1))}]);
    const rel = join(scan("SRC"), oneRow, lit(1, T.int), "cross");
    expect(sqlOf(rel, "duckdb")).to.contain("CROSS JOIN");
    expect(lower(rel, "duckdb").params[0].name).to.equal("lv_sig");
  });

  it("IFNULL, which is COALESCE on one engine and not on another", () => {
    const rel = project(scan("SRC"), [{as: "V", expr: call("IFNULL", [col("A"), lit(0, T.int)], T.int)}]);
    expect(sqlOf(rel, "duckdb")).to.contain("COALESCE");
    expect(sqlOf(rel, "hana")).to.contain("IFNULL");
    expect(sqlOf(rel, "sqlite")).to.contain("IFNULL");
  });

  it("CONCAT and SUBSTR, the two commonest functions in the corpus", () => {
    const rel = project(scan("SRC"), [
      {as: "C", expr: call("CONCAT", [col("A"), col("B")], T.str)},
      {as: "S", expr: call("SUBSTR", [col("A"), lit(1, T.int), lit(3, T.int)], T.char(3))},
    ]);
    expect(sqlOf(rel, "duckdb")).to.contain('("A" || "B")');
    expect(sqlOf(rel, "sqlite")).to.contain("SUBSTR(");
    expect(sqlOf(rel, "hana")).to.contain("SUBSTRING(");
  });

  it("ORDER BY and LIMIT", () => {
    const rel = limit(order(scan("SRC"), [{col: "K", desc: true}]), 10);
    const sql = sqlOf(rel, "duckdb");
    expect(sql).to.contain('ORDER BY "K" DESC');
    expect(sql).to.contain("LIMIT 10");
  });

  it("an identifier with a quote in it cannot break out of its quoting", () => {
    expect(sqlOf(scan('WEIRD"NAME'), "duckdb")).to.equal('SELECT * FROM "WEIRD""NAME"');
  });
});

describe("SQLScript IR: what it refuses", () => {
  it("refuses a relation it cannot lower rather than emitting something close", () => {
    expect(() => lower({rel: "window", input: scan("A")}, "duckdb")).to.throw(Refused, /relation window/);
  });

  it("refuses a cast to a type nobody has lowered yet", () => {
    expect(() => lower(project(scan("A"), [{as: "D", expr: cast(col("T"), T.date)}]), "duckdb"))
      .to.throw(Refused, /not lowered yet/);
  });

  it("refuses an unknown dialect instead of guessing one", () => {
    expect(() => lower(scan("A"), "oracle")).to.throw(Refused, /no dialect/);
  });

  it("marks a non-deterministic source, because reading it twice is observable", () => {
    const rel = project(scan("SRC"), [{as: "R", expr: call("RAND", [], T.dec(15, 2))}]);
    expect(effects(rel).nonDeterministic).to.equal(true);
  });
});
