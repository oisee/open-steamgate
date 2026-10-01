// The checkouts osabap compiles against (.local/lars/open-abap-core and
// open-abap-gui) are working clones, and a clone left on another commit
// changes what a report becomes: the host framework of a different
// open-abap-gui marks different table rows stable, and a test written for
// the pinned one stops compiling (seen 2026-10-01: a clone at 31cc8b3 where
// libs.lock.json pins 238c5bfe). Each is checked against libs.lock.json;
// a difference is said loudly, and with OSABAP_STRICT_PINS=1 (CI) refused.
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {readLock} from "../osd-lock.mjs";

export function libDrift(home, folders = ["open-abap-core", "open-abap-gui"]) {
  let lock;
  try {
    lock = readLock(home);
  } catch {
    return [];
  }
  const drift = [];
  for (const folder of folders) {
    const pin = lock.libraries.find((lib) => lib.folder === folder)?.ref;
    const dir = join(home, ".local", "lars", folder);
    if (!pin || !existsSync(dir)) continue;
    const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout?.trim();
    const dirty = spawnSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"], {encoding: "utf8"}).stdout?.trim();
    if (head && head !== pin) drift.push(`${folder} is at ${head.slice(0, 8)}, libs.lock.json pins ${pin.slice(0, 8)}`);
    else if (dirty) drift.push(`${folder} has uncommitted changes over its pin ${pin.slice(0, 8)}`);
  }
  return drift;
}

export function checkLibPins(home, {say = (line) => console.error(line), strict = process.env.OSABAP_STRICT_PINS === "1"} = {}) {
  const drift = libDrift(home);
  if (drift.length === 0) return;
  for (const line of drift) say(`osabap: ${line}`);
  if (strict) throw new Error("osabap: the library clones differ from libs.lock.json (OSABAP_STRICT_PINS=1)");
  say("osabap: building against them anyway; what this report becomes may differ from CI");
}
