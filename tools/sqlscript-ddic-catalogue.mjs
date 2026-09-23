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

/** A database view's fields, each typed by the base-table field it projects
 *  (DD27P: VIEWFIELD <- TABNAME.FIELDNAME). A view generated for a CDS view
 *  keeps the client column its base tables have (MANDT, measured on A4H:
 *  the SQL view of a client-dependent CDS view lists MANDT first), which the
 *  CDS entity itself does not show. A base table this dictionary lacks
 *  leaves its columns marked, refused when a body reads them. */
function viewColumns(store, name) {
  const source = store.read("VIEW", name)?.source ?? "";
  const fields = [...source.matchAll(/<DD27P>([\s\S]*?)<\/DD27P>/g)].map(([, block]) => {
    const tag = (t) => (new RegExp(`<${t}>([^<]*)</${t}>`).exec(block)?.[1] ?? "").trim().toUpperCase();
    return {view: tag("VIEWFIELD"), table: tag("TABNAME"), field: tag("FIELDNAME")};
  }).filter((one) => one.view !== "");
  if (fields.length === 0) throw new Error(`DDIC view ${name}: no fields in its definition`);
  const bases = new Map();
  const baseOf = (table) => {
    if (!bases.has(table)) bases.set(table, resolveType(store, table));
    return bases.get(table);
  };
  return Object.fromEntries(fields.map((one) => {
    // a CDS view's literal or cast column projects a pseudo-field of
    // DDDDLCHARTYPES whose name is its type: `CHAR*000256*000000`
    const literal = /^([A-Z0-9_]+)\*(\d+)\*(\d+)$/.exec(one.field);
    if (one.table.startsWith("DDDDL") && literal !== null) {
      return [one.view, irType({NAME: one.view, DATATYPE: literal[1], LENG: literal[2], DECIMALS: literal[3]}, name)];
    }
    const base = baseOf(one.table);
    const field = base.KIND === "STRUCTURE" ? base.FIELDS.find((f) => String(f.NAME).toUpperCase() === one.field) : undefined;
    if (field === undefined) return [one.view, unresolvedType(`${name}.${one.view}: base field ${one.table}.${one.field} is not in this dictionary`)];
    return [one.view, irType(field, `${name}(${one.table})`)];
  }));
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
    if (store.find("TABL", name) === undefined) {
      if (store.find("VIEW", name) !== undefined) catalogue[name] = viewColumns(store, name);
      continue;
    }
    const resolved = resolveType(store, name);
    if (resolved.KIND !== "STRUCTURE") {
      throw new Error(`DDIC ${name}: ${resolved.REASON ?? `expected STRUCTURE, got ${resolved.KIND}`}`);
    }
    catalogue[name] = Object.fromEntries(resolved.FIELDS.map((field) => [field.NAME, irType(field, name)]));
  }
  return catalogue;
}
