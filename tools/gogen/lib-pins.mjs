// Go compilers read the same locked library path as the Node builder.
import {readLock} from "../osd-lock.mjs";
import {libraryPath} from "../osd-lib-path.mjs";

export function libDrift(home, folders = ["open-abap-core", "open-abap-gui"]) {
  const lock = readLock(home);
  const drift = [];
  for (const folder of folders) {
    if (!lock.libraries.some((lib) => lib.folder === folder)) continue;
    try { libraryPath(home, folder); }
    catch (error) { drift.push(error.message); }
  }
  return drift;
}

export function checkLibPins(home, {say = (line) => console.error(line)} = {}) {
  const drift = libDrift(home);
  for (const line of drift) say(`osabap: ${line}`);
  if (drift.length) throw new Error(`osabap: library pin drift; run node tools/osd-libs.mjs --sync`);
}
