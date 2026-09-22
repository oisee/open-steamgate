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
import {T, col, lit, param, sessionValue, bin, call, cast, like, scan, ref, filter, project, join, union, except, aggregate, order, limit, effects, alias} from "../tools/sqlscript-ir.mjs";
import {lower, statementCount, Refused} from "../tools/sqlscript-lower.mjs";
import {schemaOf, typeOfExpr, varRef} from "../tools/sqlscript-ir.mjs";

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
    // The filter and projection are clauses of one query block; an earlier
    // lowering kept a redundant subquery here. One statement either way is
    // the semantic promise, but one SELECT is also the simpler faithful SQL.
    expect(sql.match(/SELECT/g), sql).to.have.length(1);
    expect(sql).to.not.contain(";");
    expect(statementCount(chain)).to.equal(1);
  });

  it("nests rather than sequences, on every dialect we ship", () => {
    for (const dialect of ["hana", "postgres", "duckdb", "sqlite"]) {
      expect(sqlOf(chain, dialect), dialect).to.match(/^SELECT "K" AS "K" FROM "SRC" WHERE .* ORDER BY/);
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
    expect(sqlOf(c, "hana")).to.contain('CAST("TXT" AS INTEGER)');
    // DuckDB's own CAST raises like HANA's and **rounds** where HANA
    // truncates -- CAST(1.7 AS INTEGER) is 2 there and 1 on HANA, measured
    // 2026-09-19. This line used to assert the pass-through, which is how a
    // test can keep a divergence green for as long as it exists.
    expect(sqlOf(c, "duckdb")).to.contain('TRUNC(CAST("TXT" AS DOUBLE))');
  });

  it("a cast to a character type truncates, because HANA truncates and neither other engine does", () => {
    const c = project(scan("SRC"), [{as: "S", expr: cast(col("TXT"), T.char(3))}]);
    // CAST('abcdef' AS NVARCHAR(3)) is 'abc' on HANA and 'abcdef' on both
    // others, measured; SUBSTR of the cast agrees with HANA on both
    expect(sqlOf(c, "hana")).to.contain('CAST("TXT" AS NVARCHAR(3))');
    expect(sqlOf(c, "duckdb")).to.contain('SUBSTR(CAST("TXT" AS VARCHAR), 1, 3)');
    expect(sqlOf(c, "sqlite")).to.contain('SUBSTR(CAST("TXT" AS VARCHAR), 1, 3)');
  });

  it("LIKE carries its ESCAPE, and case sensitivity is a promise the connection keeps", () => {
    const rel = filter(scan("SRC"), like(col("N"), param("p", T.str), lit("#", T.char(1))));
    // all three render the same text; what differs is that SQLite only means
    // the same thing by it because the connection sets case_sensitive_like
    for (const engine of ["hana", "duckdb", "sqlite"]) {
      expect(sqlOf(rel, engine)).to.contain("LIKE ? ESCAPE ?");
    }
    expect(sqlOf(filter(scan("SRC"), like(col("N"), lit("a%", T.char(2)), undefined, true)), "hana"))
      .to.contain("NOT LIKE");
  });

  it("a cast marks the subtree as able to raise, which is what a barrier decision reads", () => {
    const c = filter(project(scan("SRC"), [{as: "N", expr: cast(col("TXT"), T.int)}]),
                     bin("<>", col("K"), lit("b", T.char(1)), T.bool));
    expect(effects(c).mayThrow).to.equal(true);
  });
});

