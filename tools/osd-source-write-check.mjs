// Standalone filesystem boundary: layer discovery must not import the store/compiler.
import {existsSync, lstatSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";

export function writable(base, inside, target, strict) {
  const within = (outer, inner) => {
    const rel = relative(outer, inner);
    return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..");
  };
  const outer = resolve(base, inside);
  const full = resolve(base, target);
  if (!within(outer, full) || full === outer) return false;
  const from = strict ? resolve(base) : outer;
  let at = from;
  for (const step of relative(from, full).split(/[\\/]/).filter((p) => p !== "")) {
    at = join(at, step);
    let info;
    try {
      info = lstatSync(at);
    } catch {
      break; // nothing exists from here down
    }
    if (info.isSymbolicLink()) return false;
  }
  if (existsSync(outer)) {
    let existing = full;
    while (!existsSync(existing)) existing = dirname(existing);
    if (!within(realpathSync(outer), realpathSync(existing))) return false;
  }
  return true;
}

