// The per-object front-end cache of the osgo fast path. README:
// tools/gogen/osgo-incr.md; the measurements and the design against the
// runners' whole-tree cache: docs/osgo-fast-rebuild.md "The incremental
// front end".
//
// A full front end (compileOsg without a fast proof) records, per object of
// the tree and the libraries, what its lowering produced (the class IRs, the
// writes it made to the shared program state, in order) and what it depended
// on (the registry objects it read, the classes and interfaces it named, the
// owner of every generated type name). A fast build -- osgo-fast.mjs proved
// that only the *content* of existing classes and interfaces changed since
// the live generation -- re-lowers the edited objects and everything that
// transitively depends on them, in a registry that holds only that closure
// plus every non-class object, and takes every other object's lowered IR
// from this cache, replaying the recorded writes in the original order so
// the shared state is exactly the state the full build would have had.
//
// Anything it cannot prove refuses, and the caller runs the full front end:
// a missing or unreadable entry, a non-serialisable IR, a syntax error in a
// re-lowered object, a changed broken-set, an anonymous structure an edit
// could have renamed. The cache never guesses.
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import {deserialize, serialize} from "node:v8";
import {deflateRawSync, inflateRawSync} from "node:zlib";
import {compileProgram, defaultValue, aliasTarget} from "./frontend.mjs";
import {caughtIndex} from "./frontend-hierarchy.mjs";
import {core} from "./frontend-inventory.mjs";
import {referencedClasses} from "./emit-go.mjs";
import {callsIn, goSymbol} from "./go-layers.mjs";
import {objectOfFile} from "./osgo-layers.mjs";
import {portable, toolIdentity} from "./frontend-object-cache.mjs";
import {prepareDynamicStatics} from "./frontend-dynamic-call.mjs";

export const SCHEMA = "osgo-incr/4";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const upper = (text) => String(text).toUpperCase();
const walk = (d) => readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
/** every ABAP word of a source, namespace forms included */
const wordsOf = (text) => new Set(text.toUpperCase().match(/(?:\/[A-Z0-9_]+\/)?[A-Z_][A-Z0-9_]*/g) ?? []);
const keyOf = (type, name) => `${type} ${name}`;

/** the registry object a file belongs to: ["CLAS"|"INTF"|"FUGR"|"DDIC"|"OTHER", NAME] */
export function objectOf(fileName) {
  const name = fileName.split("/").at(-1);
  if (/\.clas\./i.test(name)) return ["CLAS", objectOfFile(name)];
  if (/\.intf\./i.test(name)) return ["INTF", objectOfFile(name)];
  if (/\.fugr\./i.test(name)) return ["FUGR", objectOfFile(name)];
  // `type` is the ABAP type pool (`abap.type.abap` of a library): ABAP the
  // syntax pass resolves (`abap_component_tab` of the RTTI classes), not XML
  const kind = /\.(tabl|ttyp|dtel|doma|view|enqu|msag|prog|type|w3mi|shlp|tran|webi|xslt|suso|suvo|tobj|iacg|iamu|iext|iobj|sfp|susc)(?:\.[a-z_]+)?\.(abap|xml)$/i.exec(name)?.[1];
  return [kind ? "DDIC" : "OTHER", objectOfFile(name)];
}

/** the files compileProgram loads, the way its own walk decides: absolute
 *  path -> object key. A read-side `skip` narrows the registry to a subset
 *  of exactly these files, so no other rule can differ. */
export function registryFiles(folders, hidden, includeTests) {
  const files = new Map();
  for (const folder of folders) {
    for (const file of walk(folder)) {
      const name = file.split("/").at(-1);
      if (hidden.has(file) || !/\.(abap|xml)$/i.test(name) || /\.ddls\.xml$/i.test(name)) continue;
      if (/\.clas\.testclasses\.abap$/i.test(name)
          && !(includeTests === true || (includeTests instanceof Set && includeTests.has(objectOfFile(name))))) continue;
      const [type, object] = objectOf(name);
      if (type === "OTHER") continue;
      files.set(file, keyOf(type, object));
    }
  }
  return files;
}

/** the class, interface and type names one lowered class IR spells: what
 *  another object's lowering could have read through it */
function irNames(ir) {
  const refs = new Set(), types = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    if (node.e === "call" && node.owner) refs.add(node.owner);
    if (node.cls) refs.add(node.cls);
    const t = node.type;
    if (t && typeof t === "object") visitType(t);
    for (const [k, v] of Object.entries(node)) if (k !== "type") visit(v);
  };
  const visitType = (t) => {
    if (Array.isArray(t)) { t.forEach(visitType); return; }
    if (!t || typeof t !== "object") return;
    if (t.k === "ref" && t.name) refs.add(t.name);
    if (t.k === "struct" && t.go) types.add(t.go);
    if (t.row) visitType(t.row);
  };
  visit(ir);
  return {refs, types};
}

/** the collections whose lowering-time writes replay at read time. Fields
 *  assigned later (locals, functionModules, lockObjects, the final-output
 *  analyses) are rebuilt by the fresh compile, not replayed. */
const RECORDED = ["structs", "consts", "sigs", "events", "missing", "dynStatics", "excAttrs", "intfOwnAttrs",
  "badStructs", "ddicOutputLen", "interfaces", "skipped", "partial", "classes"];

/** every op of one collection an object's lowering made, all its passes in
 *  order (a payload holds them per segment: one segment per `enter`) */
const flatOps = (payload, coll) => (payload?.segs ?? []).flatMap((seg) => seg[coll] ?? []);

/** the component names of an anonymous structure: what both builds can
 *  name it by (abaplint keys it by type instance, which a new registry
 *  does not share) */
const shapeOf = (t) => { try { return t.getComponents().map((c) => upper(c.name)).join(","); } catch { return undefined; } };

/** where a write outside every object's mark (a global pass) sits in the
 *  sequence of segments: "A" before the first segment of the discovery
 *  phase, "B" after its last, "C" before the first segment of the lowering
 *  phase, "D" after its last; null anywhere else. With no segment in a
 *  phase its two slots are one ("AB" / "CD"). */
function straySlot(phase, at, count) {
  if (count === 0) return phase === 0 ? "AB" : "CD";
  if (at === 0) return phase === 0 ? "A" : "C";
  if (at === count) return phase === 0 ? "B" : "D";
  return null;
}

// ---------------------------------------------------------------------------
// the write side
// ---------------------------------------------------------------------------

