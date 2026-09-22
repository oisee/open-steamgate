// DDIC objects -> the small typed catalogue consumed by the SQLScript binder.
//
// Keep this adapter at the compiler boundary.  The relational IR deliberately
// knows neither ObjectStore nor abapGit XML; it only needs
// `{TABLE: {COLUMN: type}}`.  Conversely, DDIC resolution already exists in
// osd-type-graph.mjs and must not be reimplemented by the AMDP generator.
import {irTypeOfDdic} from "./sqlscript/scalar-types.mjs";
import {resolveType} from "./osd-type-graph.mjs";

function irType(field, table) {
  if (field.INCLUDE !== undefined) {
    // a missing include is a missing *set* of columns whose names nobody
    // knows, so the table is refused rather than served in part
    throw new Error(`DDIC ${table}: include ${field.INCLUDE} did not resolve (${field.REASON}), so the table's schema would be partial`);
  }
  const type = field.TYPE ?? field;
  return irTypeOfDdic(type, `DDIC ${table}.${field.NAME}`);
}

/** All transparent/structure TABL objects visible through an ObjectStore.
 *
 * A caller may request only referenced names.  That is how generated AMDP
 * artefacts stay small even when the workbench can see a system-sized DDIC.
 */
export function ddicCatalogue(store, names = store.list("TABL").map((one) => one.name)) {
  const catalogue = {};
  for (const name of [...new Set(names.map((one) => String(one).toUpperCase()))].sort()) {
    // USING also names called procedures.  Only DDIC tables belong in this
    // catalogue; the procedure registry resolves the other names.
    if (store.find("TABL", name) === undefined) continue;
    const resolved = resolveType(store, name);
    if (resolved.KIND !== "STRUCTURE") {
      throw new Error(`DDIC ${name}: ${resolved.REASON ?? `expected STRUCTURE, got ${resolved.KIND}`}`);
    }
    catalogue[name] = Object.fromEntries(resolved.FIELDS.map((field) => [field.NAME, irType(field, name)]));
  }
  return catalogue;
}
