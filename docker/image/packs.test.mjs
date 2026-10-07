import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {test} from "node:test";
import {resolve} from "node:path";
import {imagePacks} from "./packs.mjs";

const root = resolve(import.meta.dirname, "../..");

test("the core image selects no checkout packs", () => {
  assert.deepEqual(imagePacks(root), []);
});

test("the showcase image selects its three named pack layers", () => {
  assert.deepEqual(imagePacks(root, "o4d,zork,zvdb").map((pack) => pack.name), ["o4d", "zork", "zvdb"]);
  assert.throws(() => imagePacks(root, "o4d,missing"), /Unknown OSD_IMAGE_PACKS pack: missing/);
  assert.throws(() => imagePacks(root, "zork,zork"), /Duplicate OSD_IMAGE_PACKS/);
});

// Model the core runtime dependency boundary without hiding installed packages.
test("core/showcase pack validation does not load the optional ABAP compiler", () => {
  const scratch = mkdtempSync(join(tmpdir(), "osd-core-loader-"));
  try {
    const loader = join(scratch, "no-core.mjs");
    writeFileSync(loader, `export function resolve(specifier, context, next) {
      if (specifier === '@abaplint/core') throw new Error('core image has no compiler');
      return next(specifier, context);
    }`);
    const child = spawnSync(process.execPath, ['--loader', loader, '--input-type=module', '-e',
      `const {imagePacks} = await import(${JSON.stringify(new URL('./packs.mjs', import.meta.url).href)});
       imagePacks(${JSON.stringify(root)}); imagePacks(${JSON.stringify(root)}, 'o4d,zork,zvdb');`], {encoding: 'utf8'});
    assert.equal(child.status, 0, child.stdout + child.stderr);
  } finally {rmSync(scratch, {recursive: true, force: true});}
});
