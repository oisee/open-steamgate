// The classrun of OSD: ADT's own F9, "Run as ABAP Application (Console)"
// (`POST /sap/bc/adt/oo/classrun/<name>`, tools/adt-facade.mjs), served by
// instantiating a class that implements IF_OO_ADT_CLASSRUN and calling
// its MAIN with an `out` implementing IF_OO_ADT_CLASSRUN_OUT.
//
// Both interfaces are open-abap-core's own (src/classrun/if_oo_adt_classrun*
// .intf.abap), already pulled in by abap_transpile.json as a library --
// they were not missing, so nothing is added clean-room here. This module
// only implements the OUT side (src/classrun/zcl_osd_classrun_out.clas.abap)
// and runs a class against it.
//
// Unlike an ABAP Unit run (tools/osd-unit.mjs), which spawns a detached
// child with its own throwaway database because a test's writes must never
// land in the rows the application serves, a classrun IS a run of the
// application: it shares the one connection every request runs against, so
// it is wrapped the same way a request is -- a dialog step
// (tools/osd-dialog-step.mjs), commit when the work is done, rollback when
// it ends in an exception nobody declared, and the work-process lock in
// between so a classrun never races a request or another classrun. A dump
// is recorded exactly like a runtime dump (tools/osd-dumps.mjs), not
// swallowed: the console output already written survives the rollback
// because it lives in the OUT object's own memory, not in a row.
import {join} from "node:path";
import {existsSync} from "node:fs";
import {dialogStep} from "./osd-dialog-step.mjs";
import {dumpOf} from "./osd-where.mjs";
import {persistDump} from "./osd-dumps.mjs";
import {NotFound} from "./osd-store.mjs";

// the same shape osd-tran-registry.mjs already reads a contract by: a plain
// scan of the main source rather than a parse, which is enough to answer
// "does this class implement IF_OO_ADT_CLASSRUN" without paying for the
// abaplint registry when only the class name is known (the VS Code
// extension's own F8 dispatch, lib.js implementsClassrun, runs the same
// regex over the editor's buffer, not necessarily saved)
const CLASSRUN_INTERFACE = /^\s*INTERFACES\s+if_oo_adt_classrun\b/im;

export function implementsClassrun(source) {
  return CLASSRUN_INTERFACE.test(String(source ?? ""));
}

export class NotClassrun extends Error {
  constructor(name) {
    super(`${name} does not implement IF_OO_ADT_CLASSRUN`);
    this.code = "NOT_CLASSRUN";
  }
}

export class NotTranspiled extends Error {
  constructor() {
    super("there is no output/ yet: a classrun runs the transpiled class, so transpile first");
    this.code = "NOT_TRANSPILED";
  }
}

// abapGit writes a namespace as #, an import specifier needs it encoded --
// the same rule tools/osd-unit.mjs applies to a test class's own module
function specifier(file) {
  return "file://" + file.replaceAll("#", "%23");
}

