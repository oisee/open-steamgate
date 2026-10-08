import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, mkdirSync, mkdtempSync, rmSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, it} from "mocha";
import {createHash} from "node:crypto";
import {ObjectStore} from "../tools/osd-store.mjs";
import {zipInProcess} from "../tools/osd-abapgit-zip.mjs";
import {sourceSnapshotPath} from "../tools/osd-source-snapshot.mjs";
import {storeConfig} from "../tools/gogen/store.mjs";

function goRead(root, config, type, name, include = "main") {
  const scratch = mkdtempSync(join(tmpdir(), "osgo-emitter-config-"));
  const path = join(scratch, "store.json");
  writeFileSync(path, JSON.stringify(config));
  try {
    const raw = execFileSync("go", ["run", "./cmd/storecmp", "-root", root, "-config", path], {
      cwd: join(here, "../tools/gogen/go"), env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/osgo-gocache"},
      input: JSON.stringify([{IV_COMMAND: "READ", IV_TYPE: type, IV_NAME: name, IV_INCLUDE: include, IV_REVISION: "active"}]), encoding: "utf8",
    });
    return JSON.parse(raw)[0].Scalars;
  } finally { rmSync(scratch, {recursive: true, force: true}); }
}

const here = resolve(new URL(".", import.meta.url).pathname);

describe("OSGo store emitter", function() {
  this.timeout(30000);

  it("emits no active snapshots when the tree has no live generation", async () => {
    const root = resolve(here, "../tools/gogen/testdata-store/tree");
    const config = await storeConfig(root, {storeModule: `${here}/../tools/osd-store.mjs`});
    assert.deepEqual(config.active, {});
    assert.notDeepEqual(config.built, {});
    assert.equal(goRead(root, config, "CLAS", "ZCL_ST_A").EV_ERROR, "CLAS ZCL_ST_A active version (main) does not exist");
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
      {cwd: join(here, "../tools/gogen/go"), env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/osgo-gocache"},
        input: JSON.stringify([
          {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZACTIVE", IV_REVISION: "active"},
        ]), encoding: "utf8"});
    assert.equal(JSON.parse(raw)[0].Scalars.EV_SOURCE, "REPORT retained.\n");
  });
  for (const shared of [false, true]) {
    it(`retains zip-layer main and include sources (${shared ? "shared-only" : "materialized"}, edited before emission)`, async () => {
      const root = mkdtempSync(join(tmpdir(), "osgo-archive-emitter-"));
      const prior = process.env.OSD_LAYERS;
      const priorPackage = process.env.OSD_LAYER_PACKAGE;
      try {
        mkdirSync(join(root, "src"));
        writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], libs: []}));
        const repo = join(root, "archive-input");
        mkdirSync(join(repo, "src"), {recursive: true});
        writeFileSync(join(repo, ".abapgit.xml"), "<STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>FULL</FOLDER_LOGIC>");
        writeFileSync(join(repo, "src/zarchive.clas.abap"), "CLASS zarchive DEFINITION PUBLIC. ENDCLASS.\nCLASS zarchive IMPLEMENTATION. ENDCLASS.\n");
        writeFileSync(join(repo, "src/zarchive.clas.locals_def.abap"), "* retained definitions\n");
        const archive = join(root, "fixture.zip");
        writeFileSync(archive, zipInProcess(repo));
        process.env.OSD_LAYERS = archive;
        process.env.OSD_LAYER_PACKAGE = "$ZIP";
        const store = new ObjectStore({root, libs: []});
        const entry = store.find("CLAS", "ZARCHIVE");
        // #656 seeds every warm-editable object input into the ZIP overlay before
        // the first generation, so the class is read from a writable overlay copy.
        assert.equal(entry.writable, true);
        assert.match(entry.file, /^local\//);
        const files = [entry.file, entry.file.replace(/\.clas\.abap$/, ".clas.locals_def.abap")];
        const generation = join(root, "build/by-input/archive-test");
        mkdirSync(join(generation, "source"), {recursive: true});
        writeFileSync(join(generation, "source/.complete"), "1\n");
        const inputs = {};
        for (const file of files) {
          const bytes = readFileSync(join(root, file));
          const digest = createHash("sha256").update(bytes).digest("hex");
          inputs[file] = digest;
          const target = shared ? join(root, "build/source-by-digest", digest)
            : join(generation, "source", sourceSnapshotPath(file));
          mkdirSync(join(target, ".."), {recursive: true});
          writeFileSync(target, bytes);
          // Deliberately break immutability to prove reads use retained bytes.
          chmodSync(join(root, file), 0o644);
          writeFileSync(join(root, file), "* edited before emission\n");
        }
        writeFileSync(join(generation, "source-inputs.json"), JSON.stringify(inputs));
        if (shared) writeFileSync(join(generation, "source-shared"), "1\n");
        symlinkSync("../by-input/archive-test", join(root, "build/live"));
        const config = await storeConfig(root, {store, storeModule: `${here}/../tools/osd-store.mjs`});
        for (const [i, include] of ["main", "definitions"].entries()) {
          assert.equal(config.built[files[i]], inputs[files[i]]);
          assert.ok(config.active[files[i]]);
          const expected = store.read("CLAS", "ZARCHIVE", include, "active").source;
          writeFileSync(join(root, files[i]), "* edited after emission\n");
          const answer = goRead(root, config, "CLAS", "ZARCHIVE", include);
          assert.equal(answer.EV_ERROR, "");
          assert.equal(answer.EV_SOURCE, expected);
        }
      } finally {
        if (prior === undefined) delete process.env.OSD_LAYERS; else process.env.OSD_LAYERS = prior;
        if (priorPackage === undefined) delete process.env.OSD_LAYER_PACKAGE; else process.env.OSD_LAYER_PACKAGE = priorPackage;
        rmSync(root, {recursive: true, force: true});
      }
    });
  }

});
