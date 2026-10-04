// Immutable source inputs beside a generation, never in the database.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, linkSync, copyFileSync, rmSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

export function keepSourceInputs(root, generation, digests, actual = undefined, overlay = undefined, previous = undefined) {
  const copies = resolve(root, overlay?.folder ?? "build/inactive/active").replaceAll("\\", "/") + "/";
  const rootPrefix = resolve(root).replaceAll("\\", "/") + "/";
  const inputs = {};
  const shared = join(root, "build", "source-by-digest");
  const reuse = previous && existsSync(join(previous.generation, "source-shared"));
  mkdirSync(shared, {recursive: true});
  const directories = new Set();
  const ensureDirectory = target => {
    const dir = dirname(target);
    if (!directories.has(dir)) {
      mkdirSync(dir, {recursive: true});
      directories.add(dir);
    }
  };
  for (const [file, digest] of digests) {
    const input = actual?.get(file) ?? file;
    const normalized = resolve(file).replaceAll("\\", "/");
    const logical = normalized.startsWith(copies) ? resolve(root, normalized.slice(copies.length)) : normalized;
    const path = logical.startsWith(rootPrefix) ? logical.slice(rootPrefix.length) : relative(root, logical);
    if (path.startsWith("..") || !/\.(abap|asddls|as[A-Za-z]+|srvdsrv|xml)$/.test(path)) continue;
    inputs[path.replaceAll("\\", "/")] = digest;
    if (reuse && previous.digests.get(file) === digest) continue;
    const target = join(generation, "source", path);
    const prior = previous && join(previous.generation, "source", path);
    if (prior && previous.digests.get(file) === digest && existsSync(prior)) {
      ensureDirectory(target);
      try {linkSync(prior, target);} catch {copyFileSync(prior, target);}
    } else {
      if (!existsSync(input)) throw changedSource(path);
      const bytes = readFileSync(input);
      if (createHash("sha256").update(bytes).digest("hex") !== digest) {
        throw changedSource(path);
      }
      ensureDirectory(target);
      writeFileSync(target, bytes);
    }
    const retained = join(shared, digest);
    if (!existsSync(retained)) {
      try {linkSync(target, retained);} catch {copyFileSync(target, retained);}
    }
  }
  // Retain the proof separately: a missing/incomplete source directory may
  // only be backfilled from bytes this generation actually read.
  const record = join(generation, "source-inputs.json");
  let known = {};
  if (reuse) {
    const prior = JSON.parse(readFileSync(join(previous.generation, "source-inputs.json"), "utf8"));
    for (const [path, digest] of Object.entries(prior)) if (path.startsWith("gen/")) inputs[path] = digest;
  } else {
    try {known = JSON.parse(readFileSync(record, "utf8"));} catch {}
  }
  mkdirSync(generation, {recursive: true});
  writeFileSync(record, JSON.stringify(Object.fromEntries(Object.entries({...known, ...inputs}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
  writeFileSync(join(generation, "source-shared"), "1\n");
  return reuse === true;
}

// gen/ is derived input, so hashOf deliberately excludes it. It is stable
// after generators finish, and warm builds cannot change it.
export function keepGeneratedSources(root, generation, read = new Map()) {
  const digests = new Map(read);
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const key = file.replaceAll("\\", "/");
        digests.set(key, read.get(key) ?? createHash("sha256").update(readFileSync(file)).digest("hex"));
      }
    }
  };
  walk(join(root, "gen"));
  keepSourceInputs(root, generation, digests);
}

// Warm builds cannot change generated input. Reuse its retained digest map;
// legacy snapshots are migrated to the shared copies once.
export function linkGeneratedSources(root, previous, generation) {
  const record = join(generation, "source-inputs.json");
  const inputs = JSON.parse(readFileSync(record, "utf8"));
  let prior = {};
  try {prior = JSON.parse(readFileSync(join(previous, "source-inputs.json"), "utf8"));} catch {}
  const walk = (from, to) => {
    mkdirSync(to, {recursive: true});
    for (const entry of readdirSync(from, {withFileTypes: true})) {
      const input = join(from, entry.name), target = join(to, entry.name);
      if (entry.isDirectory()) walk(input, target);
      else if (entry.isFile()) {
        try {linkSync(input, target);} catch {copyFileSync(input, target);}
        const path = relative(join(generation, "source"), target).replaceAll("\\", "/");
        inputs[path] = prior[path] ?? createHash("sha256").update(readFileSync(input)).digest("hex");
        const shared = join(root, "build", "source-by-digest", inputs[path]);
        if (!existsSync(shared)) {try {linkSync(input, shared);} catch {copyFileSync(input, shared);}}
      }
    }
  };
  if (existsSync(join(previous, "source-shared"))) {
    for (const [path, digest] of Object.entries(prior)) if (path.startsWith("gen/")) inputs[path] = digest;
  } else {
    const from = join(previous, "source", "gen");
    if (!existsSync(from)) return;
    walk(from, join(generation, "source", "gen"));
  }
  writeFileSync(record, JSON.stringify(Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
}

export function completeSourceSnapshot(generation) {
  mkdirSync(join(generation, "source"), {recursive: true});
  writeFileSync(join(generation, "source", ".complete"), "1\n");
}

// Cold reproducibility comparisons use ordinary files, including when the
// generation being compared retained unchanged sources by shared digest.
export function materializeSourceSnapshot(root, generation) {
  if (!existsSync(join(generation, "source-shared"))) return;
  const inputs = JSON.parse(readFileSync(join(generation, "source-inputs.json"), "utf8"));
  const directories = new Set();
  for (const [path, digest] of Object.entries(inputs)) {
    const target = join(generation, "source", path);
    if (existsSync(target)) continue;
    const shared = join(root, "build", "source-by-digest", digest);
    if (!existsSync(shared)) continue;
    const dir = dirname(target);
    if (!directories.has(dir)) {mkdirSync(dir, {recursive: true}); directories.add(dir);}
    try {linkSync(shared, target);} catch {copyFileSync(shared, target);}
  }
}

export function gcSourceInputs(root) {
  const shared = join(root, "build", "source-by-digest");
  if (!existsSync(shared)) return;
  const retained = new Set();
  const byInput = join(root, "build", "by-input");
  for (const entry of readdirSync(byInput, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const generation = join(byInput, entry.name);
    if (!existsSync(join(generation, "source-shared"))) continue;
    try {
      for (const digest of Object.values(JSON.parse(readFileSync(join(generation, "source-inputs.json"), "utf8")))) retained.add(digest);
    } catch {return;} // Unreadable provenance must never make GC delete it.
  }
  for (const entry of readdirSync(shared)) if (!retained.has(entry)) rmSync(join(shared, entry));
}

function changedSource(path) {
  const error = new Error(`source changed while retaining generation input: ${path}`);
  error.code = "INPUT_CHANGED";
  return error;
}
