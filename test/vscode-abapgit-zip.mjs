import {expect} from "chai";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const {unitChoices, zipArgs, outcomeOf, runZip} = require("../editors/vscode/abapgit-zip.js");
const {registerAbapgitZipCommand, prepareAbapgitZip} = require("../editors/vscode/abapgit-zip-command.js");
const checkout = process.cwd();
const manifest = JSON.parse(readFileSync("deploy/manifest.json", "utf8"));
const demo = {name: "demo", ...manifest.units.demo};
// Captured from the real CLI, with only the temporary directory normalized.
const refusalText = `/fixture/source: 1 refusal(s), nothing may leave for a system until each is resolved:
  CLAS CL_HTTP_CLIENT  (cl_http_client.clas.xml)
    sap-api-name: CL_/IF_/CX_ is SAP's public API, reimplemented here and never deployed
What ships is listed in deploy/manifest.json; an SAP-owned name ships only with "intended": "<why>" on its entry.
`;
// Real CLI summary and object rows; omitted unpaired-data notices carry no objects.
const successText = `/fixture/demo.zip: 25 files, 25.8 KB, deploy unit "demo"
  CLAS  zcl_zstg_demo_dpc, zcl_zstg_demo_dpc_ext, zcl_zstg_demo_mpc, zcl_zstg_demo_mpc_ann, zcl_zstg_demo_mpc_ext
  IWMO  zstg_demo_mdl                   0001
  IWPR  zstg_demo
  IWSV  zstg_demo_srv                      0001
  DATA  zstg_demo, zstg_demo_bk, zstg_flightfact, zstg_photo, zstg_status
  NOT carried: zstg_demo: 1 row(s) not in client 123 -- abapGit deserialises into the logon client, so another client's row would arrive as this one's

Import it in abapGit: "New Online/Offline" -> Offline -> pick the zip,
then give it the package. The zip does not name one, so nothing here
decides where it lands.
`;

function apiFor(name, target, action = "Copy path") {
  const seen = {errors: [], info: [], output: ""};
  const disposable = {dispose() {}};
  let accept, hide;
  const picker = {
    onDidAccept(fn) { accept = fn; return disposable; },
    onDidHide(fn) { hide = fn; return disposable; },
    show() { seen.active = this.activeItems; seen.items = this.items;
      this.selectedItems = this.items.filter((item) => item.label === name); accept(); },
    hide() { hide(); }, dispose() {},
  };
  const api = {
    Uri: {file: (fsPath) => ({scheme: "file", fsPath})},
    ProgressLocation: {Notification: 15},
    window: {
      activeTextEditor: {document: {uri: {scheme: "file", fsPath: path.join(checkout, demo.sources[0])}}},
      createQuickPick: () => picker,
      showSaveDialog: async (options) => { seen.save = options; return target; },
      withProgress: async (options, run) => { seen.progress = options; return run(); },
      showInformationMessage: async (...args) => { seen.info.push(args); return action; },
      showErrorMessage: async (...args) => { seen.errors.push(args); return action; },
    },
    commands: {
      registerCommand: (name, run) => { seen.command = name; seen.run = run; return disposable; },
      executeCommand: async (...args) => { seen.executed = args; },
    },
    env: {clipboard: {writeText: async (value) => { seen.copied = value; }}},
  };
  const output = {append: (value) => { seen.output += value; }, appendLine: (value) => { seen.output += value + "\n"; }, show: () => { seen.shown = true; }};
  return {api, output, seen};
}

