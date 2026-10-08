import {warmOverlay} from "./osd-warm-overlay.mjs";
// Active/inactive versions, source snapshots and activation provenance.
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname, join, relative, resolve} from "node:path";
import {hashOf, inputsOf, liveHash, normalPath} from "./osd-build.mjs";
import {entityTag} from "./adt-entity.mjs";
import {NotFound} from "./osd-store.mjs";
import {writeSourceSnapshot, sourceSnapshotPath, sourceOriginalPath} from "./osd-source-snapshot.mjs";
import {copyDurable, mkdirDurable, removeDurable, renameDurable, writeDurable} from "./osd-durable.mjs";
import {TYPES, INCLUDES} from "./osd-store-types.mjs";
import {forgetMissingObjectOutcomes} from "./osd-activation-journal.mjs";

// Owned privately by ObjectStore. The callback reads its private index without
// adding an index accessor to the store's public API.
export class StoreVersions {
  #store;
  #entries;

  constructor(store, entries) {
    this.#store = store;
    this.#entries = entries;
  }

  crash(point) {
    if (this.#store.crashAt === point) {
      const error = new Error(`crashed at ${point}`);
      error.code = "CRASH";
      throw error;
    }
  }

  // The set as saved: per object, its files and the digest of what was
  // saved in them. The order of every step is the recoverable one:
  //   a save:       active copy, then the set (with the digest the save will
  //                 have), then the source -- a crash before the source
  //                 leaves an object inactive whose file is still active;
  //   an activation: the set, then the copies -- a crash between leaves a
  //                 copy nobody owns, which the next start removes;
  //   a delete:     the files, then the set, then the copies.
  // The set is replaced atomically (temp, fsync, rename), so no crash
  // truncates it. A file that no longer hashes to its digest was changed
  // outside (a checkout, another editor): it stays inactive, with its
  // active copy, until somebody activates it; nothing claims an activation
  // that did not happen. An object whose files are all gone is gone.
  loadInactive() {
    forgetMissingObjectOutcomes(this.#store);
    const file = join(this.#store.root, this.#store.inactiveDir, "inactive.json");
    let saved;
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && existsSync(file)) {
        // unreadable, and not by a crash of ours (the replace is atomic): kept
        // aside, and every active copy kept
        console.log(`inactive: ${file} is unreadable (${error.message}); kept aside, the set is read off the active copies`);
        try {
          renameSync(file, `${file}.unreadable-${Date.now()}`);
        } catch {
          // read-only
        }
      }
      // **Fail closed.** No set, or none that can be read, while active
      // copies exist: every object with a copy is inactive -- a copy is made
      // only for one -- and what its saved files should hold is unknown, so
      // it is "changed outside, inactive until activated". An empty set here
      // built the saved source of a broken class at the next publication.
      this.#recoverFromCopies();
      return;
    }
    let changed = false;
    for (const [key, record = {}] of [...Object.entries(saved.inactive ?? {}), ...Object.values(saved.retained ?? {}).map(record => [record.key, record])]) {
      const files = Array.isArray(record.files) ? record.files : [];
      if (files.length > 0 && !files.some((f) => existsSync(join(this.#store.root, f)))) {
        changed = true;
        continue;
      }
      const digest = this.#digestOf(files);
      const outside = record.outside === true || (record.digest !== undefined && digest !== record.digest);
      if (outside !== (record.outside === true) || digest !== record.digest) changed = true;
      const restored = {files, digest, ...(outside ? {outside: true} : {})};
      // Archive drafts and active copies belong to their overlay revision.
      // Keep an unmounted draft durable without excluding a replacement's object.
      const owner = files.map(f => /^local\/overlays\/[a-f0-9]{64}(?=\/)/.exec(f.replaceAll("\\", "/"))?.[0]).find(Boolean);
      const [type, ...name] = key.split(" ");
      if (owner && this.#store.find(type, name.join(" "))?.root !== owner) {
        this.#retained.set(owner + "\0" + key, {key, ...restored});
        changed = true;
      } else {
        this.#store.inactive.add(key);
        this.#saved.set(key, restored);
      }
    }
    if (changed) this.saveInactive();
    this.#dropOrphanCopies();
  }

  // the set read off build/inactive/active: each copy names a file of the
  // tree, the file names its object. A copy whose object is gone is kept
  // (nothing is removed on a guess) and builds nothing (#overlay).
  #recoverFromCopies() {
    const folder = join(this.#store.root, this.#store.inactiveDir, "active");
    if (!existsSync(folder)) return;
    const copies = new Set(walkFiles(folder).map((f) => sourceOriginalPath(relative(folder, f))));
    if (copies.size === 0) return;
    this.#keepOrphans = true;
    for (const entry of this.#entries().values()) {
      const files = this.#filesOfEntry(entry);
      if (!files.some((f) => copies.has(f.split("\\").join("/")))) continue;
      const key = `${entry.type} ${entry.name}`;
      this.#store.inactive.add(key);
      this.#saved.set(key, {files, digest: this.#digestOf(files), outside: true});
    }
    if (this.#store.inactive.size > 0) this.saveInactive();
  }

  #saved = new Map();
  #retained = new Map();
  #keepOrphans = false;

  // a copy that no saved object owns: what a crash between an activation's
  // set and its copies leaves behind
  #dropOrphanCopies() {
    if (this.#keepOrphans) return;
    const folder = join(this.#store.root, this.#store.inactiveDir, "active");
    if (!existsSync(folder)) return;
    const owned = new Set([...this.#saved.values(), ...this.#retained.values()].flatMap((r) => r.files.map((f) => resolve(this.#store.root, this.#snapshotOf(f)))));
    for (const file of walkFiles(folder)) {
      if (!owned.has(resolve(file))) removeDurable(file);
    }
  }

  // Whether `file` (relative to the root) belongs to an object that is
  // inactive and still holds exactly the version saved through this store:
  // an ADT save (or create) waiting for its activation. The dev loop
  // (tools/osd-dev.mjs) never builds such a file -- a save is not an
  // activation, and building it there was a cold build and a recycle per
  // create and per PUT, besides the activation's (vsp-i7, 0.6.1511: 21
  // recycles), and would have made a saved-only version live.
  // This is the persistent inactive set, not a record of the write: it
  // ends with the activation, the delete, or bytes that differ from the
  // saved version (`outside`, which the dev loop builds like any change).
  // So the same bytes again -- another editor, a checkout, a watcher event
  // that comes late -- are that same inactive source, and wait for it to be
  // activated, however long.
  // The inactive objects other than `activating`, each with its files'
  // active copy (empty when it never had one) and saved text: the captured
  // source view sent to a warm compiler process.
  inactiveSources(activating = new Set()) {
    const out = [];
    for (const key of this.#store.inactive) {
      if (activating.has(key)) continue;
      const [type, ...rest] = key.split(" ");
      const entry = this.#store.find(type, rest.join(" "));
      if (entry === undefined) continue;
      const files = this.#filesOfEntry(entry).map((file) => {
        const copy = join(this.#store.root, this.#snapshotOf(file));
        const tree = join(this.#store.root, file);
        return {file, before: existsSync(copy) ? readFileSync(copy, "utf8") : "", after: existsSync(tree) ? readFileSync(tree, "utf8") : ""};
      });
      out.push({key, type, files});
    }
    return out;
  }

  // the object a file of the tree belongs to, "TYPE NAME", among the
  // inactive ones (what a warm prime asks of a file read from its copy)
  objectKeyOf(file) {
    const wanted = join(String(file));
    for (const key of this.#store.inactive) {
      const [type, ...rest] = key.split(" ");
      const entry = this.#store.find(type, rest.join(" "));
      if (entry !== undefined && this.#filesOfEntry(entry).some((f) => join(f) === wanted)) return key;
    }
    return undefined;
  }

  savedInactive(file) {
    const wanted = join(String(file));
    for (const key of this.#store.inactive) {
      const record = this.#saved.get(key);
      if (record === undefined || record.outside === true || !record.files.some((f) => join(f) === wanted)) continue;
      return this.#digestOf(record.files) === record.digest;
    }
    return false;
  }

  #digestOf(files, override = new Map()) {
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file).update("\0");
      if (override.has(file)) hash.update(override.get(file));
      else if (existsSync(join(this.#store.root, file))) hash.update(readFileSync(join(this.#store.root, file)));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  saveInactive() {
    const dir = join(this.#store.root, this.#store.inactiveDir);
    for (const key of [...this.#saved.keys()]) {
      if (!this.#store.inactive.has(key)) this.#saved.delete(key);
    }
    if (this.#store.inactive.size === 0 && this.#retained.size === 0 && !existsSync(dir)) return;
    mkdirDurable(dir);
    const inactive = Object.fromEntries([...this.#saved.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const target = join(dir, "inactive.json");
    const temp = `${target}.${process.pid}.tmp`;
    // the bytes, flushed; then the name, flushed: durable once this returns
    writeDurable(temp, JSON.stringify({inactive, ...(this.#retained.size ? {retained: Object.fromEntries(this.#retained)} : {})}, null, 1) + "\n");
    this.crash("save:before-rename");
    renameDurable(temp, target);
    this.crash("save:after-rename");
  }

  // every file of one object in the tree: the source, a class's includes,
  // the abapGit header beside it
  #filesOfEntry(entry) {
    const meta = TYPES[entry.type];
    const files = [entry.file];
    if (entry.type === "CLAS") {
      files.push(...Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix)));
    }
    if (meta !== undefined && entry.type !== "DEVC" && (meta.ext.endsWith(".abap") || meta.ext.endsWith(".asddls"))) {
      files.push(entry.file.slice(0, -meta.ext.length) + meta.ext.replace(/\.(abap|asddls)$/, ".xml"));
    }
    return [...new Set(files)];
  }

  #snapshotOf(file) {
    return join(this.#store.inactiveDir, "active", sourceSnapshotPath(file));
  }

  #hasCopy(entry) {
    return this.#filesOfEntry(entry).some((file) => existsSync(join(this.#store.root, this.#snapshotOf(file))));
  }

  // the active version of an object, copied aside before its first save
  // after an activation overwrites it
  keepActive(entry) {
    const key = `${entry.type} ${entry.name}`;
    if (this.#store.inactive.has(key)) return;
    for (const file of this.#filesOfEntry(entry)) {
      if (!existsSync(join(this.#store.root, file))) continue;
      const active = this.#activeFile(file, entry);
      // Unavailable source has no copy. An empty placeholder would become
      // false proof of activity when the saved source is also empty.
      if (!active || !existsSync(active)) continue;
      const copy = join(this.#store.root, this.#snapshotOf(file));
      mkdirDurable(dirname(copy));
      copyDurable(active, copy);
      this.crash("keep:after-copy");
    }
  }

  relocateActive(entry, copied) {
    this.keepActive(entry);
    for (const file of this.#filesOfEntry(entry)) {
      const target = copied.file.slice(0, -TYPES[copied.type].ext.length) + file.slice(entry.file.length - TYPES[entry.type].ext.length);
      const from = join(this.#store.root, this.#snapshotOf(file));
      if (existsSync(from)) {
        const to = join(this.#store.root, this.#snapshotOf(target));
        mkdirDurable(dirname(to));
        copyDurable(from, to);
      }
    }
  }

  dropActiveCopy(entry) {
    for (const file of this.#filesOfEntry(entry)) {
      const copy = join(this.#store.root, this.#snapshotOf(file));
      if (existsSync(copy)) removeDurable(copy);
    }
  }

  // the intent, before the bytes: the set says the object is inactive and
  // what its files will hold once `pending` (file -> text) is written
  markInactive(entry, pending = new Map()) {
    const key = `${entry.type} ${entry.name}`;
    const files = this.#filesOfEntry(entry);
    this.#store.inactive.add(key);
    this.#saved.set(key, {files, digest: this.#digestOf(files, pending)});
    this.saveInactive();
  }

  markActive(type, name) {
    const key = `${type} ${String(name).toUpperCase()}`;
    if (!this.#store.inactive.has(key)) return;
    const entry = this.#store.find(type, name);
    this.#store.inactive.delete(key);
    // the removal is durable (saveInactive returns after the rename and
    // its directory are flushed) before any copy goes
    this.saveInactive();
    this.crash("activate:before-copies");
    if (entry !== undefined) this.dropActiveCopy(entry);
  }

  // The inactive objects as one build takes them (tools/osd-build.mjs
  // activeOverlay): every file of an inactive object is excluded, and its
  // last active version comes from build/inactive/active when there is one.
  // The objects THIS publication activates (`activating`, a set of
  // "TYPE NAME") are built with their saved version instead -- that is what
  // activating them means -- so their copies are excluded. Another
  // publication's objects are not this one's: each build is given its own.
  // undefined when there is nothing to keep out.
  overlay(activating = new Set()) {
    const entries = [...this.#store.inactive].flatMap(key => {
      const [type, ...rest] = key.split(" ");
      const entry = this.#store.find(type, rest.join(" "));
      return entry === undefined ? [] : [{key, files: this.#filesOfEntry(entry)}];
    });
    return warmOverlay(this.#store.root, join(this.#store.inactiveDir, "active"), entries, activating);
  }

  // The registry as the build of `activating` would see the system: every
  // other inactive object as its active copy, or absent when it never had
  // one, for the length of one call. What a precheck says about a dependent
  // is then what the build will say, not what an unactivated save says
  // (#withSource's borrowing, for several files).
  withOverlay(activating, fn) {
    const registry = this.#store.registry();
    const replacements = [], restore = [], paths = new Map();
    for (const key of this.#store.inactive) {
      if (activating.has(key)) continue;
      const [type, ...rest] = key.split(" ");
      const entry = this.#store.find(type, rest.join(" "));
      if (entry === undefined) continue;
      for (const file of this.#filesOfEntry(entry)) {
        if (!/\.(abap|xml|asddls)$/.test(file)) continue;
        const name = "/" + file;
        const before = registry.getFileByName(name)?.getRaw();
        const copy = join(this.#store.root, this.#snapshotOf(file));
        const path = existsSync(copy) ? realpathSync(copy) : undefined;
        const source = path === undefined ? undefined : readFileSync(path, "utf8");
        if (path !== undefined) paths.set(name, path);
        if (before === source) continue;
        replacements.push([name, source]);
        restore.push([name, before]);
      }
    }
    if (replacements.length === 0) return fn(registry, paths);
    try {
      this.#store.updateRegistryFiles(registry, replacements);
      return fn(registry, paths);
    } finally {
      this.#store.updateRegistryFiles(registry, restore);
    }
  }

  // the inactive objects, for the ADT inactive-objects feed
  inactiveObjects() {
    return [...this.#store.inactive].sort().map((key) => {
      const [type, ...rest] = key.split(" ");
      const name = rest.join(" ");
      const entry = this.#store.find(type, name);
      return {type, name, package: entry?.package, file: entry?.file};
    });
  }

  // the state of one object as its documents report it
  stateOf(entry) {
    let changedAt;
    try {
      changedAt = statSync(join(this.#store.root, entry.file)).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
    } catch {
      changedAt = undefined;
    }
    const object = this.#store.find(entry.type, entry.name) ?? entry;
    const differs = TYPES[entry.type]?.source === true
      ? this.#filesOfEntry(object).filter((f) => !/\.xml$/.test(f))
        .some((f) => {
          const working = join(this.#store.root, f);
          const active = this.#activeFile(f, entry);
          if (!existsSync(working)) return active && existsSync(active) && readFileSync(active, "utf8") !== "";
          return !active || !existsSync(active) || readFileSync(working, "utf8") !== readFileSync(active, "utf8");
        })
      : this.#store.inactive.has(`${entry.type} ${entry.name}`);
    return {changedAt, version: differs ? "inactive" : "active"};
  }

  // An activation checks one source revision. A save can arrive while the
  // build is running, including from another editor writing to the worktree.
  sourceRevision(type, name) {
    const entry = this.#store.find(type, name);
    if (entry === undefined) return undefined;
    return this.#revisionOf(entry, (file) => existsSync(join(this.#store.root, file))
      ? createHash("sha256").update(readFileSync(join(this.#store.root, file))).digest("hex") : "");
  }

  // a revision is the files of an object and the digest of each: the same
  // whether it is read off the disk or off the digests a build read
  // (tools/osd-build.mjs hashOf), so a completion compares like with like
  #revisionOf(entry, digestOf) {
    const files = entry.type === "CLAS"
      ? Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix))
      : [entry.file];
    const hash = createHash("sha256");
    for (const file of files) hash.update(file).update("\0").update(digestOf(file)).update("\0");
    return hash.digest("hex");
  }

  builtRevision(key, digests) {
    const [type, ...rest] = key.split(" ");
    const entry = this.#store.find(type, rest.join(" "));
    if (entry === undefined) return undefined;
    return this.#revisionOf(entry, (file) => digests.get(normalPath(join(this.#store.root, file))) ?? "");
  }

  #activeInputs;

  #activeFile(file, entry) {
    const hash = (this.#store.served?.running === true ? this.#store.served.generation : undefined) ?? liveHash(this.#store.root);
    const generation = hash && join(this.#store.root, "build", "by-input", hash);
    const complete = generation && existsSync(join(generation, "source", ".complete"));
    const snapshot = generation && join(generation, "source", sourceSnapshotPath(file));
    if (complete && existsSync(snapshot)) return snapshot;
    // Pre-save copies retain proven active input, including genuinely empty
    // bytes. keepActive leaves unavailable input absent, never a placeholder.
    const copy = join(this.#store.root, this.#snapshotOf(file));
    const layer = this.#store.roots.find(root => root.path === entry.root);
    if ((!complete || layer?.overlayOf) && existsSync(copy)) return copy;
    // A freshly copied overlay still runs the archive's proven active bytes
    // until it has been published. Never infer activity from the working copy.
    if (complete && layer?.overlayOf) {
      const original = join(layer.overlayOf, relative(layer.path, file));
      const base = join(generation, "source", sourceSnapshotPath(original));
      if (existsSync(base)) return base;
    }
    if (!generation || !existsSync(generation)) return undefined;
    let inputs = this.#activeInputs?.generation === generation ? this.#activeInputs.inputs : undefined;
    if (inputs === undefined) {
      try {
        inputs = JSON.parse(readFileSync(join(generation, "source-inputs.json"), "utf8"));
      } catch {
        // Older generations recorded the aggregate input hash only. Matching
        // that hash proves every input; a partial match proves nothing.
        try {
          const manifest = JSON.parse(readFileSync(join(generation, "manifest.json"), "utf8"));
          const digests = new Map();
          // New manifests keep identity separate from the diagnostic description;
          // the older shape used transpiler itself to name the generation.
          if (hashOf(this.#store.root, inputsOf(this.#store.root), {digests, transpiler: manifest.toolchain ?? manifest.transpiler}) !== hash) return undefined;
          inputs = Object.fromEntries([...digests].map(([path, digest]) => [relative(this.#store.root, path).replaceAll("\\", "/"), digest]));
          writeFileSync(join(generation, "source-inputs.json"), JSON.stringify(inputs));
        } catch {return undefined;}
      }
      if (inputs === null || typeof inputs !== "object") return undefined;
      // A generation's proof is immutable. Reuse it for class includes and
      // repository listings instead of parsing the full input map per part.
      this.#activeInputs = {generation, inputs};
    }
    const digest = inputs[file.replaceAll("\\", "/")];
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return undefined;
    const shared = join(this.#store.root, "build", "source-by-digest", digest);
    if (existsSync(join(generation, "source-shared")) && existsSync(shared)) return shared;
    const target = join(generation, "source", sourceSnapshotPath(file));
    if (existsSync(target) && createHash("sha256").update(readFileSync(target)).digest("hex") === digest) return target;
    const working = join(this.#store.root, file);
    if (!existsSync(working)) return undefined;
    const bytes = readFileSync(working);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) return undefined;
    mkdirSync(dirname(target), {recursive: true});
    writeSourceSnapshot(target, bytes);
    return target;
  }

  sourceVersion(part, version) {
    const active = version === "active";
    const activeFile = active ? this.#activeFile(part.file, part) : undefined;
    const classInclude = part.type === "CLAS" && part.include !== "main";
    // Class includes use READ's per-version absence flag. The ADT routes
    // turn it into measured missing-test errors or standard templates.
    // A main source without active proof has no readable representation.
    if (active && activeFile === undefined && !classInclude) {
      throw new NotFound(part.type, `${part.name} active version (${part.include ?? "main"})`);
    }
    const source = active ? (activeFile === undefined ? "" : readFileSync(activeFile, "utf8")) : part.source;
    // Retained active bytes, including zero bytes, survive working-file removal.
    const presence = active ? {empty: activeFile === undefined} : {};
    return {...part, ...presence, source, etag: entityTag(active ? "active\0" + source : source)};
  }

}

// every file under a folder, for the copies of active versions
function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
