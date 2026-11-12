// The accumulation step of the closure (H5c round 4), beside the loop --
// this file is its own package so the size budget stays honest, the way
// tools/hana-closure-stubs.mjs is. Three facts of the island build live
// here, none of them the loop's business:
//
// - the island is the UNION of the seed dump and every dump so far (bed run
//   5: a merge per dump REPLACED gen/hana-src, iteration 3 validated a tree
//   without the service, and the fixed point was false). Every dump is
//   converted once, into .local/hana-closure/layers-<NNN>/ (the converter is
//   OSD_HANA_CONVERTER, an external script, so it starts through
//   scriptCommandIn like every spawn of another tool), and hana-src-gen is
//   called with ALL the layers dirs -- the union, later wins per object.
//   gen/hana-ddic accumulates by hana-ddic-gen's own write mode (per-file
//   overlays, never clears).
// - the island's object count (classes+interfaces+tables) is the run's
//   control on the merges: after each merge it must not be below the
//   previous iteration's -- a shrink means objects were lost, and a fixed
//   point over a shrunken island is false.
// - a "fixed point" needs a build that succeeded (bed run 4's control:
//   osd-build FAILED on a generator step with zero transpiler findings, and
//   the loop read that as convergence): the build runs before the
//   declaration, and a non-zero exit with no findings aborts with its
//   FAILED line.
import {existsSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {basename, join} from "node:path";
import {scriptCommandIn, toolCommandIn} from "./osd-host.mjs";
import {parseFindings} from "./hana-closure.mjs";

const TOOLS = fileURLToPath(new URL(".", import.meta.url));

/** the island's objects, counted: classes and interfaces off the
 *  gen/hana-src class files (one object each, though a converter layer
 *  carries .clas.abap, .clas.xml and the locals includes beside it), tables
 *  off gen/hana-ddic's *.tabl.xml. The shrink assert's unit and the count
 *  on every iteration line. Pure. */
export function islandObjectCount(root) {
  const names = {clas: new Set(), intf: new Set(), tabl: new Set()};
  const walk = (dir, onFile) => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), onFile);
      else onFile(entry.name);
    }
  };
  walk(join(root, "gen", "hana-src"), (name) => {
    const clas = /^([^/]+)\.clas\.abap$/.exec(name);
    if (clas !== null) return void names.clas.add(clas[1]);
    const intf = /^([^/]+)\.intf\.abap$/.exec(name);
    if (intf !== null) names.intf.add(intf[1]);
  });
  walk(join(root, "gen", "hana-ddic"), (name) => {
    const tabl = /^([^/]+)\.tabl\.xml$/.exec(name);
    if (tabl !== null) names.tabl.add(tabl[1]);
  });
  return {clas: names.clas.size, intf: names.intf.size, tabl: names.tabl.size,
    total: names.clas.size + names.intf.size + names.tabl.size};
}

/** one dump into its layers dir: the converter's --out must be empty (it
 *  refuses anything else), so a retry starts clean; the argv is the real
 *  converter's: <dump> --out <dir> --system <prefix>. Throws when
 *  OSD_HANA_CONVERTER is not configured or the converter fails. */
export function convertDump({root, env, dump, system, dir, say}) {
  const converter = env.OSD_HANA_CONVERTER;
  if (converter === undefined || converter === "") {
    throw new Error("hana-closure: OSD_HANA_CONVERTER must name the dump->layers converter (a path to dump-to-layers.mjs): every merge converts its dump into .local/hana-closure/layers-<NNN> first");
  }
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(join(dir, ".."), {recursive: true});
  const [command, ...argv] = scriptCommandIn(env, converter, [dump, "--out", dir, "--system", system]);
  say(`layers: ${basename(converter)} ${dump} -> ${dir}`);
  const child = spawnSync(command, argv, {cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024});
  if (child.status !== 0) {
    const tail = [child.stdout, child.stderr].filter(Boolean).join("\n").slice(-2000);
    throw new Error(`hana-closure: the converter exited ${child.status ?? "on a signal"} for ${dump}${tail === "" ? "" : `:\n${tail}`}`);
  }
}

/** the layers dirs of this walk, oldest first, converting the current dump
 *  first when it has none yet -- the union hana-src-gen merges, in the
 *  order the dumps arrived, so the later dump's copy of an object wins.
 *  state.layers (an array of {dump, dir}) remembers them across runs; a
 *  dir whose plan.json is gone is converted again in place. Mutates
 *  state; the caller saves it. */
export function ensureLayers({root, state, dump, system, env, say}) {
  state.layers ??= [];
  const known = state.layers.find((l) => l.dump === dump);
  const dir = known?.dir ?? join(root, ".local", "hana-closure", `layers-${String(state.layers.length + 1).padStart(3, "0")}`);
  if (known === undefined || existsSync(join(dir, "plan.json")) === false) {
    convertDump({root, env, dump, system, dir, say});
    if (known === undefined) state.layers.push({dump, dir});
  }
  return state.layers.map((l) => l.dir);
}

/** the positive control's verdict: the build's exit and log to a decision.
 *  Exit 0 stands; non-zero with findings in the log is "exit 1 with
 *  findings only", the walk's ordinary material; non-zero with NO findings
 *  is the abort -- bed run 4's generator crash, which the loop used to
 *  read as convergence. Throws with the build's FAILED line. Pure. */
export function buildVerdict(status, output) {
  if (status === 0) return {status, findings: 0};
  const findings = parseFindings(output);
  if (findings.length > 0) return {status, findings: findings.length};
  const text = String(output ?? "");
  const failed = text.split("\n").find((line) => /FAILED/.test(line)) ??
    text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? `exit ${status}`;
  throw new Error(`hana-closure: the build failed with no findings -- not a fixed point: ${failed}`);
}

/** the positive control itself: the tree's own build
 *  (tools/osd-build.mjs) before the loop declares a fixed point, through
 *  toolCommandIn like every tool of this tree. Returns the verdict (with
 *  the finding count for the report line); throws through buildVerdict. */
export function buildCheck({root, env, say}) {
  const [command, ...argv] = toolCommandIn(env, join(TOOLS, "osd-build.mjs"), []);
  say("build: osd-build.mjs (the fixed point's positive control)");
  const child = spawnSync(command, argv, {cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024});
  return buildVerdict(child.status === null ? -1 : child.status, [child.stdout, child.stderr].filter(Boolean).join("\n"));
}