/** a proxy over one of the shared collections that turns every mutating
 *  call into an op (`["set",k,v]`, `["add",v]`, `["delete",k]`, `["clear"]`,
 *  `["push",v]`), handed to `onOp` -- the write side records the ops of an
 *  object's lowering, the read side the ops of the fresh one, and both then
 *  agree on what a replay of those ops does */
function opProxy(coll, value, onOp) {
  return new Proxy(value, {
    get(target, method) {
      const member = target[method];
      if (typeof member !== "function") return member;
      if (method === "set") return (k, v) => { onOp(["set", k, v]); return target.set(k, v); };
      if (method === "add") return (v) => { onOp(["add", v]); return target.add(v); };
      if (method === "delete") return (k) => { onOp(["delete", k]); return target.delete(k); };
      if (method === "clear") return () => { onOp(["clear"]); return target.clear(); };
      if (method === "push") return (...vs) => { for (const v of vs) onOp(["push", v]); return target.push(...vs); };
      return member.bind(target);
    },
  });
}

/**
 * The recorder a full compileOsg installs into compileProgram. Nothing it
 * does changes the compile; `finish` writes the cache of one generation.
 * @param {{root: string, folders: string[], hidden: Set<string>, objects: string[], includeTests: Set<string>}} o
 */
export function incrRecorder({root, folders, hidden, objects, includeTests}) {
  const buckets = new Map();
  const order = []; // first-enter order
  // the full build's write sequence: one segment per `enter`, in the order
  // compileProgram enters them -- the local discovery, the class pass, the
  // local classes after every class, the function groups -- as
  // [key, occurrence of that key, phase]. An object's writes belong to the
  // segment they were made in, not to the object as a whole: the locals
  // pass writes an owner's local types after EVERY class, and a merge that
  // grouped them at the owner's slot moved them (LCL_STACK__TY_DATA).
  const segments = [];
  const phaseCount = [0, 0];
  let current = null;
  let lowering = false;
  let program;
  const bucket = (key) => {
    if (!buckets.has(key)) buckets.set(key, {key, segs: [], reads: new Set(), supplied: [], rttiDefs: [], anon: new Map()});
    return buckets.get(key);
  };
  // a write outside any object's mark is a global pass, which the fast
  // build runs again over its own registry; recorded here is only WHERE it
  // ran in the segment sequence, so the reader can put its own there and
  // refuse when the layout is not one it can reproduce
  const straySlots = {};
  const record = (coll, op) => {
    if (current === null) {
      // the phase's segment count is not known yet: remember the position,
      // classify it at finish
      const phase = lowering ? 1 : 0;
      (straySlots[coll] ??= []).push([phase, phaseCount[phase]]);
      return;
    }
    const seg = bucket(current).segs.at(-1);
    (seg[coll] ??= []).push(op);
  };
  const proxy = (coll, value) => opProxy(coll, value, (op) => record(coll, op));
  const ownership = new Map();
  return {
    // the compileProgram hooks (frontend.mjs)
    prepare(p, reg) {
      program = p;
      for (const coll of RECORDED) {
        if (p[coll] instanceof Map || p[coll] instanceof Set || Array.isArray(p[coll])) p[coll] = proxy(coll, p[coll]);
      }
      // which names each object's lowering gave the anonymous structures it
      // reached, per shape, and how many distinct instances of the shape it
      // reached: the reader pins a fresh lowering to the full build's name
      const anon = p.anonStructs;
      const note = (t, go) => {
        if (current === null) return;
        const shape = shapeOf(t);
        if (shape === undefined) return;
        const b = bucket(current);
        if (!b.anon.has(shape)) b.anon.set(shape, {names: new Set(), instances: new Set()});
        b.anon.get(shape).names.add(go);
        b.anon.get(shape).instances.add(t);
      };
      p.anonStructs = {
        get(t) { const go = anon.get(t); if (go !== undefined) note(t, go); return go; },
        set(t, go) { note(t, go); anon.set(t, go); return this; },
        has(t) { return anon.has(t); },
      };
      const get = reg.getObject.bind(reg);
      reg.getObject = (type, name) => {
        const value = get(type, name);
        if (type && name && current !== null) bucket(current).reads.add(keyOf(upper(type), upper(name)));
        return value;
      };
    },
    enter(key) {
      if (!order.includes(key)) order.push(key);
      const b = bucket(key);
      b.segs.push({});
      segments.push([key, b.segs.length - 1, lowering ? 1 : 0]);
      phaseCount[lowering ? 1 : 0] += 1;
      current = key;
    },
    exit() { current = null; },
    lowering() { lowering = true; },
    suppliedOf(owner, contributed) { bucket(keyOf("CLAS", owner)).supplied = contributed; },
    rttiOf(owner, defs) { bucket(keyOf("CLAS", owner)).rttiDefs = defs; },
    ownershipOf(name, value) { ownership.set(upper(name), {names: [...value.names], dynamic: value.dynamic}); },
    /** write the cache of generation `gen`; returns what it wrote */
    finish({gen}) {
      const dir = join(root, "build", "osgo-incr", gen);
      const reg = program.reg;
      // which bucket pushed each class, off the recorded push ops
      const pushedNames = new Map(); // class name -> bucket key
      for (const b of order) for (const op of flatOps(bucket(b), "classes")) if (op[0] === "push") pushedNames.set(op[1].name ?? op[1], b);
      const supers = Object.fromEntries([...reg.getObjects()].filter((o) => o.getType() === "CLAS")
        .map((o) => [upper(o.getName()), o.getDefinition()?.getSuperClass()?.toUpperCase() ?? null]));
      // per pushed class or interface: the symbols its generated type names
      // start with (a class's local types, an interface's, and the anonymous
      // structure named after the class that first used its shape)
      const symbolOwner = new Map([...pushedNames].map(([name, key]) => [goSymbol(name), key]));
      for (const intf of program.interfaces) symbolOwner.set(goSymbol(intf), keyOf("INTF", intf));
      const symbols = [...symbolOwner.keys()].sort((a, b) => b.length - a.length);
      const anonNames = new Map([...program.structs].filter(([, st]) => st?.qname === undefined));
      const entries = {};
      const filesByObject = new Map();
      for (const [file, key] of registryFiles(folders, hidden, includeTests)) {
        if (!filesByObject.has(key)) filesByObject.set(key, []);
        filesByObject.get(key).push(file);
      }
      let allPortable = true;
      for (const [key, b] of buckets) {
        const irs = program.classes.filter((c) => pushedNames.get(c.name) === key);
        const deps = new Set(b.reads);
        const anonRefs = new Set();
        for (const ir of irs) {
          const names = irNames(ir);
          const bodyRefs = new Set();
          for (const method of [...ir.methods ?? [], ...(ir.stubs ?? [])]) callsIn(method.body ?? [], bodyRefs);
          if (Object.hasOwn(ir, "constructor")) callsIn(ir.constructor?.body ?? [], bodyRefs);
          for (const ref of [...referencedClasses({...program, classes: [ir], structs: new Map()}), ...bodyRefs, ...names.refs]) {
            for (const type of ["CLAS", "INTF"]) if (buckets.has(keyOf(type, ref))) deps.add(keyOf(type, ref));
          }
          if (ir.super && buckets.has(keyOf("CLAS", ir.super))) deps.add(keyOf("CLAS", ir.super));
          for (const intf of ir.interfaces ?? []) if (buckets.has(keyOf("INTF", intf))) deps.add(keyOf("INTF", intf));
          for (const name of names.types) {
            const owner = symbolOwner.get(symbols.find((s) => name.startsWith(s + "__")));
            if (owner !== undefined && owner !== key) { deps.add(owner); if (anonNames.has(name)) anonRefs.add(name); }
          }
        }
        deps.delete(key);
        /** @type {any} */ const payload = {key, ir: Object.fromEntries(irs.map((c) => [c.name, c])),
          segs: b.segs, reads: [...b.reads], supplied: b.supplied, rttiDefs: b.rttiDefs};
        let ok = true;
        try { if (!portable(payload)) ok = false; } catch { ok = false; }
        // the file name the registry gives each pushed class (status.mjs
        // counts a pack's objects by it): recorded as the full build has it
        const regFiles = Object.fromEntries(irs.map((c) => [c.name, (reg.getObject("CLAS", c.name) ?? reg.getObject("INTF", c.name))?.getFiles?.()[0]?.getFilename?.()])
          .filter(([, f]) => f !== undefined));
        const entry = {deps: [...deps].sort(), reads: [...b.reads].sort(), pushed: irs.map((c) => c.name), regFiles,
          anonRefs: [...anonRefs].sort(), broken: false, segs: b.segs.length,
          anonUse: Object.fromEntries([...b.anon].map(([shape, u]) => [shape, {names: [...u.names], instances: u.instances.size}])),
          super: irs.find((c) => !c.name.includes(":"))?.super ?? supers[key.slice(5)] ?? null,
          files: Object.fromEntries((filesByObject.get(key) ?? []).map((f) => [relative(root, f), sha(readFileSync(f))]))};
        if (ok) {
          try {
            mkdirSync(join(dir, "e"), {recursive: true});
            const bytes = deflateRawSync(serialize(payload));
            const file = join(dir, "e", `${sha(key)}.bin`);
            const temp = `${file}.${process.pid}.pending`;
            writeFileSync(temp, bytes);
            renameSync(temp, file);
            entry.digest = sha(bytes);
          } catch { ok = false; }
        }
        entry.portable = ok;
        if (!ok) allPortable = false;
        entries[key] = entry;
      }
      const broken = [...program.broken].map(upper);
      for (const name of broken) if (!entries[keyOf("CLAS", name)] && !entries[keyOf("INTF", name)]) entries[keyOf("CLAS", name)] = {deps: [], reads: [], pushed: [], anonRefs: [], broken: true, super: supers[name] ?? null, files: {}, portable: true};
      // the global passes' slots, per collection; a write in the middle of
      // a phase is a layout the reader cannot reproduce, and it refuses
      const slots = {};
      let strayLayoutOk = true;
      for (const [coll, positions] of Object.entries(straySlots)) {
        for (const [phase, at] of positions) {
          const slot = straySlot(phase, at, phaseCount[phase]);
          if (slot === null) strayLayoutOk = false;
          else (slots[coll] ??= new Set()).add(slot);
        }
      }
      const index = {schema: SCHEMA, tool: toolIdentity(), folders, objects, order, segments, strayLayoutOk,
        straySlots: Object.fromEntries(Object.entries(slots).map(([c, s]) => [c, [...s].sort()])),
        classes: program.classes.map((c) => [pushedNames.get(c.name), c.name]),
        entries, broken, supers, wanted: [...program.wanted],
        // the CDS views are read off the .ddls.asddls sources, which the
        // closure registry never holds (registryFiles takes .abap/.xml
        // only), so the fast build's own registry cannot rebuild them -- and
        // a CDS source is not a class or interface, so on the fast path it
        // cannot have changed either; the recorded map is the answer
        cdsViews: {...program.cdsViews},
        diagnostics: program.diagnostics.map((d) => `${upper(d.object)}\0${d.message}`),
        rtti: {structs: [...program.rtti.structs], known: [...program.rtti.known], classSupers: [...program.rtti.classSupers]},
        ownership: [...ownership],
        aliased: [...reg.getObjects()].filter((o) => o.getType() === "CLAS" && ((o.getDefinition()?.getAliases?.().getAll?.() ?? []).length > 0)).map((o) => upper(o.getName())),
        registryOrder: [...reg.getObjects()].map((o) => keyOf(o.getType(), upper(o.getName()))),
        includeTests: [...includeTests].sort(), allPortable};
      writeIndex(dir, index);
      pruneGenerations(join(root, "build", "osgo-incr"), gen);
      return {dir, objects: Object.keys(entries).length, allPortable};
    },
  };
}

