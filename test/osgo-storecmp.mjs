import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

describe("OSGo store command parity", function() {
  this.timeout(120000);
  it("matches every read and write on the store fixture, including scalar keys", () => {
    const result = spawnSync(process.execPath, ["tools/gogen/storecmp.mjs", "--root", "tools/gogen/testdata-store/tree", "--tools", "."],
      {cwd: root, encoding: "utf8", env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/osgo-gocache"}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const kind of ["reads", "writes"]) {
      const match = result.stdout.match(new RegExp(`${kind}: (\\d+) of (\\d+) answers the same`));
      assert.ok(match, result.stdout);
      assert.equal(match[1], match[2], result.stdout);
      assert.ok(Number(match[1]) > 0);
    }
  });
});
