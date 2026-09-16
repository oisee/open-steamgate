#!/bin/sh
# Is a Node single executable a host for OSD? Six phases, fail fast, each one
# printed before it runs, because a silent minute is indistinguishable from a
# hang (SP4's control group, docs/bun-spike.md part four).
#
#   scripts/sea-speedrun.sh [path-to-node]
#
# The question underneath: a SEA's injected main could not import() a file
# outside the executable (Node 26.3: ERR_UNKNOWN_BUILTIN_MODULE out of
# loadBuiltinModuleForEmbedder), and every generation OSD builds is exactly
# such a file. Node 26.9 mounts bundled assets as a virtual file system and
# runs an ESM main through the ordinary loader, which may remove the need for
# the vm.Script hand-off. This says which, in one run.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
node=${1:-node}
work=$root/.local/sea-speedrun
rm -rf "$work"
mkdir -p "$work"

say() { printf '\n[%s] %s\n' "$1" "$2"; }

say 1/6 "environment"
"$node" --version
printf '  vm.USE_MAIN_CONTEXT_DEFAULT_LOADER: '
"$node" -e 'console.log(typeof require("node:vm").constants.USE_MAIN_CONTEXT_DEFAULT_LOADER)'

say 2/6 "a main that reports which entry path it is on, and imports an external module"
cat > "$work/main.mjs" <<'EOF'
import {pathToFileURL} from "node:url";
const inVfs = import.meta.filename !== process.execPath;
console.log(`  node ${process.version}`);
console.log(`  import.meta.filename !== process.execPath: ${inVfs}  (true = the VFS entry path)`);
console.log(`  import.meta.url: ${import.meta.url}`);
const target = pathToFileURL(process.argv[2]).href;
try {
  const m = await import(target);
  console.log(`  plain import: ${m.answer()}`);
  process.exitCode = 0;
} catch (error) {
  console.log(`  plain import FAILED: ${error.code}`);
  console.log("  " + String(error.stack).split("\n").filter((l) => /at /.test(l)).slice(0, 3).map((l) => l.trim()).join("\n  "));
  // the hand-off: one import through the default ESM loader
  const {Script, constants} = await import("node:vm");
  try {
    const m = await new Script(`import(${JSON.stringify(target)})`, {importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();
    console.log(`  vm.Script hand-off: ${m.answer()}`);
    process.exitCode = 3;
  } catch (second) {
    console.log(`  vm.Script hand-off FAILED: ${second.code}`);
    process.exitCode = 1;
  }
}
EOF

say 3/6 "the module it must load: created after the build, top-level await, a relative dependency, a namespaced name"
mkdir -p "$work/gen"
echo 'export const dep = () => "relative dependency";' > "$work/gen/child.mjs"
cat > "$work/gen/%23iwbep%23init.clas.mjs" <<'EOF'
const {dep} = await import("./child.mjs");
const {createHash} = await import("node:crypto");
export const answer = () => `external ESM ran, ${dep()}, sha ${createHash("sha256").update("x").digest("hex").slice(0, 8)}`;
EOF

say 4/6 "build the single executable (ESM main, useVfs)"
cat > "$work/sea.json" <<EOF
{"main": "$work/main.mjs", "output": "$work/sea", "mainFormat": "module", "useVfs": true, "disableExperimentalSEAWarning": true}
EOF
"$node" --build-sea "$work/sea.json" >/dev/null
ls -l "$work/sea" | awk '{printf "  %.0f MB\n", $5/1e6}'

say 5/6 "run it against the external module"
set +e
"$work/sea" "$work/gen/%23iwbep%23init.clas.mjs" 2>&1 | grep -v ExperimentalWarning
verdict=$?
code=$("$work/sea" "$work/gen/%23iwbep%23init.clas.mjs" >/dev/null 2>&1; echo $?)
set -e
case $code in
  0) printf '\n  VERDICT: a plain import works. No hand-off needed; SEA is a host like any other.\n' ;;
  3) printf '\n  VERDICT: the plain import is refused, the vm.Script hand-off works. One bridge at the\n           SEA boundary (about ten lines) makes SEA a host.\n' ;;
  *) printf '\n  VERDICT: neither works on this Node. SEA cannot load a generation here.\n' ;;
esac

say 6/6 "the OSD suite against a SEA of the real entry, if one is built"
if [ -x "$root/build/osd-sea" ]; then
  cd "$root" && OSD_BINARY='["build/osd-sea"]' timeout 600 npx mocha test/osd-binary.mjs 2>&1 | tail -12
else
  echo "  build/osd-sea is not built: bun scripts/build-sea.mjs sea"
fi
exit $code
