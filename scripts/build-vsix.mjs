// One universal .vsix that carries the system inside it (docs/vscode-extension.md,
// "B0 spike", "What packaging still needs"). `npm run vsix` writes
// `build/vsix/osd-vscode-<version>.vsix`: a plain zip -- built with the
// system `zip` CLI, not `vsce` -- of `[Content_Types].xml`,
// `extension.vsixmanifest` (both generated from `editors/vscode/package.json`
// the way vsce does) and an `extension/` folder holding the extension itself
// plus a runnable system tree at `extension/osd/`.
//
// What goes into `extension/osd/` is exactly what `node test/run.mjs` needs
// at run time, found by tracing rather than guessing:
//   - the CURRENT generation's `output/` -- the real files, not
//     `build/live/output`'s symlink chain, and NOT the `build/by-input/<hash>/`
//     cache entry it lives in either. Two things ruled the cache entry out,
//     found by trying it first: `zip` without `-y` dereferences a symlink
//     into a real directory when it archives one (`build/live` -> a full
//     second copy of its own target, and unzip then hands
//     `tools/osd-build.mjs`'s own live-switch a real directory where it
//     only ever expects a symlink or nothing, which is an unhandled EISDIR
//     on `renameSync` -- `output/` itself, alone among the three, DOES
//     tolerate that shape, "a real directory there is what every tree had
//     before this existed"); and separately, the input hash the cache is
//     keyed on is computed over each lib folder'S WHOLE tree, not the
//     `files` glob a lib entry restricts reading to, so a lib trimmed to
//     that glob (below) never reproduces the hash of the untrimmed clone
//     this generation was actually built from -- the cache would miss on
//     first build regardless. `output/` alone, shipped as plain files,
//     costs nothing extra (`switchTo` moves a pre-existing directory there
//     aside to `build/legacy-<ts>` on the first real build) and adds
//     nothing broken; a first start is therefore a full, ordinary build
//     (measured below), and a second start of the SAME materialized copy
//     is fast because BY THEN it has grown its own matching cache, the
//     same way any other checkout's second build does.
//   - `src/`, `gen/`, `packs/` (whole -- generators read pack content, not a
//     layer list), `webapp/`, `tools/` (whole), `test/` minus `test/e2e/`
//     and `test/fixtures/` (`abap_transpile.json`'s and `abaplint.jsonc`'s
//     own exclude lists) -- not just `run.mjs`/`start.mjs`/`setup.mjs` and
//     their JS imports (traced by grep, including one dynamic import,
//     `test/setup.mjs` -> `./seed.mjs`): `abaplint.jsonc`'s own
//     `global.files` glob makes ALL of `test/` an input to the abaplint
//     registry `tools/osd-store.mjs` builds at startup, non-JS ABAP fixtures
//     included, which a JS import graph alone can never find;
//   - `abaplint.jsonc` itself, read at startup by that same registry;
//   - `data/` (root seed rows -- `tools/osd-packs.mjs` `dataDirsOf()` reads
//     it, `test/seed.mjs` calls that);
//   - `abap_transpile.json` and, at the exact relative paths it names, the
//     library sources it reads: `.local/lars/<name>/...`, each trimmed to
//     what the library's own `files` glob names (abapGit, open-abap-gui,
//     open-abap-odata, ajson) or, for a library with no `files` filter
//     (open-abap-core, express-icf-shim, open-abap-apc), everything except
//     that library's OWN `node_modules/`, `output/` and `test/` -- its own
//     build litter, never read by our transpile;
//   - `node_modules/`, traced from `package-lock.json`'s own dependency
//     graph (lockfileVersion 3, flat `packages` map) starting at the five
//     packages the run-time path actually imports (`@abaplint/core`,
//     `@abaplint/runtime`, `@abaplint/transpiler`, `@abaplint/database-sqlite`,
//     `express`) and walking `dependencies`/`optionalDependencies` --
//     answered by npm's own resolution, not by a guess at what "the
//     transitive deps" are. `open-rfc` (live RFC) and `@duckdb/*` (not on
//     the default path, per CLAUDE.md) are left out on purpose.
//
// Left out on purpose: `.git`, `.local/worktrees`, `.local/corpus*` (SAP
// corpus -- never shipped, CLAUDE.md), every other `.local/lars/*` clone,
// `test/e2e`, `test/fixtures` used only by suites not shipped, Playwright,
// DuckDB, Postgres, docs, and every dev-only devDependency (webpack, mocha,
// chai, terser, the browserify shims -- browser-preview and node-test-only).
//
// See `docs/vscode-extension.md`, "Packaging", for the measured numbers this
// produced and the trims proposed if the total ever creeps back up.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  readlinkSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {minimatch} from "minimatch";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = join(ROOT, "editors", "vscode");
const BUILD_DIR = join(ROOT, "build", "vsix");
const STAGE = join(BUILD_DIR, "stage");

