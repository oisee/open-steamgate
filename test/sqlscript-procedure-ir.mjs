import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {T, lit, param, bin, call, scan, filter, project, union, varRef} from "../tools/sqlscript-ir.mjs";
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop,
  runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";

const p = (name, type = T.int) => param(name, type);

function squaresProgram() {
  const empty = project(
    filter(scan("DUMMY"), bin("=", lit(1, T.int), lit(0, T.int), T.bool)),
    [{as: "ID", expr: lit(0, T.int)},
     {as: "LABEL", expr: lit("", T.char(20))},
     {as: "SQUARE", expr: lit(0, T.int)}]);
  const row = project(scan("DUMMY"),
    [{as: "ID", expr: p("LV_I")},
     {as: "LABEL", expr: bin("||", lit("square of ", T.char(10)), p("LV_I"), T.str)},
     {as: "SQUARE", expr: bin("*", p("LV_I"), p("LV_I"), T.int)}]);
  return procedure({
    parameters: [{name: "IV_COUNT", type: T.int}],
    output: "ET_SQUARE",
    outputSchema: {ID: T.int, LABEL: T.char(20), SQUARE: T.int},
    body: [
      declareScalar("LV_I", T.int),
      assignRelation("ET_SQUARE", empty),
      assignScalar("LV_I", lit(1, T.int)),
      whileLoop(bin("<=", p("LV_I"), p("IV_COUNT"), T.bool), [
        assignRelation("ET_SQUARE", union([varRef("ET_SQUARE"), row], true)),
        assignScalar("LV_I", bin("+", p("LV_I"), lit(1, T.int), T.int)),
      ]),
    ],
  });
}

