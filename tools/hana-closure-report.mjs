// What a closure run says about itself (H5x-4 B1): the loop's state file and
// argv helpers, carved out of tools/hana-closure.mjs (its size budget asked
// for exactly this carve), the stub record held once per (class, method),
// and the run summary with its seed guard.
//
// The stub record. A dumper round re-lays gen/hana-src from the layers, so
// every stub of the walk is cut AGAIN in the next iteration's stub round --
// bed run 21 recorded 298 entries for 101 unique (class, method) pairs, and
// the iteration line counted the entries. The record is a Map keyed by
// object, class and method: the latest round's finding wins, `rounds` counts
// how often the method was stubbed, and every reader -- the
// closure-stubs.json `stubs` section, the iteration line, the summary --
// reads the unique pairs.
//
// The summary (gen/hana-closure/closure-summary.json, written at the fixed
// point): {fixed_point, iterations, island_objects, stubs_unique, excluded,
// gaps, seed: {classes, stubbed_methods}, failures}. It is the false-green
// guard of the brief: a green transpile proves nothing when the service's
// own classes were excluded or their reads stubbed away, so the run FAILS
// (after writing the summary) when
// - a seed class -- the registered service's MPC/DPC/_EXT, the closure
//   guard's own set -- is excluded, or one a registration or an island file
//   names is not an island object;
// - a seed-class method matches a --require-unstubbed glob and is stubbed.
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

// ---------------------------------------------------------- state, argv ----

export const loadState = (out) => {
  try {
    return JSON.parse(readFileSync(join(out, "state.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

export const saveState = (out, state) => {
  writeFileSync(join(out, "state.json"), JSON.stringify(state, null, 2) + "\n");
};

export function take(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`hana-closure: ${name} needs a value`);
  args.splice(at, 2);
  return value;
}

/** every value of a repeatable option, in order. */
export function takeAll(args, name) {
  const values = [];
  for (let value = take(args, name); value !== undefined; value = take(args, name)) values.push(value);
  return values;
}

export function has(args, flag) {
  const at = args.indexOf(flag);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

// ---------------------------------------------------------- stub record ----

const stubKey = (r) => `${r.object ?? ""}|${r.class ?? ""}|${String(r.method ?? "").toUpperCase()}`;

/** one applied stub into the walk's record: a (class, method) already there
 *  takes the latest round's fields and counts one more round. Mutates and
 *  returns `record` (a Map). */
export function recordStub(record, stub) {
  const key = stubKey(stub);
  const before = record.get(key);
  record.set(key, {...stub, rounds: (before?.rounds ?? 0) + 1});
  return record;
}

/** the record's unique entries, in first-stubbed order. Pure. */
export const stubList = (record) => [...record.values()];

// ------------------------------------------------------------- summary ----

/** a --require-unstubbed glob as a predicate over (class, method): `*` and
 *  `?`, case-insensitive; a glob with `=>` matches `CLASS=>METHOD`, any
 *  other matches the method name alone. Pure. */
export function unstubbedGlob(glob) {
  const text = String(glob).toUpperCase();
  const re = new RegExp(`^${text.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return (cls, method) => re.test(text.includes("=>") === true
    ? `${String(cls).toUpperCase()}=>${String(method).toUpperCase()}` : String(method).toUpperCase());
}

/** the run summary and its failures. Inputs: `seeds` -- the seed classes
 *  (the closure guard's set); `named` -- those a registration or an island
 *  file named, which must be island objects (a base derived off an _EXT
 *  name is checked only for exclusion; absent, the _EXT's own superclass
 *  ask covers it); `present(name)` -- an island object by file;
 *  `excluded` -- the excluded objects; `stubs` -- the unique stub list;
 *  `gaps` -- [{name, kind}]; `requireUnstubbed` -- the globs. Pure. */
export function closureSummary({fixedPoint = true, iterations, islandObjects, seeds, named = seeds, present, excluded, stubs, gaps, requireUnstubbed = []}) {
  const seedList = [...(seeds ?? [])].map((s) => String(s).toUpperCase()).sort();
  const seedSet = new Set(seedList);
  const excludedList = [...(excluded ?? [])].map((s) => String(s).toUpperCase()).sort();
  const excludedSet = new Set(excludedList);
  const seedStubs = (stubs ?? [])
    .filter((s) => seedSet.has(String(s.object ?? s.class ?? "").toUpperCase()) === true)
    .map((s) => ({class: String(s.object ?? s.class).toUpperCase(), method: String(s.method).toUpperCase()}))
    .sort((a, b) => (a.class + "|" + a.method < b.class + "|" + b.method ? -1 : 1));
  const namedSet = new Set([...(named ?? [])].map((s) => String(s).toUpperCase()));
  const failures = [];
  for (const seed of seedList) {
    if (present(seed) !== true) {
      if (namedSet.has(seed) === true) failures.push(`seed class ${seed} is not an island object`);
    } else if (excludedSet.has(seed) === true) failures.push(`seed class ${seed} is excluded from the build`);
  }
  for (const glob of requireUnstubbed) {
    const match = unstubbedGlob(glob);
    const hit = seedStubs.filter((s) => match(s.class, s.method) === true);
    if (hit.length > 0) {
      failures.push(`--require-unstubbed ${glob}: ${hit.length} seed method(s) stubbed: ${hit.map((s) => `${s.class}=>${s.method}`).join(", ")}`);
    }
  }
  return {
    fixed_point: fixedPoint,
    iterations,
    island_objects: islandObjects,
    stubs_unique: (stubs ?? []).length,
    excluded: excludedList,
    gaps: (gaps ?? []).map((g) => ({name: g.name, kind: g.kind})),
    seed: {classes: seedList, stubbed_methods: seedStubs},
    ...(requireUnstubbed.length > 0 ? {require_unstubbed: [...requireUnstubbed]} : {}),
    failures,
  };
}

/** writes closure-summary.json and throws when the summary carries a
 *  failure: the run exits non-zero, the summary on disk says why. */
export function writeClosureSummary(out, summary) {
  writeFileSync(join(out, "closure-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  if (summary.failures.length > 0) {
    throw new Error(`the fixed point does not carry the service (${join(out, "closure-summary.json")}):\n  ${summary.failures.join("\n  ")}`);
  }
}
