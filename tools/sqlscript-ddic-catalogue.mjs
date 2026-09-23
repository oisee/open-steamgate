// DDIC objects -> the small typed catalogue consumed by the SQLScript binder.
//
// Keep this adapter at the compiler boundary.  The relational IR deliberately
// knows neither ObjectStore nor abapGit XML; it only needs
// `{TABLE: {COLUMN: type}}`.  Conversely, DDIC resolution already exists in
// osd-type-graph.mjs and must not be reimplemented by the AMDP generator.
import {irTypeOfDdic, unresolvedType, UnresolvedScalarType} from "./sqlscript/scalar-types.mjs";
import {resolveType} from "./osd-type-graph.mjs";

function irType(field, table) {
  if (field.INCLUDE !== undefined) {
    // a missing include is a missing *set* of columns whose names nobody
    // knows, so refusing on reference cannot work: the table is refused
    throw new Error(`DDIC ${table}: include ${field.INCLUDE} did not resolve (${field.REASON}), so the table's schema would be partial`);
  }
  const type = field.TYPE ?? field;
  try {
    return irTypeOfDdic(type, `DDIC ${table}.${field.NAME}`);
  } catch (error) {
    if (!(error instanceof UnresolvedScalarType)) throw error;
    // one column's element is not in this dictionary: the column is carried
    // marked, and a body is refused by its name when it reads it
    return unresolvedType(`${table}.${field.NAME}: ${type.REASON ?? error.message}`);
  }
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
