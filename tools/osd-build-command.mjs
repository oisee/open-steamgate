// Build subprocess failures retain their process provenance beside diagnostics.
import {spawnSync} from "node:child_process";
import {basename} from "node:path";

export function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, {cwd, env, encoding: "utf8", maxBuffer: 64 << 20});
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) {
    const e = new Error(`${basename(cmd)} ${args.join(" ")} exited ${r.status ?? r.signal}`);
    e.code = "FAILED";
    e.signal = r.signal;
    e.spawnError = r.error?.code;
    e.output = output;
    throw e;
  }
  return output;
}
