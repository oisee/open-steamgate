// Run one plan twice - fused, and forced step by step - and compare.
//
// This is the instrument for the defect class we know we have. An assignment
// to a table variable is **not** an observable barrier on HANA (measured:
// docs/sqlscript-hana-observed.md), so the splitter fuses a chain into one
// statement. Fusing is therefore the semantics rather than a liberty - but it
// also means a projection that could raise may never be evaluated, because
// the engine is free to push a later filter underneath it. Materialising the
// same chain evaluates it and raises.
//
// Neither behaviour is wrong. What is wrong is not knowing which one you got,
// which is why the seam reports `relationKind` with a reason and why this
// exists: the difference between the two runs is a list of the places where
// fusion is doing something observable, and it is the only cheap way to find
// them before somebody finds them in an answer.
//
// It is the same instrument as the branch comparison in track W - one
// question, two executors, the difference is the result - one storey down.
import {lower} from "./sqlscript-lower.mjs";
import {ref} from "./sqlscript-ir.mjs";

const CHILD_KEYS = ["input", "left", "right"];

/** run the plan as the splitter would: one statement, nothing materialised */
export async function runFused(client, rel, dialect) {
  try {
    const {sql, params} = lower(rel, dialect);
    const answer = await client.native({sql, params, expect: "rows"});
    return {rows: answer.rows, statements: 1};
  } catch (error) {
    return {raised: String(error.message ?? error), statements: 1};
  }
}

/**
 * Run the plan with every intermediate forced into a relation of its own -
 * what eager execution would do, and what `NO_INLINE` does on HANA.
 *
 * Bottom-up, because a step can only be defined once its inputs have names.
 * Every definition is created with the reason `lowering-declined`: the seam
 * records why something was materialised, and "because this run is the eager
 * half of a comparison" is an honest reason.
 */
export async function runEager(client, rel, dialect) {
  const handles = [];
  let statements = 0;
  const refOf = (handle) => client.relationRef(handle);

  const notForced = [];

  const materialise = async (node) => {
    // leaves stay as they are: a scan is already a name
    if (node.rel === "scan" || node.rel === "ref") return node;
    const copy = {...node};
    for (const key of CHILD_KEYS) {
      if (copy[key] !== undefined) copy[key] = await materialise(copy[key]);
    }
    if (copy.inputs !== undefined) {
      const done = [];
      for (const one of copy.inputs) done.push(await materialise(one));
      copy.inputs = done;
    }
    const {sql, params} = lower(copy, dialect, {relationRef: refOf});
    if (params.length > 0) {
      // A definition is a view, and a view with an unbound value has no
      // meaning until somebody supplies one - the seam says so in as many
      // words ("bind at use"). So this step CANNOT be forced, and the honest
      // thing is to leave it fused and say which one, rather than to
      // interpolate the value into the text (the one thing this whole
      // contract exists to prevent) or to report a comparison that quietly
      // forced less than it claimed.
      notForced.push({rel: copy.rel, params: params.length});
      return copy;
    }
    statements++;
    const handle = await client.defineRelation({name: "step", sql, materialise: "lowering-declined"});
    handles.push(handle);
    return ref(handle);
  };

  try {
    const last = await materialise(rel);
    const {sql, params} = lower(last, dialect, {relationRef: refOf});
    statements++;
    const answer = await client.native({sql, params, expect: "rows"});
    return {rows: answer.rows, statements, handles, notForced};
  } catch (error) {
    return {raised: String(error.message ?? error), statements, handles, notForced};
  } finally {
    for (const handle of handles.reverse()) {
      try {
        await client.dropRelation(handle);
      } catch {
        // a relation that could not be dropped is not a reason to lose the
        // measurement; it is a reason for the next run to use fresh names
      }
    }
  }
}

/** the same rows, or the same raise? and if not, which way round */
export function compare(fused, eager) {
  if (fused.raised !== undefined || eager.raised !== undefined) {
    if (fused.raised !== undefined && eager.raised !== undefined) {
      return {agree: true, both: "raised"};
    }
    return {
      agree: false,
      // this is the interesting direction and the one HANA showed: fused
      // answers, forced fails, because the filter never let the row reach
      // the expression that would have failed
      kind: fused.raised === undefined ? "fused-answers-eager-raises" : "fused-raises-eager-answers",
      raised: fused.raised ?? eager.raised,
    };
  }
  const left = JSON.stringify(fused.rows);
  const right = JSON.stringify(eager.rows);
  return left === right ? {agree: true, both: "rows"} : {agree: false, kind: "different-rows", fused: left, eager: right};
}

export async function runBothWays(client, rel, dialect) {
  const fused = await runFused(client, rel, dialect);
  const eager = await runEager(client, rel, dialect);
  const verdict = compare(fused, eager);
  // "they agree" means less when some steps could not be forced at all, so
  // the count travels with the verdict instead of being lost in the eager
  // half where nobody would look for it
  if ((eager.notForced ?? []).length > 0) verdict.notForced = eager.notForced;
  return {fused, eager, ...verdict};
}
