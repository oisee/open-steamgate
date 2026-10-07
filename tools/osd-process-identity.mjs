// Linux process start ticks distinguish an active verifier from PID reuse.
import {readFileSync} from "node:fs";
export function processIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch { return undefined; }
}
