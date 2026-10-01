import {expect} from "chai";
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {home} from "../tools/gogen/home.mjs";
import {reportModel, renderReport} from "../tools/dsl-report.mjs";

const sample = "recipes/report-help/sample";
const generatorSource = readFileSync("tools/gogen/osabap.mjs", "utf8");
// Run the current generator's own selection expressions and interpolation,
// without invoking its native compiler or writing zz_app.go.
const selectionSource = /const selections = ([\s\S]*?)(?=\n\nconst rttiObjects)/.exec(generatorSource)?.[0];
const goSource = /var appSelectionNames = [\s\S]*?var appRanges = [^\n]+\n/.exec(generatorSource)?.[0];
if (!selectionSource || !goSource) throw new Error("osabap Go selection block moved; update the read-only oracle");
const selectionBlock = new Function("converted", `${selectionSource}\nreturn {selectionNames, positionals, checkboxes, ranges};`);
const goBlock = new Function("name", "selectionNames", "positionals", "checkboxes", "ranges", `return \`${goSource}\`;`);

async function originalBlock(file) {
  const {convertProgram} = await import(join(home, ".local", "lars", "open-abap-gui", "converter", "src", "api.mjs"));
  const name = basename(file).replace(/\.prog\.abap$/i, "").toUpperCase();
  const converted = await convertProgram({source: readFileSync(file, "utf8"), filename: basename(file),
    mode: "strict", className: `ZCL_OSABAP_${name.replace(/^Z/, "")}`, transactionCode: name});
  const {selectionNames, positionals, checkboxes, ranges} = selectionBlock(converted);
  return goBlock(name, selectionNames, positionals, checkboxes, ranges);
}

describe("report selection L1", function () {
  this.timeout(120000);
  it("matches osabap's current Go block for every example report", async () => {
    for (const folder of readdirSync("tools/gogen/apps")) {
      const dir = join("tools/gogen/apps", folder);
      const file = readdirSync(dir, {withFileTypes: true}).find((entry) => entry.isFile() && entry.name.endsWith(".prog.abap"))?.name;
      if (!file) continue;
      const path = join(dir, file);
      expect((await renderReport("args", path)).text, path).to.equal(await originalBlock(path));
    }
    const fixture = join(sample, "zreportdemo.prog.abap");
    const args = await renderReport("args", fixture);
    expect(args.text, fixture).to.equal(await originalBlock(fixture));
    for (const [index, key] of ["selection_names", "positionals", "checkboxes", "ranges"].entries()) {
      expect(args.trace[index].nodes, key).to.deep.equal(args.model[key].map((name) =>
        args.model.elements.find((item) => item.name === name)["@id"]));
    }
    const dir = mkdtempSync(join(tmpdir(), "report-parity-"));
    try {
      const memory = join(dir, "zmemory.prog.abap");
      writeFileSync(memory, "REPORT zmemory.\nDATA gv_num TYPE i.\nSELECT-OPTIONS s_mem FOR gv_num MEMORY ID checkbox.\nSTART-OF-SELECTION.\n WRITE gv_num.\n");
      const result = await renderReport("args", memory);
      expect(result.text).to.equal(await originalBlock(memory));
      expect(result.model.ranges).to.deep.equal(["S_MEM"]);
      expect(result.model.elements[0].source_kind).to.equal("select-option");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
    expect((await reportModel("tools/gogen/apps/greet")).elements.find((item) => item.name === "P_NAME")?.default).to.equal("world");
  });

  it("renders fixture help byte for byte and traces each option line", async () => {
    const rendered = await renderReport("help", sample);
    expect(rendered.text).to.equal(readFileSync(join(sample, "help.txt"), "utf8"));
    const manpage = await renderReport("manpage", sample);
    expect(manpage.text).to.equal(readFileSync(join(sample, "manpage.md"), "utf8"));
    const lines = rendered.text.trimEnd().split("\n");
    for (let index = 2; index < 2 + rendered.model.elements.length; index++) {
      expect(rendered.trace[index].node, lines[index]).to.equal(rendered.model.elements[index - 2]["@id"]);
    }
    const members = rendered.model.elements.filter((item) => item.radio_group === "DIR").map((item) => item["@id"]);
    expect(rendered.trace.find((entry) => entry.node === rendered.model.groups[0]["@id"]).nodes).to.deep.equal(members);
    expect(manpage.trace.find((entry) => entry.node === manpage.model.groups[0]["@id"]).nodes).to.deep.equal(members);
    const dir = mkdtempSync(join(tmpdir(), "report-trace-"));
    try {
      for (const kind of ["help", "manpage", "args"]) {
        const out = join(dir, kind);
        const result = await renderReport(kind, sample, {out});
        expect(readFileSync(out, "utf8")).to.equal(result.text);
        expect(JSON.parse(readFileSync(`${out}.trace.json`, "utf8"))).to.deep.equal(result.trace);
      }
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("records CLI names, kinds, radio membership, obligation and typed default", async () => {
    const model = await reportModel(sample);
    const byName = (name) => model.elements.find((item) => item.name === name);
    const [name, loud, tag, inButton, outButton, date, constant, plain] =
      ["P_NAME", "P_LOUD", "S_TAG", "P_IN", "P_OUT", "P_DATE", "P_CONST", "P_PLAIN"].map(byName);
    expect(tag.cli).to.deep.equal(["--s-tag"]);
    expect(loud.kind).to.equal("checkbox");
    expect(loud.cli).to.deep.equal(["--loud", "--p-loud"]);
    expect(model.checkboxes).to.deep.equal(["P_LOUD"]);
    expect(name.obligatory).to.equal(true);
    expect(name["default@type"]).to.include({built_in: "CHAR", length: 12});
    expect(name.type_label).to.equal("CHAR(12)");
    expect(tag).to.include({default_to: "omega", default_sign: "E", default_option: "NE"});
    expect(tag["default_to@type"]).to.include({built_in: "CHAR", length: 12});
    expect(byName("S_WHEN")).to.include({default: "sy-datum", default_to: "sy-datum", default_to_raw: "sy-datum"});
    expect(date).to.include({default: "sy-datum", default_raw: "sy-datum"});
    expect(date).not.to.have.property("default@type");
    expect(constant).to.include({default: "gc_def", default_raw: "gc_def"});
    expect(constant).not.to.have.property("default@type");
    expect(plain.type_label).to.equal("CHAR(1)");
    expect(plain["@type"]).to.include({built_in: "CHAR", length: 1});
    expect(plain.text).to.equal("");
    expect(name.selection_text).to.equal("Your name");
    expect([inButton.radio_group, outButton.radio_group]).to.deep.equal(["DIR", "DIR"]);
    expect(model.groups[0].members).to.equal("--in, --out");
    const dir = mkdtempSync(join(tmpdir(), "report-decimal-"));
    try {
      const file = join(dir, "zdecimal.prog.abap");
      writeFileSync(file, "REPORT zdecimal.\nPARAMETERS p_amount TYPE p LENGTH 8 DECIMALS 2.\nSTART-OF-SELECTION.\n WRITE p_amount.\n");
      expect((await reportModel(file)).elements[0].type_label).to.equal("DEC(8,2)");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
