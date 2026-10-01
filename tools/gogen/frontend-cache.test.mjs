import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {frontendInputs, readFrontendCache, writeFrontendCache} from "./frontend-cache.mjs";

test("every input category changes the frontend key", () => {
  const home = mkdtempSync(join(tmpdir(), "gogen-cache-key-"));
  const fixture = join(home, "src");
  const files = ["src/example.clas.abap", "src/example.clas.testclasses.abap", "src/example.tabl.xml",
    "tools/gogen/frontend.mjs", "tools/gogen/emit-go.mjs", "tools/gogen/go/abap/abap.go",
    "tools/osd-amc.mjs", "test/seed.mjs", "data/rows.tabu.json", "packs/example/data/rows.tabu.json",
    "abap_transpile.json", "package-lock.json", "libs.lock.json"];
  try {
    for (const file of files) {
      mkdirSync(join(home, file, ".."), {recursive: true});
      writeFileSync(join(home, file), "first");
    }
    const options = {home, folders: [fixture], owners: ["EXAMPLE"], fixture: true, unlayered: false};
    const key = () => frontendInputs(options).key;
    const baseline = key();
    for (const file of files) {
      writeFileSync(join(home, file), "changed");
      assert.notEqual(key(), baseline, file);
      writeFileSync(join(home, file), "first");
    }
    writeFileSync(join(fixture, "new.clas.abap"), "new");
    assert.notEqual(key(), baseline, "new registry object");
    assert.notEqual(frontendInputs({...options, owners: ["OTHER"]}).key, key(), "selection");
    assert.notEqual(frontendInputs({...options, folders: [fixture, join(home, "other")]}).key, key(), "layer order");
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test("a snapshot is complete before it can be read", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-cache-atomic-"));
  try {
    const go = join(dir, "go");
    mkdirSync(join(go, "cmd", "unit"), {recursive: true});
    writeFileSync(join(go, "cmd", "unit", "zz_generated.go"), "package main\n");
    const root = join(dir, "cache");
    assert.equal(readFrontendCache(root, "key", join(dir, "copy")), null);
    writeFrontendCache(root, "key", go, {rows: [{status: "READY"}], layers: {}});
    writeFrontendCache(root, "key", go, {rows: [], layers: {}});
    assert.deepEqual(readFrontendCache(root, "key", join(dir, "copy")).rows, [{status: "READY"}]);
    assert.equal(readFileSync(join(dir, "copy", "cmd", "unit", "zz_generated.go"), "utf8"), "package main\n");
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
