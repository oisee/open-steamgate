// What gateway.mjs and osgo.mjs share: OSG compiled whole (src/, gen/ and the
// libraries of abap_transpile.json) and its database as SQL statements.
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {home} from "./home.mjs";

const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

export const layers = [`${home}/src`, `${home}/gen`];
export const libs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/scaffold", "open-abap-odata/src", "ajson/src/core"]
  .map((d) => `${home}/.local/lars/${d}`).filter(existsSync);

/** every class and interface of the layers and libraries, compiled (a statement outside the subset is a stub) */
export function compileOsg() {
  const objects = [...new Set([...layers, ...libs].flatMap(walk).filter((f) => /\.(clas|intf)\.abap$/.test(f) && !f.includes("testclasses")).map((f) => f.split("/").pop().split(".")[0]))];
  const t0 = performance.now();
  const program = compileProgram({folders: [...layers, ...libs], objects, tolerant: true});
  const summary = `front end: ${program.classes.length} classes, ${program.partial.length} statement stubs, ${program.skipped.length} methods not compiled, ${program.broken.length} objects with syntax errors (${Math.round(performance.now() - t0)} ms)`;
  return {program, summary};
}

/**
 * The database: the transpiler's CREATE TABLEs for this registry and the rows
 * test/seed.mjs gives the Node side, so both hosts start from the same data.
 * Rows of a table this program has no definition for (a pack's) are left out,
 * and said so in the summary.
 */
export async function osgDatabase(program) {
  const {DatabaseSetup} = await import(`${home}/node_modules/@abaplint/transpiler/build/src/db/index.js`);
  const setup = new DatabaseSetup(program.reg).run();
  process.env.OSD_ROOT ??= home;
  const {seedStatements} = await import(`${home}/test/seed.mjs`);
  const seed = seedStatements();
  const created = new Set(setup.schemas.sqlite.map((x) => /^CREATE\s+(?:TABLE|VIEW)\s+['"]?([\w\/]+)/i.exec(x)?.[1]?.toLowerCase()).filter(Boolean));
  const inserts = [...setup.insert, ...(Array.isArray(seed) ? seed : [seed])].filter((x) => String(x).trim() !== "");
  const skipped = new Map();
  const kept = inserts.filter((x) => {
    const t = /^INSERT\s+INTO\s+['"]?([\w\/]+)/i.exec(x)?.[1]?.toLowerCase();
    if (t === undefined || created.has(t)) return true;
    skipped.set(t, (skipped.get(t) ?? 0) + 1);
    return false;
  });
  const summary = `database: ${created.size} tables and views, ${kept.length} inserts${skipped.size ? `; left out, no table in this program: ${[...skipped].map(([t, n]) => `${t} (${n})`).join(", ")}` : ""}`;
  return {statements: [...setup.schemas.sqlite, ...kept], summary};
}
