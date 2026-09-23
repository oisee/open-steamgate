// The table parameters of a signature, given their schemas.
//
// A method's `IMPORTING it_rows TYPE tt_rows` names a type that lives in one
// of two places: the class (or an interface it reads), as a local TYPES
// declaration the extractor already collected, or the dictionary, as a
// TTYP whose row is a TABL. The procedure compiler reads the first; the
// corpus instruments had neither, so every table parameter was a scan of a
// table the catalogue did not describe (6 + 3 + 3 bodies, 2026-09-22).
//
// This joins the two, and says which one answered or why neither did. A
// parameter it could not type is left as it was -- the binder's name
// heuristic still applies -- rather than given an empty schema, because an
// empty schema is how a column becomes STRING.
import {resolveType} from "../osd-type-graph.mjs";
import {scalarTypeOf, irTypeOfDdic, unresolvedType, UnresolvedScalarType} from "./scalar-types.mjs";

const upper = (value) => String(value ?? "").toUpperCase().trim();

/** a local structure's components typed; throws UnresolvedScalarType for one it cannot */
function localStructure(row, resolve) {
  return Object.fromEntries(row.components.map((one) => {
    try {
      return [upper(one.name), scalarTypeOf(one.abapType, resolve)];
    } catch (error) {
      if (!(error instanceof UnresolvedScalarType)) throw error;
      return [upper(one.name), unresolvedType(`${one.name}: ${error.message}`)];
    }
  }));
}

/** a dictionary structure's fields typed; throws for an unresolved include or field */
function ddicStructure(structure) {
  const schema = {};
  for (const field of structure.FIELDS) {
    if (field.INCLUDE !== undefined) {
      throw new UnresolvedScalarType(`include ${field.INCLUDE} did not resolve (${field.REASON})`);
    }
    try {
      schema[field.NAME] = irTypeOfDdic(field.TYPE ?? field, `${structure.NAME}.${field.NAME}`);
    } catch (error) {
      if (!(error instanceof UnresolvedScalarType)) throw error;
      schema[field.NAME] = unresolvedType(`${structure.NAME}.${field.NAME}: ${field.TYPE?.REASON ?? error.message}`);
    }
  }
  return schema;
}

/**
 * The schema of a table type, or the reason there is none.
 *
 * @param {string} abapType   as the signature spells it
 * @param {{types?: Map, store?: object, resolve?: Function}} where
 *   `types` the class's local types (amdp-extract), `store` a dictionary
 *   `resolveType` accepts, `resolve` the scalar typer's data-element hook
 * @returns {{schema: object, from: "class"|"ddic"} | {reason: string} | {scalar: true}}
 */
export function relationSchemaOf(abapType, {types, store, resolve} = {}) {
  const name = upper(abapType);
  if (name === "") return {reason: "no type"};
  // a literal or a CDS built-in (`I`, `abap.int4`, `C LENGTH 10`) is a
  // scalar and needs no dictionary to say so
  try {
    scalarTypeOf(name, () => undefined);
    return {scalar: true};
  } catch (error) {
    if (!(error instanceof UnresolvedScalarType)) throw error;
  }
  const local = types?.get(name);
  if (local !== undefined) {
    if (local.kind !== "table") return local.kind === "structure" ? {reason: `${name} is a structure, not a table type`} : {scalar: true};
    const row = types.get(upper(local.of));
    if (row?.kind !== "structure") return {reason: `${name}: row type ${local.of} is not a local structure`};
    try {
      return {schema: localStructure(row, resolve), from: "class"};
    } catch (error) {
      if (error instanceof UnresolvedScalarType) return {reason: `${name}: ${error.message}`};
      throw error;
    }
  }
  if (store === undefined) return {reason: `${name} is not a local type and no dictionary was given`};
  const found = resolveType(store, name);
  if (found.KIND === "DTEL" || found.KIND === "BUILTIN") return {scalar: true};
  if (found.KIND === "TABLE") {
    if (found.ROW?.KIND !== "STRUCTURE") return {reason: `${name}: row type ${found.ROWTYPE} is ${found.ROW?.KIND ?? "missing"}`};
    try {
      return {schema: ddicStructure(found.ROW), from: "ddic"};
    } catch (error) {
      if (error instanceof UnresolvedScalarType) return {reason: `${name}: ${error.message}`};
      throw error;
    }
  }
  if (found.KIND === "STRUCTURE") return {reason: `${name} is a structure, not a table type`};
  return {reason: `${name}: ${found.REASON ?? found.KIND}`};
}

/**
 * Every parameter of a signature, told whether it is a table and given its
 * schema when it is. Returns the parameters (copied, with `kind` and
 * `schema`) and the reasons for the ones it could not type.
 */
export function typedParameters(signature, where) {
  const parameters = [];
  const untyped = {};
  for (const p of signature?.parameters ?? []) {
    const got = relationSchemaOf(p.abapType, where);
    if (got.schema !== undefined) parameters.push({...p, kind: "table", schema: got.schema, schemaFrom: got.from});
    else if (got.scalar === true) parameters.push({...p, kind: "scalar"});
    else {
      parameters.push({...p});
      untyped[upper(p.name)] = got.reason;
    }
  }
  return {parameters, untyped};
}