function writeIndex(dir, index) {
  mkdirSync(dir, {recursive: true});
  const file = join(dir, "index.json"), temp = `${file}.${process.pid}.pending`;
  writeFileSync(temp, JSON.stringify(index));
  renameSync(temp, file);
}

/** keep the newest few generations of the cache (a fast build reads the live
 *  one; older ones only take space) */
function pruneGenerations(root, current) {
  try {
    const gens = readdirSync(root, {withFileTypes: true}).filter((e) => e.isDirectory()).map((e) => ({name: e.name, used: statSync(join(root, e.name)).mtimeMs})).sort((a, b) => b.used - a.used);
    for (const {name} of gens.slice(3)) if (name !== current) rmSync(join(root, name), {recursive: true, force: true});
  } catch { /* cache housekeeping must not fail a build */ }
}

// ---------------------------------------------------------------------------
// the read side
// ---------------------------------------------------------------------------

/** abaplint keys anonymous structures by type instance; a new registry has
 *  new instances, so the substitute answers by the component names the
 *  write-time build named, which is the same answer whenever abaplint
 *  shared the instance -- and never invents one (a miss lowers as the full
 *  build would, naming the structure after the class that reached it) */
class AnonShapes {
  /** @param {Map<string, string>} seed shape -> the one name the write-time build gave it
   *  @param {() => string | null} currentKey the object lowering now
   *  @param {(key: string) => Record<string, {names: string[], instances: number}> | undefined} useOf what that object reached in the full build
   *  @param {Set<string>} namedShapes every shape some object of the full build named */
  constructor(seed, currentKey = () => null, useOf = () => undefined, namedShapes = new Set()) {
    Object.assign(this, {seed, currentKey, useOf, namedShapes});
    this.mine = new Map();
    this.reached = new Map(); // key \0 shape -> Set of instances (this build)
    this.doubt = undefined;
  }
  /** the full build named every instance of a shape after the FIRST object
   *  to reach it in its own order; a fresh lowering reaches it in another
   *  order (the first reacher may be cached), so it takes the name its own
   *  object used in the full build -- when that is one name, and it reaches
   *  no more instances of the shape than it did then. Anything else is a
   *  doubt, and the caller refuses. */
  get(t) {
    const key = this.currentKey();
    const shape = shapeOf(t);
    if (key === null || shape === undefined) {
      if (this.mine.has(t)) return this.mine.get(t);
      return shape === undefined ? undefined : this.seed.get(shape);
    }
    const seen = `${key}\0${shape}`;
    if (!this.reached.has(seen)) this.reached.set(seen, new Set());
    this.reached.get(seen).add(t);
    const use = this.useOf(key)?.[shape];
    if (use !== undefined && this.reached.get(seen).size > use.instances) {
      this.doubt ??= `${key} reaches more anonymous structures of the shape ${shape} than in the live generation`;
    }
    if (this.mine.has(t)) {
      const go = this.mine.get(t);
      if (use !== undefined && !use.names.includes(go)) this.doubt ??= `${key} reaches the anonymous structure ${go} the live generation named ${use.names.join("/")}`;
      return go;
    }
    if (use !== undefined && use.names.length === 1) { this.mine.set(t, use.names[0]); return use.names[0]; }
    if (use !== undefined) { this.doubt ??= `${key} named the anonymous shape ${shape} ${use.names.join(" and ")} in the live generation`; return undefined; }
    // the edit reaches a shape this object did not: when some other object
    // of the full build named it, which name the full build gives this
    // instance depends on who reached it first -- not provable here
    if (this.namedShapes.has(shape)) { this.doubt ??= `${key} newly reaches the anonymous shape ${shape}`; return undefined; }
    return undefined;
  }
  set(t, go) { this.mine.set(t, go); }
  has(t) { return this.get(t) !== undefined; }
  seededNames() { return new Set(this.seed.values()); }
}

