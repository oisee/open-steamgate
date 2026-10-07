import {join} from "node:path";
import {warmVerdict} from "./osd-hot.mjs";

// Validation is synchronous, even when publication is deferred to after the
// calling step. The store checks every include in the activation's source view;
// compiler availability must never turn that verdict into a promise.
export function prepareActivation(store, named, {transpile = true, forced = false} = {}) {
  return named.map(o => ({...o, ...(transpile && forced ? store.warmActivation(o.type, o.name)
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
