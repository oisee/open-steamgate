// Local installation uses the same build gate and direct links as CI.
import {existsSync, realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {readLock} from "./osd-lock.mjs";
import {runsAs} from "./osd-main.mjs";

const tools = dirname(fileURLToPath(import.meta.url));
const within = (path, parent) => path === parent || path.startsWith(parent + sep);
function canonical(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonical(dirname(path)), path.slice(dirname(path).length + 1));
}

export function pinPath(ref, env = process.env) {
  const path = resolve(env.TRANSPILER ?? join(homedir(), ".cache", "osd", `transpiler-${ref}`));
  const real = canonical(path);
  const temporary = ["/tmp", "/var/tmp", tmpdir(), env.TMPDIR, env.RUNNER_TEMP].filter(Boolean).map(p => canonical(resolve(p)));
  if (temporary.some(p => within(real, p)) || /(?:^|[/\\])(?:tmp|scratch(?:pad)?(?:[-_.][^/\\]*)?|session(?:s|[-_.][^/\\]+))(?:[/\\]|$)/i.test(real)) {
    throw new Error(`TRANSPILER must be persistent, outside temporary directories and session scratchpads: ${path}`);
  }
  return path;
}

export function installPin(root = process.cwd(), env = process.env) {
  const {repo, ref} = readLock(root).transpiler;
  const clone = pinPath(ref, env);
  const childEnv = {...env, TRANSPILER: clone, OSD_TRANSPILER_REPO: `https://github.com/${repo}.git`, OSD_TRANSPILER_REF: ref};
  const run = (cmd, args, stdio = "inherit") => {
    const r = spawnSync(cmd, args, {cwd: root, env: childEnv, stdio});
    if (r.error) throw r.error;
    return r.status === 0;
  };
  const builder = join(tools, "osd-ci-transpiler-build.sh");
  if (!run("bash", [builder, "verify"], "ignore")) {
    if (!run("bash", [builder, existsSync(clone) ? "rebuild" : "build"])) throw new Error("Pinned transpiler build failed");
  } else console.log(`transpiler:pin: reusing verified build ${clone}`);
  for (const [name, path] of [["transpiler", "packages/transpiler"], ["transpiler-cli", "packages/cli"],
    ["runtime", "packages/runtime"], ["core", "packages/transpiler/node_modules/@abaplint/core"]]) {
    if (!run(process.execPath, [join(tools, "osd-link.mjs"), name, path])) throw new Error(`Could not link ${name}`);
  }
  if (!run(process.execPath, [join(tools, "osd-transpiler.mjs")])) throw new Error("Could not describe pinned transpiler");
}

if (runsAs("osd-transpiler-pin.mjs")) {
  try { installPin(); } catch (error) { console.error(`transpiler:pin: ${error.message}`); process.exitCode = 1; }
}
