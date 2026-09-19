// A directory someone can copy to a machine with nothing installed.
//
//   bun scripts/make-release.mjs [outdir]
//
// What goes in, and why each part is there — every line of this was learned
// by deploying to a second machine and watching it fail (2026-09-16):
//
//   osd            the Bun binary. Self-contained: it hands the generated
//                  code its own @abaplint/runtime through a plugin, so it
//                  needs no node_modules at all.
//   osd-sea        a Node single executable (Node 26.9 inside).
//   osd.mjs        the bundle, for the private ./node or a system Node >= 22.
//   node/          a private Node, because a machine's own may be too old.
//   node_modules/  the runtime closure — @abaplint/runtime, its database
//                  adapter, sql.js. The NODE hosts need it: generated code
//                  imports "@abaplint/runtime" by name and test/setup.mjs
//                  imports the adapter, and neither is bundled outside Bun.
//                  Leaving it out is the failure that looks like the system
//                  working: the launchpad serves, every app answers 503.
//   src/ gen/ data/ webapp/ test/ tools/ abap_transpile.json
//                  OSD's own content, which is not yet a pack (backlog B.11)
//   packs/         the content packs, read at start (backlog E.2)
//   build/         one prebuilt generation, so nothing transpiles to serve
//   output         the link the runtime loads the generation through
import {cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename, join, resolve} from "node:path";

const root = resolve(import.meta.dir ?? process.cwd(), "..");
const out = resolve(process.argv[2] ?? join(root, ".local", "release"));
const say = (m) => console.log(`  ${m}`);

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

// the tree's own content, minus everything a machine does not need to serve
const TREE = ["src", "gen", "data", "webapp", "test", "tools", "bin", "scripts", "abap_transpile.json", "package.json", "abaplint.jsonc"];
for (const entry of TREE) {
  if (existsSync(join(root, entry))) {
    cpSync(join(root, entry), join(out, entry), {recursive: true, dereference: true, filter: (p) => basename(p) !== "e2e"});
  }
}
say(`content: ${TREE.filter((e) => existsSync(join(root, e))).join(", ")}`);

// the hosts
for (const artefact of ["osd", "osd-sea"]) {
  if (existsSync(join(root, "build", artefact))) {
    cpSync(join(root, "build", artefact), join(out, artefact));
    say(`host: ${artefact}`);
  }
}
if (existsSync(join(root, "build", "osd-node", "osd.mjs"))) {
  cpSync(join(root, "build", "osd-node", "osd.mjs"), join(out, "osd.mjs"));
  say("host: osd.mjs (the bundle)");
}
const node = process.env.OSD_NODE_DIR ?? join(root, ".local", "node", "node-v26.9.0-linux-x64");
if (existsSync(node)) {
  cpSync(node, join(out, "node"), {recursive: true, dereference: true});
  say(`host: a private ${execFileSync(join(node, "bin", "node"), ["--version"], {encoding: "utf8"}).trim()}`);
}

// the closure the Node hosts resolve from disk
mkdirSync(join(out, "node_modules", "@abaplint"), {recursive: true});
for (const pkg of ["@abaplint/runtime", "@abaplint/database-sqlite", "sql.js", "temporal-polyfill"]) {
  const from = join(root, "node_modules", pkg);
  if (existsSync(from)) {
    cpSync(from, join(out, "node_modules", pkg), {recursive: true, dereference: true});
  }
}
say("runtime closure for the Node hosts: @abaplint/runtime, @abaplint/database-sqlite, sql.js");

// the packs: the same places a served system reads them from, the tree's
// packs/ first and then whatever OSD_PACKS names, a pack found twice kept
// from the first place (tools/osd-packs.mjs). A fetched folder inside a
// pack (packs/o4d/upstream/) is a directory on disk and travels with it.
// It used to copy .local/packs alone, which shipped an older demo than the
// tree served (2026-09-17).
const places = [join(root, "packs"), ...(process.env.OSD_PACKS ?? "").split(/[:;]/).map((s) => s.trim()).filter((s) => s !== "").map((s) => resolve(root, s))];
const carried = new Set();
for (const place of places) {
  if (existsSync(place) === false) {
    continue;
  }
  for (const entry of readdirSync(place).sort()) {
    if (existsSync(join(place, entry, "osd-pack.json")) === false || carried.has(entry)) {
      continue;
    }
    cpSync(join(place, entry), join(out, "packs", entry), {recursive: true, dereference: true});
    carried.add(entry);
    say(`pack ${entry}: ${join(place, entry)}`);
  }
}

// one generation, and the link the runtime loads it through
const live = readlinkSync(join(root, "build", "live"));
mkdirSync(join(out, "build", "by-input"), {recursive: true});
cpSync(join(root, "build", live), join(out, "build", live), {recursive: true});
symlinkSync(live, join(out, "build", "live"));
symlinkSync(join("build", "live", "output"), join(out, "output"));
say(`generation: ${basename(live)}`);

// **The commit the release was built from, written down here because the
// release is the one place that cannot work it out.**
//
// `/sap/bc/adt/core/http/build` answers `commit` by asking git, and a
// release directory is not a checkout -- so a deployment reported
// `"unknown"` and the rule the two targets are supposed to share ("the i7
// follows Pages, both show the same commit", docs/backlog.md) could not be
// checked on the half that matters. It was not checked for weeks, because
// the field existed and read like a measurement.
const commit = (process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"],
  {cwd: root, encoding: "utf8"}).trim());
writeFileSync(join(out, "release.json"), `${JSON.stringify({
  commit,
  generation: basename(live),
  builtAt: new Date().toISOString(),
}, undefined, 2)}\n`);
say(`commit: ${commit.slice(0, 7)}`);

writeFileSync(join(out, "run.sh"), `#!/bin/sh
# OSD on a machine that has none of this installed.
#
#   ./run.sh          the Bun binary       (needs nothing)
#   ./run.sh sea      a Node single executable
#   ./run.sh node     the bundle on the private Node in ./node
#   ./run.sh system   the bundle on the system node (Node 22 or newer)
#
# Then open http://<this machine>:3030/ — the launchpad, with the demos on it.
set -e
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
export OSD_PACKS="\${OSD_PACKS:-$here/packs}"
export STG_PORT="\${STG_PORT:-3030}"
export STG_DB_PATH="\${STG_DB_PATH:-$here/.osd.sqlite}"
# work processes: one per core up to four, unless told otherwise (backlog B.12)
cores=$(nproc 2>/dev/null || echo 1)
export OSD_WORKERS="\${OSD_WORKERS:-$([ "$cores" -gt 4 ] && echo 4 || echo "$cores")}"
case "\${1:-bun}" in
  bun)    exec ./osd up ;;
  sea)    exec ./osd-sea up ;;
  node)   exec ./node/bin/node ./osd.mjs up ;;
  system) exec node ./osd.mjs up ;;
  *) echo "usage: run.sh [bun|sea|node|system]"; exit 2 ;;
esac
`);
execFileSync("chmod", ["+x", join(out, "run.sh")]);
const size = execFileSync("du", ["-sh", out], {encoding: "utf8"}).split(/\s+/)[0];
console.log(`${out}: ${size}`);
