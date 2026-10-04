// Generation retention is separate from compilation and publication.
import {existsSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {layout, lock, liveHash, generations} from "./osd-build.mjs";
import {gcSourceInputs} from "./osd-source-snapshot.mjs";

// keep the live generation and the newest N; drop the rest, every leftover
// tmp, and the directories moved aside by the first switch
export function gc(root, options = {}) {
  const paths = layout(root);
  const unlock = lock(paths);
  try {
    const keep = options.keep ?? 5;
    const live = liveHash(root);
    const removed = [];
    const all = generations(root).reverse(); // newest first
    for (const g of all.slice(keep)) {
      if (g.hash === live) {
        continue;
      }
      rmSync(join(paths.byInput, g.hash), {recursive: true, force: true});
      removed.push(g.hash);
    }
    if (existsSync(paths.tmp)) {
      for (const e of readdirSync(paths.tmp)) {
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
