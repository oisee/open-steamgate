// One build view for the store and the compiler process. A promoted object's
// sources replace its copies; all other inactive sources keep their copies.
import {sourceSnapshotPath} from "./osd-source-snapshot.mjs";
import {existsSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";

export function warmOverlay(root, folder, entries, activating = new Set()) {
  const kept = [];
  const copied = [];
  const unused = [];
  const owned = new Set();
  for (const {key, files} of entries) {
    const mine = activating.has(key);
    for (const file of files) {
      const copy = join(folder, sourceSnapshotPath(file));
      const hasCopy = existsSync(join(root, copy));
      if (mine) {
        if (hasCopy) unused.push(resolve(root, copy));
        continue;
      }
      if (existsSync(join(root, file))) kept.push(resolve(root, file));
      if (hasCopy) {
        copied.push(copy);
        owned.add(resolve(root, copy));
      }
    }
  }
  // no copy is an input: the tree's own inactive files are all there is
  // to leave out, and nothing at all is the build as it always was --
  // which keeps an ordinary save-then-activate on the warm path
  if (copied.length === 0) return kept.length === 0 ? undefined : {exclude: kept.sort()};
  // a copy nobody inactive owns any more (an object deleted under us) is
  // not an input either
  for (const file of walkFiles(join(root, folder))) {
    if (!owned.has(resolve(file))) unused.push(resolve(file));
  }
  return {exclude: [...new Set([...kept, ...unused])].sort(), folder};
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
