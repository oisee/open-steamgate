// bin/osd.mjs as one executable, build/osd (SP4, docs/bun-spike.md part three).
//
// Run with bun: `bun scripts/build-binary.mjs [outfile] [target]`. Two things the bundler is
// told: DuckDB stays outside (native, optional), and @abaplint/core is ONE
// module — the transpiler resolves its own copy from where it lives and the
// entry another from here, same version, different files, and the
// transpiler checks its registry with instanceof.
import {createRequire} from "node:module";
import {resolve} from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dir, "..");
const core = require.resolve("@abaplint/core");
const outfile = process.argv[2] ?? resolve(root, "build", "osd");
const target = process.argv[3];
const releaseTargets = new Set([
  "bun-linux-x64-baseline", "bun-linux-arm64", "bun-windows-x64-baseline", "bun-darwin-arm64",
]);
if (target !== undefined && !releaseTargets.has(target)) {
  throw new Error(`Unsupported release target ${target}; expected one of ${[...releaseTargets].join(", ")}`);
}
const started = Date.now();
const result = await Bun.build({
  entrypoints: [resolve(root, "bin", "osd.mjs")],
  target: "bun",
  compile: {...(target ? {target} : {}), outfile},
  plugins: [{
    name: "one-core",
    setup(build) {
      build.onResolve({filter: /^@abaplint\/core$/}, () => ({path: core}));
      // DuckDB is native and optional, and a compiled bundle evaluates every
      // import at start, even one behind a dynamic import; the binary ships
      // without it and says so when asked for it
      build.onResolve({filter: /^@duckdb\/node-api$/}, () => ({path: "duckdb-absent", namespace: "osd-stub"}));
      build.onLoad({filter: /.*/, namespace: "osd-stub"}, () => ({
        contents: 'export const DuckDBInstance = {create() { throw new Error("DuckDB is not part of the binary"); }}; export default {DuckDBInstance};',
        loader: "js",
      }));
      // web/generated/amdp.mjs is written by scripts/build-preview.mjs for
      // the service worker only: test/setup.mjs imports it on the
      // globalThis.__stgPreview branch, which no binary ever takes (the
      // binary answers AMDP through tools/amdp-destination.mjs and
      // gen/amdp/procedures.json at run time). Bun still resolves the
      // dynamic import at build time, so without this the binary build
      // depended on a preview build having run first in the same tree.
      build.onResolve({filter: /\/web\/generated\/amdp\.mjs$/}, () => ({path: "preview-amdp-absent", namespace: "osd-preview-stub"}));
      build.onLoad({filter: /.*/, namespace: "osd-preview-stub"}, () => ({
        contents: "// the preview's AMDP list; the binary is not a preview (scripts/build-binary.mjs)\nexport const procedures = [];",
        loader: "js",
      }));
    },
  }],
});
for (const log of result.logs) {
  console.log(String(log).split("\n")[0]);
}
if (!result.success) {
  process.exit(1);
}
const size = (await Bun.file(outfile).size) / 1e6;
console.log(`built ${outfile}${target ? ` for ${target}` : ""}: ${size.toFixed(1)} MB in ${Date.now() - started} ms`);
