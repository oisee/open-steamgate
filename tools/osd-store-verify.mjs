// Bounded frozen comparisons: the live/latest generation takes the next turn.
import {join} from "node:path";
import {liveHash} from "./osd-build.mjs";
import {existsSync, readFileSync, writeFileSync} from "node:fs";

export const VERIFY_PENDING_LIMIT = 2;

export function verifyNext(store) {
  const w = store.warm();
  if (w.closed || w.on === false || !w.next?.size) return;
  // Bound and prune even while a comparison is running. A dropped generation
  // keeps its unchecked disk verdict and may be scheduled again if revisited.
  for (const hash of [...w.next]) {
    if (hash === w.verifyingHash) w.next.delete(hash);
    else if (store.root && !existsSync(join(store.root, "build", "by-input", hash, "manifest.json"))) {
      w.next.delete(hash);
      console.log(`warm: ${hash} superseded, not verified (generation removed by GC)`);
    }
  }
  const latest = [...w.next].at(-1);
  const live = store.root && liveHash(store.root);
  const hash = w.next.has(live) ? live : w.next.has(store.served?.generation) ? store.served.generation : latest;
  for (const older of [...w.next]) {
    if (w.next.size <= VERIFY_PENDING_LIMIT) break;
    if (older === hash) continue;
    w.next.delete(older);
    console.log(`warm: ${older} superseded, not verified (verification queue limit ${VERIFY_PENDING_LIMIT})`);
  }
  if (w.verifying !== undefined || !w.next.size) return;
  w.verifyingHash = hash;
  w.next.delete(hash);
  w.verifying = w.compiler.verify(hash).then(async (result) => {
    w.last = {hash, ...result, at: new Date().toISOString()};
    if (result.verdict === "same") {
      console.log(`warm: ${hash} verified against a cold transpile (${result.files} files, ${result.ms} ms)`);
      store.served?.verified?.(hash);
    } else if (result.verdict === "differs") {
      // the warm build and the cold one disagree: the cold one is the
      // truth, so it replaces the generation and the process, and the
      // registry is primed again from it
      console.log(`warm: ${hash} DIFFERS from a cold transpile in ${result.count} files (${result.differing.slice(0, 5).join(", ")}); rebuilding cold`);
      // the note beside it keeps the generation from ever being a cache
      // hit, whatever the tree is by the time the cold build runs
      try {
        const side = join(store.root, "build", "by-input", `${hash}.warm.json`);
        writeFileSync(side, JSON.stringify({...JSON.parse(readFileSync(side, "utf8")), verified: false, differs: result.differing}, null, 2));
      } catch {
        // no note: nothing a cold build would take as its own
      }
      w.compiler.drop();
      await store.publish({force: true, replace: true});
    } else {
      console.log(`warm: ${hash} not verified: ${result.verdict} ${result.why ?? result.output ?? ""}`);
    }
  }).finally(() => {
    w.verifying = undefined;
    w.verifyingHash = undefined;
    verifyNext(store);
  });
}
