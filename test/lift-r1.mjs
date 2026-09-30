// Recipe R1 end to end (recipes/r1-lookup-enrich/): the model comes out of
// BEFORE by tools/lift.mjs, the ABAP template engine renders AFTER from it,
// the rendered text is the generated region of ZCL_OSD_LIFT_R1_DEMO, and the
// two methods are run on the same rows while the database calls are counted.
// Equality of the rows is ABAP Unit's job (the class's own test class, which
// runs on a system as well); what only the host can see is the cost.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {modelR1} from "../tools/lift.mjs";

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

  it("R1 refuses a loop that is not the shape, and says which obligation failed", () => {
    expect(() => modelR1(DEMO, "after", ["src"])).to.throw(/^shape: /);
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
