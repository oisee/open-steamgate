// The cross-reference tables, filled on every host, by one module.
//
// **Decided 2026-09-24 (Alice, AGENDA.md):** sources stay files in abapGit
// shape plus git; database tables hold only DERIVED indices such as the
// cross-reference, rebuilt from the files per generation and never edited.
// So nothing here reads the tables back to merge with them: a seed replaces
// every row of CROSS, WBCROSSGT, WBCROSSGTX and D010INC with what the files
// say, and a second seed of the same files is the same four tables.
//
// Why a module and not a line in each host: the end-of-dialog-step rule was
// written once, correctly, next to its one caller, and the two hosts written
// after it did not copy it (CLAUDE.md, "A rule written once..."). Until this
// file the cross-reference had the same shape one step worse: it was written
// by nobody but a person running `osd-xref.mjs --write`, into git-ignored
// seed files, so every host started with four empty tables and vsp's
// where-used and graph tools, which read them over freestyle SQL, saw nothing.
//
// The callers, all through the functions below:
//
//   test/start.mjs (inline)   seedAtStartup(client, {root})
//   tools/osd-serve.mjs       seedAtStartup(client, {root}) -- also the
//                             binary's `osd serve`, which the workbench and
//                             `osd up` start
//   tools/osd-data.mjs        seedAtStartup, when it boots a runtime of its own
//   scripts/build-preview.mjs rows(root) at build time, into the bundle
//   web/preview-backend.mjs   applyRows(client, rows) -- a service worker has
//                             no files to parse
//   OSGo (tools/gogen/osgo.mjs on spike/go-backend) rows(root) and
//                             insertStatements(rows) at build time
//
// The API:
//
//   await rows(root, {cache})   -> {CROSS: [...], WBCROSSGT, WBCROSSGTX, D010INC}
//                                  rows with upper-case field names, unpadded.
//                                  The parse costs ~3 s on the full tree, so
//                                  the answer is kept per generation in
//                                  build/xref/<key>.json (cache: false skips it)
//   insertStatements(rows)      -> SQL strings: one DELETE per table, then
//                                  multi-row INSERTs, CHAR padded to its DDIC
//                                  length the way the seed pads it
//   await applyRows(client, rows)  runs them on a DatabaseClient
//   await seedAtStartup(client, {root, say})  rows + applyRows, reported;
//                                  never throws, returns the counts or undefined
//
// The four tables are client-independent (no MANDT in src/osd/ddic/*.tabl.xml,
// as on a system), so no row carries a client.
//
// This file is bundled into the preview's service worker, so it imports
// nothing at the top: the parse (abaplint, node:fs) is loaded inside rows()
// only, and webpack is told to leave that import alone.

/** the four tables, in the order they are written, as the database names them */
export const TABLES = ["CROSS", "WBCROSSGT", "WBCROSSGTX", "D010INC"];

/** the CHAR/NUMC widths of src/osd/ddic/<table>.tabl.xml; test/xref-seed.mjs
 *  holds this against the XML so the two cannot drift apart */
export const WIDTHS = {
  CROSS: {TYPE: 1, NAME: 30, INCLUDE: 40},
  WBCROSSGT: {OTYPE: 2, NAME: 120, INCLUDE: 40},
  WBCROSSGTX: {OTYPE: 2, NAME: 120, INCLUDE: 40},
  D010INC: {MASTER: 40, INCLUDE: 40, OBSOLETE_IN_VERSION: 4},
};

// what the cache key carries besides the generation: bump it when what
// tools/osd-xref.mjs derives changes and the tree does not
const DERIVATION = "xref-1";

