import {isDeepStrictEqual} from "node:util";

export function analyzeTableMoves(program, stable) {
  const classes = program.classes ?? program;
  const tainted = new Map(), escaped = new Map();
  const attrKey = (name) => `attr:${name.toUpperCase()}`;
  const attributes = new Set(classes.flatMap((c) => (c.attributes ?? []).map((a) => attrKey(a.name))));
  // Follow storage ancestry only: indices and key values are independent.
  // Attribute names deliberately span classes, inheritance and interfaces.
  const keys = (value, cls, method, binding = false) => {
    const result = new Set();
    for (let n = value; n && typeof n === "object"; n = n.base ?? n.table ?? n.x) {
      if (["attr", "refattr", "static"].includes(n.e)) result.add(attrKey(n.name));
      if (n.e === "var" && (!binding || (!n.ref && !method.params?.some((p) => p.name.toUpperCase() === n.name.toUpperCase())
        && !["data", "any", "dref"].includes(n.type?.k))))
        result.add(`local:${cls.name}=>${method.name}:${n.name.toUpperCase()}`);
    }
    return result;
  };
  const record = (map, storage, origin) => {
    for (const key of storage) if (!map.has(key)) map.set(key, origin);
  };
  const literal = (value) => {
    while (value?.x) value = value.x;
    return value?.e === "str" ? value.value : null;
  };
  // every body that can bind or pass storage: methods, the instance
  // constructor (kept apart from cls.methods; critic round 5) and function
  // modules
  const bodies = [...classes.flatMap((cls) => [...(cls.methods ?? []), ...(cls.constructor ? [cls.constructor] : [])].map((method) => [cls, method])),
    ...[...(program.functionModules?.values?.() ?? [])].map((fm) => fm.module).filter((m) => m?.body).map((m) => [{name: "FUNCTION"}, m])];
  for (const [cls, method] of bodies) {
    const origin = (node) => `${cls.name}=>${method.name} ${node.s ?? node.e}`;
    walkMoveBindings(method.body, (value, node) => record(tainted, keys(value, cls, method, true), origin(node)));
    walkMove(method.body, (node) => {
      // Formal direction is used here (IMPORTING without VALUE is by reference).
      // Output wrappers retain the actual in x; RETURNING targets escape too.
      if (node.e === "call" || node.e === "new" || ["call_dyn_static", "call_fm"].includes(node.s)) {
        for (const arg of node.args ?? []) if (arg.dir !== "importing" || !arg.byValue)
          record(escaped, keys(arg.value ?? arg.place ?? arg.wrap, cls, method), origin(node));
        if (node.receiving) record(escaped, keys(node.receiving, cls, method), origin(node));
      }
      // COMPONENT access is bounded by the structure's own storage ancestry.
      if (node.s === "assign_comp") record(escaped, keys(node.from, cls, method), origin(node));
      if (node.s === "assign_name") {
        const name = literal(node.name);
        record(escaped, name === null ? attributes : [attrKey(name)], origin(node));
      }
      // Unsupported dynamic attribute forms retain their source in the stub.
      // Parse only operand positions, never FIELD-SYMBOL(<name>) targets or
      // dynamic class/method/type names. A literal names just that attribute.
      if (node.s === "stub") {
        const text = node.reason ?? "";
        const names = [...text.matchAll(/(?:->|=>)\s*\(\s*([^)]*)\)/g)];
        const assign = text.match(/\bASSIGN\s+\(\s*([^)]*)\)/i);
        if (assign) names.push(assign);
        for (const match of names) {
          const name = match[1].trim().match(/^'((?:[^']|'')*)'$/);
          record(escaped, name ? [attrKey(name[1].replaceAll("''", "'"))] : attributes, origin(node));
        }
      }
    });
  }
  return (st, next, ctx, previous) => {
    while (next?.s === "seq" && next.body.length === 1) next = next.body[0];
    if (st.s !== "assign" || next?.s !== "clear" || st.target.type.k !== "table") return false;
    const b = movePath(st.value), cleared = movePath(next.target);
    if (b ? b.path !== cleared?.path : !isDeepStrictEqual(st.value, next.target)) return false;
    const rule = movePair(st, next, ctx, previous, tainted, escaped, keys, stable);
    if (process.env.GOGEN_MOVE_TRACE === "1")
      console.error(`GOGEN_MOVE_TRACE ${ctx.cls.name}=>${ctx.method.name} ${movePath(st.target)?.path ?? JSON.stringify(st.target)} <- ${b?.path ?? JSON.stringify(st.value)}: ${rule}`);
    return rule === "moved";
  };
}

