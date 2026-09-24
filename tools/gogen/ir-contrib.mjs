// What one class adds to the program while it is compiled: the keys it puts
// into the program's Maps and Sets and the rows it appends to its lists.
// compileProgram (frontend.mjs) runs each class's compile through record(),
// and the IR documents carry the result (ir-json.mjs), so that a cache can
// tell which parts of the shared document came from which class.
//
// A value changed in place under a key that was already there -- an array
// under a Map key that another class created -- is not seen: only keys that
// appear, and keys whose value is replaced by another object. The check in
// ir-json-check.mjs counts what the recorded contributions cover.

// currentTypes is the compiler's scratch position (left out of the IR too)
const SKIP = new Set(["classes", "reg", "contributions", "currentTypes"]);

function snapshot(program) {
  const s = new Map();
  for (const [field, v] of Object.entries(program)) {
    if (SKIP.has(field)) continue;
    if (v instanceof Map) s.set(field, {kind: "map", values: new Map(v)});
    else if (v instanceof Set) s.set(field, {kind: "set", values: new Set(v)});
    else if (Array.isArray(v)) s.set(field, {kind: "list", length: v.length});
  }
  return s;
}

function diff(program, before) {
  const out = {};
  for (const [field, v] of Object.entries(program)) {
    if (SKIP.has(field)) continue;
    const was = before.get(field);
    if (v instanceof Map) {
      const keys = [...v].filter(([k, x]) => !was?.values?.has(k) || was.values.get(k) !== x).map(([k]) => k);
      if (keys.length > 0) out[field] = keys;
    } else if (v instanceof Set) {
      const added = [...v].filter((x) => !was?.values?.has(x));
      if (added.length > 0) out[field] = added;
    } else if (Array.isArray(v)) {
      const from = was?.length ?? 0;
      if (v.length > from) out[field] = {appended: v.length - from};
    }
  }
  return out;
}

/** run one class's compile, and keep what it added to the program under its name */
export function record(program, compile) {
  const before = snapshot(program);
  const ir = compile();
  const name = String(ir?.name ?? ir?.go ?? "?");
  program.contributions ??= new Map();
  program.contributions.set(name, diff(program, before));
  return ir;
}
