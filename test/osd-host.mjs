import {expect} from "chai";
import {strict as assert} from "node:assert";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, join} from "node:path";
import {inputFoldersOf} from "../tools/osd-packs.mjs";
import {compiled, serveCommand, toolCommand, unitCommand, dataDirOf, layerList, isCheckout} from "../tools/osd-host.mjs";

// The host module: which process starts which, in a checkout and in the
// binary. Under mocha this is a checkout, so the commands are node + path;
// the compiled shape is what bin/osd.mjs dispatches (SP4).
describe("tools/osd-host: how a tool starts another tool", () => {
  it("knows it is not a compiled binary here", () => {
    expect(compiled).to.equal(false);
  });

  it("starts a tool, the serving child and a unit run by path under node", () => {
    expect(toolCommand("/x/tools/cds2ddic.mjs", ["--all"])).to.deep.equal([process.execPath, "/x/tools/cds2ddic.mjs", "--all"]);
    expect(serveCommand("/x/tools/osd-serve.mjs")).to.deep.equal([process.execPath, "/x/tools/osd-serve.mjs"]);
    expect(unitCommand("/x/tools/osd-unit.mjs", ["CLAS", "ZCL_X", "--json"])).to.deep.equal([process.execPath, "/x/tools/osd-unit.mjs", "CLAS", "ZCL_X", "--json"]);
  });
});

describe("standalone binary home and layers", () => {
  it("chooses the platform user data directory", () => {
    assert.equal(dataDirOf("linux", {}, "/home/example"), "/home/example/.local/share/open-steamgate");
    assert.equal(dataDirOf("linux", {XDG_DATA_HOME: "/data"}, "/home/example"), "/data/open-steamgate");
    assert.equal(dataDirOf("darwin", {}, "/Users/example"), "/Users/example/Library/Application Support/open-steamgate");
    assert.equal(dataDirOf("win32", {LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local"}, "C:\\Users\\example"),
      join("C:\\Users\\example\\AppData\\Local", "open-steamgate"));
  });

  it("puts environment and repeatable CLI layers after the bundled system", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-layers-"));
    try {
      for (const name of ["src", "gen", "first", "second", "third"]) mkdirSync(join(root, name));
      const env = {OSD_LAYERS: ["first", "second"].join(delimiter)};
      const {folders, rest} = layerList(["up", "--layer", "third"], env, root);
      assert.deepEqual(rest, ["up"]);
      assert.deepEqual(folders, ["first", "second", "third"].map((name) => join(root, name)));
      const stack = inputFoldersOf(root, {input_folder: ["src", "gen"]}, {OSD_LAYERS: folders.join(delimiter)});
      assert.deepEqual(stack, ["src", "gen", "first", "second", "third"]);
      assert.throws(() => layerList(["--layer", "missing"], {}, root), /not a directory/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("distinguishes a checkout from a materialized working copy", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-home-choice-"));
    try {
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "tools"));
      writeFileSync(join(root, "abap_transpile.json"), "{}");
      assert.equal(isCheckout(root), true);
      writeFileSync(join(root, ".osd-materialized"), "seed-id");
      assert.equal(isCheckout(root), false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
