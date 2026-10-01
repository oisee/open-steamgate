// R2's source shape, refusal obligations, generated region, and one-call cost.
// The ABAP Unit class in src/lift also compares the row results and system
// fields on an ABAP runtime.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {basename} from "node:path";
import {DEFAULT_DDIC, find, modelR2, modelR2FromSource, survey} from "../tools/lift.mjs";
import {Refusal} from "../tools/dsl-ddic.mjs";
import {region, render} from "../tools/dsl-regions.mjs";

const DEMO = "src/lift/zcl_osd_lift_r2_demo.clas.abap";
const TEMPLATE = "recipes/r2-select-table-per-row/template.tpl";
const ORIGINAL = readFileSync(DEMO, "utf8");

describe("verified lift R2: SELECT table per row", function () {
  this.timeout(60000);
  let abap;
  const model = (source = ORIGINAL) => modelR2FromSource(basename(DEMO), source, "before", DEFAULT_DDIC);

  before(async () => {
    await import("./start.mjs");
    abap = globalThis.abap;
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_ajson.clas.mjs");
    await import("../output/zcl_osd_lift_r2_demo.clas.mjs");
  });

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
  });

  it("BEFORE makes one SELECT per row; AFTER makes one guarded FAE call", async () => {
    const db = abap.context.databaseConnections.DEFAULT;
    await db.execute("DELETE FROM zosd_lift_r2 WHERE kind IN ('STAT', 'PRIO')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '001', 'X', 'First')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '002', 'X', 'Second')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '003', '', 'Hidden')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'OPEN', '004', 'X', 'Second')");
    await db.execute("INSERT INTO zosd_lift_r2 (kind, code, seq, active, label) VALUES ('STAT', 'DONE', '001', 'X', 'Done')");

    const makeRows = (keys) => {
      const line = new abap.types.Structure({
        kind: new abap.types.Character(4), code: new abap.types.Character(10),
        result: new abap.types.Character(100), status: new abap.types.Integer(), db_count: new abap.types.Integer(),
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
    const counted = async (method, keys) => {
      const original = db.select.bind(db);
      let calls = 0;
      db.select = async (options) => { calls++; return original(options); };
      const rows = makeRows(keys);
      try {
        await abap.Classes.ZCL_OSD_LIFT_R2_DEMO[method]({ct_rows: rows});
      } finally {
        db.select = original;
      }
      return {calls, rows: rows.array().map((r) => ({
        kind: r.get().kind.get(), code: r.get().code.get(), result: r.get().result.get(),
        status: r.get().status.get(), db_count: r.get().db_count.get(),
      }))};
    };
    const keys = [["STAT", "OPEN"], ["STAT", "GONE"], ["STAT", "DONE"], ["STAT", "OPEN"]];
    const before = await counted("before", keys);
    const after = await counted("after", keys);
    expect(after.rows).to.deep.equal(before.rows);
    expect(before.calls).to.equal(keys.length);
    expect(after.calls).to.equal(1);
    expect(after.rows.map((row) => row.result.trimEnd())).to.deep.equal(["First;Second;Second", "", "Done", "First;Second;Second"]);
    expect(after.rows.map((row) => [row.status, row.db_count])).to.deep.equal([[0, 3], [4, 0], [0, 1], [0, 3]]);

    const empty = await counted("after", []);
    expect(empty.calls).to.equal(0);
  });
});
