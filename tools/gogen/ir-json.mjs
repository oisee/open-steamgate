// The gogen IR as JSON: the program compileProgram (frontend.mjs) builds,
// written so that a reader in another process -- the Go side, or a later
// build that did not parse the ABAP again -- gets the same program back.
//
// Shape (docs in tools/gogen/README.md, "The IR as JSON"):
//   {"ir": "gogen", "version": 1, "program": {...}}             the shared part
//   {"ir": "gogen", "version": 1, "object": "ZCL_X", "class": {...}}  one per class,
//                                                                     function group
// The emitters read Maps and Sets, so both are carried with a tag:
//   {"$map": [[key, value], ...]}   in insertion order
//   {"$set": [value, ...]}          in insertion order
//   {"$bigint": "123"}
//   {"$id": n, ...} / {"$id": n, "$array": [...]}   a node that is reached more
//   {"$ref": n}                                     than once, and every later reach
// The IR is a graph, not a tree: a DELETE inside a LOOP holds the loop's own
// node, and the emitters write the loop's index name into it and read it back
// through that reference. A copy would read nothing (it did: `[:undefined]`),
// so a node reached twice in one document is written once and referred to
// after; ids are numbered in the order the writer meets them, per document.
// Plain objects keep their keys in insertion order. The front end builds the
// same program in the same order from the same input, so the JSON is
// byte-identical run to run; nothing is sorted here, because the emitters
// iterate in that order and sorting would change what they write.
//
// What does not travel: `reg`, the abaplint registry the front end parsed
// with, and `functionModules` (see DROPPED). Anything else that is not plain data -- a class instance, a
// function -- is refused with its path, so a node that still holds an
// abaplint object is found here and not in the reader.

import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

export const IR_VERSION = 1;

/** the IR is whatever these files make of the ABAP: a document names them by
 *  hash, and a reader refuses a document from other sources, since a change
 *  to the front end changes the IR without changing IR_VERSION */
const SOURCES = ["frontend.mjs", "emit-go.mjs", "emit-js.mjs", "ir-json.mjs"];
export function irSource() {
  const h = createHash("sha256");
  for (const f of SOURCES) h.update(f).update("\0").update(readFileSync(new URL(`./${f}`, import.meta.url))).update("\0");
  return h.digest("hex").slice(0, 16);
}
// front-end state that holds abaplint objects and that no emitter reads:
// the registry, and the function modules' groups, modules and scopes (their
// compiled form is in `classes`, as a function group's class)
// and the compiler's scratch position (current*), which depends on the order
// it compiled in
const DROPPED = new Set(["reg", "functionModules", "currentClass", "currentOwner", "currentTypes"]);
// written by the emitters into the IR while they emit (a loop's index
// variable), and different per emitter: not IR, dropped wherever it stands
const EMITTER_SCRATCH = new Set(["idxVar"]);

/** the objects reached more than once from `root`, by identity */
function sharedIn(root) {
  const seen = new Set();
  const shared = new Set();
  const walk = (v) => {
    if (v === null || typeof v !== "object") return;
    if (seen.has(v)) { shared.add(v); return; }
    seen.add(v);
    if (v instanceof Map) for (const [k, x] of v) { walk(k); walk(x); }
    else if (v instanceof Set || Array.isArray(v)) for (const x of v) walk(x);
    else for (const x of Object.values(v)) walk(x);
  };
  walk(root);
  return shared;
}

function encoder(root) {
  const shared = sharedIn(root);
  const ids = new Map();
  const encode = (value, path) => {
    if (value !== null && typeof value === "object" && shared.has(value)) {
      if (ids.has(value)) return {$ref: ids.get(value)};
      const id = ids.size;
      ids.set(value, id);
      const body = plain(value, path, encode);
      return Array.isArray(body) ? {$id: id, $array: body} : {$id: id, ...body};
    }
    return plain(value, path, encode);
  };
  return encode;
}

