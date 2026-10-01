import {expect} from "chai";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";

describe("called report SUBMIT selections", function () {
  this.timeout(30000);
  let abap;
  const box = (value) => new abap.types.String().set(value);
  const values = (rows) => {
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const table = types.ty_values.clone();
    for (const item of rows) {
      const row = types.ty_value.clone();
      row.get().name.set(item.name);
      row.get().value.set(item.value ?? "");
      for (const range of item.ranges ?? []) {
        const entry = types.ty_range.clone();
        for (const [key, value] of Object.entries(range)) entry.get()[key].set(value);
        row.get().ranges.append(entry);
      }
      table.append(row);
    }
    return table;
  };
  const run = async (input) => {
    const result = await abap.Classes.ZCL_OSD_BATCH_REPORT.run({
      iv_program: box("ZOSD_SUB_SEM"), ...(input ? {it_input: input} : {}),
    });
    expect(result.get().status.get()).to.equal("COMPLETED");
    return result.get().lines.array().map((line) => line.get());
  };

  before(async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    abap = globalThis.abap;
  });

  it("uses declared parameter, radio, and select-option defaults", async () => {
    const lines = await run();
    expect(lines).to.include.members(["EMPTY", "CHAR MIX", "LOWER AbCdE", "NUM 4",
      "RADIO X", "RADIO2  X", "HEADER A", "TEXT E NB A Z", "LCASE I EQ lower", "STR MIXED"]);
    expect(lines.find((line) => line.startsWith("DATE "))).to.match(/^DATE \d{8}$/);
  });

  it("converts supplied values using the called declarations and clears defaults", async () => {
    const lines = await run(values([
      {name: "P_CHAR", value: "abcde"}, {name: "P_LOWER", value: "aBcDeF"},
      {name: "P_NUM", value: "12"}, {name: "P_STR", value: "hello"},
    ]));
    expect(lines).to.include.members(["CHAR ABC", "LOWER aBcDe", "NUM 12", "STR HELLO"]);
    expect(await run(values([{name: "P_CHAR", value: ""}]))).to.include("CHAR");
  });

  it("replaces select-option defaults and appends repeated WITH rows in order", async () => {
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const rows = abap.Classes.ZCL_OSD_SUBMIT_SEMANTICS.ty_input_rows.clone();
    for (const value of ["q1", "q2"]) {
      const row = types.ty_value.clone();
      row.get().name.set("S_TEXT");
      row.get().value.set(value);
      rows.append(row);
    }
    const input = await abap.Classes.ZCL_OSD_SUBMIT_SEMANTICS.combine({it_rows: rows});
    const lines = await run(input);
    expect(lines).to.include("HEADER Q1");
    expect(lines.filter((line) => line.startsWith("TEXT "))).to.deep.equal([
      "TEXT I EQ Q1", "TEXT I EQ q2",
    ]);
    const fromRange = await run(values([{name: "S_TEXT", ranges: [
      {sign: "I", option: "CP", low: "z*"}, {sign: "I", option: "EQ", low: "m2"},
    ]}]));
    expect(fromRange).to.include("HEADER Z*");
    expect(fromRange.filter((line) => line.startsWith("TEXT "))).to.deep.equal([
      "TEXT I CP Z*", "TEXT I EQ m2",
    ]);
  });

  it("keeps an empty IN range distinct from scalar WITH = '' through combine and registry", async () => {
    await abap.Classes.ZCL_OSD_BATCH_RUNNER_TEST.empty_range_with();
    await abap.Classes.ZCL_OSD_BATCH_RUNNER_TEST.scalar_empty_with();
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const empty = types.ty_ranges.clone();
    const marked = await abap.Classes.ZCL_OSD_SUBMIT_RANGES.for_submit({it_range: empty});
    expect(marked.array()).to.have.length(1);
    const rows = abap.Classes.ZCL_OSD_SUBMIT_SEMANTICS.ty_input_rows.clone();
    const inRow = types.ty_value.clone();
    inRow.get().name.set("S_TEXT");
    inRow.get().ranges.set(marked);
    rows.append(inRow);
    const input = await abap.Classes.ZCL_OSD_SUBMIT_SEMANTICS.combine({it_rows: rows});
    expect(input.array()[0].get().ranges.array()).to.have.length(1);
    const noRows = await run(input);
    expect(noRows).to.include("HEADER");
    expect(noRows.filter((line) => line.startsWith("TEXT "))).to.deep.equal([]);

    const scalar = await run(values([{name: "S_TEXT", value: ""}]));
    expect(scalar.filter((line) => line.startsWith("TEXT "))).to.deep.equal(["TEXT I EQ"]);
  });

  it("converts both bounds of only the first range row unless LOWER CASE is declared", async () => {
    const lines = await run(values([{name: "S_TEXT", ranges: [
      {sign: "I", option: "BT", low: "a", high: "c"},
      {sign: "I", option: "BT", low: "d", high: "f"},
    ]}]));
    expect(lines).to.include("HEADER A");
    expect(lines.filter((line) => line.startsWith("TEXT "))).to.deep.equal([
      "TEXT I BT A C", "TEXT I BT d f",
    ]);
    const lower = await run(values([{name: "S_LOWER", ranges: [
      {sign: "I", option: "BT", low: "a", high: "c"},
    ]}]));
    expect(lower).to.include("LCASE I BT a c");
  });

  it("leaves caller sy-subrc intact and ends the step on an uncatchable numeric dump", async () => {
    abap.builtin.sy.get().subrc.set(4);
    await abap.Classes.ZCL_OSD_BATCH_REPORT.submit({iv_program: box("ZOSD_SUB_SEM")});
    expect(abap.builtin.sy.get().subrc.get()).to.equal(4);
    for (const bad of ["abc", "1abc"]) {
      let failure;
      try { await run(values([{name: "P_NUM", value: bad}])); }
      catch (error) { failure = error; }
      expect(failure, bad).to.be.instanceOf(Error);
      expect(failure.message, bad).to.include("CONVT_NO_NUMBER");
    }
    const client = abap.context.databaseConnections.DEFAULT;
    const commit = client.commit;
    const rollback = client.rollback;
    let commits = 0;
    let rollbacks = 0;
    client.commit = async function (...args) { commits++; return commit.apply(this, args); };
    client.rollback = async function (...args) { rollbacks++; return rollback.apply(this, args); };
    try {
      let failure;
      try {
        await dialogStep(() => abap.Classes.ZCL_OSD_BATCH_RUNNER_TEST.invalid_with());
      } catch (error) { failure = error; }
      expect(failure).to.be.instanceOf(Error);
      expect(failure.message).to.include("CONVT_NO_NUMBER");
      expect(commits).to.equal(0);
      expect(rollbacks).to.equal(1);
      expect(workProcess()).to.include({held: false});
    } finally {
      client.commit = commit;
      client.rollback = rollback;
    }
  });
});
