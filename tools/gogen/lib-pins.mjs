// The checkouts osabap compiles against (.local/lars/open-abap-core and
// open-abap-gui) are working clones, and a clone left on another commit
// changes what a report becomes: the host framework of a different
// open-abap-gui marks different table rows stable, and a test written for
// the pinned one stops compiling (seen 2026-10-01: a clone at 31cc8b3 where
// libs.lock.json pins 238c5bfe). Each is checked against libs.lock.json;
// a difference is said loudly, and with OSABAP_STRICT_PINS=1 (CI) refused.
import {spawnSync} from "node:child_process";
import {existsSync, realpathSync} from "node:fs";
import {join} from "node:path";
import {readLock} from "../osd-lock.mjs";

// osabap compiles every class file it finds in a clone, so a new untracked
// one counts as much as an edit; a folder that is not a clone of its own
// would otherwise be answered by the open-steamgate repository around it
export function libDrift(home, folders = ["open-abap-core", "open-abap-gui"], {strict = false} = {}) {
  let lock;
  try {
    lock = readLock(home);
  } catch (e) {
    if (strict) throw e;
    return [];
  }
  const drift = [];
  const git = (dir, ...args) => spawnSync("git", ["-C", dir, ...args], {encoding: "utf8"});
  for (const folder of folders) {
    const pin = lock.libraries.find((lib) => lib.folder === folder)?.ref;
    const dir = join(home, ".local", "lars", folder);
    if (!pin) continue;
    if (!existsSync(dir)) {
      if (strict) drift.push(`${folder} is missing; libs.lock.json pins ${pin.slice(0, 8)}`);
      continue;
    }
    const top = git(dir, "rev-parse", "--show-toplevel");
    if (top.error) {
      if (strict) drift.push(`${folder} cannot be checked: git is not available`);
      continue;
    }
    if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(dir)) {
      drift.push(`${folder} is not a git clone of its own; libs.lock.json pins ${pin.slice(0, 8)}`);
      continue;
    }
    const head = git(dir, "rev-parse", "HEAD").stdout?.trim();
    const dirty = git(dir, "status", "--porcelain").stdout?.trim();
    if (head && head !== pin) drift.push(`${folder} is at ${head.slice(0, 8)}, libs.lock.json pins ${pin.slice(0, 8)}`);
    else if (dirty) drift.push(`${folder} has changes over its pin ${pin.slice(0, 8)} (edited or untracked files)`);
  }
  return drift;
}

export function checkLibPins(home, {say = (line) => console.error(line), strict = process.env.OSABAP_STRICT_PINS === "1"} = {}) {
  const drift = libDrift(home, undefined, {strict});
  if (drift.length === 0) return;
  for (const line of drift) say(`osabap: ${line}`);
  if (strict) throw new Error("osabap: the library clones differ from libs.lock.json (OSABAP_STRICT_PINS=1)");
  say("osabap: building against them anyway; what this report becomes may differ from CI");
}
