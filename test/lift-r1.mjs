// Recipe R1 end to end (recipes/r1-lookup-enrich/): the model comes out of
// BEFORE by tools/lift.mjs, the ABAP template engine renders AFTER from it,
// the rendered text is the generated region of ZCL_OSD_LIFT_R1_DEMO, and the
// two methods are run on the same rows while the database calls are counted.
// Equality of the rows is ABAP Unit's job (the class's own test class, which
// runs on a system as well); what only the host can see is the cost.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {modelR1, modelR1FromSource} from "../tools/lift.mjs";

const DEMO = "src/lift/zcl_osd_lift_r1_demo.clas.abap";
const TEMPLATE = "recipes/r1-lookup-enrich/template.tpl";

function region(source) {
  const lines = source.split("\n");
  const begin = lines.findIndex((l) => l.trim() === '" lift:R1 begin');
  const end = lines.findIndex((l) => l.trim() === '" lift:R1 end');
  const indent = /^ */.exec(lines[begin])[0].length;
  return lines.slice(begin + 1, end).map((l) => l.slice(indent)).join("\n") + "\n";
}

describe("verified lift R1: lookup-enrich", function () {
  this.timeout(60000);
  let abap;
  const box = (value) => new abap.types.String().set(value);

  before(async () => {
    await import("./start.mjs");
    abap = globalThis.abap;
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_ajson.clas.mjs");
    await import("../output/zcl_osd_lift_r1_demo.clas.mjs");
  });

  async function render(model) {
    const data = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(model))});
    const result = await abap.Classes.ZCL_OSD_TPL.render({iv_template: box(readFileSync(TEMPLATE, "utf8")), ii_data: data});
    return {
      text: (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get(),
      trace: result.get().trace.array().map((t) => ({
        line: t.get().line.get(), template_line: t.get().template_line.get(), path: t.get().path.get()})),
    };
  }

  it("the model is read out of BEFORE, the key checked against the DDIC", () => {
    const model = modelR1(DEMO, "before", ["src"]);
    expect(model.source).to.deep.equal({
      table: "zosd_lift_txt",
      keys: [{column: "kind", component: "kind"}, {column: "code", component: "code"}],
    });
    expect(model.fields).to.deep.equal([{column: "text", component: "text"}]);
  });

  // One method per boundary of the shape; each must be refused by the named
  // obligation. The table of the fixtures is the demo's (kind, code key).
  const fixture = (body, declarations = "") => `CLASS zcl_fx DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row, kind TYPE c LENGTH 4, code TYPE c LENGTH 10, text TYPE c LENGTH 40, END OF ty_row.
    TYPES tt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS m CHANGING ct_rows TYPE tt_rows.
ENDCLASS.
CLASS zcl_fx IMPLEMENTATION.
  METHOD m.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
${declarations}    LOOP AT ct_rows ASSIGNING <ls_row>.
${body}
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.`;
  const SELECT = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE";
  const refusals = [
    ["a partial key", `${SELECT} kind = <ls_row>-kind.`, "", /^full key: WHERE names kind/],
    ["an extra condition", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code AND text = <ls_row>-text.`, "", /^full key: /],
    ["OR", `${SELECT} kind = <ls_row>-kind OR code = <ls_row>-code.`, "", /^full key: /],
    ["a literal", `${SELECT} kind = 'STAT' AND code = <ls_row>-code.`, "", /^full key: /],
    ["INTO CORRESPONDING", "      SELECT SINGLE text FROM zosd_lift_txt INTO CORRESPONDING FIELDS OF <ls_row> WHERE kind = <ls_row>-kind AND code = <ls_row>-code.", "", /^shape: /],
    ["a second statement", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.\n      CLEAR <ls_row>-kind.`, "", /^shape: /],
    ["a nested loop", `      LOOP AT ct_rows TRANSPORTING NO FIELDS WHERE kind = 'X'.\n      ENDLOOP.`, "", /^shape: /],
    ["lt_lookup taken", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, "    DATA lt_lookup TYPE i.\n", /^names: lt_lookup/],
    ["<ls_lookup> taken", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, "    FIELD-SYMBOLS <ls_lookup> TYPE any.\n", /^names: <ls_lookup>/],
    ["the shape rewritten already", null, null, /^names: lt_lookup/],
  ];
  for (const [what, body, declarations, reason] of refusals) {
    it(`R1 refuses ${what}, naming the obligation`, () => {
      const run = body === null
        ? () => modelR1(DEMO, "after", ["src"])
        : () => modelR1FromSource("zcl_fx.clas.abap", fixture(body, declarations), "m", ["src"]);
      expect(run).to.throw(reason);
    });
  }

  // The key is read off the DDIC only where its layout is unambiguous.
  const table = (clidep, fields) => `<abapGit><asx:abap><asx:values><DD02V><TABNAME>ZOSD_LIFT_TXT</TABNAME>
<TABCLASS>TRANSP</TABCLASS>${clidep ? "<CLIDEP>X</CLIDEP>" : ""}</DD02V><DD03P_TABLE>${fields.map((f) => `<DD03P>${f}</DD03P>`).join("")}
</DD03P_TABLE></asx:values></asx:abap></abapGit>`;
  const layouts = [
    ["a client-dependent table whose first key field is not the client", table(true, [
      "<FIELDNAME>KIND</FIELDNAME><KEYFLAG>X</KEYFLAG><DATATYPE>CHAR</DATATYPE>",
      "<FIELDNAME>MANDT</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>MANDT</ROLLNAME>",
      "<FIELDNAME>CODE</FIELDNAME><KEYFLAG>X</KEYFLAG><DATATYPE>CHAR</DATATYPE>"]), /first key field is not the client/],
    ["a client-independent table with a client-typed key field", table(false, [
      "<FIELDNAME>MANDT</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>MANDT</ROLLNAME>",
      "<FIELDNAME>KIND</FIELDNAME><KEYFLAG>X</KEYFLAG><DATATYPE>CHAR</DATATYPE>",
      "<FIELDNAME>CODE</FIELDNAME><KEYFLAG>X</KEYFLAG><DATATYPE>CHAR</DATATYPE>"]), /client-typed key field mandt/],
    ["a table with an include", table(true, [
      "<FIELDNAME>MANDT</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>MANDT</ROLLNAME>",
      "<FIELDNAME>.INCLUDE</FIELDNAME><KEYFLAG>X</KEYFLAG>"]), /has includes/],
  ];
  for (const [what, xml, reason] of layouts) {
    it(`R1 refuses ${what}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "lift-ddic-"));
      try {
        writeFileSync(join(dir, "zosd_lift_txt.tabl.xml"), xml);
        expect(() => modelR1(DEMO, "before", [dir])).to.throw(reason);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  }

  it("the fixture itself is accepted, so the refusals above are about their one change", () => {
    const model = modelR1FromSource("zcl_fx.clas.abap", fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`), "m", ["src"]);
    expect(model.open).to.include("key types equal column types");
  });

  it("the generated region of AFTER is exactly what the template renders", async () => {
    const {text, trace} = await render(modelR1(DEMO, "before", ["src"]));
    expect(region(readFileSync(DEMO, "utf8"))).to.equal(text);
    // the line that copies the value traces to the template line of the
    // field loop and to the first value on it
    const copy = text.split("\n").findIndex((l) => l.includes("-text = <ls_lookup>-text")) + 1;
    const template = readFileSync(TEMPLATE, "utf8").split("\n");
    const entry = trace.find((t) => t.line === copy);
    expect(template[entry.template_line - 1]).to.equal("    {{loop.row}}-{{component}} = {{hit}}-{{column}}.");
    expect(entry.path).to.equal("/loop/row");
  });

  // AFTER is one SELECT in the ABAP. On a system the kernel sends FOR ALL
  // ENTRIES in blocks; the open-abap runtime sends one SELECT per row of the
  // driving table (ANOMALY-2026-09-30-fae-one-select-per-row), so here the
  // round trips do not drop. This test pins that: when the runtime blocks,
  // it fails, and the expectation becomes the real one.
  it("BEFORE asks the database once per row; AFTER does too, on this runtime", async () => {
    const db = abap.context.databaseConnections.DEFAULT;
    await db.execute("DELETE FROM zosd_lift_txt");
    for (let i = 0; i < 40; i++) {
      await db.execute(`INSERT INTO zosd_lift_txt (mandt, kind, code, text) VALUES ('${abap.builtin.sy.get().mandt.get()}', 'STAT', 'C${i}', 'text ${i}')`);
    }
    const rows = () => {
      const table = abap.types.TableFactory.construct(new abap.types.Structure({
        kind: new abap.types.Character(4), code: new abap.types.Character(10), text: new abap.types.Character(40)}),
      {withHeader: false, keyType: "DEFAULT", primaryKey: {name: "primary_key", type: "STANDARD", isUnique: false, keyFields: []}, secondary: []});
      for (let i = 0; i < 50; i++) {
        const row = table.getRowType().clone();
        row.get().kind.set("STAT");
        row.get().code.set(`C${i % 45}`);
        table.append(row);
      }
      return table;
    };
    const counted = async (method) => {
      const original = db.select.bind(db);
      let calls = 0;
      let fetched = 0;
      db.select = async (options) => {
        calls++;
        const answer = await original(options);
        fetched += answer.rows.length;
        return answer;
      };
      const table = rows();
      try {
        await abap.Classes.ZCL_OSD_LIFT_R1_DEMO[method]({ct_rows: table});
      } finally {
        db.select = original;
      }
      return {calls, fetched, texts: table.array().map((r) => r.get().text.get())};
    };
    const before = await counted("before");
    const after = await counted("after");
    expect(after.texts).to.deep.equal(before.texts);
    expect(before.calls).to.equal(50);
    expect(after.calls, "ANOMALY-2026-09-30-fae-one-select-per-row").to.equal(50);
    const empty = abap.types.TableFactory.construct(rows().getRowType(), {withHeader: false, keyType: "DEFAULT", primaryKey: {name: "primary_key", type: "STANDARD", isUnique: false, keyFields: []}, secondary: []});
    const original = db.select.bind(db);
    let calls = 0;
    db.select = async (options) => { calls++; return original(options); };
    try {
      await abap.Classes.ZCL_OSD_LIFT_R1_DEMO.after({ct_rows: empty});
    } finally {
      db.select = original;
    }
    expect(calls, "no rows, no read: the IS NOT INITIAL guard").to.equal(0);
  });
});
