import {warnWarmPin} from "./osd-warm-capabilities.mjs";
import {acceptView, captureView} from "./osd-store-compile-view.mjs";
import {waitVerifier} from "./osd-warm-verification.mjs";
import {verifyNext} from "./osd-store-verify.mjs";
// Background priming belongs to the compiler process, never the HTTP front.
export function warmUp(store) {
  const w = store.warm();
  if (w.on !== true || w.closed === true || w.disabled === true) return undefined;
  if (w.priming !== undefined) return w.priming;
  // Keep the source baseline stable until the runtime finishes changing hands.
  const changing = store.served?.recycling ?? store.served?.starting;
  if (changing !== undefined) {
    return changing.catch(() => undefined).then(() => store.warmUp());
  }
  w.primeDue = false;
  clearTimeout(w.reprime);
  w.priming = (async () => {
    const {WarmCompilerProcess} = await import("./osd-warm-process.mjs");
    if (w.closed === true) { w.priming = undefined; return undefined; }
    // primed on the build view: inactive objects as their active copies
    w.compiler ??= new WarmCompilerProcess({root: store.root, log: (m) => console.log(m), overlay: (activating) => store.overlay(activating),
      keyOf: (file) => store.objectKeyOf(file), inactiveSources: (activating) => store.inactiveSources(activating)});
    w.compiler.verifyDeadlineMs = store.warmVerifyLifetimeMs ?? Number(process.env.OSD_WARM_VERIFY_LIFETIME_MS ?? 180000);
    try {
      // Let an already running frozen comparison finish before the bounded
      // full prime. New comparisons wait below; saves still take their turns.
      const verifier = w.compiler.verifying;
      await waitVerifier(verifier, store.warmVerifyDeadlineMs ?? store.warmVerifyWaitMs ?? Number(process.env.OSD_WARM_VERIFY_WAIT_MS ?? 30000));
      for (;;) {
        const view = await captureView(store);
        try {
          const r = await warmOperation(store, () => w.compiler.prime(view));
          await acceptView(store, view, new Set(), undefined, true);
          w.reason = undefined;
          return r;
        } catch (error) {
          try { await acceptView(store, view, new Set(), undefined, true); } catch (changed) { error = changed; }
          if (!["CHANGED", "INPUT_CHANGED"].includes(error.code) || w.closed || w.disabled) throw error;
          // Saves landed during prime. Rebuild the baseline from their active
          // copies before advertising the registry as available.
          console.log(`warm: ${error.message}`);
          await w.compiler.drop();
        }
      }
    } catch (error) {
      if (w.closed === true || w.compiler.closing === true) return undefined;
      w.reason = error.message;
      await w.compiler.drop?.();
      if (error.pinMissing === true && !w.pinWarned) {
        warnWarmPin(error.message);
        w.pinWarned = true;
      }
      console.log(`warm: builds stay cold: ${error.message}`);
      return undefined;
    } finally {
      w.priming = undefined;
      verifyNext(store);
    }
  })();
  return w.priming;
}

export async function closeWarm(store) {
  const w = store.warmState;
  if (!w) return;
  w.closed = true;
  clearTimeout(w.reprime);
  clearTimeout(w.timer);
  await w.compiler?.shutdown?.();
  await w.priming;
}

// A dead/silent compiler is an optimization failure. Reap it before a cold
// build takes over the shared build lock, and keep later publications cold.
export async function warmOperation(store, work) {
  const w = store.warm();
  let timer;
  try {
    const ms = store.warmDeadlineMs ?? 30000;
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`warm compiler exceeded ${ms} ms`),
        {code: "WARM_UNAVAILABLE"})), ms);
    })]);
  } catch (error) {
    if (error.code === "WARM_UNAVAILABLE") {
      w.disabled = true;
      w.primeDue = false;
      w.reason = error.message;
      clearTimeout(w.reprime);
      await w.compiler?.drop?.();
    }
    throw error;
  } finally { clearTimeout(timer); }
}
