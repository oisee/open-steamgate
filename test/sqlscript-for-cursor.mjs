// FOR r AS c DO ... END FOR: a loop over a cursor's rows, in the order they
// are known to come in -- a property of the relation (defined / inherited /
// unknown), observed on HXE and A4H (docs/sqlscript-hana-observed.md, "The
// order a cursor's rows come in"). A loop over an unknown order is refused.
import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {compileProcedure, orderOf} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, orderedRelation, UnsupportedSqlScript, procedure, forCursor, assignScalar} from "../tools/sqlscript-procedure-ir.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {project, union, scan, lit, filter, order, join, bin, col, aggregate, limit, subquery, varRef, T} from "../tools/sqlscript-ir.mjs";

const TYPES = new Map([["TT", {kind: "table", of: "TY"}],
  ["TY", {kind: "structure", components: [{name: "n", abapType: "i"}, {name: "k", abapType: "i"}]}]]);
const SIG = {name: "M", kind: "METHOD", parameters: [
  {name: "it", direction: "IN", abapType: "tt"}, {name: "ev", direction: "OUT", abapType: "string"}]};
const compile = (body) => compileProcedure({...SIG, body}, TYPES, {});
// the caller's rows, in the order 3, 1, 2 (k 30, 10, 20): not sorted by anything
const IT = union([[3, 30], [1, 10], [2, 20]].map(([n, k]) =>
  project(scan("DUMMY"), [{as: "N", expr: lit(n, T.int)}, {as: "K", expr: lit(k, T.int)}])), true);
const LOOP = (cursor, prologue = "") => `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR ${cursor};
  ${prologue} FOR r AS c DO v = :v || r.n || ','; END FOR; ev = :v;`;

