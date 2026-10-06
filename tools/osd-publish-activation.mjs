import {join} from "node:path";
import {warmVerdict} from "./osd-hot.mjs";

// ADT and local STORE take the same revision and let the warm compiler check
// its affected closure. Eligibility remains the compiler's rule; a refused
// optimization builds cold, with full validation, before anything is promoted.
export function prepareActivation(store, named, {transpile = true, forced = false} = {}) {
  const warm = store.warm?.();
  const compilerCheck = transpile && (forced || warm?.on && !warm.disabled && !warm.closed &&
    warm.compiler?.primed === true && named.every(o => ["CLAS", "INTF", "PROG", "INCL"].includes(o.type)));
  return named.map(o => ({...o, ...(compilerCheck ? store.warmActivation(o.type, o.name)
    : store.activate(o.type, o.name, {activating: named}))}));
}

// One publication/promotion contract for both entry points. publish() owns
// compile, generation switch and runtime load; promotion fences the exact
// revision checked above against both the build's reads and today's source.
export async function publishActivation(store, checked) {
  const named = checked.map(({type, name}) => ({type, name}));
  const result = await store.publish({activate: named});
  let failureStage = result?.ok === false ? "build"
    : !result?.generation ? "promotion" : "";
  const wrongGeneration = !failureStage && result.transpile?.hash && result.generation !== result.transpile.hash;
  const runtime = store.served;
  const members = runtime?.runtimes ?? (runtime ? [runtime] : []);
  if (!failureStage && runtime?.running === true && members.some(m => !m.running || m.generation !== result.generation)) failureStage = "promotion";
  const committed = !failureStage && !wrongGeneration && (checked.length === 1 && store.completeActivation
    ? await store.completeActivation(checked[0], result?.transpile?.built)
    : await store.completeActivations(checked, result?.transpile?.built));
  if (!failureStage && !committed) failureStage = "revision";
  // A source-only host publishes a complete generation for detached execution.
  const live = committed && (runtime?.running === true || result.hot === true || result.recycled === true);
  const verified = committed && warmVerdict(join(store.root, "build/by-input", result.generation)) !== false;
  return {...result, committed: Boolean(committed), live: Boolean(live), verified: Boolean(verified), failureStage};
}
