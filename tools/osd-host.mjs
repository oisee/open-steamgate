// What the process is running in: Node over a checkout, or one compiled
// binary (bin/osd.mjs through scripts/build-binary.mjs, SP4).
//
// Inside a compiled Bun binary every bundled module has the same
// import.meta.url (file:///$bunfs/root/<binary>), process.execPath is the
// binary itself, and no file of tools/ exists on disk. So a tool that starts
// another tool by path — the supervisor its child, the builder its
// generators, the unit runner its detached run — asks here for the command
// instead, and gets `<binary> <mode> …` when compiled and `node <path> …`
// when not. bin/osd.mjs dispatches the modes.
//
// The transpiler and the core it was built against are the other thing a
// binary must hand over deliberately: bundled, they are static imports of
// the entry, registered here, and tools/osd-transpile.mjs asks before it
// resolves them from a node_modules that is not there.
import {basename} from "node:path";

export const compiled = typeof Bun !== "undefined" && import.meta.url.startsWith("file:///$bunfs/");

// How this very program is started again, as [command, ...args]: set by
// bin/osd.mjs for whichever host it finds itself on (a Bun binary, a Node
// single executable, a bundle under node, the source under node), so a
// tool that starts a tool never has to know. Unset means the plain
// checkout, where a tool is a file and node runs it.
function self() {
  const me = process.env.OSD_SELF;
  return me === undefined || me === "" ? undefined : JSON.parse(me);
}
export function hosted() {
  return self() !== undefined;
}

// [command, ...args] that runs a tool script with arguments
export function toolCommand(script, args = []) {
  const me = self();
  return me !== undefined ? [...me, "gen", basename(script), ...args] : [process.execPath, script, ...args];
}

// the serving runtime (tools/osd-serve.mjs) as a child of the supervisor
export function serveCommand(child) {
  const me = self();
  return me !== undefined ? [...me, "serve"] : [process.execPath, child];
}

// a detached ABAP Unit run (tools/osd-unit.mjs main)
export function unitCommand(script, args) {
  const me = self();
  return me !== undefined ? [...me, "unit", ...args] : [process.execPath, script, ...args];
}

let modules;
export function setHostModules(m) {
  modules = m;
}
export function hostModules() {
  return modules;
}
