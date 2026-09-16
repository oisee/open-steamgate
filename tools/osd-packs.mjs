// A pack is a directory, not a rebuild (backlog E.2).
//
// The split document's promise: content packs are directories the binary
// reads at start, so a pack is added without rebuilding anything. A pack is
// (ABAP folder, seed rows, a webapp, a manifest naming it) — the shape the
// demo already has inside this tree, made explicit and movable outside it.
//
// One directory with an osd-pack.json in it:
//
//   packs/zork/
//     osd-pack.json      {"name": "zork", "description": "…"}
//     src/               ABAP, abapGit-named, the pack's layer
//     src/ddic/          the tables its seed rows belong to (optional)
//     data/              *.tabu.json seed rows (optional)
//     webapp/            static files, served under /app/<name> (optional)
//
// Found in <root>/packs/ and in every directory OSD_PACKS names (a pack
// itself, or a container of packs). The order is the manifest's `order`
// (default 100) then the name, and packs come after the tree's own input
// folders — so a pack wins a name it shares, the way any later layer does
// (tools/osd-inputs.mjs), and the build says so with both files named.
//
// Nothing here is compiled in: adding a directory and starting again is the
// whole procedure. The generation hash covers the input folders, so a new
// pack is a new generation, which is what it should be.
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {basename, isAbsolute, join, relative, resolve} from "node:path";

export const MANIFEST = "osd-pack.json";
export const PACKS_DIR = "packs";

const slash = (p) => p.split("\\").join("/");
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** the directories to look in: <root>/packs, then what OSD_PACKS names */
export function placesOf(root, env = process.env) {
  const places = [join(root, PACKS_DIR)];
  for (const entry of (env.OSD_PACKS ?? "").split(/[:;]/).map((s) => s.trim()).filter((s) => s !== "")) {
    places.push(isAbsolute(entry) ? entry : join(root, entry));
  }
  return places;
}

/** one directory read as a pack, or undefined when it is not one */
export function packAt(root, dir) {
  const manifest = join(dir, MANIFEST);
  if (existsSync(manifest) === false) {
    return undefined;
  }
  let declared;
  try {
    declared = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    throw new BadPack(dir, error.message);
  }
  const name = String(declared.name ?? basename(dir)).toLowerCase();
  const inside = (value, fallback) => {
    const wanted = value ?? fallback;
    if (wanted === undefined || wanted === null || wanted === false) {
      return undefined;
    }
    const at = join(dir, wanted);
    return isDir(at) ? at : undefined;
  };
  // "abap" may name one folder or several; src/ is the abapGit default, and
  // a pack that is itself a repository folder says "." instead
  const declaredAbap = declared.abap === undefined ? undefined : [declared.abap].flat();
  const abap = (declaredAbap ?? ["src", "."]).map((f) => inside(f)).filter((f) => f !== undefined);
  return {
    name,
    description: declared.description === undefined ? undefined : String(declared.description),
    dir,
    order: Number(declared.order ?? 100),
    // the package this pack's objects live in, so a tree shows a pack as a
    // package of its own rather than as "$SRC"
    package: String(declared.package ?? "$" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
    abap: abap.slice(0, 1),
    data: inside(declared.data, "data"),
    ddic: inside(declared.ddic, join(relative(dir, abap[0] ?? dir), "ddic")),
    webapp: inside(declared.webapp, "webapp"),
  };
}

/** every pack, in the order they are layered */
export function packsOf(root, env = process.env) {
  const found = new Map();
  for (const place of placesOf(root, env)) {
    if (isDir(place) === false) {
      continue;
    }
    const candidates = existsSync(join(place, MANIFEST)) ? [place] : readdirSync(place).sort().map((e) => join(place, e));
    for (const dir of candidates) {
      const pack = packAt(root, dir);
      if (pack === undefined) {
        continue;
      }
      // a pack named twice is the same pack found twice (a container listed
      // as well as its parent); the first place wins and nothing is doubled
      if (found.has(pack.name) === false) {
        found.set(pack.name, pack);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** a pack's ABAP folder as the build and the store name it: root-relative */
export function folderOf(root, dir) {
  const rel = slash(relative(root, dir));
  return rel === "" ? "." : rel;
}

/** the layers: what the config lists, then every pack, later winning */
export function inputFoldersOf(root, config, env = process.env) {
  const listed = config?.input_folder === undefined ? [] : [config.input_folder].flat();
  const packs = packsOf(root, env).flatMap((p) => p.abap.map((f) => folderOf(root, f)));
  return [...listed, ...packs.filter((f) => listed.includes(f) === false)];
}

/** the roots a pack adds to the object store, with the package each lives in */
export function packRootsOf(root, env = process.env) {
  return packsOf(root, env).flatMap((p) => p.abap.map((f) => ({
    path: folderOf(root, f), writable: true, library: false, imported: true, package: p.package, pack: p.name,
  })));
}

/** The folders a generator reads: content, not every layer.
 *
 * The transpiler is handed test/ and gen/ as well, and a generator that
 * scanned those found a CDS fixture under test/fixtures whose table exists
 * nowhere and failed the build (2026-09-16). Content is this tree's src/ and
 * every pack's ABAP folder, which is what a pack may carry CDS or a SEGW
 * project in (backlog E.3). */
export function contentFoldersOf(root, env = process.env) {
  const own = ["src"].filter((f) => isDir(join(root, f)));
  return [...own, ...packsOf(root, env).flatMap((p) => p.abap.map((f) => folderOf(root, f)))];
}

/** every folder of seed rows: the tree's own, then each pack's */
export function dataDirsOf(root, env = process.env) {
  const own = join(root, "data");
  return [...(isDir(own) ? [own] : []), ...packsOf(root, env).map((p) => p.data).filter((d) => d !== undefined)];
}

/** every folder holding table definitions a seed row may need */
export function ddicDirsOf(root, env = process.env) {
  const own = ["src/ddic", "src/segw/ddic", "src/zosd_test/ddic"].map((d) => join(root, d));
  return [...own, ...packsOf(root, env).map((p) => p.ddic).filter((d) => d !== undefined)];
}

/** the static folders a pack brings, each served under /app/<name> */
export function webappsOf(root, env = process.env) {
  return packsOf(root, env).filter((p) => p.webapp !== undefined).map((p) => ({name: p.name, dir: p.webapp}));
}

export class BadPack extends Error {
  constructor(dir, why) {
    super(`${join(dir, MANIFEST)} is not readable as a pack: ${why}`);
    this.code = "BAD_PACK";
  }
}

function main(args) {
  const root = resolve(args[0] ?? process.cwd());
  const packs = packsOf(root);
  if (packs.length === 0) {
    console.log(`no packs: nothing in ${placesOf(root).map((p) => relative(root, p) || p).join(", ")}`);
    return 0;
  }
  for (const pack of packs) {
    const parts = [
      ...pack.abap.map((f) => `abap ${folderOf(root, f)}`),
      ...(pack.data ? [`data ${folderOf(root, pack.data)}`] : []),
      ...(pack.webapp ? [`webapp /app/${pack.name}`] : []),
    ];
    console.log(`${pack.name}  ${pack.package}  order ${pack.order}  ${parts.join(", ")}`);
    if (pack.description !== undefined) {
      console.log(`  ${pack.description}`);
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