describe("the typed SQLScript procedural IR", function () {
  this.timeout(30000);
  let client;

  beforeEach(async () => {
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("runs host control flow and one final relational statement", async () => {
    let invocations = 0;
    const native = client.native.bind(client);
    client.native = async (...args) => { invocations += 1; return native(...args); };
    const answer = await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: 4}});
    expect(answer.rows.sort((a, b) => Number(a.ID) - Number(b.ID))).to.deep.equal([
      {ID: 1, LABEL: "square of 1", SQUARE: 1},
      {ID: 2, LABEL: "square of 2", SQUARE: 4},
      {ID: 3, LABEL: "square of 3", SQUARE: 9},
      {ID: 4, LABEL: "square of 4", SQUARE: 16},
    ]);
    expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    expect(invocations).to.equal(1);
    expect(answer.trace.boundParameters).to.be.greaterThan(4);
  });

  it("keeps the declared schema when zero iterations return no rows", async () => {
    const answer = await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: 0}});
    expect(answer.rows).to.deep.equal([]);
    expect(answer.columns.map((column) => column.name)).to.deep.equal(["ID", "LABEL", "SQUARE"]);
    // This is the signature declaration carried across the empty-result
    // boundary; the engine columns above are checked separately.
    expect(answer.outputSchema).to.deep.equal({ID: T.int, LABEL: T.char(20), SQUARE: T.int});
  });

  it("captures each iteration's scalar and previous relation version", async () => {
    const answer = await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: 3}});
    expect(answer.rows.sort((a, b) => Number(a.ID) - Number(b.ID)).map((row) => [row.ID, row.SQUARE]))
      .to.deep.equal([[1, 1], [2, 4], [3, 9]]);
  });

  it("fails boundedly instead of hanging in an infinite loop", async () => {
    const endless = procedure({parameters: [], output: "OUT", outputSchema: {ID: T.int}, body: [
      assignRelation("OUT", project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}])),
      whileLoop(bin("=", lit(1, T.int), lit(1, T.int), T.bool), []),
    ]});
    let error;
    try { await runProcedure(endless, {client, dialect: "duckdb", maxSteps: 5}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.code).to.equal("UNSUPPORTED_SQLSCRIPT");
    expect(error.message).to.contain("step limit 5");
  });

  it("refuses integer overflow before it reaches a database", async () => {
    const overflow = squaresProgram();
    overflow.body.splice(3, 0, assignScalar("LV_I", lit(2147483647, T.int)));
    let error;
    try { await runProcedure(overflow, {client, dialect: "duckdb", inputs: {IV_COUNT: 2147483647}, maxSteps: 10}); }
    catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("outside SQLScript INTEGER");
  });

  it("preserves a NULL INTEGER input instead of coercing it to zero", async () => {
    const answer = await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: null}});
    expect(answer.rows).to.deep.equal([]);
  });

  it("validates a DECLARE initializer against its declared type", async () => {
    const invalid = procedure({output: "OUT", outputSchema: {ID: T.int}, body: [
      declareScalar("I", T.int, lit(1.5, T.dec(2, 1))),
      assignRelation("OUT", project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}])),
    ]});
    let error;
    try { await runProcedure(invalid, {client, dialect: "duckdb"}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("outside SQLScript INTEGER");
  });

  it("bounds the expanded relational plan as well as host statements", async () => {
    const doubling = procedure({output: "OUT", outputSchema: {ID: T.int}, body: [
      assignRelation("OUT", project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}])),
      whileLoop(bin("=", lit(1, T.int), lit(1, T.int), T.bool), [
        assignRelation("OUT", union([varRef("OUT"), varRef("OUT")], true)),
      ]),
    ]});
    let error;
    try {
      await runProcedure(doubling, {client, dialect: "duckdb", maxSteps: 100, maxPlanNodes: 31});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("expanded plan limit 31");
  });

  it("captures scalar parameters inside window partitions", async () => {
    const ranked = call("SUM", [p("I")], T.int);
    ranked.window = {partitionBy: [p("I")], orderBy: []};
    const program = procedure({output: "OUT", outputSchema: {N: T.int}, body: [
      declareScalar("I", T.int, lit(7, T.int)),
      assignRelation("OUT", project(scan("DUMMY"), [{as: "N", expr: ranked}])),
      assignScalar("I", lit(8, T.int)),
    ]});
    const answer = await runProcedure(program, {client, dialect: "duckdb"});
    expect(answer.rows).to.deep.equal([{N: 7}]);
    expect(answer.trace.boundParameters).to.equal(2);
  });

  it("refuses NO_INLINE until the executor has a real materialisation barrier", async () => {
    const forced = project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}]);
    forced.hints = ["NO_INLINE"];
    const program = procedure({output: "OUT", outputSchema: {ID: T.int}, body: [assignRelation("OUT", forced)]});
    let error;
    try { await runProcedure(program, {client, dialect: "duckdb"}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("materialisation barrier");

  });

  it("requires boolean operands and a boolean WHILE condition", async () => {
    const invalid = procedure({output: "OUT", outputSchema: {ID: T.int}, body: [
      assignRelation("OUT", project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}])),
      whileLoop(bin("AND", lit(1, T.int), lit(2, T.int), T.bool), []),
    ]});
    let error;
    try { await runProcedure(invalid, {client, dialect: "duckdb"}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("requires a boolean or NULL");
  });

  it("validates execution budgets before interpreting the body", async () => {
    let error;
    try {
      await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: 1}, maxPlanDepth: 0});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.equal("maxPlanDepth must be a positive safe integer");
  });

  it("refuses excessive input depth before recursive freezing", async () => {
    let deep = scan("DUMMY");
    for (let i = 0; i < 5000; i += 1) deep = filter(deep, bin("=", lit(1, T.int), lit(1, T.int), T.bool));
    const program = procedure({output: "OUT", body: [assignRelation("OUT", deep)]});
    let error;
    try { await runProcedure(program, {client, dialect: "duckdb", maxPlanDepth: 16}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("plan depth limit 16");
  });

  it("counts bound literals against the parameter budget", async () => {
    const relation = project(scan("DUMMY"), [
      {as: "A", expr: lit("one", T.str)}, {as: "B", expr: lit("two", T.str)},
    ]);
    const program = procedure({output: "OUT", body: [assignRelation("OUT", relation)]});
    let invocations = 0;
    const native = client.native.bind(client);
    client.native = async (...args) => { invocations += 1; return native(...args); };
    let error;
    try { await runProcedure(program, {client, dialect: "duckdb", maxParameters: 1}); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("bound parameter limit 1");
    expect(invocations).to.equal(0);
  });

  it("binds a typed table input as a relation, never as a JavaScript array", async () => {
    const program = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int}}],
      output: "OUT", outputSchema: {ID: T.int},
      body: [assignRelation("OUT", varRef("IT_ROWS"))],
    });
    const supplied = union([
      project(scan("DUMMY"), [{as: "ID", expr: lit(2, T.int)}]),
      project(scan("DUMMY"), [{as: "ID", expr: lit(3, T.int)}]),
    ], true);
    const answer = await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: supplied},
      inputCatalogue: {DUMMY: {}}});
    expect(answer.rows.map((one) => one.ID).sort()).to.deep.equal([2, 3]);
    let error;
    try { await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: [{ID: 2}]}}); }
    catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("missing typed relation input IT_ROWS");

    const wrong = project(scan("DUMMY"), [{as: "OTHER", expr: lit("abc", T.str)}]);
    try {
      await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: wrong},
        inputCatalogue: {DUMMY: {}}});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("schema does not match");

    const open = project(scan("DUMMY"), [{as: "ID", expr: p("IV")}]);
    try {
      await runProcedure(program, {client, dialect: "duckdb", inputs: {IV: 7}, relationInputs: {IT_ROWS: open},
        inputCatalogue: {DUMMY: {}}});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("unknown scalar :iv");

    const forced = project(scan("DUMMY"), [{as: "ID", expr: lit(2, T.int)}]);
    forced.hints = ["NO_INLINE"];
    try {
      await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: forced},
        inputCatalogue: {DUMMY: {}}});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("materialisation barrier");

    const mixed = union([
      project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}]),
      project(scan("DUMMY"), [{as: "ID", expr: lit("abc", T.str)}]),
    ], true);
    try {
      await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: mixed},
        inputCatalogue: {DUMMY: {}}});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("differs in type");

    let deep = scan("DUMMY");
    for (let i = 0; i < 5000; i += 1) deep = filter(deep, bin("=", lit(1, T.int), lit(1, T.int), T.bool));
    try {
      await runProcedure(program, {client, dialect: "duckdb", relationInputs: {IT_ROWS: deep}, maxPlanDepth: 16,
        inputCatalogue: {DUMMY: {}}});
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("plan depth limit 16");
  });
});