// Only independent, plain storage paths can transfer table ownership.
// A by-reference parameter may be the very same slot as another parameter.
function movePath(p) {
  if (!p) return null;
  if (p.e === "field") {
    const base = movePath(p.base);
    return base && {...base, path: `${base.path}.${p.name}`};
  }
  if (p.e === "var" && !p.ref) return {root: `var:${p.name}`, path: `var:${p.name}`};
  if (p.e === "attr") return {root: "me", path: `me.${p.name}`};
  if (p.e === "static") return {root: `static:${p.owner}`, path: `static:${p.owner}.${p.name}`};
  if (p.e === "refattr" && p.base.e === "var" && !p.base.ref)
    return {root: `object:${p.base.name}`, path: `object:${p.base.name}.${p.name}`, object: p.base.name};
  return null;
}

function walkMove(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) walkMove(value, visit);
}

const objectRoot = (path) => path?.root === "me" || !!path?.object;
const moveRootsOverlap = (a, b) => a && b && (a.root === b.root || (objectRoot(a) && objectRoot(b)));

function walkMoveBindings(body, visit) {
  walkMove(body, (node) => {
    // Dynamic/dereferenced bindings cannot be proved independent of source.
    if (["assign_deref", "assign_deref_typed", "assign_comp"].includes(node.s)) visit(null, node);
    // the operand bound, not its subexpressions (a key value or an index
    // is not bound)
    if (node.s === "get_ref" || node.s === "assign_data" || node.fs || node.refInto) {
      for (const value of [node.table, node.value, node.from]) if (value?.e) visit(value, node);
    }
  });
}

function moveBound(source, method) {
  let bound = false;
  walkMoveBindings(method.body, (value, node) => {
    const path = movePath(value);
    if (!bound && (!path || moveRootsOverlap(path, source))) bound = node;
  });
  return bound;
}

function movePair(st, next, ctx, previous, tainted, escaped, keys, stable) {
  while (next?.s === "seq" && next.body.length === 1) next = next.body[0];
  if (st.s !== "assign" || next?.s !== "clear" || st.target.type.k !== "table") return false;
  const a = movePath(st.target), b = movePath(st.value), cleared = movePath(next.target);
  if (!a || !b || b.path !== cleared?.path || a.root === b.root) return "alias";
  if (!isDeepStrictEqual(st.target.type, st.value.type)) return "type";
  // All table kinds currently use slices, but keep keyed tables on the
  // established copying path (including their row representation/metadata).
  if (st.value.type.sorted || st.value.type.hashed || st.value.type.secondary?.length) return "keyed";
  if (ctx.loopStack?.some((loop) => moveRootsOverlap(movePath(loop.table), b))) return "loop";
  const binding = moveBound(b, ctx.method);
  if (binding) return `moveBound ${[...keys(st.value, ctx.cls, ctx.method)].join(",")} by ${ctx.cls.name}=>${ctx.method.name} ${binding.s}`;
  if (stable(st.value.type)) return "stable";
  for (const key of keys(st.value, ctx.cls, ctx.method)) {
    if (tainted.has(key)) return `boundStorage ${key} by ${tainted.get(key)}`;
    if (escaped.has(key)) return `escapedStorage ${key} by ${escaped.get(key)}`;
  }
  // Two object references can name the same object, even with different names.
  // A fresh result object and me are distinct; this covers Array.splice1.
  if (a.object || b.object) {
    const obj = a.object ? a : b, other = a.object ? b : a;
    if (other.object) return "object-root";
    if (other.root === "me") {
      if (previous?.s !== "assign" || previous.target.e !== "var"
        || previous.target.name !== obj.object || previous.value.e !== "new") return "object-root";
    } else if (!other.root.startsWith("var:")) return "object-root";
  }
  return "moved";
}
