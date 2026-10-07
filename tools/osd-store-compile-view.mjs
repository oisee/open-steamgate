// A short source-lock turn captures the view; compilers validate every read
// against it. Publication takes another short turn and refuses stale work.
import {createHash} from "node:crypto";
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {join, resolve, basename} from "node:path";
import {genHash, hashOf, inputsOf, switchTo, prepare, ownConfig} from "./osd-build.mjs";
import {listFiles} from "./osd-transpile.mjs";
import {withSourceLock} from "./osd-store-source-lock.mjs";

export function superseded(reason = "compile inputs changed") {
  return Object.assign(new Error(`${reason}; retrying the current view`), {code: "CHANGED"});
}
export function captureView(store, activating = new Set()) {
  return withSourceLock(store, () => {
    const overlay = store.overlay(activating);
    const digests = new Map();
    const hash = hashOf(store.root, inputsOf(store.root), {overlay, digests});
    // gen/ is derived and excluded from the generation hash, but prime reads
    // it too. Its bytes must be checked before entering the kept registry.
    const walk = dir => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) digests.set(file, createHash("sha256").update(readFileSync(file)).digest("hex"));
      }
    };
    walk(join(store.root, "gen"));
    const {config, stack} = prepare(store.root);
    const listing = ownConfig(store.root, config, stack, join(store.root, "build", "tmp", "view", "output"), overlay);
    for (const file of listFiles(store.root, listing).wanted) {
      if (!digests.has(file)) digests.set(file, createHash("sha256").update(readFileSync(file)).digest("hex"));
    }
    return {hash, digests: [...digests], gen: genHash(store.root), overlay,
      inactive: store.inactiveSources(new Set()), folder: store.overlay(new Set())?.folder ?? join("build", "inactive", "active")};
  });
}
export function checkView(root, view, overlay) {
  if (!view) return;
  if (hashOf(root, inputsOf(root), {overlay}) !== view.hash) throw superseded();
  if (genHash(root) !== view.gen) throw superseded("generated inputs changed");
}
export function checkRead(view) {
  if (!view) return undefined;
  const digests = new Map(view.digests.map(([file, digest]) => [resolve(file), digest]));
  return (file, bytes) => {
    if (createHash("sha256").update(bytes).digest("hex") !== digests.get(resolve(file))) throw superseded(`${basename(file)} changed while being read`);
  };
}
export function acceptView(store, view, activating, result = undefined, prime = false) {
  return withSourceLock(store, async () => {
    if ((result && result.hash !== view.hash) || await store.sourceKey(activating) !== view.hash ||
        ((prime || result?.warm) && genHash(store.root) !== view.gen)) throw superseded();
    if (result) switchTo(store.root, result.hash);
    return result;
  });
}
