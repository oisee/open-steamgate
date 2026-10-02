// The ADT kernel of a host that runs no system of its own: the child-mode
// parent of test/start.mjs (`npm start`, test/run.mjs, `osd up`), whose ABAP
// system is a child process the supervisor replaces on every activation.
//
// The ADT front (tools/adt-abap-front.mjs, slice 3 option B) has to run where
// the ADT sessions and their locks live, and they must outlive a recycle of
// the serving child: an editor locks, saves, activates and saves again under
// the same handle. So the parent loads the ADT classes itself -- not the
// whole system, which is 1939 modules -- with a database of its
// own in memory that holds only the tables those classes use, and the lock
// server (tools/osd-enq-host.mjs) in this process. The sessions are then as
// long-lived as Node's Sessions were in this process: until it stops.
//
// What is loaded is the closure of the classes the front calls, read off the
// generated modules: every quoted name that is a module of the generation
// (a class, an interface, a table, a lock object). The handler finds its
// route classes by name at run time, and the router names them as literals,
// so they are in the closure too.
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

// the lock table and its lock object are named by the ENQUEUE call and the
// lock server's dictionary read, not by a literal the scan would see
const ROOTS = ["ZCL_OSD_ADT_HANDLER", "ZCL_OSD_ADT_SESSION", "ZCL_OSD_ADT_ROUTER", "ZOSD_ADT_LOCK", "EZOSD_ADT_OBJ"];
const KINDS = new Set(["clas", "intf", "tabl", "enqu", "dtel", "ttyp", "view", "doma", "fugr"]);