/**
 * The program of a fast build, assembled from the cache of the live
 * generation plus fresh lowerings of the edited objects and their
 * dependents, or why that cannot be done.
 * @param {{root: string, folders: string[], objects: string[], hidden: Set<string>, includeTests: Set<string>, proof: {ok: true, base: string, changed: string[]}}} o
 */
export function incrAssemble({root, folders, objects, hidden, includeTests, proof}) {
  const dir = join(root, "build", "osgo-incr", proof.base);
  const notes = [];
  let index;
  try { index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")); }
  catch { return {ok: false, reason: `no per-object cache of the live generation ${proof.base}`}; }
  if (index.schema !== SCHEMA) return {ok: false, reason: `the per-object cache has schema ${index.schema}, not ${SCHEMA}`};
  if (index.tool !== toolIdentity()) return {ok: false, reason: "the front end changed since the cache was written"};
  if (JSON.stringify(index.folders) !== JSON.stringify(folders)) return {ok: false, reason: "the layer folders changed since the cache was written"};
  if (JSON.stringify(index.objects) !== JSON.stringify(objects)) return {ok: false, reason: "the object list changed since the cache was written"};
  if (JSON.stringify(index.includeTests) !== JSON.stringify([...includeTests].sort())) return {ok: false, reason: "the ABAP Unit owners changed since the cache was written"};

  const edited = new Set();
  for (const file of proof.changed) {
    const [type, name] = objectOf(file);
    if (type !== "CLAS" && type !== "INTF") return {ok: false, reason: `${file}: the edit is not of a class or interface`};
    // an interface is not lowered on its own -- no entry -- but every object
    // that implements or names it depends on it, and its methods are
    // computed again from its (edited) definition either way
    if (type === "CLAS" && !index.entries[keyOf(type, name)]) return {ok: false, reason: `${file}: the cache has no entry for ${type} ${name}`};
    edited.add(keyOf(type, name));
  }
  // what a fast build must re-lower: the edited objects and, transitively,
  // every object that depends on one (read it, called it, named a type it
  // owns); an entry whose IR did not serialise always re-lowers
  const dependents = new Map();
  for (const [key, entry] of Object.entries(index.entries)) for (const dep of entry.deps ?? []) {
    if (!dependents.has(dep)) dependents.set(dep, []);
    dependents.get(dep).push(key);
  }
  const relower = new Set(edited);
  for (let queue = [...edited]; queue.length > 0;) {
    const next = [];
    for (const key of queue) for (const dep of dependents.get(key) ?? []) if (!relower.has(dep)) { relower.add(dep); next.push(dep); }
    queue = next;
  }
  for (const [key, entry] of Object.entries(index.entries)) if (entry.portable === false) relower.add(key);
  notes.push(`re-lowering ${relower.size} of ${Object.keys(index.entries).length} objects (edited: ${[...edited].join(", ")})`);

  // the registry of the fast build: every non-class object, plus the
  // reference closure of the classes it re-lowers -- their recorded reads
  // and deps, and every class whose name any member's text spells (a
  // reference the lowering stubs out is in neither recorded set, and
  // abaplint's syntax pass resolves it anyway)
  const allFiles = registryFiles(folders, hidden, includeTests);
  const byKey = new Map(); // object key -> [files]
  for (const [file, key] of allFiles) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(file);
  }
  const need = new Set();
  const queue = []; // every member whose references still walk: the classes
  // re-lowered plus every non-class object, all of them in the registry
  for (const [key, files] of byKey) {
    if (key.startsWith("CLAS ") && !relower.has(key)) continue;
    for (const f of files) need.add(f);
    queue.push(key);
  }
  // the CDS sources: compileProgram reads their SQL view names off them,
  // and the lowering (a SELECT from a CDS name) and the table registry ask
  // for those; registryFiles leaves them out, they are not registry objects
  for (const folder of folders) for (const f of walk(folder)) if (/\.ddls\.asddls$/i.test(f) && !hidden.has(f)) need.add(f);
  const wordCache = new Map();
  const words = (key) => {
    if (wordCache.has(key)) return wordCache.get(key);
    const set = new Set();
    for (const f of byKey.get(key) ?? []) if (/\.abap$/i.test(f)) for (const w of wordsOf(readFileSync(f, "utf8"))) set.add(w);
    wordCache.set(key, set);
    return set;
  };
  const enqueued = new Set(queue.filter((k) => k.startsWith("CLAS ")));
  for (let i = 0; i < queue.length; i += 1) {
    const key = queue[i];
    // `reads` alone is not what the registry must hold: abaplint's syntax
    // pass resolves a type the lowering never calls getObject for (the class
    // of a TYPE REF TO in a signature), which `deps` names -- and it must
    // resolve for every object in the registry, not only the classes this
    // build re-lowers, because findIssues checks them all against it. A
    // reference in a statement the lowering stubs out is in neither set, so
    // every member's words are candidates too (a support object of this
    // shape, zcl_stg_json_text spelling zcl_stg_json, refused the first
    // real-tree run)
    const entry = index.entries[key];
    const names = new Set([...(entry?.reads ?? []), ...(entry?.deps ?? [])]);
    for (const w of words(key)) names.add(keyOf("CLAS", w));
    for (const name of names) {
      if (!name.startsWith("CLAS ") || relower.has(name)) continue;
      if (!byKey.has(name) || !index.entries[name] || enqueued.has(name)) continue;
      for (const f of byKey.get(name)) need.add(f);
      enqueued.add(name);
      queue.push(name);
    }
  }
  notes.push(`registry ${need.size} of ${allFiles.size} files`);

  // the cached entries, loaded and digest-checked
  const payloads = new Map(); // key -> payload (undefined when unreadable)
  const load = (key) => {
    if (payloads.has(key)) return payloads.get(key);
    const entry = index.entries[key];
    let payload;
    if (entry?.portable && entry.digest) {
      try {
        const bytes = readFileSync(join(dir, "e", `${sha(key)}.bin`));
        if (sha(bytes) === entry.digest) payload = deserialize(inflateRawSync(bytes));
      } catch { /* unreadable: a miss */ }
    }
    payloads.set(key, payload);
    return payload;
  };
  const reusedKeys = [];
  for (const key of index.order) {
    if (relower.has(key)) continue;
    if (load(key) === undefined) return {ok: false, reason: `${key}: its cache entry is unreadable`};
    reusedKeys.push(key);
  }

  // the anonymous structures a fresh lowering may be handed: only a shape
  // the write-time build covered with exactly ONE name -- its owner reused,
  // so it does not mint it again -- and more than its creator referenced,
  // so it truly flowed through one shared instance. A shape several names
  // cover (the RAP message row, constructed per lowering and named after
  // each first reacher: four names on this tree) is never answered: a
  // fresh lowering mints its own, as the full build's reachers did
  const creatorOf = new Map(), referencers = new Map(), namesOfShape = new Map();
  for (const key of index.order) {
    const payload = load(key);
    if (payload !== undefined) for (const op of flatOps(payload, "structs")) {
      if (op[0] !== "set") continue;
      creatorOf.set(op[1], key);
      if (op[2]?.qname !== undefined) continue;
      if (!namesOfShape.has(op[2].shape)) namesOfShape.set(op[2].shape, new Set());
      namesOfShape.get(op[2].shape).add(op[1]);
    }
    for (const name of index.entries[key].anonRefs ?? []) {
      if (!referencers.has(name)) referencers.set(name, new Set());
      referencers.get(name).add(key);
    }
  }
  const seeds = new Map(); // component names -> go name
  for (const [shape, names] of namesOfShape) {
    if (names.size !== 1) continue;
    const name = [...names][0];
    const creator = creatorOf.get(name);
    if (creator === undefined || relower.has(creator)) continue;
    const refs = referencers.get(name) ?? new Set();
    if (refs.size >= 2 || (refs.size === 1 && !refs.has(creator))) seeds.set(shape, name);
  }
  const seededNames = new Set(seeds.values());
  // the full build's layout of the global passes must be one this build can
  // reproduce (see straySlot)
  if (index.strayLayoutOk !== true) return {ok: false, reason: "a global pass of the live generation wrote between two objects"};
  // which object first wrote each key of the keyed collections in the
  // live generation (the re-lowered objects' entries describe their last
  // lowering): a fresh lowering that FIRST writes a key another object
  // first wrote there would put it at the wrong slot of the merge
  const firstSetter = new Map(); // coll \0 key -> object key
  for (const [key, occ] of index.segments) {
    const payload = load(key);
    for (const coll of ["structs", "consts", "sigs", "events"]) for (const op of payload?.segs?.[occ]?.[coll] ?? []) {
      if (op[0] === "set" && !firstSetter.has(`${coll}\0${op[1]}`)) firstSetter.set(`${coll}\0${op[1]}`, key);
    }
  }

  // the fast compileProgram: fresh lowerings over the closure registry,
  // with the shared state pre-seeded from the cache. The fresh lowering's
  // own writes are recorded per object (opProxy), so the merged program can
  // put every collection back in the order the full build's lowering wrote
  // it -- the program digest and the emitted Go read several of them in
  // insertion order, and "reused first, fresh after it" is not that order
  const freshRtti = [];
  const freshOwnership = new Map();
  const freshSegs = new Map(); // key -> [{coll: [ops]}], one per `enter`, as the write side records
  const freshPhases = new Map(); // key -> [phase of each segment]
  const freshStrays = []; // [coll, op, phase, segments of the phase before it]
  const freshCount = [0, 0];
  let currentKey = null;
  let lowering = 0;
  let orderDoubt;
  const supers = new Map(Object.entries(index.supers));
  const readIncr = {
    // only the re-lowered objects compile; everything else stays in `wanted`
    // (a call of a class outside the program is refused during lowering) and
    // its IR comes from the cache
    compiles: (key) => relower.has(key),
    enter(key) {
      if (!freshSegs.has(key)) { freshSegs.set(key, []); freshPhases.set(key, []); }
      freshSegs.get(key).push({});
      freshPhases.get(key).push(lowering);
      freshCount[lowering] += 1;
      currentKey = key;
    },
    exit() { currentKey = null; },
    lowering() { lowering = 1; },
    // the partial registry cannot walk the superclass chains of the classes
    // it does not hold -- and its own `wanted` is partial with them, the
    // selection drops what the registry does not know -- so both the walk's
    // start set and its steps come from the write-time build's records
    // (frontend.mjs asks this hook before it walks)
    caughtIndex: (reg) => caughtIndex(reg, new Set(index.wanted), (c) => supers.get(c) ?? null),
    prepare(p, reg) {
      for (const coll of RECORDED) {
        const target = p[coll];
        if (!["skipped", "partial", "classes"].includes(coll)) {
          // in the full build's segment order, the cached objects only
          for (const [key, occ] of index.segments) {
            if (relower.has(key)) continue;
            for (const [method, ...args] of load(key).segs?.[occ]?.[coll] ?? []) {
              if (method === "set") target.set(args[0], args[1]);
              else if (method === "add") target.add(args[0]);
              else if (method === "delete") target.delete(args[0]);
              else if (method === "clear") target.clear();
            }
          }
        }
        // the fresh lowering's writes land in the same collections, recorded
        // per object; one outside any object's mark is a global pass,
        // recorded by which side of the lowering it ran on (the rebuild
        // below puts it there).
        // `classes` keeps its own merge off index.classes below.
        if (coll !== "classes") p[coll] = opProxy(coll, target, (op) => {
          if (currentKey === null) { freshStrays.push([coll, op, lowering, freshCount[lowering]]); return; }
          const seg = freshSegs.get(currentKey).at(-1);
          (seg[coll] ??= []).push(op);
          // a key this object writes FIRST in this build must be one it (or
          // nobody) wrote first in the full build, or the merge puts it at
          // another object's slot
          if (op[0] === "set" && target instanceof Map && !target.has(op[1])) {
            const id = `${coll}\0${op[1]}`;
            const before = firstSetter.get(id);
            if (before !== undefined && before !== currentKey) orderDoubt ??= `${currentKey} now first writes ${coll} ${op[1]}, which ${before} wrote first in the live generation`;
          }
        });
      }
      const supplied = new Map(p.supplied);
      for (const key of reusedKeys) for (const [k, params] of load(key).supplied ?? []) supplied.set(k, new Set([...(supplied.get(k) ?? []), ...params]));
      p.supplied = supplied;
      const namedShapes = new Set(namesOfShape.keys());
      p.anonStructs = anonShapes = new AnonShapes(seeds, () => currentKey, (key) => index.entries[key]?.anonUse, namedShapes);
      // the fresh lowering resolves CDS view types through this map
      // (frontend.mjs), and the mini registry's own is empty -- its walk
      // never reaches the .ddls.asddls sources; the merge restores the
      // recorded one below, over what the mini's final analysis answered
      p.cdsViews = index.cdsViews ?? {};
    },
    rttiOf(owner, defs) { freshRtti.push([owner, defs]); },
    ownershipOf(name, value) { freshOwnership.set(upper(name), value); },
  };
  let anonShapes;
  let mini;
  try {
    mini = compileProgram({folders, objects, tolerant: true, skip: (p) => hidden.has(p) || !need.has(p), includeTests, incr: readIncr});
  } catch (e) {
    return {ok: false, reason: `the fresh lowering failed: ${e.message}`};
  }
  // an object the fast build re-lowered must come out clean: the full front
  // end would drop it from the program, and that is not this edit's answer
  const reloweredObjects = new Set([...relower].map((k) => k.slice(5)));
  const freshErrors = mini.diagnostics.filter((d) => reloweredObjects.has(upper(d.object)));
  if (freshErrors.length > 0) return {ok: false, reason: `syntax errors in re-lowered objects (${freshErrors[0].object}: ${freshErrors[0].message})`};
  // and nothing outside the re-lowered set may have turned broken
  const cachedBroken = new Set(index.broken);
  for (const name of mini.broken) if (!reloweredObjects.has(upper(name)) && !cachedBroken.has(upper(name))) {
    const why = mini.diagnostics.find((d) => upper(d.object) === upper(name))?.message ?? "no diagnostic";
    return {ok: false, reason: `${name}: the edit left it with syntax errors the live generation did not have (${why})`};
  }

  if (anonShapes?.doubt !== undefined) return {ok: false, reason: anonShapes.doubt};
  // the full build entered every re-lowered object as often, and in the
  // same phases, as this one did (the discovery, the class pass, the local
  // classes, the function groups); an edit that changed that changes the
  // full build's sequence too, and the merge below could not follow it
  const recordedSegs = new Map();
  for (const [key, , phase] of index.segments) {
    if (!recordedSegs.has(key)) recordedSegs.set(key, []);
    recordedSegs.get(key).push(phase);
  }
  for (const key of relower) {
    if (JSON.stringify(freshPhases.get(key) ?? []) !== JSON.stringify(recordedSegs.get(key) ?? [])) {
      return {ok: false, reason: `${key}: its passes differ from the live generation's (${JSON.stringify(freshPhases.get(key) ?? [])} against ${JSON.stringify(recordedSegs.get(key) ?? [])})`};
    }
  }
  if (orderDoubt !== undefined) return {ok: false, reason: orderDoubt};

  // the merged program's shared collections, in the order the full build
  // wrote them: its segment sequence (index.segments), each segment the
  // fresh writes of an object that lowered again or the recorded ones of an
  // object taken from the cache, and the global passes in the slots they
  // ran in. The program digest and the emitted Go read several of these
  // collections in insertion order; any other order names another
  // generation. The passes are this build's own: its registry holds every
  // object they read (every non-class object is a member).
  const strayBySlot = {}; // coll -> slot -> [ops]
  for (const [coll, op, phase, at] of freshStrays) {
    let slot = straySlot(phase, at, freshCount[phase]);
    if (slot === null) return {ok: false, reason: `a global pass wrote ${coll} between two objects`};
    if (slot === "AB" || slot === "CD") {
      // this build had no segment in the phase: the slot is the one the
      // full build used, if it used only one of the two
      const both = slot.split("");
      const used = (index.straySlots[coll] ?? []).filter((s) => both.includes(s));
      if (used.length > 1) return {ok: false, reason: `the global passes of ${coll} ran on both sides of a phase this build has no object in`};
      slot = used[0] ?? both[0];
    }
    ((strayBySlot[coll] ??= {})[slot] ??= []).push(op);
  }
  const apply = (target, op) => {
    const [method, ...args] = op;
    if (method === "set") target.set(args[0], args[1]);
    else if (method === "add") target.add(args[0]);
    else if (method === "delete") target.delete(args[0]);
    else if (method === "clear") target.clear();
    else if (method === "push") target.push(args[0]);
  };
  const program2 = mini;
  for (const coll of RECORDED) {
    if (coll === "classes") continue; // merged below, off index.classes
    const like = program2[coll];
    const out = like instanceof Map ? new Map() : like instanceof Set ? new Set() : [];
    const strays = (slot) => { for (const op of strayBySlot[coll]?.[slot] ?? []) apply(out, op); };
    const segs = (phase) => {
      for (const [key, occ, p] of index.segments) {
        if (p !== phase) continue;
        const ops = relower.has(key) ? freshSegs.get(key)?.[occ]?.[coll] : load(key).segs?.[occ]?.[coll];
        for (const op of ops ?? []) apply(out, op);
      }
    };
    strays("A"); segs(0); strays("B");
    strays("C"); segs(1); strays("D");
    program2[coll] = out;
  }

  // the classes in the recorded push order
  const freshClasses = new Map(mini.classes.map((c) => [c.name, c]));
  const classes = [];
  for (const [key, name] of index.classes) {
    if (key === undefined || relower.has(key)) {
      const ir = freshClasses.get(name);
      if (ir === undefined) return {ok: false, reason: `${name} of ${key ?? "the fresh compile"} was not lowered fresh as expected`};
      classes.push(ir);
      // a fresh IR may not newly name an anonymous structure another object
      // first used: whether the full build would share it through the same
      // abaplint instance is exactly what this registry cannot prove
      for (const type of irNames(ir).types) {
        if (seededNames.has(type) && !(index.entries[key]?.anonRefs ?? []).includes(type)) {
          return {ok: false, reason: `${key}: the edit now names the shared anonymous structure ${type}`};
        }
      }
    } else {
      const ir = load(key)?.ir[name];
      if (ir === undefined) return {ok: false, reason: `${key}: no lowered ${name} in the cache`};
      classes.push(ir);
    }
  }
  program2.classes = classes;
  program2.wanted = new Set(index.wanted);
  // the mini's final analysis rebuilt the CDS view map off a registry that
  // holds no .ddls source; the recorded map is the fast path's answer (a
  // CDS edit is not a class or interface edit and refuses before this)
  program2.cdsViews = index.cdsViews ?? {};
  const cachedDiag = index.diagnostics.map((d) => d.split("\0")).map(([object, message]) => ({object, message}))
    .filter((d) => !reloweredObjects.has(upper(d.object)));
  program2.diagnostics = [...cachedDiag, ...mini.diagnostics];
  program2.broken = [...new Set([...index.broken.filter((n) => !reloweredObjects.has(upper(n))), ...mini.broken.map(upper)])];
  // rtti: the full build's table interleaves the dictionary and the class
  // typedefs in registry enumeration order (index.registryOrder recorded
  // it); rebuild that order, a re-lowered class's typedefs fresh, an absent
  // class's from the cache
  {
    const freshDefs = new Map(freshRtti);
    const wanted = new Set([...index.wanted].map((n) => upper(n)));
    const structs = new Map(), known = new Set(), classSupers = new Map();
    const typed = new Set(["TABL", "DTEL", "TTYP", "DOMA", "CLAS", "INTF", "VIEW", "DDLS"]);
    for (const key of index.registryOrder) {
      const space = key.indexOf(" ");
      const type = key.slice(0, space), name = key.slice(space + 1);
      if (!typed.has(type)) continue;
      known.add(name);
      if ((type === "TABL" || type === "VIEW") && mini.rtti.structs.has(name)) structs.set(name, mini.rtti.structs.get(name));
      if (type === "CLAS" && wanted.has(name)) {
        if (relower.has(key)) {
          for (const [n, comps] of freshDefs.get(name) ?? []) { if (comps) structs.set(n, comps); known.add(n); }
        } else if (index.entries[key]) {
          for (const [n, comps] of load(key).rttiDefs ?? []) { if (comps) structs.set(n, comps); known.add(n); }
        }
      }
      // every class of the registry gets an entry, a null super included
      // (the digest reads them); an absent class's from the recorded map
      if (mini.rtti.classSupers.has(name)) classSupers.set(name, mini.rtti.classSupers.get(name));
      else if (type === "CLAS") classSupers.set(name, index.entries[key]?.super ?? index.supers[name] ?? null);
    }
    // compiled local classes share the RTTI name space: their supers append
    // after the inventory, in program.classes order (rttiLocalSupers), which
    // the merged `classes` array is
    for (const c of classes) if (c.name.includes(":")) classSupers.set(c.name, c.super ?? null);
    program2.rtti = {structs, known, classSupers};
    // the dictionary's other names (frontend.mjs tableRegistry): the mini
    // computed them off its own partial rtti, so they follow the merged one
    const tableNames = new Set((program2.tables ?? []).map((t) => t.name));
    program2.ddicNames = [...known].filter((n) => !/=>/.test(n) && !tableNames.has(n)).sort();
  }
  // the superclass chain of every merged class, for CATCH at run time
  {
    const superOf = (name) => {
      const ir = classes.find((c) => c.name === name);
      if (ir !== undefined) return ir.super ?? null;
      return index.supers[name] ?? null;
    };
    const out = {};
    for (const c of classes) {
      const chain = [c.name];
      for (let at = superOf(c.name), guard = 0; at && guard < 64; at = superOf(at), guard += 1) chain.push(at);
      if (!chain.includes("CX_ROOT")) continue;
      for (let i = 0; i + 1 < chain.length; i += 1) out[chain[i]] = chain[i + 1];
    }
    program2.exceptionSupers = out;
  }
  // ownership: the recorded collection order, a fresh value where the fresh
  // registry answered for the name, the cached one where it did not
  {
    const merged = new Map();
    for (const [name, value] of index.ownership) {
      merged.set(name, freshOwnership.get(name) ?? mini.ownershipSafety.get(name)
        ?? {names: new Set(value.names), dynamic: value.dynamic});
    }
    for (const [name, value] of mini.ownershipSafety) if (!merged.has(name)) merged.set(name, value);
    program2.ownershipSafety = merged;
  }
  // dynamic dispatch over the merged classes; a class with an alias outside
  // the fresh registry would resolve differently than the full build
  const aliasedOutside = index.aliased.filter((name) => mini.reg.getObject("CLAS", name) === undefined);
  if (aliasedOutside.length > 0) {
    return {ok: false, reason: `${aliasedOutside[0]} has interface aliases and is outside the fresh registry`};
  }
  program2.dynamicDispatch = [];
  prepareDynamicStatics(program2, {defaultValue, aliasTarget});
  // the files of the compiled classes, for what reads them without lowering
  // (status.mjs): the partial registry does not hold most of them
  // -- the name the full build's registry gave it, which is what the
  // status counts by, so the fast and the full build answer the same
  const filesOf = new Map();
  for (const entry of Object.values(index.entries)) for (const [name, file] of Object.entries(entry.regFiles ?? {})) filesOf.set(name, file);
  program2.filesOf = filesOf;
  return {ok: true, program: program2, lowered: [...relower].sort(), reused: reusedKeys.length, notes,
    incrDb: {dir, relower: [...relower], registryOrder: index.registryOrder}};
}

