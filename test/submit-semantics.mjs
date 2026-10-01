import {expect} from "chai";
import * as core from "@abaplint/core";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";
import {batchRegistrySource, generate, selectionSemanticsSource} from "../tools/osd-gui-convert.mjs";

describe("called report selection additions", () => {
  const parameter = (name, additions) => ({kind: "parameter", name, additions});
  const selectOption = (name, additions) => ({kind: "select-option", name, additions});
  const line = (kind, name, tail) => `io_builder->add_${kind}( VALUE #( name = '${name}' ${tail} ) ).`;

  it("converts report defaults once and passes abaplint's field-assignment check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-selection-defaults-"));
    try {
      writeFileSync(join(dir, "zdefaults.prog.abap"), `REPORT zdefaults.
DATA gv_text TYPE c LENGTH 8.
PARAMETERS p_char TYPE c LENGTH 3 DEFAULT 'mixed'.
PARAMETERS p_lower TYPE c LENGTH 5 LOWER CASE DEFAULT 'AbCdEf'.
PARAMETERS r_one RADIOBUTTON GROUP rad.
PARAMETERS r_two RADIOBUTTON GROUP rad DEFAULT 'X'.
SELECT-OPTIONS s_text FOR gv_text DEFAULT 'a' TO 'z' OPTION nb SIGN e.
SELECT-OPTIONS s_lower FOR gv_text LOWER CASE DEFAULT 'lower'.
START-OF-SELECTION.
  WRITE p_char.`);
      const {reports} = await generate([dir], join(dir, "generated"));
      expect(reports[0].supported).to.equal(true);
      const file = "zcl_osd_gui_defaults.clas.abap";
      const source = readFileSync(join(dir, "generated", file), "utf8");
      const lines = source.split("\n");
      expect(lines.find((row) => row.includes("name = 'S_TEXT'"))).to.include("sign = 'E' option = 'NB' low = 'a' high = 'z'");
      expect(lines.find((row) => row.includes("name = 'R_TWO'"))).to.include("default = abap_true");
      expect(lines.find((row) => row.includes("name = 'P_LOWER'"))).to.include("lower_case = abap_true");
      const lowerOption = lines.find((row) => row.includes("name = 'S_LOWER'"));
      expect(lowerOption?.match(/lower_case\s*=/g)).to.have.length(1);
      const syntax = (text) => new core.Registry(core.Config.getDefault())
        .addFile(new core.MemoryFile(file, text)).parse().findIssues()
        .filter((issue) => issue.getKey() === "check_syntax" && issue.getMessage() === "Duplicate field assignment");
      expect(syntax(source)).to.have.length(0);
      // The isolated class lacks its interface dependencies, but this check
      // still detects duplicate VALUE fields in the generated source.
      const duplicate = source.replace(lowerOption, lowerOption.replace("lower_case = abap_true", "lower_case = abap_true lower_case = abap_true"));
      expect(syntax(duplicate)).to.have.length(1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("ignores addition keywords inside defaults while keeping real additions", () => {
    const elements = [
      parameter("P_TEXT", "TYPE c LENGTH 20 DEFAULT 'lower case'"),
      selectOption("S_TEXT", "FOR p_text DEFAULT 'option eq sign e group r1 lower case'"),
      selectOption("S_REAL", "FOR p_text DEFAULT 'option eq' OPTION NE SIGN E LOWER CASE"),
    ];
    const source = [
      line("parameter", "P_TEXT", "default = 'lower case'"),
      line("select_option", "S_TEXT", "default = VALUE #( sign = 'I' option = 'EQ' low = 'option eq sign e group r1 lower case' )"),
      line("select_option", "S_REAL", "default = VALUE #( sign = 'I' option = 'EQ' low = 'option eq' )"),
    ].join("\n");
    const converted = selectionSemanticsSource(source, elements).split("\n");
    expect(converted[0]).to.include("zcl_osd_submit_semantics=>parameter(");
    expect(converted[1]).to.include("sign = 'I' option = 'EQ'");
    expect(converted[1]).to.not.include("lower_case = abap_true");
    expect(converted[2]).to.include("sign = 'E' option = 'NE'");
    expect(converted[2]).to.include("lower_case = abap_true");
    const registry = batchRegistrySource([{programName: "Z_TEST", className: "ZCL_TEST", wired: true,
      selectionElements: elements, selectionNames: elements.map((element) => element.name)}]);
    expect(registry).to.include("INSERT `S_REAL` INTO TABLE lt_lower_case.");
    expect(registry).to.not.include("INSERT `P_TEXT` INTO TABLE lt_lower_case.");
    expect(registry).to.not.include("INSERT `S_TEXT` INTO TABLE lt_lower_case.");
  });

  it("reads radio groups and explicit defaults outside quoted text", () => {
    const elements = [
      parameter("P_ONE", "RADIOBUTTON GROUP r1 DEFAULT 'group r2'"),
      parameter("P_TWO", "RADIOBUTTON GROUP r1 DEFAULT 'X'"),
      parameter("P_THREE", "DEFAULT 'radiobutton group r1' RADIOBUTTON GROUP r2"),
    ];
    const source = elements.map((element) => line("radiobutton", element.name, "")).join("\n");
    const converted = selectionSemanticsSource(source, elements).split("\n");
    expect(converted[0]).to.not.include("default = abap_true");
    expect(converted[1]).to.include("default = abap_true");
    expect(converted[2]).to.include("default = abap_true");
  });
});

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
