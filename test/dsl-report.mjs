import {expect} from "chai";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
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
    expect(args.trace[2].nodes).to.deep.equal([args.model.elements[1]["@id"]]);
    expect((await reportModel("tools/gogen/apps/greet")).elements.find((item) => item.name === "P_NAME")?.default).to.equal("world");
  });

  it("renders fixture help byte for byte and traces each option line", async () => {
    const rendered = await renderReport("help", sample);
    expect(rendered.text).to.equal(readFileSync(join(sample, "help.txt"), "utf8"));
    const lines = rendered.text.trimEnd().split("\n");
    for (let index = 2; index < 7; index++) {
      expect(rendered.trace[index].node, lines[index]).to.equal(rendered.model.elements[index - 2]["@id"]);
    }
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
    const [name, loud, tag, inButton, outButton] = model.elements;
    expect(tag.cli).to.deep.equal(["--s-tag"]);
    expect(loud.kind).to.equal("checkbox");
    expect(loud.cli).to.deep.equal(["--loud", "--p-loud"]);
    expect(model.checkboxes).to.deep.equal(["P_LOUD"]);
    expect(name.obligatory).to.equal(true);
    expect(name["default@type"]).to.include({built_in: "CHAR", length: 12});
    expect(name.selection_text).to.equal("Your name");
    expect([inButton.radio_group, outButton.radio_group]).to.deep.equal(["DIR", "DIR"]);
    expect(model.groups[0].members).to.equal("--in, --out");
  });
});
