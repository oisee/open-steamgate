import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
describe("Go compiler client with real osd", function () {
  this.timeout(120000);
  it("checks clean and invalid ABAP and refuses a hash lie", function () {
    const probe = spawnSync("go", ["version"], {encoding: "utf8"});
    if (probe.error?.code === "ENOENT") {
      console.warn("Skipping Go compiler integration: go is absent");
      this.skip();
    }
    assert.equal(probe.status, 0, probe.stderr);
    const dir = mkdtempSync(join(tmpdir(), "osgo-compiler-"));
    try {
      const launcher = join(dir, "osd");
      // Discovery is binary-only; this launcher stands in for build/osd and runs the same entry point.
      writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("bin/osd.mjs"))} "$@"\n`, {mode: 0o700});
      const result = spawnSync("go", ["test", "./compiler", "-count=1", "-v", "-timeout=60s"], {
        cwd: resolve("tools/gogen/go"), encoding: "utf8", timeout: 90000,
        env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/osgo-gocache", OSGO_COMPILER_INTEGRATION: launcher},
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      for (const name of ["clean", "syntax", "hash-lie"]) assert.match(result.stdout, new RegExp(`--- PASS: TestRealSidecar/${name}`));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
