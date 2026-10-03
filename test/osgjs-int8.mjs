// A4H 7.58 oracle: run the real folder Unit entry point with the fixed runtime.
// Like the upstream-pending cases in jobs-e2e.mjs, keep this pending until
// the pinned runtime carries the fix. Opt in to prove a local upstream build.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const upstreamTest = process.env.OSD_INT8_UPSTREAM === "1" ? it : it.skip;

describe("osgjs int8 byte conversion oracle", function () {
  this.timeout(300000);
  upstreamTest("ANOMALY-2026-10-03-int8-hex-conversion: 10 SUCCESS awaits runtime fix", () => {
    mkdirSync(join(root, ".local"), {recursive: true});
    const input = mkdtempSync(join(root, ".local/osgjs-int8-"));
    try {
      for (const name of ["int8x", "int8y"]) {
        const fixtures = join(root, "test/fixtures/osgjs-unit-int8");
        copyFileSync(join(fixtures, `${name}.abap`), join(input, `zcl_abapiti_${name}.clas.abap`));
        copyFileSync(join(fixtures, `${name}-testclasses.abap`), join(input, `zcl_abapiti_${name}.clas.testclasses.abap`));
      }
      const run = spawnSync("npm", ["run", "--silent", "osgjs:unit", "--", input, "--json"], {
        cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 8e6,
      });
      assert.equal(run.error, undefined, String(run.error));
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout);
      assert.deepEqual(result.totals, {success: 10, failure: 0, not_compiled: 0, error: 0, tests: 10});
      assert.equal(result.classes, 2);
      assert.equal(result.compiled, 2);
    } finally {
      rmSync(input, {recursive: true, force: true});
    }
  });
});
