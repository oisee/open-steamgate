// The one binary: the workbench, its serving child, the builder and every
// tool it starts, as modes of a single executable (SP4).
//
//   osd up            the workbench on STG_PORT (test/run.mjs)
//   osd serve         the serving runtime, as the supervisor starts it
//   osd build [...]   tools/osd-build.mjs
//   osd fetch         the folders the packs declare as sources
//   osd gen <tool>    one generator, as the builder starts it
//   osd unit ...      a detached ABAP Unit run, as the façade starts it
//
// Two things a binary has to do that a checkout gets for free. First, code
// generated after the binary was built imports "@abaplint/runtime" by name
// and "../test/setup.mjs" by path, and neither is on disk beside it: a Bun
// runtime plugin answers both with the binary's own copies, so the
// generated code and the host run one runtime. Second, every bundled
// module shares one import.meta.url, so the "am I the script being run"
// guards of the tools would all fire on import: argv[1] is set to a name
// no module ends with, and the modes are dispatched here.
import * as runtime from "@abaplint/runtime";
import * as core from "@abaplint/core";
import {Transpiler} from "@abaplint/transpiler";
import * as setup from "../test/setup.mjs";
import {dirname, resolve} from "node:path";
import {createRequire} from "node:module";
import {compiled, setHostModules} from "../tools/osd-host.mjs";

const [, , mode = "up", ...rest] = process.argv;


// how to start this program again, for every tool that starts a tool
// (tools/osd-host.mjs): the executable alone when this IS the executable
// (a Bun binary, a Node single executable), node plus this file otherwise
const sea = (() => {
  try {
    return createRequire(import.meta.url)("node:sea").isSea();
  } catch {
    return false;
  }
})();
process.env.OSD_SELF = JSON.stringify(compiled || sea ? [process.execPath] : [process.execPath, resolve(process.argv[1])]);

// The bundle renames a top-level class whose name collides with another
// (types.Date became Date2, types.String String2, measured with `osd
// doctor`), and the runtime tells types apart by constructor.name in some
// four hundred places, so RTTI took every string for "todo". webpack keeps
// class names on request; Bun has no such switch, and a function's name is
// a configurable property, so it is put back here, before anything runs.
for (const [key, value] of Object.entries(runtime.types ?? {})) {
  if (typeof value === "function" && value.name !== key) {
    Object.defineProperty(value, "name", {value: key});
  }
}

if (typeof Bun !== "undefined") {
  Bun.plugin({
    name: "osd-host",
    setup(build) {
      build.module("@abaplint/runtime", () => ({exports: runtime, loader: "object"}));
      build.onResolve({filter: /\/test\/setup\.mjs$/}, () => ({path: "osd:setup", namespace: "osd-host"}));
      // the transpiler writes a namespace as %23 in an import and as # in
      // the file name (a URL against a path), and Bun's resolver takes the
      // specifier literally: decoded here, against the importing module
      build.onResolve({filter: /%(23|25)/}, (args) => ({path: resolve(dirname(args.importer), decodeURIComponent(args.path))}));
      build.onLoad({filter: /.*/, namespace: "osd-host"}, () => ({exports: setup, loader: "object"}));
    },
  });
}
setHostModules({Transpiler, core, plugin: undefined, where: "bundled", version: "bundled"});

const GENERATORS = {
  "osd-transpiler.mjs": () => import("../tools/osd-transpiler.mjs"),
  "osd-inputs.mjs": () => import("../tools/osd-inputs.mjs"),
  "cds2ddic.mjs": () => import("../tools/cds2ddic.mjs"),
  "stg-compile.mjs": () => import("../tools/stg-compile.mjs"),
  "segw-registry.mjs": () => import("../tools/segw-registry.mjs"),
  "segw-shlp.mjs": () => import("../tools/segw-shlp.mjs"),
};

switch (mode) {
  case "up": {
    process.argv = [process.argv[0], "osd-host", ...rest];
    await import("../test/run.mjs");
    break;
  }
  case "serve": {
    process.argv = [process.argv[0], "osd-host", ...rest];
    await import("../tools/osd-serve.mjs");
    break;
  }
  case "build": {
    process.argv = [process.argv[0], "osd-host", ...rest];
    const {main} = await import("../tools/osd-build.mjs");
    process.exit(await main(rest));
    break;
  }
  case "gen": {
    const [name, ...args] = rest;
    if (GENERATORS[name] === undefined) {
      console.error(`osd gen: not a generator: ${name}`);
      process.exit(2);
    }
    // the generator's own guard sees its name and runs its main
    process.argv = [process.argv[0], name, ...args];
    await GENERATORS[name]();
    break;
  }
  case "fetch": {
    // a pack's declared sources, into the pack (tools/osd-fetch.mjs)
    process.argv = [process.argv[0], "osd-fetch", ...rest];
    const {main} = await import("../tools/osd-fetch.mjs");
    process.exit(await main(rest));
    break;
  }
  case "unit": {
    process.argv = [process.argv[0], "osd-host", ...rest];
    const {main} = await import("../tools/osd-unit.mjs");
    process.exit(await main(rest));
    break;
  }
  case "doctor": {
    // what the bundle did to the runtime: a class the runtime looks up by
    // its name must still carry that name after bundling
    const renamed = [];
    for (const [group, members] of Object.entries({types: runtime.types ?? {}, runtime: runtime})) {
      for (const [key, value] of Object.entries(members)) {
        if (typeof value === "function" && value.name !== key && /^[A-Z]/.test(key)) {
          renamed.push(`${group}.${key} is named ${JSON.stringify(value.name)}`);
        }
      }
    }
    console.log(`runtime classes renamed by the bundle: ${renamed.length}`);
    for (const line of renamed.slice(0, 20)) {
      console.log("  " + line);
    }
    break;
  }
  default:
    console.error(`osd: unknown mode ${mode}; one of up, serve, build, fetch, gen, unit, doctor`);
    process.exit(2);
}