/** The rows the files say. */
export async function rows(root = process.cwd(), options = {}) {
  const fs = await import(/* webpackIgnore: true */ "node:fs");
  const path = await import(/* webpackIgnore: true */ "node:path");
  const key = options.cache === false ? undefined : await cacheKey(root);
  const file = key === undefined ? undefined : path.join(root, "build", "xref", `${key}.json`);
  if (file !== undefined && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      // a torn or foreign file is a miss, not an answer
    }
  }
  const {CrossReference} = await import(/* webpackIgnore: true */ "./osd-xref.mjs");
  const {ObjectStore} = await import(/* webpackIgnore: true */ "./osd-store.mjs");
  const tables = new CrossReference(new ObjectStore({root})).build().tables();
  const out = {
    CROSS: tables.cross,
    WBCROSSGT: tables.wbcrossgt,
    WBCROSSGTX: tables.wbcrossgtx,
    D010INC: tables.d010inc,
  };
  if (file !== undefined) {
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, {recursive: true});
      // one generation's answer; the others are what this one replaced
      for (const old of fs.readdirSync(dir)) {
        if (old.endsWith(".json")) fs.rmSync(path.join(dir, old), {force: true});
      }
      // written aside and renamed, so a second process starting at the same
      // moment reads a whole file or none
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, file);
    } catch {
      // a tree that cannot be written to still gets its rows
    }
  }
  return out;
}

/** The generation the rows belong to: the build's own hash of its inputs
 *  (tools/osd-build.mjs hashOf -- the folders, the libraries, the config, the
 *  transpiler and the generators), plus the derivation. Undefined where there
 *  is no tree to hash, which only costs the cache. */
async function cacheKey(root) {
  try {
    const {hashOf} = await import(/* webpackIgnore: true */ "./osd-build.mjs");
    const {createHash} = await import(/* webpackIgnore: true */ "node:crypto");
    return createHash("sha256").update(DERIVATION).update("\0").update(hashOf(root)).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}

const quote = (value, width = 0) => `'${String(value ?? "").padEnd(width, " ").replaceAll("'", "''")}'`;

/** The rows as SQL: every table emptied, then filled. Emptying first is what
 *  makes a restart, a second host on the same database file, or a stored
 *  browser database restored under a new build all end in the same rows. */
export function insertStatements(tables, options = {}) {
  const batch = options.batch ?? 500;
  const out = [];
  for (const table of TABLES) {
    const widths = WIDTHS[table];
    const columns = Object.keys(widths);
    out.push(`DELETE FROM "${table.toLowerCase()}";`);
    const list = tables[table] ?? [];
    for (let i = 0; i < list.length; i += batch) {
      const values = list.slice(i, i + batch)
        .map((row) => `(${columns.map((c) => quote(row[c], widths[c])).join(", ")})`);
      out.push(`INSERT INTO "${table.toLowerCase()}" (${columns.map((c) => `"${c.toLowerCase()}"`).join(", ")}) VALUES ${values.join(", ")};`);
    }
  }
  return out;
}

/** Run them on the eleven-method DatabaseClient every host already holds. */
export async function applyRows(client, tables) {
  for (const sql of insertStatements(tables)) {
    await client.execute(sql);
  }
  return counts(tables);
}

export const counts = (tables) => Object.fromEntries(TABLES.map((t) => [t, (tables[t] ?? []).length]));

/** What a host with a tree does at start. Loud and not fatal: the tables
 *  are an index for tools, and a system that cannot build its index still
 *  serves -- but it says so, because four empty tables read as "nobody uses
 *  this" to every tool that asks them. */
export async function seedAtStartup(client, options = {}) {
  const say = options.say ?? ((line) => console.log(line));
  try {
    const started = Date.now();
    const tables = await rows(options.root ?? process.cwd(), options);
    const n = await applyRows(client, tables);
    if (options.quiet !== true) {
      say(`cross-reference: ${TABLES.map((t) => `${t} ${n[t]}`).join(", ")} (${Date.now() - started} ms)`);
    }
    return n;
  } catch (e) {
    say(`cross-reference not seeded: ${e?.message ?? e}. Where-used and the graph tools will see empty tables.`);
    return undefined;
  }
}