// ---------------------------------------------------------------------------
// the database statements of the fast path (osg-build.mjs osgiDatabase)
// ---------------------------------------------------------------------------

const require2 = createRequire(import.meta.url);
/** the per-object statement lists DatabaseSetup produces, attributed so a
 *  fast build can splice in the re-lowered objects' rows. The write side
 *  checks the reconstruction against the real run before caching.
 *  `only` builds the contributions of those object keys alone. */
export function dbContributions(reg, only) {
  const {SQLiteDatabaseSchema} = require2("@abaplint/transpiler/build/src/db/schema_generation/sqlite_database_schema.js");
  const {PopulateTables} = require2("@abaplint/transpiler/build/src/db/populate_tables.js");
  const {CDSDatabaseView} = require2("@abaplint/transpiler/build/src/db/cds_database_view.js");
  const schema = new SQLiteDatabaseSchema(reg), populate = new PopulateTables(reg), cds = new CDSDatabaseView(reg);
  const order = [], tabl = new Map(), view = new Map(), cdsViews = new Map(), inserts = new Map();
  for (const obj of reg.getObjects()) {
    const key = keyOf(obj.getType(), upper(obj.getName()));
    if (only !== undefined && !only.has(key)) continue;
    if (!order.includes(key)) order.push(key);
    if (!inserts.has(key)) inserts.set(key, []);
    const add = (statement) => { if (statement.length > 0) inserts.get(key).push(statement); };
    try {
      if (obj instanceof core.Objects.Table && obj.getTableCategory() === core.Objects.TableCategory.Transparent) tabl.set(key, schema.buildTABL(obj).trim());
      else if (obj instanceof core.Objects.View) view.set(key, schema.buildVIEW(obj).trim());
      else if (obj instanceof core.Objects.DataDefinition) {
        const built = cds.build(obj);
        if (built !== undefined) cdsViews.set(key, built);
      }
    } catch { /* the real run fails the same way; the write-time check catches a difference */ }
    try {
      add(populate.insertTADIR(obj));
      if (obj instanceof core.Objects.MessageClass) for (const s of populate.insertT100(obj)) add(s);
      else if (obj instanceof core.Objects.WebMIME) for (const s of populate.insertWWWPARAMS(obj)) add(s);
      else if (obj instanceof core.Objects.Class || obj instanceof core.Objects.Interface || obj instanceof core.Objects.Program) {
        add(populate.insertREPOSRC(obj));
        if (obj instanceof core.Objects.Class || obj instanceof core.Objects.Interface) {
          for (const s of populate.insertSEOSUBCO(obj)) add(s);
          for (const s of populate.insertSEOSUBCODF(obj)) add(s);
          for (const s of populate.insertSEOSUBCOTX(obj)) add(s);
        }
      }
    } catch { /* as above */ }
  }
  let tail = "";
  try { tail = populate.insertT000(); } catch { /* none */ }
  return {order, tabl, view, cdsViews, inserts, tail};
}

