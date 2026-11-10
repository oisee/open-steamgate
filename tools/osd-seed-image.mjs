// A base image for the in-memory SQLite database: the schema, the
// generation's mandatory rows and the seed rows, made once and then loaded
// as bytes. A start without STG_DB_PATH used to run all three every time --
// 0.4 s on main's CI runners, 1.1 s once packs/rap-flight brought 12 MB of
// seed rows (4.8 MB of INSERTs) -- and test hosts start a runtime about a
// hundred times per CI run. Loading the 20 MB image takes about 10 ms.
//
// STG_DB=file has had the same idea since B.13 (test/setup.mjs, BASE_DIR);
// this is the memory database's version of it. The image is named by
// everything the rows are made from, read as content: the DDL, the
// mandatory rows, the seeder's own source, and every seed file and table
// definition the seeder reads (*.tabu.json in the data folders, *.tabl.xml in
// the DDIC folders, test/seed.mjs). Anything else changes the name, and a
// name that is not there is seeded the old way and written for the next
// start. If a key cannot be computed, nothing is cached and the start seeds
// as before. OSD_SEED_IMAGE=0 turns it off; scaled data (STG_DATA_SCALE)
// never uses it.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {isAbsolute, join} from "node:path";
import {dataDirsOf, ddicDirsOf} from "./osd-packs.mjs";

const SEED_INPUT = /\.(tabu\.json|tabl\.xml)$/;

export function seedImageKey(root, schema, insert, seederSource) {
  const hash = createHash("sha256").update("osd-seed-image/1\0").update(String(schema)).update("\0");
  for (const statement of Array.isArray(insert) ? insert : [insert]) hash.update(String(statement)).update("\0");
  hash.update(seederSource).update("\0");
  for (const dir of [...dataDirsOf(root), "--ddic--", ...ddicDirsOf(root)]) {
    hash.update(dir).update("\0");
    let files;
    try { files = readdirSync(dir).sort(); } catch { continue; }
    for (const file of files) {
      if (SEED_INPUT.test(file)) hash.update(file).update("\0").update(readFileSync(join(dir, file))).update("\0");
    }
  }
  return hash.digest("hex").slice(0, 24);
}

/** load(db) -> true when the image was there; save(db) after seeding */
export function seedImage(schema, insert, env = process.env) {
  if (env.OSD_SEED_IMAGE === "0" || Number(env.STG_DATA_SCALE ?? 0) > 0) return undefined;
  const root = env.OSD_ROOT ?? process.cwd();
  let file;
  try {
    const seeder = readFileSync(join(root, "test", "seed.mjs"));
    const base = env.STG_DB_BASE ?? join(".local", "db", "base");
    file = join(isAbsolute(base) ? base : join(root, base), `heap-${seedImageKey(root, schema, insert, seeder)}.sqlite`);
  } catch {
    return undefined;
  }
  return {
    file,
    async load(db) {
      if (existsSync(file) === false) return false;
      await db.connect(readFileSync(file));
      return true;
    },
    save(db) {
      // written beside its final name and renamed: another start reading
      // the image never sees half of one
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        mkdirSync(join(file, ".."), {recursive: true});
        writeFileSync(temporary, Buffer.from(db.export()));
        renameSync(temporary, file);
      } catch (error) {
        rmSync(temporary, {force: true});
        console.error(`the seed image could not be written: ${error?.message ?? error}`);
      }
    },
  };
}
