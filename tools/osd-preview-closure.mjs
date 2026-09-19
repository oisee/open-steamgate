// What the preview bundle can reach, and which node builtins that costs.
//
// **`await import()` does not keep a module out of a webpack bundle.**
// webpack follows a dynamic import exactly as it follows a static one --
// it makes a chunk, and `LimitChunkCountPlugin({maxChunks: 1})` glues the
// chunk back in. A comment saying "this is lazy so it stays out of the
// worker" describes an intention, and the bundle does not read comments.
// That is how `tools/osd-store.mjs` reached the service worker through
// `test/setup.mjs`, brought `tools/osd-unit.mjs` with it and, through that,
// `require("module")` -- which has no polyfill and no `false` in the
// fallback list, so webpack failed with thirteen errors (2026-09-19).
//
// The thing that keeps a module out is `IgnorePlugin`, and nothing else.
//
// So this walks the graph the way webpack does -- static and dynamic imports
// alike, stopping only at what `IgnorePlugin` removes -- and reports the
// node builtins it reaches that the config neither polyfills nor stubs.
// Three green suites did not cover this, because none of them bundles.
import {readFileSync, existsSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";

export const ENTRY = "web/preview-worker.mjs";

/** the two lists the webpack config keeps, read from it rather than repeated */
export function configuredFor(root = process.cwd()) {
  const text = readFileSync(join(root, "webpack.config.cjs"), "utf8");
  // **Read the object, not a window of characters.** The first version took
  // 1200 characters after `fallback` and swallowed `module:`, `rules:` and
  // `plugins:` -- the config's own sections -- so it reported `module` as
  // covered. That is the one builtin this check exists for: it was blind to
  // exactly the defect it was written for, and only testing it against that
  // defect said so.
  const at = text.indexOf("fallback");
  const open = text.indexOf("{", at);
  let depth = 0;
  let end = open;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const fallback = text.slice(open + 1, end);
  const covered = new Set([...fallback.matchAll(/(?:^|,)\s*"?([a-z_]+)"?\s*:/g)].map((m) => m[1]));
  const ignored = [...text.matchAll(/IgnorePlugin\(\{resourceRegExp:\s*(\/[^/]+\/[a-z]*)\}/g)]
    .map((m) => {
      const body = m[1].slice(1, m[1].lastIndexOf("/"));
      return new RegExp(body);
    });
  return {covered, ignored};
}

/** every module the bundle can reach from the worker */
export function previewClosure(root = process.cwd(), {ignored} = configuredFor(root)) {
  const seen = new Set();
  const builtins = new Map();
  const walk = (file) => {
    const abs = resolve(file);
    if (seen.has(abs) || !existsSync(abs)) return;
    if (ignored.some((re) => re.test(abs))) return;         // IgnorePlugin, the only thing that removes a module
    seen.add(abs);
    const text = readFileSync(abs, "utf8");
    const note = (name) => {
      if (!builtins.has(name)) builtins.set(name, new Set());
      builtins.get(name).add(relative(root, abs));
    };
    for (const m of text.matchAll(/(?:from|import\(|require\()\s*"node:([a-z_]+)"/g)) note(m[1]);
    for (const m of text.matchAll(/require\("([a-z_]+)"\)/g)) note(m[1]);
    // static and dynamic alike: webpack does not tell them apart either
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) walk(join(dirname(abs), m[1]));
    for (const m of text.matchAll(/import\("(\.[^"]+)"\)/g)) walk(join(dirname(abs), m[1]));
  };
  walk(join(root, ENTRY));
  return {modules: [...seen].sort(), builtins};
}

/** builtins the bundle reaches that the config neither polyfills nor stubs */
export function uncovered(root = process.cwd()) {
  const config = configuredFor(root);
  const {builtins} = previewClosure(root, config);
  const out = [];
  for (const [name, files] of builtins) {
    if (config.covered.has(name)) continue;
    out.push({builtin: name, files: [...files].sort()});
  }
  return out.sort((a, b) => (a.builtin < b.builtin ? -1 : 1));
}

// **What this answers, and what it does not.** The unit here is the MODULE:
// it says every node builtin the graph reaches has a polyfill or a stub. It
// says nothing about the **exports** of that polyfill, and a polyfill can be
// partial -- measured 2026-09-19, the day this was written: `node:url` is
// polyfilled, so this printed a clean line, and the preview build failed on
// `fileURLToPath`, which the browser `url` package does not have (it has
// `Url`, `format`, `parse`, `resolve`, `resolveObject`). The check was green
// and the bundle was broken, in the same commit.
//
// So the clean line says it out loud rather than implying more than it
// measured. Widening it to exports is real work -- the imported names per
// module against what each fallback package actually exports -- and until
// that exists the sentence is the honest half of the answer.
if (runsAs("osd-preview-closure.mjs")) {
  const bad = uncovered();
  const {modules} = previewClosure();
  console.log(`preview closure: ${modules.length} modules from ${ENTRY}`);
  if (bad.length === 0) {
    console.log("every node builtin it reaches is polyfilled or stubbed in webpack.config.cjs");
    console.log("  (modules, not their exports: a partial polyfill passes this and can still fail the build)");
    process.exit(0);
  }
  for (const one of bad) {
    console.log(`\n  ${one.builtin}: no polyfill and no fallback, reached through`);
    for (const f of one.files.slice(0, 6)) console.log(`    ${f}`);
  }
  console.log("\n`await import()` does not keep a module out of a bundle; IgnorePlugin does.");
  process.exit(1);
}
