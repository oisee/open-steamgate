// Generation retention is separate from compilation and publication.
import {existsSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {layout, lock, liveHash, generations} from "./osd-build.mjs";
import {verificationPins} from "./osd-verify-pin.mjs";
import {gcSourceInputs} from "./osd-source-snapshot.mjs";

// keep the live generation and the newest N; drop the rest, every leftover
// tmp, and the directories moved aside by the first switch
export function gc(root, options = {}) {
  const paths = layout(root);
  const unlock = lock(paths);
  try {
    const keep = options.keep ?? 5;
    const live = liveHash(root);
    const pins = verificationPins(root);
    const pinned = new Set(pins.map(p => p.hash));
    const scratch = new Set(pins.map(p => p.scratch));
    const removed = [];
    const all = generations(root).reverse(); // newest first
    for (const g of all.slice(keep)) {
      if (g.hash === live || pinned.has(g.hash)) {
        continue;
      }
      rmSync(join(paths.byInput, g.hash), {recursive: true, force: true});
      rmSync(join(paths.byInput, `${g.hash}.warm.json`), {force: true});
      removed.push(g.hash);
    }
    if (existsSync(paths.byInput)) {
      for (const file of readdirSync(paths.byInput)) {
        if (!file.endsWith(".warm.json")) continue;
        const hash = file.slice(0, -10);
        if (!pinned.has(hash) && !existsSync(join(paths.byInput, hash))) {
          rmSync(join(paths.byInput, file), {force: true});
          removed.push(file);
        }
      }
    }
    if (existsSync(paths.tmp)) {
      for (const e of readdirSync(paths.tmp)) {
        if (scratch.has(e)) continue;
        rmSync(join(paths.tmp, e), {recursive: true, force: true});
        removed.push(`tmp/${e}`);
      }
    }
    if (existsSync(paths.build)) {
      for (const e of readdirSync(paths.build)) {
        if (e.startsWith("legacy-")) {
          rmSync(join(paths.build, e), {recursive: true, force: true});
          removed.push(e);
        }
      }
    }
    gcSourceInputs(root);
    return removed;
  } finally {unlock();}
}