describe("VS Code prepare abapGit zip", function () {
  this.timeout(30000);
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "osd-vscode-zip-")); });
  afterEach(() => { rmSync(dir, {recursive: true, force: true}); });

  it("preselects the active source and sorts it first, including a file source", () => {
    const choices = unitChoices(manifest, path.join(checkout, demo.sources[0]), checkout);
    expect(choices[0]).to.include({label: "demo", picked: true});
    expect(choices[0].detail).to.equal(`${demo.description} (${demo.objects.length} objects)`);
    const nested = unitChoices(manifest, path.join(checkout, "packs/zvdb/src/example.abap"), checkout);
    expect(nested[0]).to.include({label: "zvdb", picked: true});
  });

  it("respects source boundaries, handles no active editor, and uses the first sentence", () => {
    expect(unitChoices(manifest, path.join(checkout, "packs/zvdb-extra/x"), checkout).some((i) => i.picked)).to.equal(false);
    expect(unitChoices(manifest, undefined, checkout).some((i) => i.picked)).to.equal(false);
    expect(unitChoices({units: {u: {description: "First. Second.", objects: []}}}, undefined, checkout)[0].detail).to.equal("First. (0 objects)");
  });

  it("keeps source-less units visible and refuses them with instructions", () => {
    const choice = unitChoices(manifest, undefined, checkout).find((i) => i.label === "demo-app");
    expect(choice).to.include({picked: false});
    expect(choice.detail).to.include("2 objects");
    expect(() => zipArgs(choice.unit, "out.zip")).to.throw(/demo-app.*no sources.*osd-bsp-app/s);
  });

  it("passes the first input, explicit unit and output as separate arguments", () => {
    expect(zipArgs({...demo, sources: [demo.sources[0], "other"]}, "/space dir/out.zip")).to.deep.equal([
      "tools/osd-abapgit-zip.mjs", demo.sources[0], "--unit", "demo", "--out", "/space dir/out.zip",
    ]);
  });

  it("parses real success output as eight objects, excluding DATA and NOT carried", () => {
    expect(outcomeOf(0, successText, "")).to.deep.equal({ok: true, path: "/fixture/demo.zip", objects: 8, refusal: undefined, lastError: undefined});
    expect(outcomeOf(0, successText.replaceAll("/fixture/demo.zip", "C:\\space dir\\demo.zip"), "").path).to.equal("C:\\space dir\\demo.zip");
  });

  it("requires a zero exit code even if stdout contains a success summary", () => {
    expect(outcomeOf(1, successText, "failed after writing\n")).to.include({ok: false, lastError: "failed after writing"});
    expect(outcomeOf(null, successText, "").ok).to.equal(false);
    expect(outcomeOf(0, "", "").ok).to.equal(false);
  });

  it("preserves real refusal text naming the object and extracts other failures", () => {
    expect(outcomeOf(1, "", refusalText)).to.include({ok: false, refusal: refusalText.trim()});
    expect(outcomeOf(2, "", "first\r\nlast error\r\n\r\n")).to.include({ok: false, lastError: "last error", refusal: undefined});
  });

  it("runs the real demo CLI through the command's spawn helper and checks the zip", async () => {
    // YAML compilation is the cheapest real demo input: no transpile, pack
    // fetch, server or prebuilt output is needed (as in osd-abapgit-zip tests).
    const out = path.join(dir, "space dir", "demo.zip");
    mkdirSync(path.dirname(out));
    let streamed = "";
    const result = await runZip(checkout, demo, out, {onOutput: (chunk) => { streamed += chunk; }});
    expect(result.code, result.stderr).to.equal(0);
    expect(existsSync(out)).to.equal(true);
    const entries = execFileSync("unzip", ["-Z1", out], {encoding: "utf8"}).split("\n");
    expect(entries).to.include(".abapgit.xml").and.include("src/package.devc.xml");
    expect(outcomeOf(result.code, result.stdout, result.stderr)).to.include({ok: true, path: out, objects: 8});
    expect(streamed).to.equal(result.stdout + result.stderr);
  });

  it("reproduces the captured SAP-name refusal through the real spawn helper", async () => {
    const source = path.join(dir, "source");
    mkdirSync(source);
    writeFileSync(path.join(source, "cl_http_client.clas.xml"), "<VSEOCLASS><CLSNAME>CL_HTTP_CLIENT</CLSNAME></VSEOCLASS>\n");
    // --unit demo admits no SAP-owned class, regardless of which folder is passed.
    const result = await runZip(checkout, {name: "demo", sources: [source]}, path.join(dir, "bad.zip"));
    expect(result.code).to.equal(1);
    expect(outcomeOf(result.code, result.stdout, result.stderr).refusal).to.include("CLAS CL_HTTP_CLIENT").and.include("sap-api-name").and.include("not-in-manifest");
    expect(existsSync(path.join(dir, "bad.zip"))).to.equal(false);
  });

  for (const refused of [true, false]) {
    it(`shows the tool's ${refused ? "object-naming refusal" : "last stderr line"} and opens output`, async () => {
      const source = path.join(dir, "source");
      if (refused) {
        mkdirSync(source);
        writeFileSync(path.join(source, "cl_http_client.clas.xml"), "<CLSNAME>CL_HTTP_CLIENT</CLSNAME>\n");
      }
      mkdirSync(path.join(dir, "deploy"));
      symlinkSync(path.join(checkout, "tools"), path.join(dir, "tools"), process.platform === "win32" ? "junction" : "dir");
      writeFileSync(path.join(dir, "abap_transpile.json"), JSON.stringify({input_folder: []}));
      writeFileSync(path.join(dir, "deploy/manifest.json"), JSON.stringify({version: 1, units: {
        probe: {description: "Fixture.", sources: [source], objects: ["CLAS CL_HTTP_CLIENT"]},
      }}));
      const {api, output, seen} = apiFor("probe", {scheme: "file", fsPath: path.join(dir, "out.zip")}, "Show output");
      await prepareAbapgitZip(api, output, dir);
      expect(seen.info).to.deep.equal([]);
      expect(seen.errors).to.have.length(1);
      if (refused) expect(seen.errors[0][0].replaceAll(dir, "/fixture")).to.equal(refusalText.trim());
      else expect(seen.errors[0][0]).to.equal(`no such folder: ${source}`);
      expect(seen.shown).to.equal(true);
      expect(existsSync(path.join(dir, "out.zip"))).to.equal(false);
    });
  }

  it("reports missing Node as a spawn error", async () => {
    let error;
    try { await runZip(checkout, demo, path.join(dir, "x.zip"), {node: path.join(dir, "missing-node")}); }
    catch (caught) { error = caught; }
    expect(error.code).to.equal("ENOENT");
  });

  it("registers the command and explains why a checkout is needed", async () => {
    const {api, output, seen} = apiFor();
    registerAbapgitZipCommand(api, {subscriptions: []}, output, () => undefined, () => false);
    expect(seen.command).to.equal("osd.prepareAbapgitZip");
    await seen.run();
    expect(seen.errors[0][0]).to.include("checkout").and.include("Node tools");
  });

  it("rejects a bundled tree without deploy inputs even if it has system markers", async () => {
    const {api, output, seen} = apiFor();
    registerAbapgitZipCommand(api, {subscriptions: []}, output, () => dir, () => true);
    await seen.run();
    expect(seen.errors[0][0]).to.include("checkout").and.include("bundled system");
  });

  it("cancelling the save dialog does not launch the tool", async () => {
    const {api, output, seen} = apiFor("demo", undefined);
    await prepareAbapgitZip(api, output, checkout);
    expect(seen.save).not.to.equal(undefined);
    expect(seen.progress).to.equal(undefined);
    expect(seen.errors).to.deep.equal([]);
  });

  it("reports a manifest read failure and offers the output channel", async () => {
    const {api, output, seen} = apiFor("demo", undefined, "Show output");
    await prepareAbapgitZip(api, output, dir);
    expect(seen.errors[0][0]).to.include("ENOENT");
    expect(seen.errors[0][1]).to.equal("Show output");
    expect(seen.shown).to.equal(true);
  });

  it("refuses source-less units before offering a save target", async () => {
    const {api, output, seen} = apiFor("demo-app");
    await prepareAbapgitZip(api, output, checkout);
    expect(seen.save).to.equal(undefined);
    expect(seen.errors[0][0]).to.include('"demo-app" has no sources');
  });

  for (const action of ["Copy path", "Reveal in Explorer"]) {
    it(`runs the command UI and handles ${action}`, async () => {
      const target = {scheme: "file", fsPath: path.join(dir, "nested", "demo.zip")};
      const {api, output, seen} = apiFor("demo", target, action);
      await prepareAbapgitZip(api, output, checkout);
      expect(seen.errors).to.deep.equal([]);
      expect(seen.active[0].label).to.equal("demo");
      expect(seen.save.defaultUri.fsPath).to.equal(path.join(checkout, "build/deploy/demo.zip"));
      expect(seen.progress.title).to.include("demo");
      expect(seen.output).to.include(target.fsPath);
      expect(seen.info[0][0]).to.include(target.fsPath).and.include("8 objects");
      if (action === "Copy path") expect(seen.copied).to.equal(target.fsPath);
      else expect(seen.executed).to.deep.equal(["revealFileInOS", target]);
    });
  }

  it("contributes palette activation, overflow entry and a web refusal", () => {
    const pkg = JSON.parse(readFileSync("editors/vscode/package.json", "utf8"));
    expect(pkg.activationEvents).to.include("onCommand:osd.prepareAbapgitZip");
    expect(pkg.contributes.commands.find((c) => c.command === "osd.prepareAbapgitZip").title).to.equal("osd: Prepare abapGit zip…");
    expect(pkg.contributes.menus["view/title"].find((c) => c.command === "osd.prepareAbapgitZip").group).to.equal("9_osd@4");
    expect(readFileSync("editors/vscode/web/extension.mjs", "utf8")).to.include('registerCommand("osd.prepareAbapgitZip"').and.include("no file system or process runner");
  });
});
