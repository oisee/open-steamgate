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
import {join, relative, resolve} from "node:path";
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

export const SCHEMA = "osgo-incr/2";
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
  const kind = /\.(tabl|ttyp|dtel|doma|view|enqu|msag|prog|w3mi|shlp|tran|webi|xslt|suso|suvo|tobj|iacg|iamu|iext|iobj|sfp|susc)(?:\.[a-z_]+)?\.(abap|xml)$/i.exec(name)?.[1];
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

// ---------------------------------------------------------------------------
// the write side
// ---------------------------------------------------------------------------

/**
 * The recorder a full compileOsg installs into compileProgram. Nothing it
 * does changes the compile; `finish` writes the cache of one generation.
 * @param {{root: string, folders: string[], hidden: Set<string>, objects: string[], includeTests: Set<string>}} o
 */
export function incrRecorder({root, folders, hidden, objects, includeTests}) {
  const buckets = new Map();
  const order = []; // first-enter order == the lowering sequence
  let current = null;
  let program;
  const bucket = (key) => {
    if (!buckets.has(key)) buckets.set(key, {key, writes: Object.fromEntries(RECORDED.map((c) => [c, []])),
      reads: new Set(), supplied: [], rttiDefs: []});
    return buckets.get(key);
  };
  const record = (coll, op) => { if (current !== null) bucket(current).writes[coll].push(op); };
  const proxy = (coll, value) => new Proxy(value, {
    get(target, method) {
      const member = target[method];
      if (typeof member !== "function") return member;
      if (method === "set") return (k, v) => { record(coll, ["set", k, v]); return target.set(k, v); };
      if (method === "add") return (v) => { record(coll, ["add", v]); return target.add(v); };
      if (method === "delete") return (k) => { record(coll, ["delete", k]); return target.delete(k); };
      if (method === "clear") return () => { record(coll, ["clear"]); return target.clear(); };
      if (method === "push") return (...vs) => { for (const v of vs) record(coll, ["push", v]); return target.push(...vs); };
      return member.bind(target);
    },
  });
  const ownership = new Map();
  return {
    // the compileProgram hooks (frontend.mjs)
    prepare(p, reg) {
      program = p;
      for (const coll of RECORDED) {
        if (p[coll] instanceof Map || p[coll] instanceof Set || Array.isArray(p[coll])) p[coll] = proxy(coll, p[coll]);
      }
      const get = reg.getObject.bind(reg);
      reg.getObject = (type, name) => {
        const value = get(type, name);
        if (type && name && current !== null) bucket(current).reads.add(keyOf(upper(type), upper(name)));
        return value;
      };
    },
    enter(key) { if (!order.includes(key)) order.push(key); current = key; },
    exit() { current = null; },
    suppliedOf(owner, contributed) { bucket(keyOf("CLAS", owner)).supplied = contributed; },
    rttiOf(owner, defs) { bucket(keyOf("CLAS", owner)).rttiDefs = defs; },
    ownershipOf(name, value) { ownership.set(upper(name), {names: [...value.names], dynamic: value.dynamic}); },
    /** write the cache of generation `gen`; returns what it wrote */
    finish({gen}) {
      const dir = join(root, "build", "osgo-incr", gen);
      const reg = program.reg;
      // which bucket pushed each class, off the recorded push ops
      const pushedNames = new Map(); // class name -> bucket key
      for (const b of order) for (const op of bucket(b).writes.classes) if (op[0] === "push") pushedNames.set(op[1].name ?? op[1], b);
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
          writes: b.writes, reads: [...b.reads], supplied: b.supplied, rttiDefs: b.rttiDefs};
        let ok = true;
        try { if (!portable(payload)) ok = false; } catch { ok = false; }
        const entry = {deps: [...deps].sort(), reads: [...b.reads].sort(), pushed: irs.map((c) => c.name),
          anonRefs: [...anonRefs].sort(), broken: false,
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
      const index = {schema: SCHEMA, tool: toolIdentity(), folders, objects, order, classes: program.classes.map((c) => [pushedNames.get(c.name), c.name]),
        entries, broken, supers, wanted: [...program.wanted],
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
  constructor(seed) { this.seed = seed; this.mine = new Map(); }
  get(t) {
    if (this.mine.has(t)) return this.mine.get(t);
    try { return this.seed.get(t.getComponents().map((c) => upper(c.name)).join(",")); } catch { return undefined; }
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
  // dependency closure of the classes it re-lowers -- their recorded reads,
  // and (for an edited source, which may name new objects) every object
  // whose name its text spells
  const allFiles = registryFiles(folders, hidden, includeTests);
  const byKey = new Map(); // object key -> [files]
  for (const [file, key] of allFiles) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(file);
  }
  const need = new Set();
  const queue = [];
  for (const [key, files] of byKey) {
    if (key.startsWith("CLAS ") && !relower.has(key)) continue;
    for (const f of files) need.add(f);
    if (key.startsWith("CLAS ")) queue.push(key);
  }
  const wordCache = new Map();
  const words = (key) => {
    if (wordCache.has(key)) return wordCache.get(key);
    const set = new Set();
    for (const f of byKey.get(key) ?? []) if (/\.abap$/i.test(f)) for (const w of wordsOf(readFileSync(f, "utf8"))) set.add(w);
    wordCache.set(key, set);
    return set;
  };
  for (let i = 0; i < queue.length; i += 1) {
    const key = queue[i];
    const names = new Set(index.entries[key]?.reads ?? []);
    if (edited.has(key)) for (const w of words(key)) names.add(keyOf("CLAS", w));
    for (const name of names) {
      if (!name.startsWith("CLAS ") || relower.has(name)) continue;
      if (!byKey.has(name) || !index.entries[name]) continue;
      for (const f of byKey.get(name)) need.add(f);
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

  // the anonymous structures a fresh lowering may be handed: a shape that
  // one name covers and more than its creator references was shared through
  // one abaplint instance; shapes of re-lowered owners are not seeded
  const creatorOf = new Map(), referencers = new Map();
  for (const key of reusedKeys) {
    const payload = load(key);
    for (const op of payload.writes.structs) if (op[0] === "set") creatorOf.set(op[1], key);
    for (const name of index.entries[key].anonRefs ?? []) {
      if (!referencers.has(name)) referencers.set(name, new Set());
      referencers.get(name).add(key);
    }
  }
  const seeds = new Map(); // component names -> go name
  const shapes = new Map();
  for (const key of reusedKeys) for (const op of load(key).writes.structs) {
    if (op[0] !== "set" || op[2]?.qname !== undefined) continue;
    if (!shapes.has(op[2].shape)) shapes.set(op[2].shape, []);
    shapes.get(op[2].shape).push(op[1]);
  }
  for (const [shape, names] of shapes) {
    const shared = names.filter((n) => {
      const refs = referencers.get(n) ?? new Set();
      return refs.size >= 2 || (refs.size === 1 && creatorOf.get(n) !== undefined && !refs.has(creatorOf.get(n)));
    });
    if (shared.length === 1) seeds.set(shape, shared[0]);
  }
  const seededNames = new Set(seeds.values());

  // the fast compileProgram: fresh lowerings over the closure registry,
  // with the shared state pre-seeded from the cache
  let program;
  const freshMarks = [];
  const freshRtti = [];
  const freshOwnership = new Map();
  const readIncr = {
    enter(key) { freshMarks.push([key, program.skipped.length, program.partial.length]); },
    exit() {},
    prepare(p, reg) {
      program = p;
      for (const coll of RECORDED) {
        if (["skipped", "partial", "classes"].includes(coll)) continue;
        const target = p[coll];
        for (const key of reusedKeys) {
          for (const [method, ...args] of load(key).writes[coll] ?? []) {
            if (method === "set") target.set(args[0], args[1]);
            else if (method === "add") target.add(args[0]);
            else if (method === "delete") target.delete(args[0]);
            else if (method === "clear") target.clear();
          }
        }
      }
      const supplied = new Map(p.supplied);
      for (const key of reusedKeys) for (const [k, params] of load(key).supplied ?? []) supplied.set(k, new Set([...(supplied.get(k) ?? []), ...params]));
      p.supplied = supplied;
      p.anonStructs = new AnonShapes(seeds);
      const supers = new Map(Object.entries(index.supers));
      p.caught = caughtIndex(reg, p.wanted, (c) => supers.get(c) ?? null);
    },
    rttiOf(owner, defs) { freshRtti.push([owner, defs]); },
    ownershipOf(name, value) { freshOwnership.set(upper(name), value); },
  };
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
    return {ok: false, reason: `${name}: the edit left it with syntax errors the live generation did not have`};
  }

  // the merged program: the classes in the recorded push order
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
  const program2 = mini;
  program2.classes = classes;
  program2.skipped = [...reusedKeys.flatMap((key) => pushes(load(key).writes.skipped)), ...mini.skipped];
  program2.partial = [...reusedKeys.flatMap((key) => pushes(load(key).writes.partial)), ...mini.partial];
  program2.wanted = new Set(index.wanted);
  const cachedDiag = index.diagnostics.map((d) => d.split("\0")).map(([object, message]) => ({object, message}))
    .filter((d) => !reloweredObjects.has(upper(d.object)));
  program2.diagnostics = [...cachedDiag, ...mini.diagnostics];
  program2.broken = [...new Set([...index.broken.filter((n) => !reloweredObjects.has(upper(n))), ...mini.broken.map(upper)])];
  // rtti: the fresh registry answered for the dictionary and the re-lowered
  // classes; the cached class typedefs cover the classes absent from it
  {
    const structs = new Map(mini.rtti.structs);
    const known = new Set(mini.rtti.known);
    const classSupers = new Map(mini.rtti.classSupers);
    for (const key of reusedKeys) {
      for (const [name, comps] of load(key).rttiDefs ?? []) {
        if (comps) structs.set(name, comps);
        known.add(name);
      }
      if (index.entries[key].super) classSupers.set(key.slice(5), index.entries[key].super);
    }
    program2.rtti = {structs, known, classSupers};
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
  // ownership: the fresh registry answered for its objects, the cache for
  // the classes absent from it
  {
    const merged = new Map(mini.ownershipSafety);
    for (const [name, value] of index.ownership) if (!merged.has(name)) merged.set(name, {names: new Set(value.names), dynamic: value.dynamic});
    for (const [name, value] of freshOwnership) merged.set(name, value);
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
  const filesOf = new Map();
  for (const [key, entry] of Object.entries(index.entries)) {
    const main = Object.keys(entry.files ?? {}).filter((f) => /\.(clas|intf)\.abap$/i.test(f)).sort()[0] ?? Object.keys(entry.files ?? {}).sort()[0];
    if (main !== undefined) for (const name of entry.pushed ?? []) filesOf.set(name, resolve(root, main));
  }
  program2.filesOf = filesOf;
  return {ok: true, program: program2, lowered: [...relower].sort(), reused: reusedKeys.length, notes,
    incrDb: {dir, relower: [...relower], registryOrder: index.registryOrder}};
}

const pushes = (ops) => ops.filter((op) => op[0] === "push").map((op) => op[1]);

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
