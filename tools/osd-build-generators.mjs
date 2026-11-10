// The source and hosted-binary generator identities, and the child process
// that records generator reads while it writes gen/.
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {toolCommand, hosted} from "./osd-host.mjs";
import {run} from "./osd-build-command.mjs";

export function generatorClosureOf(toolsDir, generators) {
  const seen = new Set();
  const walk = file => {
    const abs = resolve(file);
    if (seen.has(abs) || !existsSync(abs)) return;
    seen.add(abs);
    const source = readFileSync(abs, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) walk(join(dirname(abs), match[1]));
    for (const match of source.matchAll(/import\("(\.[^"]+)"\)/g)) walk(join(dirname(abs), match[1]));
  };
  for (const [script] of generators) walk(join(toolsDir, script));
  walk(join(toolsDir, "rap-flight/seed-capture.mjs"));
  walk(join(toolsDir, "osd-generator-view.mjs"));
  return [...seen].sort();
}

export function runGeneratorsOf(toolsDir, generators, activeOverlay, root, log = () => {}, overlay, readsLog, external = []) {
  let output = "";
  for (const [script, ...args] of generators) {
    log(`${script} ${args.join(" ")}`.trim());
    const [cmd, ...argv] = toolCommand(join(toolsDir, script), args);
    const view = activeOverlay(overlay);
    const env = {...process.env, OSD_ROOT: root};
    if (readsLog) {
      env.OSD_GENERATOR_READS = readsLog;
      env.OSD_READ_EXTERNAL = JSON.stringify(external);
      if (!hosted()) argv.unshift("--import", join(toolsDir, "osd-generator-reads.mjs"));
    }
    delete env.OSD_ACTIVE_BUILD_OVERLAY;
    if (view) {
      env.OSD_ACTIVE_BUILD_OVERLAY = JSON.stringify({...view, exclude: [...view.exclude]});
      if (!hosted()) argv.unshift("--import", join(toolsDir, "osd-generator-view.mjs"));
    }
    output += run(cmd, argv, root, env);
  }
  return output;
}

let binaryIdentity;
export function generatorIdentityOf(toolsDir, generators) {
  const dispatch = hosted() ? JSON.parse(process.env.OSD_SELF) : undefined;
  const embedded = typeof __OSD_TOOLCHAIN_IDENTITY__ !== "undefined";
  if (dispatch && (embedded || dispatch.length === 1)) {
    if (binaryIdentity === undefined) {
      const executable = dispatch.length === 1 ? dispatch[0] : dispatch[1];
      binaryIdentity = "binary:" + createHash("sha256").update(readFileSync(executable)).digest("hex").slice(0, 16);
    }
    return binaryIdentity;
  }
  const h = createHash("sha256");
  const closure = generatorClosureOf(toolsDir, generators);
  h.update(`generators ${closure.length}\0`);
  for (const file of closure) {
    h.update(relative(toolsDir, file).split(sep).join("/")).update(readFileSync(file)).update("\0");
  }
  return "tools:" + h.digest("hex").slice(0, 16);
}