const at = (store, key) => store instanceof Map ? store.get(key) : store?.[key];

/** the flat statement lists of `run()`, in its order, out of the per-object
 *  contributions, with `fresh` (the contributions of the fresh registry,
 *  which cover the re-lowered objects) substituted per object key */
export function dbFlat(cached, fresh) {
  const of = (kind, key) => {
    const mine = fresh && at(fresh[kind], key);
    if (mine !== undefined) return mine;
    return at(cached[kind], key);
  };
  const schemas = [];
  for (const key of cached.order) { const s = of("tabl", key); if (s !== undefined) schemas.push(s); }
  for (const key of cached.order) { const s = of("view", key); if (s !== undefined) schemas.push(s); }
  for (const key of cached.order) { const s = of("cdsViews", key); if (s !== undefined) schemas.push(s); }
  const insert = [];
  for (const key of cached.order) {
    const mine = fresh && at(fresh.inserts, key);
    insert.push(...(mine ?? at(cached.inserts, key) ?? []).filter((s) => s.length > 0));
  }
  if (cached.tail && cached.tail.length > 0) insert.push(cached.tail);
  return {schemas, insert};
}

/** the database record of a generation's cache: `db.json` beside index.json */
export function dbCacheWrite(dir, contributions) {
  const file = join(dir, "db.json"), temp = `${file}.${process.pid}.pending`;
  writeFileSync(temp, JSON.stringify({order: contributions.order,
    tabl: Object.fromEntries(contributions.tabl), view: Object.fromEntries(contributions.view),
    cdsViews: Object.fromEntries(contributions.cdsViews),
    inserts: Object.fromEntries([...contributions.inserts].map(([k, v]) => [k, v])), tail: contributions.tail}));
  renameSync(temp, file);
}

/** @returns {object | undefined} the recorded contributions, or undefined */
export function dbCacheRead(dir) {
  try { return JSON.parse(readFileSync(join(dir, "db.json"), "utf8")); } catch { return undefined; }
}
