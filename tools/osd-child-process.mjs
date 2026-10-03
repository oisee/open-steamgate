// Every tool child gets an independent environment without the HTTP credential.
import * as childProcess from "node:child_process";

export function childEnv(env = process.env) {
  const copy = {...env};
  delete copy.OSD_ADT_TOKEN;
  return copy;
}
function scrubbed(name) {
  return (...args) => {
    const index = Array.isArray(args[1]) ? 2 : 1;
    const options = args[index];
    const safe = {...(typeof options === "object" ? options : {}), env: childEnv(options?.env)};
    if (typeof options === "function") args.splice(index, 0, safe);
    else args[index] = safe;
    return childProcess[name](...args);
  };
}
export const spawn = scrubbed("spawn");
export const spawnSync = scrubbed("spawnSync");
export const fork = scrubbed("fork");
export const execFile = scrubbed("execFile");
export const execFileSync = scrubbed("execFileSync");
export const exec = scrubbed("exec");
export const execSync = scrubbed("execSync");
