import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, it} from "mocha";

const here = resolve(new URL(".", import.meta.url).pathname);

function buildFixtureWithHostileConfig() {
  const home = join(tmpdir(), `osgo-store-hostile-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(home, {recursive: true});
  writeFileSync(join(home, ".gitconfig"), [
    "[commit]",
    "\tgpgsign = true",
    "[core]",
    "\tautocrlf = true",
    "[init]",
    "\tdefaultBranch = hostile",
    "\ttemplateDir = ",
  ].join("\n"));
  const env = {...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1"};
  const result = spawnSync("node", [join(here, "../tools/osgo-store-fixture.mjs")], {env, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe("OSGo store fixture hermeticity", () => {
  it("records identical goldens despite hostile global Git configuration", () => {
    const first = buildFixtureWithHostileConfig();
    const second = buildFixtureWithHostileConfig();
    const tree = root => execFileSync("git", ["rev-parse", "HEAD^{tree}"], {cwd: root, encoding: "utf8"}).trim();
    assert.equal(tree(first), tree(second));
    const check = spawnSync("node", [join(here, "../tools/osgo-store-goldens.mjs"), "--check"],
      {cwd: join(here, ".."), encoding: "utf8"});
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.notEqual(readFileSync(join(here, "fixtures/osgo-store/destination-golden.json"), "utf8"), "");
  });
});
