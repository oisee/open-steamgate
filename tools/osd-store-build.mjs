import {transpileIssues, withoutHostPaths} from "./osd-build-issues.mjs";
import {withSourceLock} from "./osd-store-source-lock.mjs";
import {warmOperation} from "./osd-store-warm.mjs";
const WARM_REPRIME_MS = Number(process.env.OSD_WARM_REPRIME_MS ?? 5000);

export async function transpileStore(store, options, activating, built) {
  const started = Date.now();
  const w = store.warm();
  // A cold publication may leave a prime due; finish it before taking the
  // source lock for this build, so priming and compilation cannot deadlock.
  if (w.on === true && !w.disabled && options.force !== true && w.primeDue === true && w.priming === undefined &&
      (store.served?.recycling ?? store.served?.starting) === undefined) {
    await store.warmUp();
  }
  await w.priming;
  return withSourceLock(store, async () => {
    // Snapshot only after earlier saves and priming have released the lock.
    const overlay = store.overlay(activating);
    if (w.on === true && !w.disabled && options.force !== true) {
      if (w.compiler?.primed === true) {
        try {
          const r = await warmOperation(store, () => w.compiler.build(activating));
          if (w.compiler.recycleDue) w.primeDue = true;
          return {ok: true, ms: Date.now() - started, objects: r.objects, hash: r.hash, cached: r.cached, warm: true,
            built: built(w.compiler.digests),
            modules: r.modules, hostHeld: r.hostHeld, from: r.from, stale: r.stale, steps: r.steps,
            closure: r.closure, xrefRows: r.xrefRows, unverified: w.compiler.unverified.has(r.hash)};
        } catch (error) {
          if (!["NOT_WARM", "WARM_UNAVAILABLE"].includes(error.code)) {
            // `check`: the transpiler refused the change; anything else
            // (BUSY, a disk that failed) is a build that did not happen
            return {ok: false, ms: Date.now() - started, objects: 0, warm: true, check: error.check === true,
              issues: error.issues, output: withoutHostPaths(String(error.output || error.message).slice(-2000), store.root),
              error: withoutHostPaths(error.message, store.root)};
          }
          w.reason = error.message;
          await w.compiler.drop();
          console.log(`warm: a cold build: ${error.message}`);
        }
      }
    }
    // a comparison of a warm generation the tree has left would end
    // inconclusive, and meanwhile it is a second cold transpile beside
    // this one (WarmCompiler#cancelVerify)
    if (w.compiler?.verifying !== undefined) w.compiler.cancelVerify(await store.sourceKey());
    try {
      const {build} = await import("./osd-build.mjs");
      const r = await build({...store.buildOptions, root: store.root, force: options.force === true, replace: options.replace === true, overlay});
      // only a build that made a generation live is one to prime on: after
      // a failed one the tree is not the live generation, and a prime on
      // demand would parse it to be told so
      w.primeDue = w.on === true && !w.disabled;
      return {ok: true, ms: Date.now() - started, objects: r.objects, hash: r.hash, cached: r.cached, built: built(r.digests)};
    } catch (error) {
      // the transpiler's refusal names each object and line; the rest of
      // the log is for the host's console and never for a client: it
      // carries absolute paths of the machine that built it
      const issues = transpileIssues(error.message);
      console.log(`build failed: ${String(error.message).slice(0, 2000)}${error.output ? `\n${String(error.output).slice(-2000)}` : ""}`);
      return {ok: false, ms: Date.now() - started, objects: 0, check: issues.length > 0, issues,
        output: withoutHostPaths(String(error.output || error.message).slice(-2000), store.root),
        error: withoutHostPaths(String(error.message).split("\n")[0], store.root)};
    } finally {
      // a cold build is a new start for the warm registry, primed once the
      // saves have stopped for a while; coalesce a burst of cold saves
      if (w.on === true && !w.disabled && w.compiler?.primed !== true) {
        clearTimeout(w.reprime);
        w.reprime = setTimeout(() => store.warmUp(), WARM_REPRIME_MS);
        w.reprime.unref?.();
      }
    }
  });
}
