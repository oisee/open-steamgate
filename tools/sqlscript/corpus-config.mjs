// What the corpus instruments need to know about the corpus that the
// repository must not: which packages are the teaching corpus.
//
// The corpus is SAP standard code exported from a sandbox and kept under
// .local/ (never tracked). Its package names are corpus content too, so the
// split between teaching and working packages lives beside it, in the
// gitignored .local/corpus-names.json, as `"teaching": ["PREFIX", ...]`.
// Without the file an instrument cannot tell the two corpora apart, and it
// says so and exits 2 rather than counting everything as one corpus -- the
// histogram that mixed them was the one that was confidently wrong
// (docs/sqlscript-corpus.md).
import {readFileSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";

/** .local/corpus-names.json, looked for upward from the working directory (a worktree shares the primary checkout's .local) */
export function corpusConfigPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, ".local", "corpus-names.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** a predicate: is this package (the export's zip name) part of the teaching corpus */
export function teachingPackages() {
  const path = corpusConfigPath();
  if (path === undefined) {
    console.error("corpus: .local/corpus-names.json is missing, so teaching and working packages cannot be told apart.\n" +
      "It is local on purpose (package names are corpus content); create it with {\"teaching\": [\"PREFIX\", ...]}.");
    process.exit(2);
  }
  const prefixes = (JSON.parse(readFileSync(path, "utf8")).teaching ?? []).map((one) => String(one).trim());
  // an empty prefix would make every package a teaching one
  if (prefixes.length === 0 || prefixes.some((one) => one === "")) {
    console.error(`corpus: ${path} names no teaching package prefixes, or an empty one`);
    process.exit(2);
  }
  const upper = prefixes.map((one) => String(one).toUpperCase());
  return (pkg) => upper.some((prefix) => String(pkg).toUpperCase().startsWith(prefix));
}
