// DDIC objects -> the small typed catalogue consumed by the SQLScript binder.
//
// Keep this adapter at the compiler boundary.  The relational IR deliberately
// knows neither ObjectStore nor abapGit XML; it only needs
// `{TABLE: {COLUMN: type}}`.  Conversely, DDIC resolution already exists in
// osd-type-graph.mjs and must not be reimplemented by the AMDP generator.
import {T} from "./sqlscript-ir.mjs";
import {resolveType} from "./osd-type-graph.mjs";

function irType(field, table) {
  const type = field.TYPE ?? field;
  const datatype = String(type.DATATYPE ?? "").toUpperCase();
  const length = Number(type.LENG ?? 0);
  const decimals = Number(type.DECIMALS ?? 0);
  if (["CHAR", "CLNT", "CUKY", "LANG", "UNIT", "ACCP", "NUMC", "DATS", "TIMS", "LCHR"].includes(datatype)) {
    return T.char(length);
  }
  if (["INT1", "INT2", "INT4"].includes(datatype)) return T.int;
  if (datatype === "INT8") return T.int8;
  if (["DEC", "CURR", "QUAN", "DF16_DEC", "DF34_DEC"].includes(datatype)) {
    return T.dec(length, decimals);
  }
  if (["STRG", "SSTR"].includes(datatype)) return T.str;
  if (["RAW", "LRAW", "RSTR"].includes(datatype)) return T.bytes(length || undefined);
  throw new Error(`DDIC ${table}.${field.NAME}: datatype ${datatype || "<unresolved>"} has no portable IR type`);
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
