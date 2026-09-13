// What one object actually needs, so that only that gets built.
//
// Importing a repository wholesale does not work and should not be made to.
// vivid-vibes is 85 effect classes of which 74 do not compile against their
// own interface, and none of them is reachable from the handler we want to
// run. Building all of it to serve one entry point means a broken class
// nobody calls can stop a service that would have worked.
//
// So: name an entry object, take what it reaches, build that.
//
// The reachability is by name, not by resolved symbol: a word matching an
// object in the folder counts as a use. That over-approximates on purpose —
// including an object nothing calls costs a little build time, while missing
// one that is called is a runtime failure in a service that reported itself
// healthy. Wrong in the cheap direction.
//
// But only over code. Scanning raw text made every entry point look as though
// it reached the whole repository, because the handler serves HTML and the
// player's markup names every effect in a string literal. Comments and
// literals are stripped before matching; expressions inside a string template
// are kept, because those are code.
//
// The same reasoning as the store's dependents(), pointed the other way.
import {readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, rmSync, existsSync} from "node:fs";
import {basename, join} from "node:path";

// <name>.<type>.abap / <name>.<type>.xml, abapGit's spelling
const OBJECT = /^([^.]+)\.(clas|intf|prog|fugr|tabl|ttyp|dtel|doma|shlp|ddls|msag|view|enho|sush|sicf|sapc|w3mi|devc)\b/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

// every object in the folder, by upper-case name, with the files that are it
export function index(folder) {
  const objects = new Map();
  for (const file of walk(folder)) {
    const match = OBJECT.exec(basename(file));
    if (match === null) {
      continue;
    }
    const name = match[1].toUpperCase();
    // a package node or a MIME object is not a code dependency and has no
    // name a class would mention; it travels with whoever wanted it
    if (objects.has(name) === false) {
      objects.set(name, {name, type: match[2].toUpperCase(), files: []});
    }
    objects.get(name).files.push(file);
  }
  return objects;
}

// Only the code. A 962-line handler that serves HTML names half the
// repository inside string literals — every effect appears in the player's
// markup — so scanning raw text made the entry point look as though it
// reached everything, which is the answer this tool exists to avoid giving.
// Comments and literals go; the expressions inside a string template stay,
// because those are code and do call things.
export function code(source) {
  const out = [];
  for (let line of source.split("\n")) {
    if (/^\s*\*/.test(line)) {
      continue;
    }
    let kept = "";
    let quote;
    for (let at = 0; at < line.length; at = at + 1) {
      const ch = line[at];
      if (quote === undefined) {
        if (ch === "\"") {
          break;
        }
        if (ch === "'" || ch === "|") {
          quote = ch;
          continue;
        }
        kept = kept + ch;
        continue;
      }
      // inside a template, { ... } is an expression and belongs to the code
      if (quote === "|" && ch === "{") {
        const end = line.indexOf("}", at);
        kept = kept + " " + line.slice(at + 1, end < 0 ? undefined : end) + " ";
        at = end < 0 ? line.length : end;
        continue;
      }
      if (ch === quote) {
        // '' inside a literal is an escaped quote, not the end of it
        if (quote === "'" && line[at + 1] === "'") {
          at = at + 1;
          continue;
        }
        quote = undefined;
      }
    }
    out.push(kept);
  }
  return out.join("\n");
}

const readable = (file) => {
  if (/\.abap$/i.test(file)) {
    return code(readFileSync(file, "utf8"));
  }
  // an XML descriptor names types and supertypes as element content, and none
  // of it is a string literal in the ABAP sense
  return /\.(xml|asddls|ddls)$/i.test(file) ? readFileSync(file, "utf8") : "";
};

// The transitive set of objects `entry` reaches, itself included. Missing
// entries are reported rather than skipped, because "built nothing and said
// nothing" is the failure this whole exercise exists to avoid.
export function closure(folder, entries, options = {}) {
  const objects = options.index ?? index(folder);
  const wanted = [];
  const missing = [];
  for (const entry of entries) {
    const name = String(entry).toUpperCase();
    if (objects.has(name)) {
      wanted.push(name);
    } else {
      missing.push(name);
    }
  }

  const seen = new Set(wanted);
  const queue = [...wanted];
  while (queue.length > 0) {
    const current = objects.get(queue.shift());
    const text = current.files.map(readable).join("\n").toUpperCase();
    for (const [name, object] of objects) {
      if (seen.has(name) || name === current.name) {
        continue;
      }
      // a word boundary, so ZCL_O4D_CELL16 is not matched by ZCL_O4D_CELL120
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
        seen.add(name);
        queue.push(name);
      }
      void object;
    }
  }

  return {
    objects: [...seen].sort().map((name) => objects.get(name)),
    missing,
    total: objects.size,
  };
}

// Materialise a closure as a folder the transpiler can be pointed at.
//
// The service nodes deliberately stay behind. They are not code and the
// transpiler refuses them outright — "Object type SAPC not allowed" — so
// carrying them here turns a buildable closure into a failed build. The ICF
// registry reads them from wherever the repository was imported, which is
// the folder this closure was taken from, so nothing is lost by leaving
// them. Pass nodes: true only for a folder meant to be read rather than
// built.
export function materialise(folder, entries, out, options = {}) {
  const result = closure(folder, entries, options);
  if (options.keep !== true && existsSync(out) === true) {
    rmSync(out, {recursive: true, force: true});
  }
  mkdirSync(out, {recursive: true});
  let files = 0;
  const carry = (file) => {
    copyFileSync(file, join(out, basename(file)));
    files = files + 1;
  };
  for (const object of result.objects) {
    object.files.forEach(carry);
  }
  if (options.nodes === true) {
    for (const file of walk(folder)) {
      if (/\.(sicf|sapc)\.xml$/i.test(basename(file))) {
        carry(file);
      }
    }
  }
  return {...result, out, files};
}

function usage() {
  console.log(`usage: osd-closure.mjs <folder> <ENTRY>... [--out <folder>] [--quiet]

What <ENTRY> reaches inside <folder>, and nothing else. With --out, the
closure is copied there so the transpiler can be pointed at it.`);
}

function main(argv) {
  const folder = argv[0];
  if (folder === undefined || existsSync(folder) === false) {
    usage();
    return 2;
  }
  const at = argv.indexOf("--out");
  const out = at < 0 ? undefined : argv[at + 1];
  const entries = argv.slice(1).filter((a, i) => a.startsWith("--") === false && argv[i] !== "--out");
  if (entries.length === 0) {
    usage();
    return 2;
  }
  const result = out === undefined ? closure(folder, entries) : materialise(folder, entries, out);
  for (const object of result.objects) {
    console.log(`${object.type}\t${object.name}`);
  }
  console.log(`\n${result.objects.length} of ${result.total} objects reached from ${entries.join(", ")}`);
  if (out !== undefined) {
    console.log(`${result.files} files written to ${out}`);
  }
  for (const name of result.missing) {
    console.log(`not in this folder: ${name}`);
  }
  return result.missing.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("osd-closure.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