function plain(value, path, encode) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: ${value} is not a JSON number`);
    if (Object.is(value, -0)) throw new Error(`${path}: -0 would come back as 0`);
    return value;
  }
  if (typeof value === "bigint") return {$bigint: String(value)};
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!(i in value)) throw new Error(`${path}[${i}]: a hole in an array would come back as null`);
    return value.map((v, i) => {
      if (v === undefined) throw new Error(`${path}[${i}]: undefined in an array would come back as null`);
      return encode(v, `${path}[${i}]`);
    });
  }
  if (value instanceof Map) return {$map: [...value].map(([k, v], i) => [encode(k, `${path}<key ${i}>`), encode(v, `${path}<${String(k)}>`)])};
  if (value instanceof Set) return {$set: [...value].map((v, i) => encode(v, `${path}{${i}}`))};
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path}: a ${value.constructor?.name ?? "non-plain object"} is not IR data`);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (EMITTER_SCRATCH.has(k)) continue;
      if (k.startsWith("$")) throw new Error(`${path}.${k}: a key starting with $ would read back as a tag`);
      const e = encode(v, `${path}.${k}`);
      if (e !== undefined) out[k] = e;
    }
    return out;
  }
  throw new Error(`${path}: a ${typeof value} is not IR data`);
}

function decoder() {
  const byId = new Map();
  const decode = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decode);
    if ("$ref" in value) {
      if (!byId.has(value.$ref)) throw new Error(`$ref ${value.$ref} before its $id`);
      return byId.get(value.$ref);
    }
    // a node with an $id is registered before its contents are read, so a
    // $ref inside it (or to it, later) finds it -- a Map and a Set as well
    if ("$map" in value) {
      const m = new Map();
      if ("$id" in value) byId.set(value.$id, m);
      for (const [k, v] of value.$map) m.set(decode(k), decode(v));
      return m;
    }
    if ("$set" in value) {
      const set = new Set();
      if ("$id" in value) byId.set(value.$id, set);
      for (const v of value.$set) set.add(decode(v));
      return set;
    }
    if ("$bigint" in value) return BigInt(value.$bigint);
    if ("$array" in value) {
      const out = [];
      byId.set(value.$id, out);
      for (const v of value.$array) out.push(decode(v));
      return out;
    }
    const out = {};
    if ("$id" in value) byId.set(value.$id, out);
    for (const [k, v] of Object.entries(value)) if (k !== "$id") out[k] = decode(v);
    return out;
  };
  return decode;
}

const nameOf = (cls, i) => String(cls.name ?? cls.go ?? `#${i}`);

/** the program as documents: one shared, and one per class (the unit a
 *  build can keep by the hash of its source) */
export function toDocuments(program) {
  const shared = {};
  for (const [k, v] of Object.entries(program)) {
    if (DROPPED.has(k) || k === "classes") continue;
    shared[k] = v;
  }
  const source = irSource();
  const objects = program.classes.map((cls, i) => ({ir: "gogen", version: IR_VERSION, source, object: nameOf(cls, i), class: encoder(cls)(cls, `classes[${i}]`)}));
  const names = new Set();
  for (const o of objects) {
    if (names.has(o.object)) throw new Error(`two classes named ${o.object}: the second would replace the first when read back`);
    names.add(o.object);
  }
  return {program: {ir: "gogen", version: IR_VERSION, source, order: objects.map((o) => o.object), program: encoder(shared)(shared, "program")}, objects};
}

/** the program back from its documents, classes in the order the front end had them */
export function fromDocuments({program, objects}, {source = irSource()} = {}) {
  for (const d of [program, ...objects]) {
    if (d.ir !== "gogen" || d.version !== IR_VERSION) throw new Error(`not gogen IR version ${IR_VERSION}: ${JSON.stringify({ir: d.ir, version: d.version})}`);
    if (d.source !== source) throw new Error(`${d.object ?? "the program document"} was written by front-end sources ${d.source}, these are ${source}`);
  }
  const byName = new Map(objects.map((o) => [o.object, o]));
  const out = decoder()(program.program);
  out.classes = program.order.map((name) => {
    const o = byName.get(name);
    if (o === undefined) throw new Error(`object ${name} is in the order and has no document`);
    return decoder()(o.class);
  });
  return out;
}

/** a document as text: compact JSON, keys in the order they were built */
export const text = (doc) => JSON.stringify(doc) + "\n";
