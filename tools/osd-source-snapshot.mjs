// Immutable source inputs beside a generation, never in the database.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, linkSync, copyFileSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";

export function keepSourceInputs(root, generation, digests, actual = undefined, overlay = undefined, previous = undefined) {
  const copies = resolve(root, overlay?.folder ?? "build/inactive/active") + sep;
  for (const [file, digest] of digests) {
    const input = actual?.get(file) ?? file;
    const logical = file.startsWith(copies) ? resolve(root, file.slice(copies.length)) : file;
    const path = relative(root, logical);
    if (path.startsWith("..") || !/\.(abap|asddls|as[A-Za-z]+|srvdsrv|xml)$/.test(path)) continue;
    if (!existsSync(input)) throw changedSource(path);
    const target = join(generation, "source", path);
    const prior = previous && join(previous.generation, "source", path);
    if (prior && previous.digests.get(file) === digest && existsSync(prior)) {
      mkdirSync(dirname(target), {recursive: true});
      try {linkSync(prior, target);} catch {copyFileSync(prior, target);}
      continue;
    }
    const bytes = readFileSync(input);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw changedSource(path);
    }
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, bytes);
  }
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

export function completeSourceSnapshot(generation) {
  mkdirSync(join(generation, "source"), {recursive: true});
  writeFileSync(join(generation, "source", ".complete"), "1\n");
}

function changedSource(path) {
  const error = new Error(`source changed while retaining generation input: ${path}`);
  error.code = "INPUT_CHANGED";
  return error;
}
