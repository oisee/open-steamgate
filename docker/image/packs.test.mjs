import assert from "node:assert/strict";
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