// A short, bounded retry for a genuinely transient ENOENT right after a
// build (a filesystem that has not caught up with a rename yet, measured
// occasionally on this worktree under WSL2). This does NOT paper over the
// bigger fact underneath it, the one tools/osd-serve.mjs's own header names
// for the whole project: **Node pins a module graph for the life of a
// process.** `output/` is two symlink hops from the tree root
// (osd-build.mjs `switchTo`: `output -> build/live/output`, `build/live ->
// by-input/<hash>`), and once *anything* under `output/` has been imported
// once, this process's own module graph is the one it answers from --
// activating a class and classrunning it in the SAME process a moment
// later is exactly the scenario the serving runtime solves by recycling
// into a NEW process. A retry fixes the disk catching up; it cannot fix a
// process that already loaded the old graph -- which is exactly why a
// served (child) runtime, recycled after every activation, does not have
// this problem the way the façade's own inline connection can: `runClassrun`
// below runs in whichever process holds the live connection, and in child
// mode that is a process the last activation just replaced. In practice the
// residual risk is only "write, activate and classrun the same class within
// one still-running inline process" (this file's own tests build the
// fixture that dumps this way at transpile time instead, for exactly this
// reason); a classrun of anything that was already part of the tree when
// the process started is unaffected.
async function importFresh(path, deadline = Date.now() + 500) {
  for (;;) {
    try {
      return await import(specifier(path));
    } catch (error) {
      const retryable = error?.code === "ERR_MODULE_NOT_FOUND" || /ENOENT/.test(String(error?.message ?? ""));
      if (retryable === false || Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

// The raw run, needing nothing but the tree root and the class name: no
// ObjectStore, so this is what a served (child) runtime's own door
// (tools/osd-serve.mjs `/osd/classrun`) calls directly, in the process that
// already holds the live connection -- the same function the façade's own
// inline path uses when there is no child to ask. Never throws for a dump:
// the dump is recorded and the partial output is returned with `ok: false`
// and an `error`, the way a console would show a trace after whatever it
// printed before failing. Throws only for "nothing transpiled yet"; a
// missing or non-classrun class is the caller's own check (the façade
// already has the source, see `ClassRun#run` below), because a bare
// `runClassrun` has no store to ask.
export async function runClassrun(root, name, options = {}) {
  const outputDir = join(root, "output");
  if (existsSync(join(outputDir, "init.mjs")) === false) {
    throw new NotTranspiled();
  }
  const started = Date.now();
  // the imports and the interface check happen before the dialog step, not
  // inside it: a wrong request (no such module, not a classrun class) is a
  // 400/503 to answer, not a runtime dump to record and roll back
  const module = await importFresh(join(outputDir, `${name.toLowerCase()}.clas.mjs`));
  const [Local] = Object.values(module);
  if (Local === undefined) {
    throw new Error(`${name} is not exported by its own module`);
  }
  // a caller of this bare function (the served-runtime door,
  // tools/osd-serve.mjs `/osd/classrun`) has no store to ask first, so the
  // check the façade already does (ClassRun#run, off the source) is
  // repeated here off the compiled class itself -- IMPLEMENTED_INTERFACES is
  // the transpiler's own record of every INTERFACES line
  if ((Local.IMPLEMENTED_INTERFACES ?? []).includes("IF_OO_ADT_CLASSRUN") === false) {
    throw new NotClassrun(name);
  }
  const outModule = await importFresh(join(outputDir, "zcl_osd_classrun_out.clas.mjs"));
  const [OutClass] = Object.values(outModule);
  if (OutClass === undefined) {
    const e = new Error("ZCL_OSD_CLASSRUN_OUT is not built: transpile first");
    e.code = "NOT_TRANSPILED";
    throw e;
  }
  let out;
  try {
    const text = await dialogStep(async () => {
      out = await (new OutClass()).constructor_();
      const instance = await (new Local()).constructor_();
      await instance.if_oo_adt_classrun$main({out});
      return (await out.text({rv_text: 1})).get();
    }, `classrun ${name}`);
    return {name, ok: true, text, ms: Date.now() - started};
  } catch (error) {
    const dumped = dumpOf(error, {request: `classrun ${name}`});
    const connection = globalThis.abap?.context?.databaseConnections?.DEFAULT;
    if (connection !== undefined) {
      persistDump(connection, dumped, {request: `classrun ${name}`, generation: options.generation ?? "0"})
        .catch((e) => console.error(`ZOSD_DUMP: ${e?.message ?? e}`));
    }
    let text = "";
    try {
      text = out === undefined ? "" : (await out.text({rv_text: 1})).get();
    } catch {
      // the OUT object never got far enough to answer; the dump is what matters
    }
    return {
      name, ok: false, text,
      error: {message: dumped.message, where: dumped.where, frames: dumped.frames},
      ms: Date.now() - started,
    };
  }
}

export class ClassRun {
  constructor(store) {
    this.store = store;
  }

  // does this class implement IF_OO_ADT_CLASSRUN, read straight off its
  // main source? Used by the façade to answer 400 before it imports
  // anything, and available to any other caller that only wants the yes/no.
  supports(name) {
    const entry = this.store.find("CLAS", name);
    if (entry === undefined) {
      return false;
    }
    return implementsClassrun(this.store.read("CLAS", entry.name).source);
  }

  // instantiate `name`, run its MAIN with a fresh console, and answer what
  // it wrote (`runClassrun` above does the actual run). Throws only for the
  // request itself being wrong: not found, not a classrun class, or
  // nothing transpiled yet.
  //
  // `options.data` is the caller's own Data (the façade passes the one it
  // was built with, whatever it shares its connection with) -- not
  // `this.store.data()`, which is a plain `Data({root})` of the store's own
  // and, called twice, would ask it to boot a SECOND runtime. Once ABAP is
  // up, `output/init.mjs`'s own module scope has already assigned
  // `globalThis.abap`, and `initializeABAP()` replaces
  // `databaseConnections.DEFAULT` every time it runs (test/setup.mjs) --
  // exactly the swap test/adt-devloop.mjs's own before() hook works around
  // by booting once, first, through test/start.mjs. A second `.boot()` here
  // would repeat that mistake against the shared connection every other
  // route already answers from. So a connection already up is left alone;
  // `.boot()` only runs when nothing has booted anything yet (a bare CLI
  // call, this file's own `main()`).
  //
  // A served (child) runtime holds the connection in a different process
  // (tools/osd-serve.mjs), so `data.runtime !== undefined` goes through its
  // own door instead (`Data#classrun`, tools/osd-data.mjs) rather than
  // touching this process's own (empty) `globalThis.abap`.
  async run(name, options = {}) {
    const entry = this.store.find("CLAS", name);
    if (entry === undefined) {
      throw new NotFound("CLAS", name);
    }
    const source = this.store.read("CLAS", entry.name).source;
    if (implementsClassrun(source) === false) {
      throw new NotClassrun(entry.name);
    }
    const data = options.data ?? this.store.data();
    if (data.runtime !== undefined) {
      return data.classrun(entry.name, options);
    }
    if (existsSync(join(this.store.root, "output", "init.mjs")) === false) {
      throw new NotTranspiled();
    }
    if (globalThis.abap?.context?.databaseConnections?.DEFAULT === undefined) {
      await data.boot();
    }
    return runClassrun(this.store.root, entry.name, options);
  }
}