describe("the order of a relation's rows, as the compiler classifies it", () => {
  it("defined by ORDER BY or the caller's rows, inherited through filter and projection, unknown otherwise", () => {
    const given = new Map([["IT", {kind: "defined", why: "the caller's rows"}]]);
    const it = {rel: "var", name: "IT"};
    expect(orderOf(order(it, [{col: "K", desc: false}]))).to.include({kind: "defined"});
    expect(orderOf(filter(it, bin(">", col("K", T.int), lit(1, T.int), T.bool)), given)).to.include({kind: "inherited"});
    expect(orderOf(project(it, [{as: "N", expr: col("N", T.int)}]), given)).to.include({kind: "inherited"});
    expect(orderOf({...project(it, [{as: "N", expr: col("N", T.int)}]), distinct: true}, given)).to.include({kind: "unknown", why: "DISTINCT"});
    expect(orderOf(join(it, it, lit(true, T.bool)), given)).to.include({kind: "unknown", why: "a join"});
    expect(orderOf(scan("SFLIGHT"))).to.include({kind: "unknown"});
    expect(orderOf(it)).to.include({kind: "unknown"}); // a variable nobody gave an order
  });

  it("refuses a FOR whose ORDER BY leaves ties among the columns it reads", () => {
    let caught;
    try { compile(LOOP("SELECT n, k FROM :it ORDER BY k")); } catch (error) { caught = error; }
    expect(caught).to.include({reason: "order"});
    expect(caught.message).to.match(/sorted by K, and rows equal in those come in any order, while the loop reads N too/);
  });

  const refusedFor = (body) => { try { compile(body); } catch (error) { return error; } };
  it("counts only what was measured or is guaranteed: an ORDER BY inside, a union, grouping, LIMIT, a window, a semi-join are unknown", () => {
    const given = new Map([["IT", {kind: "defined", why: "the caller's rows", ties: null}]]);
    const it = {rel: "var", name: "IT"};
    const n = [{as: "N", expr: col("N", T.int)}];
    expect(orderOf(project(order(it, [{col: "N", desc: false}]), n), given)).to.include({kind: "unknown"});
    expect(orderOf(union([it, it], true), given)).to.include({kind: "unknown", why: "a union"});
    expect(orderOf(aggregate(it, [col("N", T.int)], []), given)).to.include({kind: "unknown", why: "grouping"});
    expect(orderOf(limit(it, 2), given)).to.include({kind: "unknown", why: "LIMIT"});
    expect(orderOf(project(it, [{as: "R", expr: {node: "call", fn: "ROW_NUMBER", args: [], window: {orderBy: []}, type: T.int}}]), given)).to.include({kind: "unknown"});
    expect(orderOf(filter(it, subquery("exists", it)), given)).to.include({kind: "unknown"});
    expect(refusedFor(LOOP("SELECT n, k FROM :lt", "lt = SELECT n, k FROM :it ORDER BY k, n;"))).to.include({reason: "order"});
  });

  it("merges orders where paths meet: the same order on every path survives, a different one does not", () => {
    // assigned the same on both branches: the caller's order survives
    const same = `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :lt;
      IF 1 = 1 THEN lt = SELECT n FROM :it; ELSE lt = SELECT n FROM :it WHERE n > 0; END IF;
      FOR r AS c DO v = :v || r.n; END FOR; ev = :v;`;
    expect(() => compile(same)).not.to.throw();
    const different = `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :lt;
      IF 1 = 1 THEN lt = SELECT n FROM :it; ELSE lt = SELECT DISTINCT n FROM :it; END IF;
      FOR r AS c DO v = :v || r.n; END FOR; ev = :v;`;
    expect(refusedFor(different)).to.include({reason: "order"});
    // assigned again after: the later assignment decides, not the worse one
    const again = `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :lt;
      lt = SELECT DISTINCT n FROM :it; lt = SELECT n FROM :it;
      FOR r AS c DO v = :v || r.n; END FOR; ev = :v;`;
    expect(() => compile(again)).not.to.throw();
    // assigned inside a WHILE: unknown for the loop and after it
    const looped = `DECLARE v NVARCHAR(100) = ''; DECLARE i INTEGER = 0; DECLARE CURSOR c FOR SELECT n FROM :lt;
      lt = SELECT n FROM :it;
      WHILE :i < 2 DO lt = SELECT n FROM :lt WHERE n > :i; i = :i + 1; END WHILE;
      FOR r AS c DO v = :v || r.n; END FOR; ev = :v;`;
    expect(refusedFor(looped)).to.include({reason: "order"});
  });

  it("refuses what HANA was not seen to do: a cursor with arguments, a loop inside a loop over it, a table it reads assigned inside", () => {
    expect(refusedFor(`DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it; FOR r AS c(1) DO v = :v || r.n; END FOR; ev = :v;`).message)
      .to.match(/a cursor with arguments/);
    expect(refusedFor(`DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it;
      FOR r AS c DO FOR s AS c DO v = :v || s.n; END FOR; END FOR; ev = :v;`).message).to.match(/inside a loop over it/);
    expect(refusedFor(`DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it;
      FOR r AS c DO FOR r AS c DO v = :v || r.n; END FOR; END FOR; ev = :v;`).message).to.match(/same row name|inside a loop over it/);
    expect(refusedFor(`DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :lt; lt = SELECT n FROM :it;
      FOR r AS c DO lt = SELECT n FROM :it WHERE n > 1; v = :v || r.n; END FOR; ev = :v;`).message).to.match(/a table it reads is assigned inside the loop/);
  });

  it("carries ties through a rename: ORDER BY an alias it reads is fine, reading past it is not", () => {
    expect(() => compile(LOOP("SELECT n AS m FROM :it ORDER BY m").replace(/r\.n/g, "r.m"))).not.to.throw();
    const it = {rel: "var", name: "IT"};
    const known = orderedRelation(order(project(IT, [{as: "KK", expr: col("K", T.int)}, {as: "N", expr: col("N", T.int)}]), [{col: "KK", desc: false}]));
    expect([...known.ties]).to.deep.equal(["KK"]);
    // an ORDER BY below the cursor's own query, as a caller's relation brings it, counts for nothing
    expect(orderedRelation(project(filter(order(IT, [{col: "K", desc: false}]), lit(true, T.bool)), [{as: "N", expr: col("N", T.int)}]))).to.equal(undefined);
    expect(it.rel).to.equal("var");
  });

  it("a query's own source named like the row wins, and the row is gone after END FOR", () => {
    // inside the loop, `r.n` in a query FROM :it AS r is the table's column
    expect(() => compile(`DECLARE v NVARCHAR(100) = ''; DECLARE m INTEGER; DECLARE CURSOR c FOR SELECT n, k FROM :it;
      FOR r AS c DO SELECT MAX(r.n) INTO m FROM :it AS r; v = :v || :m; END FOR; ev = :v;`)).not.to.throw();
    expect(() => compile(`DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it;
      FOR r AS c DO v = :v || r.n; END FOR; v = :v || r.n; ev = :v;`)).to.throw();
  });

  it("refuses at compile time a FOR over DISTINCT, with the reason 'order'", () => {
    let caught;
    try { compile(LOOP("SELECT DISTINCT n FROM :it")); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(UnsupportedSqlScript).and.include({reason: "order"});
    expect(caught.message).to.match(/no order HANA guarantees \(DISTINCT\)/);
  });

  it("carries the order to an ORDER BY at run time: the caller's positions, or ORDER BY keys through a projection", () => {
    const numbered = orderedRelation(IT);
    expect(numbered.keys).to.have.length(1);
    expect(numbered.rel.inputs.map((part) => part.items.at(-1).expr.value)).to.deep.equal([0, 1, 2]);
    // the caller's positions, carried as a hidden column through a projection above them
    const projected = orderedRelation(project(IT, [{as: "N", expr: col("N", T.int)}]));
    expect(projected.rel.items.map((one) => one.as)).to.deep.equal(["N", "__ORD1"]);
    expect(projected.keys).to.deep.equal([{col: "__ORD1", desc: false}]);
    expect(projected.ties).to.equal(null);
    // the cursor's own ORDER BY, over the projection it orders
    const own = orderedRelation(order(project(IT, [{as: "N", expr: col("N", T.int)}]), [{col: "N", desc: true}]));
    expect(own.keys).to.deep.equal([{col: "N", desc: true}]);
    expect(orderedRelation(scan("SFLIGHT"))).to.equal(undefined);
  });
});

for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})],
  ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
  describe(`FOR over a cursor, run on ${dialect}`, function () {
    this.timeout(30000);
    let client;
    before(async () => { client = make(); await client.connect(); });
    after(async () => { await client.disconnect(); });
    const run = async (body) => runProcedure(compile(body), {client, dialect, relationInputs: {IT}});

    it("visits the caller's rows in the order they were given, and says what that rests on", async () => {
      const out = await run(LOOP("SELECT n, k FROM :it"));
      expect(out.value).to.equal("3,1,2,");
      expect(out.trace.order).to.deep.equal([{cursor: "C", order: "inherited(the caller's rows of :it)",
        basis: "observed:docs/sqlscript-hana-observed.md#the-order-a-cursors-rows-come-in", keys: ["__ORD1"], opened: 1}]);
    });
    it("refuses at run time a loop reading past its ORDER BY's keys, whatever the compiler was told", async () => {
      // a program built by hand, as another front end could: ORDER BY K, the loop reads N too
      const program = procedure({
        relationParameters: [{name: "IT", schema: {N: T.int, K: T.int}}], output: "RV", outputType: T.int,
        body: [
          forCursor("R", "C", order(project(varRef("IT"), [{as: "N", expr: col("N", T.int)}, {as: "K", expr: col("K", T.int)}]), [{col: "K", desc: false}]),
            {N: T.int, K: T.int}, [], {kind: "defined", why: "told so", ties: null}),
          assignScalar("RV", lit(1, T.int)),
        ]});
      let caught;
      try { await runProcedure(program, {client, dialect, relationInputs: {IT}}); } catch (error) { caught = error; }
      expect(caught).to.include({reason: "order"});
      expect(caught.message).to.match(/rows equal in its ORDER BY come in any order, and the loop reads N/);
    });

    it("refuses at run time a caller's table whose rows have no positions (a database table)", async () => {
      await client.native({sql: 'CREATE TABLE IF NOT EXISTS "SRC" ("N" INTEGER, "K" INTEGER)', expect: "none"});
      let caught;
      try { await runProcedure(compile(LOOP("SELECT n, k FROM :it")), {client, dialect, relationInputs: {IT: scan("SRC")}, inputCatalogue: {SRC: {N: T.int, K: T.int}}}); }
      catch (error) { caught = error; }
      expect(caught).to.include({reason: "order"});
      expect(caught.message).to.match(/not known at run time/);
    });
    it("a filter keeps that order", async () => {
      expect((await run(LOOP("SELECT n FROM :it WHERE k > 10"))).value).to.equal("3,2,");
    });
    it("the cursor's own ORDER BY decides it, when it sorts by every column the loop reads", async () => {
      const out = await run(LOOP("SELECT n, k FROM :it ORDER BY k DESC, n"));
      expect(out.value).to.equal("3,2,1,");
      expect(out.trace.order[0]).to.include({basis: "guaranteed"});
      expect((await run(LOOP("SELECT n FROM :it ORDER BY n"))).value).to.equal("1,2,3,");
    });
    it("ORDER BY puts NULL first ascending and last descending, as HANA does", async () => {
      const withNull = union([...IT.inputs, project(scan("DUMMY"), [{as: "N", expr: lit(null, T.int)}, {as: "K", expr: lit(40, T.int)}])], true);
      const loop = (dir) => `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it ORDER BY n ${dir};
        FOR r AS c DO v = :v || IFNULL(TO_NVARCHAR(r.n), 'N') || ','; END FOR; ev = :v;`;
      expect((await runProcedure(compile(loop("ASC")), {client, dialect, relationInputs: {IT: withNull}})).value).to.equal("N,1,2,3,");
      expect((await runProcedure(compile(loop("DESC")), {client, dialect, relationInputs: {IT: withNull}})).value).to.equal("3,2,1,N,");
    });
    it("an empty cursor runs the body no time", async () => {
      expect((await run(LOOP("SELECT n FROM :it WHERE k > 100"))).value).to.equal("");
    });
  });
}