function log(msg) {
  console.log(`build-vsix: ${msg}`);
}

function dirSizeBytes(dir) {
  if (existsSync(dir) === false) return 0;
  const out = execFileSync("du", ["-sk", dir], {encoding: "utf8"});
  return parseInt(out.split(/\s+/)[0], 10) * 1024;
}

function fmtMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Copies `src` to `dest`, following symlinks (`realpathSync`) so a seed
 *  never carries a symlink pointing outside itself -- `output` (a symlink
 *  chain to `build/by-input/<hash>/output`) and `.local/lars/open-abap-apc`
 *  (a symlink to a sibling checkout entirely outside this repo) are both
 *  cases of this in the tree we build from. */
function copyReal(src, dest, options = {}) {
  const real = realpathSync(src);
  mkdirSync(dirname(dest), {recursive: true});
  cpSync(real, dest, {recursive: true, dereference: true, ...options});
}

/** Copies every file of `srcDir` whose path relative to `srcDir` (leading
 *  `/`, forward slashes) matches one of `patterns` (abap_transpile.json's
 *  own glob shape) into the same relative path under `destDir`. */
function copyFiltered(srcDir, destDir, patterns) {
  const real = realpathSync(srcDir);
  // `statSync` (follows symlinks), not the dirent's own type: a lib folder
  // may hold a symlinked subtree (open-abap-apc's `src`, a sibling checkout
  // entirely outside this repo) that a dirent check alone reports as "not a
  // directory" and a plain walk then treats as a single opaque file.
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  let count = 0;
  for (const file of walk(real)) {
    const rel = `/${relative(real, file).replaceAll("\\", "/")}`;
    if (patterns.some((pat) => minimatch(rel, pat))) {
      const dest = join(destDir, relative(real, file));
      mkdirSync(dirname(dest), {recursive: true});
      cpSync(file, dest);
      count++;
    }
  }
  return count;
}

/** Everything of `srcDir` except the named top-level entries -- a library's
 *  own build litter (its `node_modules/`, `output/`, `test/`, `.git/`), not
 *  read by anything that transpiles against it as a lib. */
function copyExcludingTop(srcDir, destDir, exclude) {
  const real = realpathSync(srcDir);
  mkdirSync(destDir, {recursive: true});
  for (const entry of readdirSync(real, {withFileTypes: true})) {
    if (exclude.includes(entry.name)) continue;
    copyReal(join(real, entry.name), join(destDir, entry.name));
  }
}

// ---- node_modules: traced from package-lock.json, not guessed -----------

const RUNTIME_ROOTS = ["@abaplint/core", "@abaplint/runtime", "@abaplint/transpiler", "@abaplint/database-sqlite", "express"];

function runtimeModuleClosure() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const pkgs = lock.packages;
  const visited = new Set();
  const queue = [...RUNTIME_ROOTS];
  while (queue.length > 0) {
    const name = queue.shift();
    const key = `node_modules/${name}`;
    if (visited.has(key)) continue;
    const info = pkgs[key];
    if (info === undefined) {
      throw new Error(`build-vsix: ${key} is not in package-lock.json -- npm install first`);
    }
    visited.add(key);
    const deps = {...(info.dependencies ?? {}), ...(info.optionalDependencies ?? {})};
    for (const dep of Object.keys(deps)) queue.push(dep);
  }
  return [...visited].map((key) => key.slice("node_modules/".length)).sort();
}

// ---- library sources: the exact relative paths abap_transpile.json names --

/** `{name, folder, files}` for every lib entry of abap_transpile.json whose
 *  `folder` starts with `/.local/lars/` -- the only lib shape this repo
 *  actually has: a folder relative to the root, with an optional `files`
 *  glob list. */