describe("SQLScript IR: values are bound, identifiers are generated", () => {
  it("keeps JOIN parameters in SQL placeholder order: left, right, then ON", () => {
    const left = project(scan("DUMMY"), [{as: "L", expr: lit("left", T.str)}]);
    const right = project(scan("DUMMY"), [{as: "R", expr: lit("right", T.str)}]);
    const rel = join(left, right, bin("=", col("L"), lit("on", T.str), T.bool));
    const compiled = lower(rel, "duckdb");
    expect(compiled.params.map((one) => one.value)).to.deep.equal(["left", "right", "on"]);
  });

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
    const literals = lower(project(scan("DUMMY"), [
      {as: "N", expr: lit(null, T.int)},
      {as: "D", expr: lit(null, T.date)},
    ]), "duckdb").params;
    expect(literals.map(({value, isNull}) => ({value, isNull}))).to.deep.equal([
      {value: null, isNull: true},
      {value: null, isNull: true},
    ]);
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

  it("keeps JOIN aliases in scope for a qualified projection without WHERE", () => {
    const rel = project(
      join(alias(scan("A"), "L"), alias(scan("B"), "R"),
           bin("=", col("K", T.int, "L"), col("K", T.char(3), "R"), T.bool)),
      [{as: "LK", expr: col("K", T.int, "L")}]);
    const sql = sqlOf(rel, "duckdb");
    expect(sql).to.equal('SELECT "L"."K" AS "LK" FROM (SELECT * FROM "A") AS "L" INNER JOIN (SELECT * FROM "B") AS "R" ON ("L"."K" = "R"."K")');
  });

  it("keeps those aliases in scope through ORDER BY and LIMIT", () => {
    const selected = project(
      join(alias(scan("A"), "L"), alias(scan("B"), "R"),
           bin("=", col("K", T.int, "L"), col("K", T.int, "R"), T.bool)),
      [{as: "LK", expr: col("K", T.int, "L")}]);
    const sql = sqlOf(limit(order(selected, [{col: "LK"}]), 2), "duckdb");
    expect(sql).to.equal('SELECT "L"."K" AS "LK" FROM (SELECT * FROM "A") AS "L" INNER JOIN (SELECT * FROM "B") AS "R" ON ("L"."K" = "R"."K") ORDER BY "LK" ASC LIMIT 2');
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
    // no ON: a cross join has none, and this used to pass `lit(1)` as one,
    // which rendered `CROSS JOIN ... ON 1` -- not valid SQL on any of the
    // three engines. The test never ran the statement, so it stayed green
    // until the lowering started refusing the shape instead of rendering it.
    const rel = join(scan("SRC"), oneRow, undefined, "cross");
    expect(sqlOf(rel, "duckdb")).to.contain("CROSS JOIN");
    expect(sqlOf(rel, "duckdb")).to.not.match(/CROSS JOIN.* ON /);
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

  it("rechecks the measured decimal and regex subset at the public lowering boundary", () => {
    const changedScale = project(scan("A"), [
      {as: "D", expr: cast(col("D", T.dec(8, 3)), T.dec(12, 2))},
    ]);
    expect(() => lower(changedScale, "duckdb"))
      .to.throw(Refused, /packed-decimal source with unchanged scale/);

    const exactInteger = project(scan("A"), [
      {as: "D", expr: cast(col("I", T.int), T.dec(8, 3))},
    ]);
    expect(lower(exactInteger, "duckdb").sql).to.include('CAST("I" AS DECIMAL(8, 3))');
    expect(() => lower(exactInteger, "postgres"))
      .to.throw(Refused, /INTEGER or a packed-decimal source/);

    const broadRegex = project(scan("A"), [
      {as: "S", expr: call("REGEXP_REPLACE_ALL",
        [col("S", T.str), lit("[x]", T.char(3)), lit("", T.char(0))], T.str)},
    ]);
    expect(() => lower(broadRegex, "duckdb"))
      .to.throw(Refused, /measured only for a column subject, literal 'x'/);
  });

  it("refuses an unresolved table variable rather than reading a table of that name", async () => {
    const {varRef} = await import("../tools/sqlscript-ir.mjs");
    const rel = filter(varRef("lt1"), bin(">", col("N"), lit(0, T.int), T.bool));
    expect(() => lower(rel, "duckdb")).to.throw(Refused, /:lt1 reached the lowering unresolved/);
  });

  it("refuses an unknown dialect instead of guessing one", () => {
    expect(() => lower(scan("A"), "oracle")).to.throw(Refused, /no dialect/);
  });

  it("refuses nested set trees until parenthesized lowering is measured", () => {
    const a = scan("A"), b = scan("B"), c = scan("C");
    for (const rel of [
      except(union([a, b], false), c),
      union([a, except(b, c)], false),
      except(except(a, b), c),
    ]) {
      expect(() => lower(rel, "duckdb")).to.throw(Refused, /nested set operations/);
      expect(() => schemaOf(rel, {A: {}, B: {}, C: {}})).to.throw(/nested set operations/);
    }
  });

  it("marks a non-deterministic source, because reading it twice is observable", () => {
    const rel = project(scan("SRC"), [{as: "R", expr: call("RAND", [], T.dec(15, 2))}]);
    expect(effects(rel).nonDeterministic).to.equal(true);
  });
});

describe("SQLScript IR: the schema a typer reads, and where it comes from", () => {
  const catalogue = {SRC: {K: T.char(3), N: T.int}};

  it("a scan takes its columns from the catalogue it is handed, not from a registry", () => {
    expect(schemaOf(scan("SRC"), catalogue)).to.deep.equal({K: T.char(3), N: T.int});
    expect(() => schemaOf(scan("NOPE"), catalogue)).to.throw(/does not describe NOPE/);
  });

  it("a projection renames and retypes, and a filter changes nothing", () => {
    const rel = project(filter(scan("SRC"), bin(">", col("N"), lit(1, T.int), T.bool)),
                        [{as: "KK", expr: col("K")}]);
    expect(schemaOf(rel, catalogue)).to.deep.equal({KK: T.char(3)});
  });

  it("uses the resolved column type when JOIN sides have the same name", () => {
    const rel = project(
      join(alias(scan("LEFT_T"), "L"), alias(scan("RIGHT_T"), "R"),
           bin("=", col("K", T.int, "L"), col("K", T.char(3), "R"), T.bool)),
      [{as: "OUT", expr: col("K", T.int, "L")}]);
    const catalogue = {LEFT_T: {K: T.int}, RIGHT_T: {K: T.char(3)}};
    expect(schemaOf(rel, catalogue)).to.deep.equal({OUT: T.int});
  });

  it("an aggregate keeps its keys and types its aggregates", () => {
    const rel = aggregate(scan("SRC"), ["K"], [{as: "T", expr: bin("+", col("N"), lit(1, T.int), T.int)}]);
    expect(schemaOf(rel, catalogue)).to.deep.equal({K: T.char(3), T: T.int});
  });

  it("a table variable has no schema until the binder resolves it, and says so", () => {
    expect(() => schemaOf(varRef("lt1"), catalogue)).to.throw(/has no schema until the binder/);
  });

  it("a UNION whose branches do not line up is refused rather than guessed", () => {
    const rel = union([scan("SRC"), project(scan("SRC"), [{as: "K", expr: col("K")}])]);
    expect(() => schemaOf(rel, catalogue)).to.throw(/do not have the same columns/);
  });

  it("a materialised relation carries the schema of the plan that made it", async () => {
    const {refTo} = await import("../tools/sqlscript-ir.mjs");
    const made = {K: T.char(3)};
    expect(schemaOf(filter(refTo("H1", made), bin("=", col("K"), lit("a", T.char(1)), T.bool)), {}))
      .to.deep.equal(made);
  });

  it("an expression with no measured rule refuses instead of inventing one", () => {
    expect(() => typeOfExpr({node: "bin", op: "+", left: col("N"), right: col("N")}, {N: T.int}))
      .to.throw(/no rule has been measured/);
  });
});

describe("SQLScript IR: data chosen to break a plan, derived from the plan", () => {
  it("names the column a cast will fail on, because representative data never contains it", async () => {
    const {adversarialRows} = await import("../tools/sqlscript-ir.mjs");
    const rel = project(scan("SRC"), [{as: "N", expr: cast(col("TXT"), T.int)}]);
    const rows = adversarialRows(rel, {TXT: T.str});
    expect(rows).to.have.length(1);
    expect(rows[0].column).to.equal("TXT");
    expect(rows[0].known, "the column is in the schema we were given").to.equal(true);
  });

  it("names the divisor, which is the row the three engines disagree about", async () => {
    const {adversarialRows} = await import("../tools/sqlscript-ir.mjs");
    const rel = project(scan("SRC"), [{as: "R", expr: bin("/", col("A"), col("B"), T.dec(15, 2))}]);
    const rows = adversarialRows(rel, {A: T.int, B: T.int});
    expect(rows.map((r) => [r.column, r.value])).to.deep.equal([["B", 0]]);
  });

  it("says when the column it wants is not in the schema, rather than inventing one", async () => {
    const {adversarialRows} = await import("../tools/sqlscript-ir.mjs");
    const rel = project(scan("SRC"), [{as: "N", expr: cast(col("MISSING"), T.int)}]);
    expect(adversarialRows(rel, {A: T.int})[0].known).to.equal(false);
  });

  it("a plan with no hazard asks for nothing, so the instrument stays quiet", async () => {
    const {adversarialRows} = await import("../tools/sqlscript-ir.mjs");
    expect(adversarialRows(project(scan("SRC"), [{as: "K", expr: col("K")}]), {K: T.char(3)})).to.be.empty;
  });
});

describe("SQLScript IR: the tables a body needs, invented from the body", () => {
  it("names the table and types each column from what is done to it", async () => {
    const {tableShapesFor} = await import("../tools/sqlscript-ir.mjs");
    const rel = filter(project(scan("SRC"), [
      {as: "N", expr: cast(col("TXT"), T.int)},
      {as: "R", expr: bin("/", col("A"), col("B"), T.dec(15, 2))},
    ]), bin("<>", col("K"), lit("b", T.char(1)), T.bool));
    const shapes = tableShapesFor(rel);
    expect(shapes.tables).to.deep.equal(["SRC"]);
    expect(shapes.columns.TXT.type.abap, "cast to a number, so written as text").to.equal("STRING");
    expect(shapes.columns.A.type.abap, "arithmetic").to.equal("I");
    expect(shapes.columns.K.type.abap, "compared with a character literal").to.equal("C");
    expect(shapes.guessed, "every column's use said something").to.be.empty;
  });

  it("marks a column whose use says nothing, instead of pretending to know", async () => {
    const {tableShapesFor} = await import("../tools/sqlscript-ir.mjs");
    const shapes = tableShapesFor(project(scan("SRC"), [{as: "K", expr: col("K")}]));
    expect(shapes.guessed).to.deep.equal(["K"]);
    expect(shapes.columns.K.why).to.contain("nothing says what it is");
  });

  it("says when more than one table is read, because a bare column cannot be attributed", async () => {
    const {tableShapesFor, join} = await import("../tools/sqlscript-ir.mjs");
    const rel = join(scan("A"), scan("B"), bin("=", col("K"), col("K2"), T.bool));
    expect(tableShapesFor(rel).ambiguous, "said rather than hidden").to.equal(true);
  });

  it("a determining use beats a guessing one, whichever is walked first", async () => {
    const {tableShapesFor} = await import("../tools/sqlscript-ir.mjs");
    // K is selected (says nothing) and also compared with a number (says int)
    const rel = filter(project(scan("SRC"), [{as: "K", expr: col("K")}]),
                       bin(">", col("K"), lit(3, T.int), T.bool));
    expect(tableShapesFor(rel).columns.K.type.abap).to.equal("I");
    expect(tableShapesFor(rel).guessed).to.be.empty;
  });
});

// A function name that reaches another engine unchanged is the same class of
// defect as a cast that reaches it unchanged, and the corpus made it visible:
// SUBSTR_BEFORE, SUBSTR_AFTER, MAP and TO_NVARCHAR are
// HANA's, and DuckDB answers "Scalar Function ... does not exist". Raising is
// the lucky half; the other half is a name that exists on both engines and
// means something slightly different.
describe("SQLScript IR: a function is rendered only where it has been measured", () => {
  const sqlOf = (rel, engine) => lower(rel, engine).sql;

  it("renders the ones whose meaning is the same on all three", () => {
    const rel = project(scan("SRC"), [{as: "V", expr: call("LOWER", [col("A")], T.str)}]);
    for (const engine of ["hana", "duckdb", "sqlite"]) {
      expect(sqlOf(rel, engine)).to.contain('LOWER("A")');
    }
  });

  it("builds HANA's own out of what the other engines have, once measured", () => {
    // SUBSTR_BEFORE exists nowhere else and was refused until its edges were
    // measured on HANA Express: a miss answers the empty string, not NULL
    const rel = project(scan("SRC"), [{as: "V", expr: call("SUBSTR_BEFORE", [col("A"), lit("-", T.char(1))], T.str)}]);
    expect(sqlOf(rel, "hana")).to.contain("SUBSTR_BEFORE(");
    expect(sqlOf(rel, "duckdb")).to.contain("instr(");
    expect(sqlOf(rel, "duckdb")).to.contain("ELSE ''");
  });

  it("but still refuses a name nobody has measured", () => {
    // the list is of functions whose MEANING was measured, not of functions
    // that exist; ROUND and LOCATE left it by being measured, not by being
    // common
    for (const fn of ["TO_DATE", "ESCAPE_SINGLE_QUOTES"]) {
      const rel = project(scan("SRC"), [{as: "V", expr: call(fn, [col("A")], T.str)}]);
      expect(() => lower(rel, "duckdb"), fn).to.throw(Refused, /has no measured rendering/);
    }
  });

  it("refuses an uncaptured session node at the dialect boundary", () => {
    const rel = project(scan("SRC"), [{as: "V", expr: sessionValue("user", "CURRENT_USER")}]);
    expect(() => lower(rel, "duckdb")).to.throw(Refused, /was not captured by the procedure runtime/);
  });

  it("still translates the ones that were measured and differ", () => {
    const rel = project(scan("SRC"), [{as: "V", expr: call("IFNULL", [col("A"), lit(0, T.int)], T.int)}]);
    expect(sqlOf(rel, "duckdb")).to.contain("COALESCE");
    expect(sqlOf(rel, "hana")).to.contain("IFNULL");
  });
});

describe("SQLScript IR: attributing a bare column to a table", () => {
  it("a join predicate says which side each column is on", async () => {
    const {tableShapesPerTable} = await import("../tools/sqlscript-ir.mjs");
    const rel = project(join(scan("A"), scan("B"), bin("=", col("KA"), col("KB"), T.bool)),
                        [{as: "X", expr: col("KA")}]);
    const shapes = tableShapesPerTable(rel);
    expect(Object.keys(shapes.perTable.A)).to.deep.equal(["KA"]);
    expect(Object.keys(shapes.perTable.B)).to.deep.equal(["KB"]);
    expect(shapes.unattributed, "the predicate attributed both").to.be.empty;
  });

  it("the same table scanned twice is ambiguous, although there is only one table", async () => {
    const {tableShapesFor, tableShapesPerTable} = await import("../tools/sqlscript-ir.mjs");
    // the engine says `Ambiguous reference to table` - and counting distinct
    // names said one table and looked fine right up until it ran
    const rel = join(scan("IT_CONF"), scan("IT_CONF"), bin("=", col("A"), col("B"), T.bool));
    const flat = tableShapesFor(rel);
    expect(flat.tables).to.deep.equal(["IT_CONF"]);
    expect(flat.scans, "two scans, one name").to.equal(2);
    expect(flat.ambiguous, "ambiguity follows the scans, not the names").to.equal(true);
    expect(tableShapesPerTable(rel).attributed, "naming the same table for both sides attributes nothing")
      .to.be.empty;
  });

  it("a self-join on the same column name attributes nothing, and says so", async () => {
    const {tableShapesPerTable} = await import("../tools/sqlscript-ir.mjs");
    // the same name on both sides: the predicate cannot tell them apart, and
    // neither can we - pointing both scans at one table would only move the
    // ambiguity into a self-join
    const rel = join(scan("A"), scan("A"), bin("=", col("K"), col("K"), T.bool));
    const shapes = tableShapesPerTable(rel);
    expect(shapes.attributed).to.be.empty;
    expect(shapes.unattributed).to.contain("K");
  });

  it("a side that is itself a join attributes nothing from the outer predicate", async () => {
    const {tableShapesPerTable} = await import("../tools/sqlscript-ir.mjs");
    // (A join B) join C: the outer predicate says OUTER is under the left,
    // which is two tables - narrowing three candidates to two is not
    // attribution, and placing it in both is the ambiguity again
    const inner = join(scan("A"), scan("B"), bin("=", col("KA"), col("KB"), T.bool));
    const rel = join(inner, scan("C"), bin("=", col("OUTER"), col("KC"), T.bool));
    const shapes = tableShapesPerTable(rel);
    expect(shapes.unattributed, "the outer predicate could not place it").to.contain("OUTER");
    // but the inner predicate still did its own work
    expect(Object.keys(shapes.perTable.A)).to.contain("KA");
    expect(Object.keys(shapes.perTable.B)).to.contain("KB");
  });

  it("columns the predicate does not mention are reported, not silently placed", async () => {
    const {tableShapesPerTable} = await import("../tools/sqlscript-ir.mjs");
    const rel = filter(join(scan("A"), scan("B"), bin("=", col("KA"), col("KB"), T.bool)),
                       bin(">", col("OTHER"), lit(1, T.int), T.bool));
    const shapes = tableShapesPerTable(rel);
    expect(shapes.unattributed, "put somewhere to run, and named so nobody mistakes it for knowledge")
      .to.contain("OTHER");
  });
});
