// What the transpiler is actually given, said out loud before it runs.
//
// Two ways to edit ABAP and change nothing, both of which cost a day:
//
// A folder that looks like an input and is not. local/vivid-vibes is a
// complete abapGit package, 237 files, sitting beside local/o4d which holds
// the same objects — and only local/o4d is listed in abap_transpile.json. An
// edit to the other one transpiles nothing, builds nothing, and reports
// nothing. It is worse than a missing file, because a missing file errors.
//
// And the same object in two folders that ARE inputs, where whichever the
// walk reaches first wins and the other is discarded in silence.
//
// Neither is an error: a shadow copy may be a deliberate reference, a
// duplicate may be a deliberate override. Both are things a person should be
// told, so this prints and never fails the build.
import {readFileSync, readdirSync, statSync, existsSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** the abapGit object a file belongs to: zcl_x.clas.abap and zcl_x.clas.xml are one object */
export function objectOf(filename) {
  // <name>.<type>[.<member>].<ext>; the type is the four-character abapGit kind
  const parts = filename.split(".");
  if (parts.length < 3) {
    return undefined;
  }
  // abapGit writes the dot of ZORK-MINI.Z3 as %2e and a real per cent as
  // %25, so decoding gives the object's own name back; a name that is not
  // valid escaping is taken as it stands rather than thrown over
  let name = parts[0];
  try {
    name = decodeURIComponent(name);
  } catch {
    // as it stands
  }
  return `${parts[1].toUpperCase()} ${name.toUpperCase()}`;
}

function objectsIn(folder) {
  const found = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        const object = objectOf(entry);
        if (object !== undefined) {
          found.set(object, path);
        }
      }
    }
  };
  if (existsSync(folder)) {
    walk(folder);
  }
  return found;
}

export function report(configPath = resolve(root, "abap_transpile.json"), options = {}) {
  const base = options.root ?? root;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const folders = config.input_folder ?? config.input_folders ?? [];
  const byFolder = folders.map((f) => ({folder: f, objects: objectsIn(resolve(base, f))}));

  // the same object in more than one input: the later folder wins, because
  // that is the order the transpiler is handed them
  const seen = new Map();
  const clashes = [];
  for (const {folder, objects} of byFolder) {
    for (const object of objects.keys()) {
      const earlier = seen.get(object);
      if (earlier !== undefined) {
        clashes.push({object, earlier, winner: folder});
      }
      seen.set(object, folder);
    }
  }

  // a folder beside the inputs that holds objects the inputs also hold, and
  // is not an input itself
  const shadows = [];
  const container = resolve(base, "local");
  if (existsSync(container)) {
    for (const entry of readdirSync(container)) {
      const candidate = `local/${entry}`;
      if (folders.includes(candidate) || statSync(resolve(base, candidate)).isDirectory() === false) {
        continue;
      }
      const objects = objectsIn(resolve(base, candidate));
      const shared = [...objects.keys()].filter((o) => seen.has(o));
      if (objects.size > 0) {
        shadows.push({folder: candidate, total: objects.size, shared});
      }
    }
  }
  return {folders, clashes, shadows, total: seen.size};
}

function main() {
  const {folders, clashes, shadows, total} = report();
  console.log(`Inputs: ${folders.join(", ")} — ${total} objects`);
  for (const {object, earlier, winner} of clashes) {
    console.log(`  overridden: ${object} in ${earlier}, ${winner} wins (later input)`);
  }
  for (const {folder, total: count, shared} of shadows) {
    const also = shared.length === 0 ? "none of them in the build" : `${shared.length} of them also in the build`;
    console.log(`  not an input: ${folder} holds ${count} objects, ${also}. Edits there change nothing`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
