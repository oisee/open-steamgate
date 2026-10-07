import {join} from "node:path";
import {activationJournal, recordBaselineGeneration} from "./osd-activation-journal.mjs";
import {liveHash} from "./osd-build.mjs";
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

// STORE and ADT own different response formats, but every activation attempt
// must leave the same per-object publication outcome for RUN_TESTS.
export function beginActivation(store, named) {
  const journal = activationJournal(store);
  recordBaselineGeneration(store, () => store.served?.generation ?? liveHash(store.root));
  const operations = named.map(({type, name}) => journal.create(type, String(name).toUpperCase()));
  const update = fields => operations.map(op => journal.update(op.op_id, fields));
  return {
    operations,
    update,
    lookup: () => operations.map(op => journal.lookup(op.op_id)),
    fail: (stage, fields = {}) => update({state: "failed", active: false, live: false, failure_stage: stage, ...fields}),
    finish(result, issues = []) {
      return update({state: result.committed && result.generation ? "published" : "failed",
        generation_id: result.committed ? result.generation : "",
        active: result.committed, live: result.live, verified: result.verified,
        failure_stage: result.failureStage,
        note: !result.committed ? result.error ?? result.transpile?.error ?? "publication failed or checked source changed"
          : result.verified ? "published" : "published; warm-unverified",
        issues});
    },
  };
}

export function activationIssues(entries) {
  return entries.flatMap(entry => [entry, ...(entry.dependents ?? [])]).flatMap(entry =>
    (entry.issues ?? []).map(issue => ({type: entry.type, name: entry.name, ...issue})));
}
