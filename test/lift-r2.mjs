// R2's source shape, refusal obligations, generated region, and one-call cost.
// The ABAP Unit class in src/lift also compares the row results and system
// fields on an ABAP runtime.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DEFAULT_DDIC, find, modelR2, modelR2FromSource, survey} from "../tools/lift.mjs";
import {Refusal} from "../tools/dsl-ddic.mjs";
import {region, render} from "../tools/dsl-regions.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {requireBatchedFae} from "./helpers/fae-runtime.mjs";

const DEMO = "src/lift/zcl_osd_lift_r2_demo.clas.abap";
const TEMPLATE = "recipes/r2-select-table-per-row/template.tpl";
const ORIGINAL = readFileSync(DEMO, "utf8");

describe("verified lift R2: SELECT table per row", function () {
  this.timeout(60000);
  let abap;
  const model = (source = ORIGINAL) => modelR2FromSource(basename(DEMO), source, "before", DEFAULT_DDIC);

  let scratch;
  before(async function () {
    await requireBatchedFae(this);
    await import("./start.mjs");
    abap = globalThis.abap;
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_ajson.clas.mjs");
    await import("../output/zcl_osd_lift_r2_demo.clas.mjs");
    scratch = mkdtempSync(join(tmpdir(), "lift-r2-test-"));
  });
  after(() => { if (scratch) rmSync(scratch, {recursive: true, force: true}); });

  async function seed() {
    const db = abap.context.databaseConnections.DEFAULT;
    await db.execute("DELETE FROM zosd_lift_r2 WHERE kind IN ('STAT', 'PRIO')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '001', 'X', 'First')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '002', 'X', 'Second')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '003', '', 'Hidden')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '004', 'X', 'Second')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'DONE', '001', 'X', 'Done')");
  }

  const makeRows = (keys) => {
    const line = new abap.types.Structure({
      kind: new abap.types.Character(4), code: new abap.types.Character(10),
      result: new abap.types.Character(100), status: new abap.types.Integer(), db_count: new abap.types.Integer(),
      tabix_seen: new abap.types.Integer(),
    });
    const table = abap.types.TableFactory.construct(line, {withHeader: false, keyType: "DEFAULT",
      primaryKey: {name: "primary_key", type: "STANDARD", isUnique: false, keyFields: []}, secondary: []});
    for (const [kind, code] of keys) {
      const row = table.getRowType().clone();
      row.get().kind.set(kind);
      row.get().code.set(code);
      table.append(row);
    }
    return table;
  };
  // runs a static method of `klass` on rows made from `keys`, counting the
  // database reads it makes
  const counted = async (klass, method, keys) => {
    const db = abap.context.databaseConnections.DEFAULT;
    const original = db.select.bind(db);
    let calls = 0;
    db.select = async (options) => { calls++; return original(options); };
    const rows = makeRows(keys);
    try {
      await klass[method]({ct_rows: rows});
    } finally {
      db.select = original;
    }
    return {calls, rows: rows.array().map((r) => ({
      kind: r.get().kind.get(), code: r.get().code.get(), result: r.get().result.get(),
      status: r.get().status.get(), db_count: r.get().db_count.get(),
      tabix_seen: r.get().tabix_seen.get(),
    }))};
  };

  // The differential: a BEFORE the model accepts becomes a class of its own
  // whose AFTER is BEFORE with its outer loop replaced by the rendered
  // region, transpiled alone and run here on the same rows. Rows, system
  // fields and the number of reads are compared.
  let serial = 0;
  async function differential(source) {
    const lifted = model(source);
    const {text} = await render(lifted, TEMPLATE);
    const start = source.indexOf("  METHOD before.\n");
    const end = source.indexOf("  ENDMETHOD.", start) + "  ENDMETHOD.".length;
    const beforeMethod = source.slice(start, end);
    const head = `    LOOP AT ${lifted.loop.table} ASSIGNING ${lifted.loop.row}.\n`;
    const loopAt = beforeMethod.indexOf(head);
    const loopEnd = beforeMethod.lastIndexOf("\n    ENDLOOP.\n") + "\n    ENDLOOP.\n".length;
    expect(loopAt, "outer loop found").to.be.greaterThan(0);
    const region = text.split("\n").map((line) => line ? `    ${line}` : line).join("\n");
    const afterMethod = beforeMethod.slice(0, loopAt).replace("METHOD before.", "METHOD after.") + region + beforeMethod.slice(loopEnd);
    const afterStart = source.indexOf("  METHOD after.\n");
    const afterEnd = source.indexOf("  ENDMETHOD.", afterStart) + "  ENDMETHOD.".length;
    const className = `zcl_osd_lift_r2_dx${++serial}`;
    const classSource = (source.slice(0, afterStart) + afterMethod + source.slice(afterEnd))
      .replaceAll("zcl_osd_lift_r2_demo", className);
    const {Transpiler, core} = modulesOf(process.cwd());
    const reg = new core.Registry();
    reg.addFile(new core.MemoryFile(`${className}.clas.abap`, classSource));
    reg.addFile(new core.MemoryFile("zosd_lift_r2.tabl.xml", readFileSync("src/lift/zosd_lift_r2.tabl.xml", "utf8")));
    const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
    const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
    const own = new Set(output.objects.map((o) => o.filename));
    const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
    const clas = output.objects.find((o) => o.object.type === "CLAS" && o.filename === `${className}.clas.mjs`);
    expect(clas, `${className} transpiled`).to.not.equal(undefined);
    const code = clas.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (m, file) => own.has(file) ? m : `import("${outputDir}${file}")`);
    const file = join(scratch, clas.filename);
    writeFileSync(file, code);
    const klass = (await import(pathToFileURL(file).href))[className];
    await seed();
    const keys = [["STAT", "OPEN"], ["STAT", "GONE"], ["STAT", "DONE"], ["STAT", "OPEN"]];
    const before = await counted(klass, "before", keys);
    const after = await counted(klass, "after", keys);
    expect(after.rows).to.deep.equal(before.rows);
    expect(before.calls).to.equal(keys.length);
    expect(after.calls).to.equal(1);
    return {model: lifted, before, after};
  }

  it("models the correlations, constant condition, full key fetch, and projection", () => {
    const result = modelR2(DEMO, "before");
    expect(result.recipe).to.equal("R2");
    expect(result.loop).to.deep.equal({table: "ct_rows", row: "<ls_row>"});
    expect(result.source.keys).to.deep.equal([
      {column: "kind", component: "kind"}, {column: "code", component: "code"},
    ]);
    expect(result.source.primary.map((key) => key.column)).to.deep.equal(["kind", "code", "seq"]);
    expect(result.source.fields.map((field) => field.column)).to.deep.equal(["kind", "code", "seq", "label"]);
    expect(result.source.conditions).to.deep.equal([{column: "active", text: "active = 'X'"}]);
    expect(result.result.assignments).to.deep.equal([{column: "label", component: "label"}]);
    expect(result.before.map((item) => item.text)).to.deep.equal(["CLEAR <ls_row>-result."]);
    expect(result.open).to.include("prefetch may read keys whose loop iteration skips the SELECT");
  });

  const refusals = [
    ["an unordered SELECT", (source) => source.replace(" ORDER BY PRIMARY KEY", ""), /^order: /],
    ["an order other than the primary key", (source) => source.replace("ORDER BY PRIMARY KEY", "ORDER BY label"), /^order: /],
    ["an OR condition", (source) => source.replace("AND code = <ls_row>-code", "OR code = <ls_row>-code"), /^conditions: /],
    ["a nonconstant condition", (source) => source.replace("active = 'X'", "active = lv_active"), /^conditions: /],
    ["a correlation on a non-key column", (source) => source.replace("kind = <ls_row>-kind", "active = <ls_row>-kind"), /^correlation: active is not a key field/],
    ["a SELECT with an aggregate", (source) => source.replace("SELECT label FROM", "SELECT MAX( label ) FROM"), /^shape: /],
    ["a SELECT SINGLE", (source) => source.replace("SELECT label FROM", "SELECT SINGLE label FROM"), /^shape: /],
    ["a row limit", (source) => source.replace("FROM zosd_lift_r2 INTO TABLE", "FROM zosd_lift_r2 UP TO 2 ROWS INTO TABLE"), /^shape: /],
    ["a join", (source) => source.replace("FROM zosd_lift_r2 INTO TABLE", "FROM zosd_lift_r2 INNER JOIN zosd_lift_r2 AS x ON x~kind = zosd_lift_r2~kind INTO TABLE"), /^shape: /],
    ["a second SELECT in the body", (source) => source.replace("MOVE sy-subrc TO <ls_row>-status.", "SELECT label FROM zosd_lift_r2 INTO TABLE lt_hits WHERE kind = <ls_row>-kind ORDER BY PRIMARY KEY.\n      MOVE sy-subrc TO <ls_row>-status."), /^shape: the loop body has 2 SELECT/],
    ["another database statement", (source) => source.replace("CLEAR <ls_row>-result.", "DELETE FROM zosd_lift_r2 WHERE kind = 'NONE'.\n      CLEAR <ls_row>-result."), /^no other database statement in the loop:/],
    ["a result-table write besides SELECT", (source) => source.replace("MOVE sy-subrc TO <ls_row>-status.", "CLEAR lt_hits.\n      MOVE sy-subrc TO <ls_row>-status."), /^result written only by SELECT:/],
    ["no read of the result after SELECT", (source) => source.replace(
      "      LOOP AT lt_hits INTO ls_hit.\n        IF <ls_row>-result IS INITIAL.\n          <ls_row>-result = ls_hit-label.\n        ELSE.\n          CONCATENATE <ls_row>-result ls_hit-label INTO <ls_row>-result SEPARATED BY ';'.\n        ENDIF.\n      ENDLOOP.",
      "      WRITE 'done'."), /^result read after SELECT:/],
    ["a result read after the outer loop", (source) => source.replace("    ENDLOOP.\n  ENDMETHOD.\n\n  METHOD after.", "    ENDLOOP.\n    IF lt_hits IS NOT INITIAL.\n    ENDIF.\n  ENDMETHOD.\n\n  METHOD after."), /^result read after loop:/],
    ["a loop key written before SELECT", (source) => source.replace("CLEAR <ls_row>-result.", "CLEAR <ls_row>-kind.\n      CLEAR <ls_row>-result."), /^key not written before the read:/],
    ["the loop table modified after SELECT", (source) => source.replace("MOVE sy-subrc TO <ls_row>-status.", "APPEND <ls_row> TO ct_rows.\n      MOVE sy-subrc TO <ls_row>-status."), /^key not written before the read:/],
    ["a loop key aliased before SELECT", (source) => source
      .replace("LOOP AT ct_rows ASSIGNING <ls_row>.", "FIELD-SYMBOLS <ls_alias> TYPE c LENGTH 4.\n    LOOP AT ct_rows ASSIGNING <ls_row>.")
      .replace("CLEAR <ls_row>-result.", "ASSIGN <ls_row>-kind TO <ls_alias>.\n      CLEAR <ls_row>-result."), /^key not written before the read:/],
    ["a mismatched correlation type", (source) => source.replace("kind TYPE c LENGTH 4", "kind TYPE c LENGTH 5"), /^key types:/],
    ["a name already used by the generated region", (source) => source.replace("LOOP AT ct_rows ASSIGNING <ls_row>.", "DATA lt_all TYPE i.\n    LOOP AT ct_rows ASSIGNING <ls_row>."), /^names: lt_all/],
    ["a generic loop table", (source) => source.replace("CHANGING ct_rows TYPE tt_rows", "CHANGING ct_rows TYPE ANY TABLE"), /^shape: ct_rows is not a resolved table/],
    ["a SELECT target other than INTO TABLE", (source) => source.replace("INTO TABLE lt_hits", "APPENDING TABLE lt_hits"), /^shape: /],
    ["a result table whose access order is not standard", (source) => source.replace("DATA lt_hits TYPE tt_hits.", "DATA lt_hits TYPE SORTED TABLE OF ty_hit WITH UNIQUE KEY label."), /^shape: lt_hits must be a standard table/],
    ["a result field with a different type", (source) => source.replace("label TYPE c LENGTH 40", "label TYPE c LENGTH 39"), /^shape: lt_hits-label/],
  ];

  const aliasSources = [
    ["READ TABLE ASSIGNING before the loop", () => ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    FIELD-SYMBOLS <ls_first> LIKE LINE OF ct_rows.\n    READ TABLE ct_rows ASSIGNING <ls_first> INDEX 2.")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      <ls_first>-kind = 'PRIO'.")],
    ["READ TABLE REFERENCE INTO before the loop", () => ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    DATA lr_first TYPE REF TO ty_row.\n    READ TABLE ct_rows REFERENCE INTO lr_first INDEX 2.")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      lr_first->kind = 'PRIO'.")],
    ["GET REFERENCE OF the loop table before the loop", () => ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    DATA lr_rows TYPE REF TO tt_rows.\n    GET REFERENCE OF ct_rows INTO lr_rows.")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      LOOP AT lr_rows->* ASSIGNING FIELD-SYMBOL(<ls_x>).\n        <ls_x>-kind = 'PRIO'.\n      ENDLOOP.")],
    ["a pre-loop LOOP ASSIGNING alias", () => ORIGINAL
      .replace("    LOOP AT ct_rows ASSIGNING <ls_row>.", "    FIELD-SYMBOLS <ls_first> LIKE LINE OF ct_rows.\n    LOOP AT ct_rows ASSIGNING <ls_first>.\n      EXIT.\n    ENDLOOP.\n    LOOP AT ct_rows ASSIGNING <ls_row>.")],
    ["a pre-loop LOOP REFERENCE INTO alias", () => ORIGINAL
      .replace("    LOOP AT ct_rows ASSIGNING <ls_row>.", "    DATA lr_first TYPE REF TO ty_row.\n    LOOP AT ct_rows REFERENCE INTO lr_first.\n      EXIT.\n    ENDLOOP.\n    LOOP AT ct_rows ASSIGNING <ls_row>.")],
    ["an alias used after SELECT", () => ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    FIELD-SYMBOLS <ls_first> LIKE LINE OF ct_rows.\n    READ TABLE ct_rows ASSIGNING <ls_first> INDEX 2.")
      .replace("      MOVE sy-dbcnt TO <ls_row>-db_count.", "      MOVE sy-dbcnt TO <ls_row>-db_count.\n      <ls_first>-kind = 'PRIO'.")],
  ];

  for (const [what, makeSource] of aliasSources) {
    it(`refuses ${what}`, () => {
      let caught;
      try { model(makeSource()); } catch (error) { caught = error; }
      expect(caught, what).to.be.instanceOf(Refusal);
      if (what.startsWith("a pre-loop LOOP")) expect(caught.obligation).to.equal("loop table alias");
    });
  }

  const aliasRegressionCases = [
    ["APPEND ASSIGNING a row before the loop", ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    FIELD-SYMBOLS <ls_new> LIKE LINE OF ct_rows.\n    APPEND INITIAL LINE TO ct_rows ASSIGNING <ls_new>.")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      <ls_new>-kind = 'PRIO'."), "loop table alias"],
    ["GET REFERENCE OF the loop row before SELECT", ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    DATA lr_row TYPE REF TO ty_row.")
      .replace("      SELECT label FROM zosd_lift_r2", "      GET REFERENCE OF <ls_row> INTO lr_row.\n      lr_row->kind = 'PRIO'.\n      SELECT label FROM zosd_lift_r2"), "loop row reference"],
    ["REF # of the loop table retained before the loop", ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    FIELD-SYMBOLS <ls_x> LIKE LINE OF ct_rows.\n    DATA lr_rows TYPE REF TO tt_rows.\n    lr_rows = REF #( ct_rows ).")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      LOOP AT lr_rows->* ASSIGNING <ls_x>.\n        <ls_x>-kind = 'PRIO'.\n      ENDLOOP."), "loop table alias"],
    ["dynamic ASSIGN of the loop table", ORIGINAL
      .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    FIELD-SYMBOLS <lt> TYPE tt_rows.\n    FIELD-SYMBOLS <ls_x> LIKE LINE OF ct_rows.\n    ASSIGN ('CT_ROWS') TO <lt>.")
      .replace("      CLEAR <ls_row>-result.", "      CLEAR <ls_row>-result.\n      LOOP AT <lt> ASSIGNING <ls_x>.\n        <ls_x>-kind = 'PRIO'.\n      ENDLOOP."), "dynamic ASSIGN"],
  ];

  for (const [what, source, obligation] of aliasRegressionCases) {
    it(`refuses ${what}`, () => {
      let caught;
      try { model(source); } catch (error) { caught = error; }
      expect(caught, what).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal(obligation);
    });
  }

  it("names a chained body statement before SELECT", () => {
    const source = ORIGINAL.replace("      CLEAR <ls_row>-result.", "      CLEAR: <ls_row>-result, ls_hit.");
    let caught;
    try { model(source); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Refusal);
    expect(caught.message).to.match(/chain/i);
  });

  it("names a chained body statement after SELECT", () => {
    const source = ORIGINAL.replace("      MOVE sy-subrc TO <ls_row>-status.\n      MOVE sy-dbcnt TO <ls_row>-db_count.",
      "      MOVE: sy-subrc TO <ls_row>-status, sy-dbcnt TO <ls_row>-db_count.");
    let caught;
    try { model(source); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Refusal);
    expect(caught.message).to.match(/chain/i);
  });

  it("refuses a method call in a class-attribute loop table body", () => {
    const source = ORIGINAL
      .replace("    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.", "    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.\n    CLASS-METHODS run.\n    CLASS-METHODS bump.\n    CLASS-DATA gt_rows TYPE tt_rows.")
      .replace("CLASS zcl_osd_lift_r2_demo IMPLEMENTATION.\n", "CLASS zcl_osd_lift_r2_demo IMPLEMENTATION.\n  METHOD bump.\n    FIELD-SYMBOLS <ls_x> LIKE LINE OF gt_rows.\n    LOOP AT gt_rows ASSIGNING <ls_x>.\n      <ls_x>-kind = 'PRIO'.\n    ENDLOOP.\n  ENDMETHOD.\n  METHOD run.\n    DATA lt_hits TYPE tt_hits.\n    DATA ls_hit TYPE ty_hit.\n    FIELD-SYMBOLS <ls_row> LIKE LINE OF gt_rows.\n    LOOP AT gt_rows ASSIGNING <ls_row>.\n      bump( ).\n      SELECT label FROM zosd_lift_r2 INTO TABLE lt_hits\n        WHERE kind = <ls_row>-kind AND code = <ls_row>-code AND active = 'X'\n        ORDER BY PRIMARY KEY.\n      LOOP AT lt_hits INTO ls_hit.\n        <ls_row>-result = ls_hit-label.\n      ENDLOOP.\n    ENDLOOP.\n  ENDMETHOD.\n");
    let caught;
    try { modelR2FromSource(basename(DEMO), source, "run", DEFAULT_DDIC); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Refusal);
  });

  it("refuses a method call with a by-reference CHANGING driver table", () => {
    const source = ORIGINAL
      .replace("    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.", "    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.\n    CLASS-METHODS run CHANGING ct_rows TYPE tt_rows.\n    CLASS-METHODS bump.");
    const at = source.lastIndexOf("ENDCLASS.");
    const extra = `  METHOD bump.\n  ENDMETHOD.\n\n  METHOD run.\n    DATA lt_hits TYPE tt_hits.\n    DATA ls_hit TYPE ty_hit.\n    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    LOOP AT ct_rows ASSIGNING <ls_row>.\n      bump( ).\n      SELECT label FROM zosd_lift_r2 INTO TABLE lt_hits\n        WHERE kind = <ls_row>-kind AND code = <ls_row>-code AND active = 'X'\n        ORDER BY PRIMARY KEY.\n      LOOP AT lt_hits INTO ls_hit.\n        <ls_row>-result = ls_hit-label.\n      ENDLOOP.\n    ENDLOOP.\n  ENDMETHOD.\n\n`;
    const withRun = source.slice(0, at) + extra + source.slice(at);
    let caught;
    try { modelR2FromSource(basename(DEMO), withRun, "run", DEFAULT_DDIC); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Refusal);
    expect(caught.obligation).to.equal("loop table method call");
  });

  it("keeps standalone comments between body statements", async () => {
    const source = ORIGINAL
      .replace("      CLEAR <ls_row>-result.\n      SELECT", "      CLEAR <ls_row>-result.\n      \" before the read\n* column-one comment\n      SELECT")
      .replace("      MOVE sy-subrc TO <ls_row>-status.\n      MOVE sy-dbcnt", "      MOVE sy-subrc TO <ls_row>-status.\n      \" after the read\n      MOVE sy-dbcnt");
    const rendered = await render(model(source), TEMPLATE);
    expect(rendered.text).to.contain('" before the read');
    expect(rendered.text).to.contain('"* column-one comment');
    expect(rendered.text).to.contain('" after the read');
  });

  // Round 3 left four corners (P3). Each accepted form below is run through
  // the differential; each refusal names its obligation.
  const refuse = (source, method = "before") => {
    try { modelR2FromSource(basename(DEMO), source, method, DEFAULT_DDIC); } catch (error) { return error; }
    return undefined;
  };
  const declare = (source, lines) => source.replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.",
    `    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n${lines}`);
  const afterSelect = (source, lines) => source.replace("      MOVE sy-dbcnt TO <ls_row>-db_count.\n",
    `      MOVE sy-dbcnt TO <ls_row>-db_count.\n${lines}`);
  const beforeSelect = (source, lines) => source.replace("      CLEAR <ls_row>-result.\n", `      CLEAR <ls_row>-result.\n${lines}`);
  const attribute = (source, lines) => source.replace("    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.\n",
    `    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.\n${lines}`);
  // BEFORE over a local copy of ct_rows, so that T is a local of the method
  const localTable = (source) => source
    .replace("    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    LOOP AT ct_rows ASSIGNING <ls_row>.",
      "    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.\n    DATA lt_rows TYPE tt_rows.\n    lt_rows = ct_rows.\n    LOOP AT lt_rows ASSIGNING <ls_row>.")
    .replace("    ENDLOOP.\n  ENDMETHOD.\n\n  METHOD after.", "    ENDLOOP.\n    ct_rows = lt_rows.\n  ENDMETHOD.\n\n  METHOD after.");

  describe("field symbols that cannot point into the loop table", () => {
    it("accepts LOOP AT the result table ASSIGNING <h> after the SELECT, by the differential", async () => {
      const source = afterSelect(ORIGINAL, "      LOOP AT lt_hits ASSIGNING FIELD-SYMBOL(<h>).\n        TRANSLATE <h>-label TO UPPER CASE.\n      ENDLOOP.\n");
      const {before} = await differential(source);
      expect(before.rows.map((row) => row.result.trimEnd())).to.deep.equal(["FIRST;SECOND;SECOND", "", "DONE", "FIRST;SECOND;SECOND"]);
    });

    it("accepts the same LOOP over an unrelated local table before the SELECT, by the differential", async () => {
      const source = beforeSelect(declare(ORIGINAL, "    DATA lt_seen TYPE tt_hits.\n    DATA ls_seen TYPE ty_hit."),
        "      LOOP AT lt_seen ASSIGNING FIELD-SYMBOL(<s>).\n        <s>-label = <ls_row>-code.\n      ENDLOOP.\n"
        + "      ls_seen-label = <ls_row>-kind.\n      APPEND ls_seen TO lt_seen.\n");
      const {before} = await differential(source);
      expect(before.rows.map((row) => row.tabix_seen)).to.deep.equal([1, 2, 3, 4]);
    });

    it("accepts ASSIGN of a local and a write through it, by the differential", async () => {
      const source = afterSelect(declare(ORIGINAL, "    DATA ls_local TYPE ty_hit.\n    FIELD-SYMBOLS <x> TYPE ty_hit."),
        "      ASSIGN ls_local TO <x>.\n      <x>-label = <ls_row>-code.\n      CONCATENATE <ls_row>-result <x>-label INTO <ls_row>-result SEPARATED BY '/'.\n");
      const {before} = await differential(source);
      expect(before.rows[1].result.trimEnd()).to.equal("/GONE");
    });

    const unsafe = [
      ["ASSIGN of <R> after the SELECT", afterSelect(declare(ORIGINAL, "    FIELD-SYMBOLS <x> TYPE ty_row."),
        "      ASSIGN <ls_row> TO <x>.\n      <x>-result = 'A'.\n"), /names <ls_row>/],
      ["ASSIGN of a component of <R>", afterSelect(declare(ORIGINAL, "    FIELD-SYMBOLS <x> TYPE any."),
        "      ASSIGN <ls_row>-result TO <x>.\n      <x> = 'A'.\n"), /names <ls_row>/],
      ["ASSIGN COMPONENT of <R>", afterSelect(declare(ORIGINAL, "    FIELD-SYMBOLS <x> TYPE any."),
        "      ASSIGN COMPONENT 'RESULT' OF STRUCTURE <ls_row> TO <x>.\n      <x> = 'A'.\n"), /names <ls_row>/],
      ["ASSIGN of a dereference before the loop", afterSelect(declare(ORIGINAL, "    DATA lr_hit TYPE REF TO ty_hit.\n    FIELD-SYMBOLS <x> TYPE ty_hit.\n    ASSIGN lr_hit->* TO <x>."),
        "      <x>-label = 'A'.\n"), /dereference/],
      ["a dynamic ASSIGN COMPONENT of a local", afterSelect(declare(ORIGINAL, "    DATA lv_name TYPE string.\n    FIELD-SYMBOLS <x> TYPE any."),
        "      ASSIGN COMPONENT lv_name OF STRUCTURE ls_hit TO <x>.\n      ASSIGN (lv_name) TO <x>.\n      <x> = 'A'.\n"), /dynamic ASSIGN/],
      ["a field symbol with no visible ASSIGN", afterSelect(declare(ORIGINAL, "    FIELD-SYMBOLS <x> TYPE ty_row."),
        "      <x>-result = 'A'.\n"), /no ASSIGN, ASSIGNING or FOR/],
      ["a field symbol assigned from an unsafe one", afterSelect(declare(ORIGINAL, "    DATA lr_row TYPE REF TO ty_row.\n    FIELD-SYMBOLS <y> TYPE ty_row.\n    FIELD-SYMBOLS <z> TYPE ty_row.\n    ASSIGN lr_row->* TO <y>."),
        "      ASSIGN <y> TO <z>.\n      <z>-kind = 'PRIO'.\n"), /names <y>/],
      ["ASSIGN of an attribute when T is a parameter", afterSelect(attribute(declare(ORIGINAL, "    FIELD-SYMBOLS <x> TYPE ty_row."), "    CLASS-DATA gs_last TYPE ty_row.\n"),
        "      ASSIGN gs_last TO <x>.\n      <x>-kind = 'PRIO'.\n"), /gs_last, which is not a local/],
    ];
    for (const [what, source, reason] of unsafe) {
      it(`refuses ${what}`, () => {
        const caught = refuse(source);
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("field-symbol write");
        expect(caught.message).to.match(reason);
      });
    }

    it("accepts ASSIGN of an attribute when T is a local", () => {
      const source = afterSelect(attribute(declare(localTable(ORIGINAL), "    FIELD-SYMBOLS <x> TYPE ty_row."), "    CLASS-DATA gs_last TYPE ty_row.\n"),
        "      ASSIGN gs_last TO <x>.\n      <x>-kind = 'PRIO'.\n");
      expect(model(source).loop.table).to.equal("lt_rows");
    });

    it("refuses a write through an undeclared field symbol by the syntax check", () => {
      const caught = refuse(afterSelect(ORIGINAL, "      <undeclared>-kind = 'PRIO'.\n"));
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("shape/syntax");
    });
  });

  describe("calls that may reach a nonlocal loop table", () => {
    const withRun = (signature, extra = "") => {
      const source = attribute(ORIGINAL, `    CLASS-METHODS run ${signature}.\n    CLASS-METHODS bump.\n`);
      const at = source.lastIndexOf("ENDCLASS.");
      const body = `  METHOD bump.\n  ENDMETHOD.\n\n  METHOD run.\n    DATA lt_hits TYPE tt_hits.\n    DATA ls_hit TYPE ty_hit.\n    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_rows.\n    LOOP AT et_rows ASSIGNING <ls_row>.\n${extra}      SELECT label FROM zosd_lift_r2 INTO TABLE lt_hits\n        WHERE kind = <ls_row>-kind AND code = <ls_row>-code AND active = 'X'\n        ORDER BY PRIMARY KEY.\n      LOOP AT lt_hits INTO ls_hit.\n        <ls_row>-result = ls_hit-label.\n      ENDLOOP.\n    ENDLOOP.\n  ENDMETHOD.\n\n`;
      return source.slice(0, at) + body + source.slice(at);
    };

    it("refuses a method call with a by-reference EXPORTING driver table", () => {
      const caught = refuse(withRun("EXPORTING et_rows TYPE tt_rows", "      bump( ).\n"), "run");
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("loop table method call");
    });

    it("refuses a method call when the CHANGING parameter is written with the escape !", () => {
      // the token scan of the signature reads "!ct_rows" as another name;
      // abaplint's parameter metadata still says CHANGING by reference
      const source = beforeSelect(attribute(ORIGINAL, "    CLASS-METHODS bump.\n")
        .replace("CLASS-METHODS before CHANGING ct_rows TYPE tt_rows.", "CLASS-METHODS before CHANGING !ct_rows TYPE tt_rows.")
        .replace("  METHOD after.\n", "  METHOD bump.\n  ENDMETHOD.\n\n  METHOD after.\n"), "      bump( ).\n");
      const caught = refuse(source);
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("loop table method call");
    });

    it("accepts a method call with a VALUE( ) EXPORTING driver table", () => {
      const lifted = modelR2FromSource(basename(DEMO), withRun("EXPORTING VALUE(et_rows) TYPE tt_rows", "      bump( ).\n"), "run", DEFAULT_DDIC);
      expect(lifted.loop.table).to.equal("et_rows");
      expect(lifted.open).to.not.include("no data reference into et_rows set outside this method");
    });

    const nonlocal = [
      ["PERFORM with T a by-reference parameter", beforeSelect(ORIGINAL, "      PERFORM bump IN PROGRAM zosd_lift_forms IF FOUND.\n")],
      ["CALL FUNCTION with T a by-reference parameter", afterSelect(ORIGINAL, "      CALL FUNCTION 'Z_LIFT_BUMP'.\n")],
      ["NEW with T a by-reference parameter", afterSelect(declare(ORIGINAL, "    DATA lo_any TYPE REF TO zcl_osd_lift_r2_demo."), "      lo_any = NEW zcl_osd_lift_r2_demo( ).\n")],
      ["COMMIT WORK with T a by-reference parameter", afterSelect(ORIGINAL, "      COMMIT WORK.\n")],
    ];
    for (const [what, source] of nonlocal) {
      it(`refuses ${what}`, () => {
        const caught = refuse(source);
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("loop table call");
      });
    }

    it("refuses PERFORM with T a class attribute", () => {
      const source = withRun("", "      PERFORM bump IN PROGRAM zosd_lift_forms IF FOUND.\n")
        .replace("    CLASS-METHODS run .\n", "    CLASS-METHODS run.\n    CLASS-DATA et_rows TYPE tt_rows.\n");
      const caught = refuse(source, "run");
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("loop table call");
    });

    const local = [
      ["PERFORM passing the local T", beforeSelect(localTable(ORIGINAL), "      PERFORM bump IN PROGRAM zosd_lift_forms IF FOUND CHANGING lt_rows.\n"), /passes lt_rows/],
      ["CALL FUNCTION passing the local T after the SELECT", afterSelect(localTable(ORIGINAL), "      CALL FUNCTION 'Z_LIFT_BUMP' TABLES ct_rows = lt_rows.\n"), /passes lt_rows/],
      ["PERFORM USING the row before the SELECT", beforeSelect(localTable(ORIGINAL), "      PERFORM bump IN PROGRAM zosd_lift_forms IF FOUND USING <ls_row>.\n"), /passes <ls_row>/],
      ["CALL FUNCTION passing the row before the SELECT", beforeSelect(localTable(ORIGINAL), "      CALL FUNCTION 'Z_LIFT_BUMP' EXPORTING is_row = <ls_row>.\n"), /passes <ls_row>/],
    ];
    for (const [what, source, reason] of local) {
      it(`refuses ${what}`, () => {
        const caught = refuse(source);
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("loop table call");
        expect(caught.message).to.match(reason);
      });
    }

    it("refuses CALL METHOD passing the row before the SELECT like a functional call", () => {
      const source = beforeSelect(localTable(attribute(ORIGINAL, "    CLASS-METHODS poke IMPORTING is_row TYPE ty_row.\n"))
        .replace("  METHOD after.\n", "  METHOD poke.\n  ENDMETHOD.\n\n  METHOD after.\n"), "      CALL METHOD poke EXPORTING is_row = <ls_row>.\n");
      const caught = refuse(source);
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("key not written before the read");
      expect(caught.message).to.match(/passes <ls_row> to a call/);
    });

    it("accepts PERFORM and CALL FUNCTION that cannot reach a local T", () => {
      const source = afterSelect(beforeSelect(localTable(ORIGINAL), "      PERFORM bump IN PROGRAM zosd_lift_forms IF FOUND.\n"),
        "      CALL FUNCTION 'Z_LIFT_BUMP' EXPORTING is_row = <ls_row>.\n");
      const lifted = model(source);
      expect(lifted.loop.table).to.equal("lt_rows");
      expect(lifted.open).to.not.include("no data reference into lt_rows set outside this method");
    });

    it("runs a local T through the differential", async () => {
      await differential(localTable(ORIGINAL));
    });
  });

  describe("allow-lists: statement kinds that run no code, and kinds whose writes abaplint reports", () => {
    const localDecl = (source) => declare(localTable(source), "    DATA lt_other TYPE tt_rows.\n    DATA lv_text TYPE string.");
    const unseen = [
      ["CALL DIALOG passing the row before the SELECT (local T)", beforeSelect(localTable(ORIGINAL), "      CALL DIALOG 'Z_LIFT_BUMP' EXPORTING is_row FROM <ls_row>.\n"), ""],
      ["CALL TRANSFORMATION with T a by-reference parameter", afterSelect(ORIGINAL, "      CALL TRANSFORMATION zlift_x SOURCE x = ls_hit RESULT x = ls_hit.\n"), "nonlocal"],
      ["MODIFY ENTITIES with T a by-reference parameter", afterSelect(ORIGINAL, "      MODIFY ENTITIES OF zi_lift ENTITY lift UPDATE FIELDS ( kind ) WITH VALUE #( ( kind = 'X' ) ).\n"), "nonlocal"],
    ];
    for (const [what, source, kind] of unseen) {
      it(`refuses ${what} as a call`, () => {
        const caught = refuse(source);
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("loop table call");
        if (kind) expect(caught.message).to.match(/nonlocal loop table ct_rows/);
      });
    }

    it("refuses a statement abaplint cannot parse (CALL DIALOG ... IMPORTING ... TO)", () => {
      const caught = refuse(beforeSelect(localTable(ORIGINAL), "      CALL DIALOG 'Z_LIFT_BUMP' IMPORTING is_row TO <ls_row>.\n"));
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("shape/parse");
    });

    it("refuses OVERLAY of a key before the SELECT, whose write abaplint does not report", () => {
      const caught = refuse(beforeSelect(localDecl(ORIGINAL), "      OVERLAY <ls_row>-kind WITH 'ABCD'.\n"));
      expect(caught).to.be.instanceOf(Refusal);
      expect(caught.obligation).to.equal("key not written before the read");
      expect(caught.message).to.match(/does not report/);
    });

    // every write-capable kind of KEY_WRITE_KINDS: abaplint reports its write
    // of a key, so the refusal names the write
    const reported = ["MOVE 'PRIO' TO <ls_row>-kind.", "MOVE-CORRESPONDING lt_other TO <ls_row>.", "CLEAR <ls_row>-kind.",
      "CONCATENATE 'A' 'B' INTO <ls_row>-kind.", "CONDENSE <ls_row>-kind.", "SPLIT lv_text AT ';' INTO <ls_row>-kind <ls_row>-code.",
      "TRANSLATE <ls_row>-kind TO UPPER CASE.", "SHIFT <ls_row>-kind LEFT.", "REPLACE 'A' WITH 'B' INTO <ls_row>-kind.",
      "READ TABLE lt_other INTO <ls_row> INDEX 1.", "LOOP AT lt_other INTO <ls_row>.\n      ENDLOOP.",
      "APPEND INITIAL LINE TO lt_other ASSIGNING <ls_row>.", "INSERT INITIAL LINE INTO lt_other ASSIGNING <ls_row> INDEX 1."];
    for (const statement of reported) {
      it(`refuses ${statement.split("\n")[0]} before the SELECT as a reported write`, () => {
        const caught = refuse(beforeSelect(localDecl(ORIGINAL), `      ${statement}\n`));
        expect(caught, statement).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("key not written before the read");
        expect(caught.message).to.match(/ writes <ls_row>/);
      });
    }
  });

  describe("a local loop table that escapes before the loop", () => {
    // the critic's reproducer: stash( ) keeps a reference to the local T,
    // bump( ) names neither T nor <R> and changes row 2's key through it
    const helpers = (source) => attribute(source, "    CLASS-METHODS stash CHANGING rows TYPE tt_rows.\n    CLASS-METHODS bump.\n    CLASS-DATA gr_rows TYPE REF TO tt_rows.\n    CLASS-DATA gt_copy TYPE tt_rows.\n")
      .replace("CLASS zcl_osd_lift_r2_demo IMPLEMENTATION.\n", "CLASS zcl_osd_lift_r2_demo IMPLEMENTATION.\n  METHOD stash.\n    GET REFERENCE OF rows INTO gr_rows.\n  ENDMETHOD.\n\n"
        + "  METHOD bump.\n    FIELD-SYMBOLS <x> TYPE ty_row.\n    IF gr_rows IS BOUND.\n      READ TABLE gr_rows->* ASSIGNING <x> INDEX 2.\n      IF sy-subrc = 0.\n        <x>-code = 'OPEN'.\n      ENDIF.\n    ENDIF.\n  ENDMETHOD.\n\n");
    const preLoop = (source, lines) => source.replace("    LOOP AT lt_rows ASSIGNING <ls_row>.", `${lines}    LOOP AT lt_rows ASSIGNING <ls_row>.`);

    const escapes = [
      ["a method call", "    stash( CHANGING rows = lt_rows ).\n"],
      ["CALL FUNCTION", "    CALL FUNCTION 'Z_LIFT_STASH' TABLES ct_rows = lt_rows.\n"],
    ];
    for (const [what, line] of escapes) {
      it(`refuses an unseen call in the body once T escaped through ${what} before the loop`, () => {
        const caught = refuse(beforeSelect(preLoop(helpers(localTable(ORIGINAL)), line), "      bump( ).\n"));
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal("loop table method call");
        expect(caught.message).to.match(/lt_rows, which escapes in/);
      });
    }

    it("accepts the same call when only value copies of T leave the method, by the differential", async () => {
      const source = beforeSelect(preLoop(declare(helpers(localTable(ORIGINAL)), "    DATA lt_copy TYPE tt_rows."),
        "    lt_copy = lt_rows.\n    gt_copy = lt_rows.\n    stash( CHANGING rows = lt_copy ).\n"), "      bump( ).\n");
      const {before} = await differential(source);
      expect(before.rows.map((row) => row.code.trimEnd())).to.deep.equal(["OPEN", "GONE", "DONE", "OPEN"]);
    });
  });

  describe("aliases set outside the method", () => {
    it("lists the outside data reference as open when T is nonlocal", () => {
      expect(model().open).to.include.members(["no data reference into ct_rows set outside this method",
        "no other by-reference parameter or attribute aliases ct_rows or one of its rows"]);
    });

    const withReference = (lines) => afterSelect(attribute(ORIGINAL, "    CLASS-DATA gr_rows TYPE REF TO tt_rows.\n"), lines);
    const writes = [
      ["MODIFY through it", withReference("      MODIFY gr_rows->* FROM <ls_row> INDEX 2.\n"), "dereference write"],
      ["a component write through it", afterSelect(attribute(ORIGINAL, "    CLASS-DATA gr_row TYPE REF TO ty_row.\n"), "      gr_row->kind = 'PRIO'.\n"), "dereference write"],
      ["LOOP ASSIGNING over it", withReference("      LOOP AT gr_rows->* ASSIGNING FIELD-SYMBOL(<x>).\n        <x>-kind = 'PRIO'.\n      ENDLOOP.\n"), "dereference write"],
      ["ASSIGN of it", withReference("      ASSIGN gr_rows->* TO FIELD-SYMBOL(<x>).\n      CLEAR <x>.\n"), "dereference write"],
      ["a field symbol assigned from it before the loop", withReference("      <x>-kind = 'PRIO'.\n")
        .replace("    LOOP AT ct_rows ASSIGNING <ls_row>.", "    FIELD-SYMBOLS <x> TYPE ty_row.\n    ASSIGN gr_rows->*[ 2 ] TO <x>.\n    LOOP AT ct_rows ASSIGNING <ls_row>."), "field-symbol write"],
    ];
    for (const [what, source, obligation] of writes) {
      it(`refuses ${what} in the body`, () => {
        const caught = refuse(source);
        expect(caught, what).to.be.instanceOf(Refusal);
        expect(caught.obligation).to.equal(obligation);
      });
    }
  });

  for (const [what, mutate, reason] of refusals) {
    it(`refuses ${what} by its obligation`, () => {
      let caught;
      try { model(mutate(ORIGINAL)); } catch (error) { caught = error; }
      expect(caught, what).to.be.instanceOf(Refusal);
      expect(caught.message).to.match(reason);
      expect(caught.obligation.split("/")[0]).to.equal(reason.source.match(/^\^([^:]+)/)[1]);
    });
  }

  it("find counts loop SELECT INTO TABLE candidates", () => {
    expect(find("src/lift").loops_with_select_into_table).to.equal(1);
  });

  it("survey runs R2 on SELECT INTO TABLE candidates", () => {
    const result = survey("src/lift");
    expect(result.cases.find((item) => item.recipe === "R2" && item.where.includes("zcl_osd_lift_r2_demo")))
      .to.deep.include({accepted: true});
  });

  it("renders the generated region exactly from the template and BEFORE", async () => {
    const rendered = await render(model(), TEMPLATE);
    expect(region(readFileSync(DEMO, "utf8"), "before")).to.equal(rendered.text);
    expect(rendered.text).to.contain("IF ct_rows IS NOT INITIAL.");
    expect(rendered.text).to.contain("sy-dbcnt = lines( lt_hits ).");
    expect(rendered.text).to.contain("SELECT kind code seq label FROM zosd_lift_r2");
    const restoreTabix = rendered.text.indexOf("sy-tabix = lv_lift_saved_tabix.");
    const readTabix = rendered.text.indexOf("MOVE sy-tabix TO <ls_row>-tabix_seen.");
    expect(restoreTabix).to.be.greaterThan(-1);
    expect(readTabix).to.be.greaterThan(restoreTabix);
  });

  it("renders SORT by source.sort when correlation order differs from the primary key", async () => {
    const source = ORIGINAL.replace("WHERE kind = <ls_row>-kind AND code = <ls_row>-code",
      "WHERE code = <ls_row>-code AND kind = <ls_row>-kind");
    const alternate = model(source);
    const rendered = await render(alternate, TEMPLATE);
    const line = rendered.text.split("\n").find((item) => item.trimStart().startsWith("SORT lt_all BY"));
    const sort = alternate.source.sort.map((key) => key.column);
    const primary = alternate.source.primary.map((key) => key.column);
    expect(alternate.source.keys.map((key) => key.column)).to.deep.equal(["code", "kind"]);
    expect(sort).to.deep.equal(["code", "kind", "seq"]);
    expect(sort).not.to.deep.equal(primary);
    expect(line).to.equal(`SORT lt_all BY ${sort.join(" ")}.`);
  });

  it("BEFORE makes one SELECT per row; AFTER makes one guarded FAE call", async () => {
    await seed();
    const demo = abap.Classes.ZCL_OSD_LIFT_R2_DEMO;
    const keys = [["STAT", "OPEN"], ["STAT", "GONE"], ["STAT", "DONE"], ["STAT", "OPEN"]];
    const before = await counted(demo, "before", keys);
    const after = await counted(demo, "after", keys);
    expect(after.rows).to.deep.equal(before.rows);
    expect(before.calls).to.equal(keys.length);
    expect(after.calls).to.equal(1);
    expect(after.rows.map((row) => row.result.trimEnd())).to.deep.equal(["First;Second;Second", "", "Done", "First;Second;Second"]);
    expect(after.rows.map((row) => [row.status, row.db_count])).to.deep.equal([[0, 3], [4, 0], [0, 1], [0, 3]]);
    expect(after.rows.map((row) => row.tabix_seen)).to.deep.equal([1, 2, 3, 4]);

    const empty = await counted(demo, "after", []);
    expect(empty.calls).to.equal(0);
  });
});