function libEntries() {
  const config = JSON.parse(readFileSync(join(ROOT, "abap_transpile.json"), "utf8"));
  return config.libs.map((lib) => ({
    name: basename(lib.folder),
    folder: lib.folder.replace(/^\//, ""), // "/.local/lars/x" -> ".local/lars/x"
    files: lib.files,
  }));
}

// ---- stage layout ---------------------------------------------------------

/** The current generation's `output/` as plain files at the seed root --
 *  no `build/`, no symlink. `tools/osd-build.mjs`'s own `switchTo()`
 *  tolerates exactly this shape on the FIRST real build it runs (a
 *  pre-existing real directory at `output/` is moved aside to
 *  `build/legacy-<ts>`, never deleted from under a process still loading
 *  it, and a fresh symlink takes its place), so this is not a special case
 *  the build has to be taught -- it is the case the comment at the top of
 *  that file names as "what every tree had before this existed". Minus
 *  `*.mjs.map`: a build OUTPUT, never hashed as an input, so dropping the
 *  source maps changes nothing about correctness, only a stack trace's
 *  exact source line. */
function copyOutput(seedRoot) {
  const liveOutput = join(ROOT, "build", "live", "output");
  if (existsSync(liveOutput) === false) {
    throw new Error("build-vsix: build/live/output does not exist -- run npm run transpile first");
  }
  cpSync(realpathSync(liveOutput), join(seedRoot, "output"), {
    recursive: true, dereference: true, filter: (p) => p.endsWith(".mjs.map") === false,
  });
  log(`output/ (${basename(readlinkSync(join(ROOT, "build", "live")))})`);
}

function copySeedTree(seedRoot) {
  mkdirSync(seedRoot, {recursive: true});

  copyOutput(seedRoot);

  for (const dir of ["src", "gen", "packs", "webapp", "tools", "data"]) {
    copyReal(join(ROOT, dir), join(seedRoot, dir));
  }
  for (const file of ["abap_transpile.json", "abaplint.jsonc", "package.json"]) {
    cpSync(join(ROOT, file), join(seedRoot, file));
  }

  // Not just run.mjs/start.mjs/setup.mjs's own JS imports: `abaplint.jsonc`'s
  // own `global.files` glob ("/{src,...,test,...}/**/*.*") makes the WHOLE
  // `test/` folder (minus `test/e2e/` and `test/fixtures/`, its own exclude
  // list, matching abap_transpile.json's) an input to the abaplint registry
  // `tools/osd-store.mjs` builds at startup (`test/start.mjs`'s own
  // `store.registry()` call) for the ADT façade's xref/readers routes --
  // found the hard way, by running the packaged copy and reading the ENOENT
  // (a missing `abaplint.jsonc` first) and then the registry's own silent
  // narrower read (a `test/unit/*.clas.testclasses.abap` never in the tree)
  // rather than by re-deriving it from a static import graph, which a
  // non-JS file can never appear in.
  cpSync(join(ROOT, "test"), join(seedRoot, "test"), {
    recursive: true,
    filter: (src) => {
      const rel = relative(join(ROOT, "test"), src);
      return rel !== "e2e" && rel !== "fixtures" && rel.startsWith(`e2e${"/"}`) === false && rel.startsWith(`fixtures${"/"}`) === false;
    },
  });

  for (const lib of libEntries()) {
    const srcDir = join(ROOT, lib.folder);
    if (existsSync(srcDir) === false) {
      throw new Error(`build-vsix: lib ${lib.name} (${lib.folder}) is not cloned -- see .local/lars/`);
    }
    const destDir = join(seedRoot, lib.folder);
    if (lib.files !== undefined) {
      const n = copyFiltered(srcDir, destDir, lib.files);
      log(`lib ${lib.name}: ${n} files (files: filter)`);
    } else {
      copyExcludingTop(srcDir, destDir, ["node_modules", "output", "test", ".git"]);
      log(`lib ${lib.name}: whole folder minus its own node_modules/output/test`);
    }
  }

  const modules = runtimeModuleClosure();
  for (const name of modules) {
    copyReal(join(ROOT, "node_modules", name), join(seedRoot, "node_modules", name));
  }
  log(`node_modules: ${modules.length} packages traced from package-lock.json`);

  return modules;
}

// ---- the extension itself -------------------------------------------------

function copyExtensionFiles(extensionDir) {
  mkdirSync(extensionDir, {recursive: true});
  for (const entry of readdirSync(EXT_DIR, {withFileTypes: true})) {
    if (entry.name === "osd") continue; // never present here; guards a stray dev copy
    copyReal(join(EXT_DIR, entry.name), join(extensionDir, entry.name));
  }
  cpSync(join(ROOT, "LICENSE"), join(extensionDir, "LICENSE"));
  if (existsSync(join(EXT_DIR, "README.md"))) {
    // already copied above by the directory loop
  }
}

// ---- the two vsix manifests, generated from package.json like vsce does --

function contentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/>
<Default Extension="js" ContentType="application/javascript"/>
<Default Extension="mjs" ContentType="application/javascript"/>
<Default Extension="cjs" ContentType="application/javascript"/>
<Default Extension="md" ContentType="text/markdown"/>
<Default Extension="txt" ContentType="text/plain"/>
<Default Extension="xml" ContentType="text/xml"/>
<Default Extension="svg" ContentType="image/svg+xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>
`;
}

function vsixManifestXml(pkg) {
  const publisher = pkg.publisher ?? "open-steamgate";
  const identity = `${publisher}.${pkg.name}`;
  const displayName = pkg.displayName ?? pkg.name;
  const description = (pkg.description ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const vscodeEngine = (pkg.engines?.vscode ?? "*").replace(/^\^|^~/, "");
  const categories = (pkg.categories ?? []).join(",");
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${publisher}" ${pkg.private ? "" : ""}/>
    <DisplayName>${displayName}</DisplayName>
    <Description xml:space="preserve">${description}</Description>
    <Tags></Tags>
    <Categories>${categories}</Categories>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${vscodeEngine}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

// ---- entry point ------------------------------------------------------------

export async function buildVsix() {
  const pkg = JSON.parse(readFileSync(join(EXT_DIR, "package.json"), "utf8"));
  rmSync(STAGE, {recursive: true, force: true});
  mkdirSync(STAGE, {recursive: true});

  const extensionDir = join(STAGE, "extension");
  copyExtensionFiles(extensionDir);
  const seedRoot = join(extensionDir, "osd");
  const modules = copySeedTree(seedRoot);

  writeFileSync(join(STAGE, "[Content_Types].xml"), contentTypesXml());
  writeFileSync(join(STAGE, "extension.vsixmanifest"), vsixManifestXml(pkg));

  const out = join(BUILD_DIR, `osd-vscode-${pkg.version}.vsix`);
  rmSync(out, {force: true});
  execFileSync("zip", ["-X", "-q", "-r", out, "[Content_Types].xml", "extension.vsixmanifest", "extension"], {cwd: STAGE});

  const breakdown = {
    "output/ (current generation, plain files)": dirSizeBytes(join(seedRoot, "output")),
    "node_modules/": dirSizeBytes(join(seedRoot, "node_modules")),
    "packs/": dirSizeBytes(join(seedRoot, "packs")),
    "src/ + gen/ + webapp/ + tools/ + test/ + data/": ["src", "gen", "webapp", "tools", "test", "data"]
      .reduce((sum, d) => sum + dirSizeBytes(join(seedRoot, d)), 0),
    ".local/lars/ (library sources)": dirSizeBytes(join(seedRoot, ".local")),
    "extension.js/lib.js/launcher.js/resources/examples": dirSizeBytes(extensionDir) - dirSizeBytes(seedRoot),
  };
  const unpackedTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const vsixSize = statSync(out).size;

  log(`.vsix: ${out} (${fmtMB(vsixSize)})`);
  log(`unpacked: ${fmtMB(unpackedTotal)}`);
  for (const [label, bytes] of Object.entries(breakdown)) {
    log(`  ${label}: ${fmtMB(bytes)}`);
  }
  if (unpackedTotal > 150 * 1024 * 1024) {
    log("WARNING: unpacked size is over ~150 MB -- see docs/vscode-extension.md, Packaging, for the trims proposed.");
  }

  return {out, vsixSize, unpackedTotal, breakdown, modules, pkg};
}

if (basename(process.argv[1] ?? "") === "build-vsix.mjs") {
  buildVsix().then(
    () => process.exit(0),
    (error) => {
      console.error(String(error?.stack ?? error));
      process.exit(1);
    },
  );
}
