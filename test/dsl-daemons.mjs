import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {XMLValidator} from "fast-xml-parser";
import {buildRecipe, format} from "../tools/dsl-build.mjs";
import {firstDifference, renderDaemon} from "../tools/dsl-samc.mjs";
import {buildDaemonModel, programId} from "../tools/dsl-daemons.mjs";

const samc = "recipes/samc-xml/sample/zosd_t_amc.samc.model.json";
const sapc = "recipes/sapc-xml/sample/zstg_apc_demo.sapc.model.json";
const samcTarget = "docs/probes/abap-daemons/zosd_t_amc.samc.xml";
const sapcTarget = "src/apc/zstg_apc_demo.sapc.xml";

describe("DSL daemon channel files", function () {
  this.timeout(120000);
  const scratch = [];
  const temp = (name, value) => {
    const dir = mkdtempSync(join(tmpdir(), "dsl-daemons-"));
    scratch.push(dir);
    const file = join(dir, name);
    writeFileSync(file, value);
    return file;
  };
  after(() => scratch.forEach((dir) => rmSync(dir, {recursive: true, force: true})));

  it("renders SAMC and SAPC byte for byte, with one final newline", async () => {
    for (const [model, target] of [[samc, samcTarget], [sapc, sapcTarget]]) {
      const {text, trace} = await renderDaemon(model);
      expect(text).to.equal(readFileSync(target, "utf8"));
      expect(text).to.match(/<\/abapGit>\n$/);
      expect(trace).to.have.length(text.trimEnd().split("\n").length);
      expect(trace.every((entry) => entry.node)).to.equal(true);
      expect(XMLValidator.validate(text)).to.equal(true);
    }
  });

  it("computes each PROGRAM_ID from its class and matches the probe", () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    const output = buildDaemonModel(model);
    const target = readFileSync(samcTarget, "utf8");
    const ids = [...target.matchAll(/<PROGRAM_ID>([^<]+)<\/PROGRAM_ID>/g)].map((match) => match[1]);
    expect(ids).to.deep.equal(output.authorities.map((authority) => programId(authority.program)));
    expect(output.authorities.map((authority) => authority.program_id)).to.deep.equal(ids);
    expect(output.authorities.map((authority) => authority.nr)).to.deep.equal(Array.from({length: ids.length}, (_, i) => i + 1));
  });

  it("renders an authority whose PROGRAM_ID is absent in the input", async () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    delete model.authorities[0].program_id;
    const {text} = await renderDaemon(temp("computed.json", `${JSON.stringify(model)}\n`));
    expect(text).to.equal(readFileSync(samcTarget, "utf8"));
  });

  it("omits an empty AUTHORITIES table from the SAMC shape", async () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    model.authorities = [];
    model.channels.pop();
    const {text} = await renderDaemon(temp("noauth.json", `${JSON.stringify(model)}\n`));
    const expected = readFileSync(samcTarget, "utf8")
      .replace(/^     <AMC_CHANNEL>.*<CHANNEL_ID>\/ps<\/CHANNEL_ID>.*\n/m, "")
      .replace(/    <AUTHORITIES>\n[\s\S]*?    <\/AUTHORITIES>\n/, "");
    expect(text).to.equal(expected);
  });

  it("omits empty CHANNELS and TEXT, and an initial DESCRIPTION", async () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    model.channels = [];
    model.authorities = [];
    model.description = "";
    model.lang = "";
    const {text} = await renderDaemon(temp("empty.json", `${JSON.stringify(model)}\n`));
    const expected = readFileSync(samcTarget, "utf8")
      .replace(/^    <TEXT>.*\n/m, "")
      .replace(/    <CHANNELS>\n[\s\S]*?    <\/CHANNELS>\n/, "")
      .replace(/    <AUTHORITIES>\n[\s\S]*?    <\/AUTHORITIES>\n/, "");
    expect(text).to.equal(expected);
    model.lang = "E";
    const withLang = await renderDaemon(temp("empty-description.json", `${JSON.stringify(model)}\n`));
    expect(withLang.text).to.include("<LANG>E</LANG></TEXT>");
    expect(withLang.text).not.to.include("<DESCRIPTION>");
  });

  it("omits initial STATEFUL and escapes an apostrophe in SAPC", async () => {
    const model = JSON.parse(readFileSync(sapc, "utf8"));
    model.stateful = false;
    model.description = "Alice's channel";
    const {text} = await renderDaemon(temp("stateless.json", `${JSON.stringify(model)}\n`));
    const expected = readFileSync(sapcTarget, "utf8")
      .replace(/^     <STATEFUL>.*\n/m, "")
      .replace("OSD demo push channel", "Alice&apos;s channel");
    expect(text).to.equal(expected);
  });

  it("omits an empty SAPC TEXT block", async () => {
    const model = JSON.parse(readFileSync(sapc, "utf8"));
    model.lang = "";
    model.description = "";
    const {text} = await renderDaemon(temp("no-sapc-text.json", `${JSON.stringify(model)}\n`));
    const expected = readFileSync(sapcTarget, "utf8")
      .replace(/    <TEXT>\n[\s\S]*?    <\/TEXT>\n/, "");
    expect(text).to.equal(expected);
  });

  it("uses iXML entities for all five XML specials in both recipes", async () => {
    for (const [file, tag] of [[samc, "SAMC"], [sapc, "SAPC"]]) {
      const model = JSON.parse(readFileSync(file, "utf8"));
      model.description = `&<>"'`;
      const {text} = await renderDaemon(temp(`${tag}.json`, `${JSON.stringify(model)}\n`));
      expect(text).to.include("<DESCRIPTION>&amp;&lt;&gt;&quot;&apos;</DESCRIPTION>");
    }
  });

  it("requires an explicit recipe kind and SAMC channels", async () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    delete model.kind;
    let error;
    try { await renderDaemon(temp("no-kind.json", `${JSON.stringify(model)}\n`)); }
    catch (caught) { error = caught; }
    expect(error?.message).to.match(/kind/);
    model.kind = "samc";
    delete model.channels;
    error = undefined;
    try { await renderDaemon(temp("no-channels.json", `${JSON.stringify(model)}\n`)); }
    catch (caught) { error = caught; }
    expect(error?.message).to.match(/channels/);
  });

  it("rejects out-of-order authority numbers, row identity mismatches and namespaced classes", () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    model.authorities[0].nr = 2;
    expect(() => buildDaemonModel(model)).to.throw(/nr.*1/);
    model.authorities[0].nr = 1;
    model.channels[0].applicationId = "OTHER";
    expect(() => buildDaemonModel(model)).to.throw(/applicationId/);
    delete model.channels[0].applicationId;
    model.authorities[0].version = "B";
    expect(() => buildDaemonModel(model)).to.throw(/version/);
    delete model.authorities[0].version;
    model.authorities[0].program = "/NS/ZCL_DEMO";
    expect(() => buildDaemonModel(model)).to.throw(/namespaced.*class/i);
  });

  it("a changed channel field changes only the line traced to that channel", async () => {
    const original = await renderDaemon(samc);
    const model = JSON.parse(readFileSync(samc, "utf8"));
    model.channels[1].scope = "S";
    const changed = await renderDaemon(temp("changed.samc.model.json", `${JSON.stringify(model)}\n`));
    const before = original.text.split("\n");
    const after = changed.text.split("\n");
    const changedLines = before.flatMap((line, i) => line === after[i] ? [] : [i + 1]);
    expect(changedLines).to.have.length(1);
    expect(changed.trace[changedLines[0] - 1].node).to.equal(model.channels[1]["@id"]);
  });

  it("escapes ampersand, angle bracket and quote in descriptions", async () => {
    const model = JSON.parse(readFileSync(samc, "utf8"));
    model.description = 'A & B < "C"';
    const {text} = await renderDaemon(temp("escaped.samc.model.json", `${JSON.stringify(model)}\n`));
    expect(text).to.include("<DESCRIPTION>A &amp; B &lt; &quot;C&quot;</DESCRIPTION>");
    expect(XMLValidator.validate(text)).to.equal(true);
  });

  it("check exits 1 and reports the first differing line", () => {
    const target = temp("target.xml", readFileSync(samcTarget, "utf8").replace("<SCOPE>C</SCOPE>", "<SCOPE>X</SCOPE>"));
    const run = spawnSync("node", ["tools/dsl-samc.mjs", "check", samc, target], {encoding: "utf8"});
    expect(run.status).to.equal(1);
    expect(run.stderr).to.include(`${target}: drift at line 9`);
    expect(firstDifference("a\n", "a")).to.equal(2);
  });

  it("render --out writes XML and a node trace for every line", () => {
    const out = temp("rendered.xml", "");
    const run = spawnSync("node", ["tools/dsl-samc.mjs", "render", samc, "--out", out], {encoding: "utf8"});
    expect(run.status, run.error?.message ?? run.stderr).to.equal(0);
    expect(readFileSync(out, "utf8")).to.equal(readFileSync(samcTarget, "utf8"));
    const sidecar = JSON.parse(readFileSync(`${out}.trace.json`, "utf8"));
    expect(sidecar.lines).to.have.length(readFileSync(out, "utf8").trimEnd().split("\n").length);
    expect(sidecar.lines.every((line) => line.node)).to.equal(true);
    expect(sidecar.lines.some((line) => line.node === "samc/ZOSD_T_AMC/ch/pu")).to.equal(true);
  });

  it("dsl-build --check builds both recipes and catches schema drift", async () => {
    for (const name of ["samc-xml", "sapc-xml"]) {
      const result = await buildRecipe(name, {check: true});
      expect(result.errors.map(format), name).to.deep.equal([]);
    }
    const dir = mkdtempSync(join(tmpdir(), "dsl-daemon-recipe-"));
    scratch.push(dir);
    cpSync("recipes/samc-xml", join(dir, "copy"), {recursive: true});
    const schemaFile = join(dir, "copy", "schema.json");
    const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
    delete schema.object.description;
    writeFileSync(schemaFile, `${JSON.stringify(schema)}\n`);
    const result = await buildRecipe("copy", {dir, check: true});
    expect(result.errors.map(format)).to.include("copy/schema.json: the model has description, the schema lacks it");
  });

  it("the XML profile rejects malformed rendered XML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsl-daemon-xml-"));
    scratch.push(dir);
    cpSync("recipes/sapc-xml", join(dir, "copy"), {recursive: true});
    const file = join(dir, "copy", "template.tpl");
    writeFileSync(file, readFileSync(file, "utf8").replace("</SAPC>", "</BROKEN>"));
    const result = await buildRecipe("copy", {dir});
    expect(result.errors.map(format).join("\n")).to.match(/copy\/template\.tpl:\d+: xml: .*output line \d+, node sapc\/ZSTG_APC_DEMO/);
  });
});
