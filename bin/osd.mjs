// The one binary: the workbench, its serving child, the builder and every
// tool it starts, as modes of a single executable (SP4).
//
//   osd up            the workbench on STG_PORT (test/run.mjs)
//   osd serve         the serving runtime, as the supervisor starts it
//   osd build [...]   tools/osd-build.mjs
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
import {setHostModules} from "../tools/osd-host.mjs";

const [, , mode = "up", ...rest] = process.argv;

if (typeof Bun !== "undefined") {
  Bun.plugin({
    name: "osd-host",
    setup(build) {
      build.module("@abaplint/runtime", () => ({exports: runtime, loader: "object"}));
      build.onResolve({filter: /\/test\/setup\.mjs$/}, () => ({path: "osd:setup", namespace: "osd-host"}));
      build.onLoad({filter: /.*/, namespace: "osd-host"}, () => ({exports: setup, loader: "object"}));
    },
  });
}
setHostModules({Transpiler, core, plugin: undefined, where: "bundled", version: "bundled"});

const GENERATORS = {
  "osd-transpiler.mjs": () => import("../tools/osd-transpiler.mjs"),
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
  case "unit": {
    process.argv = [process.argv[0], "osd-host", ...rest];
    const {main} = await import("../tools/osd-unit.mjs");
    process.exit(await main(rest));
    break;
  }
  default:
    console.error(`osd: unknown mode ${mode}; one of up, serve, build, gen, unit`);
    process.exit(2);
}
