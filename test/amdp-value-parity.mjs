import {expect} from "chai";
import {inputCases, compareOutputs, hanaInputsFor} from "../tools/amdp-value-parity.mjs";
import {T} from "../tools/sqlscript-ir.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";

describe("AMDP value parity report", () => {
  it("hands HXE the case's inputs under the signature's own parameter names", () => {
    // the compiled program keys a case upper-case; amdp-run reads the
    // signature's name lower-cased: without the mapping a procedure with
    // lower-case parameters got NULL and an empty table on HXE
    const signature = {parameters: [{name: "iv_n", direction: "IN"}, {name: "it_in", direction: "IN"}, {name: "et_out", direction: "OUT"}]};
    const sample = {inputs: {IV_N: 7}, tables: {IT_IN: [{ID: 1}, {ID: 2}]}};
    expect(hanaInputsFor(signature, sample)).to.deep.equal({iv_n: 7, it_in: [{ID: 1}, {ID: 2}]});
    expect(hanaInputsFor({parameters: [{name: "IV_N", direction: "IN"}]}, {inputs: {IV_N: 0}, tables: {}})).to.deep.equal({iv_n: 0});
    expect(() => hanaInputsFor({parameters: [{name: "iv_x", direction: "IN"}]}, sample)).to.throw(/no input generated for parameter iv_x/);
  });

  it("counts an output missing on either side as a difference, not as a matching NULL", () => {
    const program = {outputs: [{name: "EV", scalar: T.int}]};
    expect(compareOutputs({}, {outputs: {}}, program)).to.deep.equal({output: "EV", expected: "missing", actual: "missing"});
    expect(compareOutputs({ev: null}, {outputs: {}}, program)).to.include({actual: "missing"});
    expect(compareOutputs({ev: null}, {outputs: {EV: {value: null}}}, program)).to.equal(undefined);
  });

  it("generates empty, default and edge inputs from the signature", () => {
    const program = {parameters: [{name: "IV", type: T.int}], relationParameters: [
      {name: "IT", schema: {ID: T.int, AMOUNT: T.dec(9, 2), LABEL: T.char(4)}}]};
    const cases = inputCases(program);
    expect(cases.map((one) => one.variant)).to.deep.equal(["empty", "defaults", "edges", "nulls"]);
    expect(cases[0].tables.IT).to.deep.equal([]);
    expect(cases[1].tables.IT).to.have.length(2);
    expect(cases[1].tables.IT[0].AMOUNT).to.equal("0.00");
    expect(cases[2].tables.IT[1].AMOUNT).to.equal("9999999.99");
    expect(cases[2].tables.IT[2]).to.deep.equal({ID: -2, AMOUNT: "-2.25", LABEL: "ZZZZ"});
    expect(cases[3].tables.IT[1]).to.deep.equal({ID: null, AMOUNT: null, LABEL: null});
  });

  it("compares every output, preserving duplicate rows and the declared decimal scale", () => {
    const program = {outputs: [
      {name: "ET", schema: {ID: T.int, AMOUNT: T.dec(9, 2)}},
      {name: "EV", scalar: T.int},
    ]};
    const hana = {et: [{ID: 2, AMOUNT: "7.50"}, {ID: 1, AMOUNT: "0.00"}], ev: 3};
    const portable = {outputs: {ET: {rows: [{ID: 1, AMOUNT: "0"}, {ID: 2, AMOUNT: "7.5"}]}, EV: {value: 3}}};
    expect(compareOutputs(hana, portable, program)).to.equal(undefined);
    expect(compareOutputs(hana, portable, program, true)).to.deep.include({output: "ET", row: 0, column: "ID"});
    portable.outputs.ET.rows.push({ID: 2, AMOUNT: "7.5"});
    expect(compareOutputs(hana, portable, program)).to.deep.include({output: "ET", row: 2});
  });

  it("records HXE's SQL NULL from concatenation and the portable scalar boundary's empty value", async () => {
    // HXE 2.00.088, run by hand under hxe.lock on 2026-10-01:
    // CREATE FUNCTION ... (IN A NVARCHAR(4), IN B NVARCHAR(4))
    // RETURNS RESULT NVARCHAR(20) ... AS BEGIN
    // RESULT = 'p_' || :A || '_' || :B; END
    // SELECT f(NULL, 'X'), f('A', 'X') FROM DUMMY -> NULL, 'p_A_X'.
    const method = {name: "M", dbKind: "FUNCTION", parameters: [
      {name: "iv_a", direction: "IN", abapType: "c LENGTH 4"},
      {name: "iv_b", direction: "IN", abapType: "c LENGTH 4"},
      {name: "rv", direction: "RETURNING", abapType: "c LENGTH 20"}],
    body: "rv = 'p_' || :iv_a || '_' || :iv_b;"};
    const program = compileProcedure(method, new Map());
    const portable = await runProcedure(program, {inputs: {IV_A: null, IV_B: "X"}});
    expect(portable.value).to.equal("");
    expect(compareOutputs({rv: null}, portable, program)).to.deep.equal({output: "RV", expected: null, actual: ""});
  });

  for (const [dialect, make] of [["sqlite", () => new FileSqliteClient()], ["duckdb", () => new DuckDBDatabaseClient()]]) {
    it(`runs two-argument SUBSTR as HXE observed on ${dialect}`, async () => {
      // HXE 2.00.088, measured by hand under hxe.lock on 2026-10-01:
      // SELECT SUBSTR('abcdef', 3) AS V FROM DUMMY -> 'cdef'.
      const types = new Map([["TY_ROW", {kind: "structure", components: [{name: "V", abapType: "c LENGTH 4"}]}],
        ["TT", {kind: "table", of: "TY_ROW"}]]);
      const program = compileProcedure({name: "M", parameters: [{name: "et", direction: "OUT", abapType: "TT"}],
        body: "et = SELECT SUBSTR('abcdef', 3) AS V FROM DUMMY;"}, types, {catalogue: {DUMMY: {}}});
      const client = make();
      await client.connect();
      try {
        const result = await runProcedure(program, {client, dialect});
        expect(result.rows).to.deep.equal([{V: "cdef"}]);
      } finally { await client.disconnect(); }
    });
  }
});