/** the module files of the closure, dependencies first */
export function kernelClosure(output, roots = ROOTS) {
  // name -> {main, parts}: the module to import, and every file of the
  // object to read names from (a class's locals are modules of their own)
  const byName = new Map();
  for (const file of readdirSync(output).sort()) {
    const m = /^([^.]+)\.([a-z]+)\.(?:([a-z_]+)\.)?mjs$/.exec(file);
    if (m === null || KINDS.has(m[2]) === false || m[3] === "testclasses") continue;
    const name = decodeURIComponent(m[1]).toUpperCase();
    if (byName.has(name) === false) byName.set(name, {main: [], parts: []});
    if (m[3] === undefined) byName.get(name).main.push(file);
    byName.get(name).parts.push(file);
  }
  // depth first, a name's dependencies before the name: a module may read
  // another's constants while it loads (zcl_ajson's class constructor reads
  // CL_ABAP_CHAR_UTILITIES). A cycle is cut where it closes.
  const seen = new Set();
  const files = [];
  const deps = (name) => {
    const found = new Set();
    for (const file of byName.get(name).parts) {
      const text = readFileSync(join(output, file), "utf8");
      for (const match of text.matchAll(/['"`]([A-Za-z0-9_\/#%]{2,40})['"`]/g)) {
        let decoded;
        try { decoded = decodeURIComponent(match[1]).toUpperCase(); } catch { continue; }
        if (decoded !== name && byName.has(decoded)) found.add(decoded);
      }
    }
    return [...found].sort();
  };
  const visit = (name) => {
    if (seen.has(name) || byName.has(name) === false) return;
    seen.add(name);
    for (const dep of deps(name)) visit(dep);
    files.push(...byName.get(name).main);
  };
  for (const root of roots) visit(root);
  return files;
}

/** the CREATE TABLE statements of the generation for these tables, as
 *  init.mjs gives them to SQLite */
function tableStatements(output, tables) {
  const init = readFileSync(join(output, "init.mjs"), "utf8");
  const out = [];
  for (const match of init.matchAll(/sqlite\.push\(`(CREATE TABLE '([a-z0-9_\/]+)'[^`]*)`\);/g)) {
    if (tables.has(match[2].toUpperCase())) out.push(match[1]);
  }
  return out;
}

/** one hash over what the kernel loads from a generation: the closure's
 *  modules (every part of each object) and its tables' statements */
export function closureHash(output) {
  const hash = createHash("sha256");
  const files = kernelClosure(output);
  const stems = new Set(files.map((f) => f.split(".")[0]));
  for (const file of readdirSync(output).sort()) {
    if (stems.has(file.split(".")[0]) && file.endsWith(".mjs") && file.includes(".testclasses.") === false) {
      hash.update(file).update("\0").update(readFileSync(join(output, file))).update("\0");
    }
  }
  const tables = new Set(files.filter((f) => f.includes(".tabl.")).map((f) => decodeURIComponent(f.split(".")[0]).toUpperCase()));
  for (const statement of tableStatements(output, tables)) hash.update(statement).update("\0");
  return hash.digest("hex").slice(0, 16);
}

/**
 * Whether the kernel this process loaded is still the generation's: the
 * kernel is loaded once, at start, and a generation that changes a class of
 * the front or one of its tables recycles the serving child but not this
 * process. Asked per request, computed once per generation (the key).
 * When stale, it says so once per generation on the console, naming the
 * restart; it never refuses, because the editor that would fix the front
 * goes through the front.
 * @param {object} options
 * @param {string} options.output the generation's folder, as it is now
 * @param {string} options.loaded the closureHash the kernel was loaded from
 * @param {Function} options.generation () => the live generation's key
 * @param {Function} [options.log] the one line, console.error by default
 * @returns {() => boolean} stale
 */
export function kernelFreshness({output, loaded, generation, log = console.error}) {
  const known = new Map();
  return () => {
    const key = String(generation() ?? "");
    if (known.has(key) === false) {
      let stale = false;
      try {
        stale = closureHash(output) !== loaded;
      } catch {
        // a generation half written or gone: not a verdict on the front
        return false;
      }
      known.set(key, stale);
      if (stale) {
        log(`ADT front: generation ${key || "?"} changes the ADT classes or their tables, and this host still runs ` +
          "the ADT kernel it started with; restart the host (npm start / osd up) to load them. Requests are served by the old front meanwhile.");
      }
    }
    return known.get(key);
  };
}

/**
 * Load the ADT kernel into this process: the ABAP runtime, a database in
 * memory with the closure's tables, the identity, the lock server and the
 * STORE destination, then the closure's modules.
 * @param {object} options
 * @param {string} options.output the generation's folder (output/)
 * @param {object} options.setup test/setup.mjs, for installStoreDestination
 * @returns {Promise<{handler: Function, modules: number, tables: string[], hash: string}>}
 */
export async function loadAdtKernel({output, setup}) {
  if (globalThis.abap !== undefined) throw new Error("the ADT kernel loads only into a process with no ABAP system");
  if (existsSync(join(output, "init.mjs")) === false) throw new Error(`no generation at ${output}`);
  const files = kernelClosure(output);
  const hash = closureHash(output);
  const runtime = (await import("@abaplint/runtime")).default;
  globalThis.abap = new runtime.ABAP();
  // the sentinel a second ABAP boot in this process checks (Data#boot): a
  // whole-system init.mjs would install another runtime over this one and
  // take the sessions and locks with it
  globalThis.__osdAdtKernel = {output, hash};
  const {SQLiteDatabaseClient} = await import("@abaplint/database-sqlite");
  const {installTrim} = await import("./sql-literals.mjs");
  const {bootIdentity} = await import("./osd-identity.mjs");
  const {installEnq} = await import("./osd-enq-host.mjs");
  bootIdentity(abap, process.env);
  const db = installTrim(new SQLiteDatabaseClient());
  await db.connect();
  abap.context.databaseConnections["DEFAULT"] = db;
  const tables = new Set(files.filter((f) => f.includes(".tabl.")).map((f) => decodeURIComponent(f.split(".")[0]).toUpperCase()));
  await db.execute(tableStatements(output, tables));
  // before the modules: open-abap-core's KERNEL_LOCK assigns itself on load
  // and the lock server's slot keeps this one (tools/osd-enq-host.mjs)
  installEnq(abap);
  setup.installStoreDestination(abap);
  for (const file of files) await import(pathToFileURL(join(output, file)).href);
  return {handler: abap.Classes.ZCL_OSD_ADT_HANDLER, modules: files.length, tables: [...tables].sort(), hash};
}
