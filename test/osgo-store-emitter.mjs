import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, it} from "mocha";
import {storeConfig} from "../tools/gogen/store.mjs";

const here = resolve(new URL(".", import.meta.url).pathname);

describe("OSGo store emitter", function() {
  this.timeout(30000);

  it("emits no active snapshots when the tree has no live generation", async () => {
    const root = resolve(here, "../tools/gogen/testdata-store/tree");
    const config = await storeConfig(root, {storeModule: `${here}/../tools/osd-store.mjs`});
    assert.deepEqual(config.active, {});
    assert.notDeepEqual(config.built, {});
  });

  it("emits root-relative active paths that the Go store reads", async () => {
    const root = join(tmpdir(), `osgo-store-emitter-${Date.now()}`);
    mkdirSync(join(root, "src"), {recursive: true});
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src"}) + "\n");
    writeFileSync(join(root, "src/zactive.prog.abap"), "REPORT retained.\n");
    const source = join(root, "build/by-input/emitter-test/source");
    mkdirSync(join(source, "src"), {recursive: true});
    writeFileSync(join(source, ".complete"), "1\n");
    writeFileSync(join(source, "src/zactive.prog.abap"), "REPORT retained.\n");
    symlinkSync("../by-input/emitter-test", join(root, "build/live"));
    const config = await storeConfig(root, {storeModule: `${here}/../tools/osd-store.mjs`});
    assert.match(config.active["src/zactive.prog.abap"], /^build\/by-input\/emitter-test\/source\//);
    writeFileSync(join(root, "src/zactive.prog.abap"), "REPORT changed.\n");
    const configPath = join(root, "emitter-store.json");
    writeFileSync(configPath, JSON.stringify(config));
    const raw = execFileSync("go", ["run", "./cmd/storecmp", "-root", root, "-config", configPath],
      {cwd: join(here, "../tools/gogen/go"), env: {...process.env, GOCACHE: mkdtempSync(join(tmpdir(), "osgo-go-cache-"))},
        input: JSON.stringify([
          {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZACTIVE", IV_REVISION: "active"},
        ]), encoding: "utf8"});
    assert.equal(JSON.parse(raw)[0].Scalars.EV_SOURCE, "REPORT retained.\n");
  });
});
