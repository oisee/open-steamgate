import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";

export function lifecycleIdentity() {
  const git = (...args) => spawnSync("git", args, {encoding:"utf8"}).stdout.trim();
  const lock = JSON.parse(readFileSync("libs.lock.json", "utf8"));
  const pin = readFileSync(".github/ci/vsp.ref", "utf8").trim();
  const binary = spawnSync("go", ["version", "-m", process.env.VSP ?? "vsp"], {encoding:"utf8"});
  if (binary.status !== 0 || !binary.stdout.includes(pin)) throw Error("VSP executable does not match .github/ci/vsp.ref");
  const sdk = createRequire(resolve(process.env.SDK_ROOT ?? "tools/abapfs-conformance", "package.json"))("abap-adt-api/package.json").version;
  return {recipe:1, commit:git("rev-parse", "HEAD"), sdk, vsp:pin, runtime:JSON.stringify(lock), node:process.versions.node.split(".")[0], platform:process.platform, arch:process.arch};
}
export async function startLifecycleServer(target) {
  if (!process.env.OSD_HEAVY_SLOT || String(target.port) !== process.env.STG_PORT) throw Error("Run --start through tools/osd-heavy.sh on its STG_PORT");
  process.env.STG_SERVE = "child";
  process.env.OSD_ADT_ONE_RUNTIME = "1";
  process.env.STG_DB = "file";
  process.env.STG_DB_PATH = resolve(".local/adt-lifecycle", `osd-${process.env.STG_PORT}-${process.pid}.sqlite`);
  process.env.OSD_BIND = "127.0.0.1";
  process.env.STG_TLS = "0";
  process.env.OSD_WARM = "1";
  const {startServer} = await import("../test/start.mjs");
  return startServer(true);
}
