import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {T, lit, param, sessionValue, bin, call, scan, filter, project, union, varRef} from "../tools/sqlscript-ir.mjs";
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop,
  ifElse, callProcedure, runProcedure, UnsupportedSqlScript, Int2OutOfRange, ScalarTooLong} from "../tools/sqlscript-procedure-ir.mjs";

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

  it("refuses a hand-built session node that changes the measured STRING type", async () => {
    const bad = procedure({output: "OUT", outputSchema: {VALUE: T.int}, body: [
      assignRelation("OUT", project(scan("DUMMY"), [
        {as: "VALUE", expr: sessionValue("user", "CURRENT_USER", T.int)},
      ])),
    ]});
    let invocations = 0;
    const native = client.native.bind(client);
    client.native = async (...args) => { invocations += 1; return native(...args); };
    let refusal;
    try {
      await runProcedure(bad, {client, dialect: "duckdb", session: {currentUser: "123"}});
    } catch (error) { refusal = error; }
    expect(refusal).to.be.instanceOf(UnsupportedSqlScript);
    expect(refusal.message).to.match(/must have the measured STRING type/);
    expect(invocations).to.equal(0);
  });

  it("keeps the declared schema when zero iterations return no rows", async () => {
    const answer = await runProcedure(squaresProgram(), {client, dialect: "duckdb", inputs: {IV_COUNT: 0}});
    expect(answer.rows).to.deep.equal([]);
    expect(answer.columns.map((column) => column.name)).to.deep.equal(["ID", "LABEL", "SQUARE"]);
    // This is the signature declaration carried across the empty-result
    // boundary; the engine columns above are checked separately.
    expect(answer.outputSchema).to.deep.equal({ID: T.int, LABEL: T.char(20), SQUARE: T.int});
  });

  it("applies the declared packed-decimal type to an exact INTEGER output", async () => {
    const program = procedure({output: "OUT", outputSchema: {FACTOR: T.dec(8, 3)}, body: [
      assignRelation("OUT", project(scan("DUMMY"), [{as: "FACTOR", expr: lit(0, T.int)}])),
    ]});
    const answer = await runProcedure(program, {client, dialect: "duckdb"});
    expect(answer.rows).to.deep.equal([{FACTOR: "0.000"}]);
    expect(answer.outputSchema).to.deep.equal({FACTOR: T.dec(8, 3)});
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

  it("executes only the first true IF branch and treats NULL as not true", async () => {
    const row = (id) => assignRelation("OUT", project(scan("DUMMY"), [{as: "ID", expr: lit(id, T.int)}]));
    const program = procedure({output: "OUT", outputSchema: {ID: T.int}, body: [
      ifElse([
        {condition: lit(null, T.bool), body: [row(1)]},
        {condition: lit(true, T.bool), body: [row(2)]},
        {condition: lit(true, T.bool), body: [row(3)]},
      ], [row(4)]),
    ]});
    const answer = await runProcedure(program, {client, dialect: "duckdb"});
    expect(answer.rows).to.deep.equal([{ID: 2}]);
  });

  it("requires the selected path to assign a scalar RETURNING value", async () => {
    const scalar = procedure({parameters: [{name: "IV", type: T.int}], output: "RV", outputType: T.int,
      body: [ifElse([{condition: bin(">", p("IV"), lit(0, T.int), T.bool),
        body: [assignScalar("RV", p("IV"))]}]) ]});
    expect((await runProcedure(scalar, {inputs: {IV: 2}})).value).to.equal(2);
    let failure;
    try { await runProcedure(scalar, {inputs: {IV: 0}}); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/scalar output RV was not assigned/);

    const wide = procedure({output: "RV", outputType: T.char(3), body: [
      assignScalar("RV", lit("abcdef", T.char(6))),
    ]});
    failure = undefined;
    try { await runProcedure(wide); } catch (error) { failure = error; }
    // a text RETURNING is carried and evaluated on the host; too long for
    // c LENGTH 3 raises, as on A4H
    expect(failure).to.be.instanceOf(ScalarTooLong);

    const optionalChar = procedure({parameters: [{name: "IV", type: T.char(3), optional: true}],
      output: "RV", outputType: T.int, body: [assignScalar("RV", lit(1, T.int))]});
    // a fixed-length character input is admitted since the A4H measurement
    // (2026-09-23); an omitted optional one is '' like ABAP's initial value
    expect((await runProcedure(optionalChar)).value).to.equal(1);
    const malformedChar = procedure({parameters: [{name: "IV", type: {abap: "C"}, optional: true}],
      output: "RV", outputType: T.int, body: [assignScalar("RV", lit(1, T.int))]});
    failure = undefined;
    try { await runProcedure(malformedChar); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/scalar inputs require the exact ABAP INTEGER, STRING, fixed-length character or fixed-length RAW type/);

    const malformedOptional = procedure({parameters: [{name: "IV", type: T.str, optional: "false"}],
      output: "RV", outputType: T.int, body: [assignScalar("RV", lit(1, T.int))]});
    failure = undefined;
    try { await runProcedure(malformedOptional); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/IV has a malformed OPTIONAL flag/);

    const stringCondition = procedure({parameters: [{name: "IV", type: T.str}],
      output: "RV", outputType: T.int, body: [
        ifElse([{condition: bin("=", p("IV", T.str), lit("x", T.str), T.bool),
          body: [assignScalar("RV", lit(1, T.int))]}], [assignScalar("RV", lit(0, T.int))]),
      ]});
    // a text equality is the host's, by the measured rule, with no database
    expect((await runProcedure(stringCondition, {inputs: {IV: "x"}})).value).to.equal(1);
    expect((await runProcedure(stringCondition, {inputs: {IV: "x  "}})).value).to.equal(0);
    const orderedText = procedure({parameters: [{name: "IV", type: T.str}],
      output: "RV", outputType: T.int, body: [
        ifElse([{condition: bin("<", p("IV", T.str), lit("x", T.str), T.bool),
          body: [assignScalar("RV", lit(1, T.int))]}], [assignScalar("RV", lit(0, T.int))]),
      ]});
    failure = undefined;
    try { await runProcedure(orderedText, {inputs: {IV: "a"}}); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    // ordering a text is not measured, so it is the engine's, and there is none
    expect(failure.message).to.match(/IF condition: a scalar the host does not evaluate goes to the database, and this run has none/);

    const forgedStringCondition = procedure({parameters: [{name: "IV", type: T.str}],
      output: "RV", outputType: T.int, body: [
        ifElse([{condition: bin("=", p("IV", T.int), lit(7, T.int), T.bool),
          body: [assignScalar("RV", lit(1, T.int))]}], [assignScalar("RV", lit(0, T.int))]),
      ]});
    failure = undefined;
    try { await runProcedure(forgedStringCondition, {inputs: {IV: "7"}}); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/parameter :iv changes its measured type/);

    const malformedString = procedure({parameters: [{name: "IV", type: {abap: "STRING", len: 3}, optional: true}],
      output: "RV", outputType: T.int, body: [assignScalar("RV", lit(1, T.int))]});
    failure = undefined;
    try { await runProcedure(malformedString); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/scalar inputs require the exact ABAP INTEGER, STRING, fixed-length character or fixed-length RAW type/);

    // a required CHAR(3) input is bound right-trimmed, and one longer than
    // its field is refused rather than cut (measured on A4H, 2026-09-23)
    const requiredChar = procedure({parameters: [{name: "IV", type: T.char(3)}],
      output: "RV", outputType: T.int, body: [assignScalar("RV", lit(1, T.int))]});
    expect((await runProcedure(requiredChar, {inputs: {IV: "ab   "}})).value).to.equal(1);
    failure = undefined;
    try { await runProcedure(requiredChar, {inputs: {IV: "abcd"}}); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/IV is longer than its 3 characters/);

    const relationalScalar = procedure({output: "RV", outputType: T.int, body: [
      assignRelation("TMP", project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}])),
      assignScalar("RV", lit(1, T.int)),
    ]});
    failure = undefined;
    try { await runProcedure(relationalScalar); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/scalar-only portable functions cannot contain relational/);

    const decorated = procedure({parameters: [{name: "IV", type: T.int}], output: "RV", outputType: T.int,
      body: [assignScalar("RV", {...call("COALESCE", [p("IV"), lit(0, T.int)], T.int), window: {}})]});
    failure = undefined;
    try { await runProcedure(decorated, {inputs: {IV: 1}}); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(UnsupportedSqlScript);
    expect(failure.message).to.match(/COALESCE does not accept window/);
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

  it("composes a nested table procedure into one final database statement", async () => {
    const child = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int}}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [assignRelation("ET_ROWS", varRef("IT_ROWS"))],
    });
    const parent = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int}}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [
        declareScalar("N", T.int, lit(7, T.int)),
        assignRelation("LOCAL", union([varRef("IT_ROWS"),
          project(scan("DUMMY"), [{as: "ID", expr: p("N")}])], true)),
        callProcedure("ZCL_DEMO=>CHILD", "LOCAL", "ET_ROWS"),
      ],
    });
    const supplied = union([
      project(scan("DUMMY"), [{as: "ID", expr: lit(2, T.int)}]),
      project(scan("DUMMY"), [{as: "ID", expr: lit(5, T.int)}]),
    ], true);
    let invocations = 0;
    const native = client.native.bind(client);
    client.native = async (...args) => { invocations += 1; return native(...args); };
    const answer = await runProcedure(parent, {
      client, dialect: "duckdb", relationInputs: {IT_ROWS: supplied}, inputCatalogue: {DUMMY: {}},
      procedures: new Map([["ZCL_DEMO=>CHILD", child]]),
    });
    expect(answer.rows.map((one) => one.ID).sort()).to.deep.equal([2, 5, 7]);
    expect(answer.trace).to.include({nestedCalls: 1, databaseStatements: 1});
    expect(invocations).to.equal(1);
  });

  it("refuses an INT2 output or an INT2 table input of a nested CALL, whose range check the CALL does not carry", async () => {
    const rows = (...ids) => union(ids.map((id) => project(scan("DUMMY"), [{as: "ID", expr: lit(id, T.int)}])), true);
    const small = {ID: T.int2};
    const childOut = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int}}],
      output: "ET_ROWS", outputSchema: small,
      body: [assignRelation("ET_ROWS", varRef("IT_ROWS"))],
    });
    const parent = (childSchema) => procedure({
      relationParameters: [{name: "IT_ROWS", schema: childSchema}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [callProcedure("ZCL_DEMO=>CHILD", "IT_ROWS", "ET_ROWS")],
    });
    let caught;
    try {
      await runProcedure(parent({ID: T.int}), {client, dialect: "duckdb", relationInputs: {IT_ROWS: rows(40000)},
        inputCatalogue: {DUMMY: {}}, procedures: new Map([["ZCL_DEMO=>CHILD", childOut]])});
    } catch (error) { caught = error; }
    expect(caught?.message).to.match(/of a nested CALL has INT2 columns \(ID\)/);
    // an INTEGER output, so only the input refusal can fire here
    const childIn = procedure({
      relationParameters: [{name: "IT_ROWS", schema: small}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [assignRelation("ET_ROWS", varRef("IT_ROWS"))],
    });
    caught = undefined;
    try {
      await runProcedure(parent(small), {client, dialect: "duckdb", relationInputs: {IT_ROWS: project(rows(5), [{as: "ID", expr: {node: "col", name: "ID", type: T.int2}}])},
        inputCatalogue: {DUMMY: {}}, procedures: new Map([["ZCL_DEMO=>CHILD", childIn]])});
    } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(UnsupportedSqlScript);
    expect(caught.message).to.match(/relation input IT_ROWS has INT2 columns \(ID\)/);
  });

  it("checks the INT2 columns of a table input at the bind, as it checks a scalar INT2 input", async () => {
    const typed = (...ids) => project(union(ids.map((id) => project(scan("DUMMY"), [{as: "ID", expr: lit(id, T.int)}])), true),
      [{as: "ID", expr: {node: "col", name: "ID", type: T.int2}}]);
    const echo = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int2}}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [assignRelation("ET_ROWS", varRef("IT_ROWS"))],
    });
    const ok = await runProcedure(echo, {client, dialect: "duckdb", relationInputs: {IT_ROWS: typed(-32768, 32767)}, inputCatalogue: {DUMMY: {}}});
    expect(ok.rows.map((r) => Number(r.ID)).sort((a, b) => a - b)).to.deep.equal([-32768, 32767]);
    let caught;
    try {
      await runProcedure(echo, {client, dialect: "duckdb", relationInputs: {IT_ROWS: typed(1, 40000)}, inputCatalogue: {DUMMY: {}}});
    } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Int2OutOfRange);
    expect(caught.message).to.match(/relation input IT_ROWS: a row is outside INT2/);
  });

  it("bounds recursive nested calls before touching the database", async () => {
    const recursive = procedure({
      relationParameters: [{name: "IT_ROWS", schema: {ID: T.int}}],
      output: "ET_ROWS", outputSchema: {ID: T.int},
      body: [callProcedure("ZCL_DEMO=>RECURSE", "IT_ROWS", "ET_ROWS")],
    });
    const supplied = project(scan("DUMMY"), [{as: "ID", expr: lit(1, T.int)}]);
    let invocations = 0;
    const native = client.native.bind(client);
    client.native = async (...args) => { invocations += 1; return native(...args); };
    let error;
    try {
      await runProcedure(recursive, {
        client, dialect: "duckdb", relationInputs: {IT_ROWS: supplied}, inputCatalogue: {DUMMY: {}},
        procedures: new Map([["ZCL_DEMO=>RECURSE", recursive]]), maxCallDepth: 3,
      });
    } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(UnsupportedSqlScript);
    expect(error.message).to.contain("nested call depth limit 3");
    expect(invocations).to.equal(0);
  });
});
