// Complete every queued frozen-generation comparison, even across new saves.
import {join} from "node:path";
import {readFileSync, writeFileSync} from "node:fs";

export function verifyNext(store) {
  const w = store.warm();
  if (w.closed || w.on === false || w.verifying !== undefined || !w.next?.size) return;
  const hash = w.next.values().next().value;
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
    verifyNext(store);
  });
}