// FOR i IN [REVERSE] a .. b, as measured on HXE (docs/sqlscript-hana-observed.md,
// "A numeric FOR loop"): every case here is the value HANA returned
describe("FOR over a range of integers, as HANA Express ran it", () => {
  const SIG1 = {name: "M", kind: "METHOD", parameters: [{name: "ev", direction: "OUT", abapType: "string"}]};
  const run = async (loop) => (await runProcedure(compileProcedure({...SIG1,
    body: `DECLARE v NVARCHAR(200) = ''; DECLARE n INTEGER = 0; DECLARE i INTEGER = 0; ${loop} ev = :v;`}, new Map(), {}), {})).value;
  for (const [name, loop, hana] of [
    ["inclusive", "FOR i IN 1 .. 3 DO v = :v || i || ','; END FOR;", "1,2,3,"],
    ["from above to: no turn", "FOR i IN 3 .. 1 DO v = :v || i || ','; END FOR;", ""],
    ["REVERSE counts down", "FOR i IN REVERSE 1 .. 3 DO v = :v || i || ','; END FOR;", "3,2,1,"],
    ["the bounds are read once", "n = 3; FOR i IN 1 .. :n DO n = 1; v = :v || i || ','; END FOR;", "1,2,3,"],
    ["1..:n without blanks", "n = 2; FOR i IN 1..:n DO v = :v || i || ','; END FOR;", "1,2,"],
    ["the counter is the loop's own", "FOR i IN 1 .. 3 DO i = 5; v = :v || i || ','; END FOR;", "5,5,5,"],
    ["the variable keeps the last value", "FOR i IN 1 .. 2 DO v = :v || i; END FOR; v = :v || '|' || :i;", "12|2"],
    ["bounds are expressions", "n = 2; FOR i IN :n - 1 .. :n * 2 DO v = :v || i || ','; END FOR;", "1,2,3,4,"],
    ["no turn leaves the variable as it was", "i = 7; FOR i IN 3 .. 1 DO v = :v || i; END FOR; v = :v || '|' || :i;", "|7"],
    ["after REVERSE, the last value visited", "FOR i IN REVERSE 1 .. 3 DO v = :v || i; END FOR; v = :v || '|' || :i;", "321|1"],
  ]) it(`${name}: ${JSON.stringify(hana)}`, async () => expect(await run(loop)).to.equal(hana));

  it("refuses what HANA refuses: an undeclared variable, a non-integer bound", () => {
    const compile1 = (body) => compileProcedure({...SIG1, body}, new Map(), {});
    expect(() => compile1("DECLARE v NVARCHAR(200) = ''; FOR i IN 1 .. 3 DO v = :v || i; END FOR; ev = :v;")).to.throw(/i is not declared|I is not declared/);
    expect(() => compile1("DECLARE v NVARCHAR(200) = ''; DECLARE i INTEGER = 0; FOR i IN 1 .. 2.7 DO v = :v || i; END FOR; ev = :v;")).to.throw(/not an integer/);
    expect(() => compile1("DECLARE v NVARCHAR(200) = ''; DECLARE s NVARCHAR(3); FOR s IN 1 .. 2 DO v = :v; END FOR; ev = :v;")).to.throw(/not INTEGER or BIGINT/);
  });

  // not measured on HANA: how this runtime spells and bounds the loop
  it("reads every spelling of the range: 1..3, 1 ..3, :n..3, 1.5..2 lexes as three tokens", async () => {
    expect(await run("FOR i IN 1..3 DO v = :v || i || ','; END FOR;")).to.equal("1,2,3,");
    expect(await run("FOR i IN 1 ..3 DO v = :v || i || ','; END FOR;")).to.equal("1,2,3,");
    expect(await run("n = 1; FOR i IN :n..3 DO v = :v || i || ','; END FOR;")).to.equal("1,2,3,");
    expect(lex("1.5..2").filter((t) => t.kind !== "eof").map((t) => t.value)).to.deep.equal(["1.5", ".", ".", "2"]);
    expect(lex("x = .5").filter((t) => t.kind !== "eof").map((t) => t.value)).to.deep.equal(["x", "=", ".5"]);
  });

  it("refuses what it does not count exactly or was not measured: a BIGINT bound past 2^53, a FOR inside a FOR over the same variable", async () => {
    const SIGB = {name: "M", kind: "METHOD", parameters: [{name: "ev", direction: "OUT", abapType: "string"}]};
    let caught;
    try {
      await runProcedure(compileProcedure({...SIGB, body: "DECLARE v NVARCHAR(200) = ''; DECLARE b BIGINT = 0; FOR b IN 9007199254740991 .. 9007199254740993 DO v = :v || 'x'; END FOR; ev = :v;"}, new Map(), {}), {});
    } catch (error) { caught = error; }
    expect(caught?.message).to.match(/past 2\^53/);
    expect(() => compileProcedure({...SIGB, body: "DECLARE v NVARCHAR(200) = ''; DECLARE i INTEGER = 0; FOR i IN 1 .. 2 DO FOR i IN 1 .. 2 DO v = :v || i; END FOR; END FOR; ev = :v;"}, new Map(), {}))
      .to.throw(/a FOR over I inside a FOR over I is not measured/);
  });
});
