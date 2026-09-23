// The table functions a body may call in FROM, and what each one takes and
// returns -- from the two places a table function is declared.
//
//   a CDS table function     define table function P_X with parameters ...
//                            returns { ... } implemented by method CL=>M
//   an AMDP function         CLASS-METHODS m IMPORTING ... RETURNING VALUE(rt) TYPE tt_x
//                            METHOD m BY DATABASE FUNCTION FOR HDB ...
//
// The corpus calls the second kind almost exclusively (15 of 23 bodies call
// one class's functions), so a registry of DDLS alone would have moved the
// bodies from one refusal to another. Both are keyed by the name a body
// spells: the DDLS name, and `CLASS=>METHOD` as the generated HANA object
// is called. A callee not in the registry is a named refusal in the binder;
// nothing here guesses a schema.
import {parseTableFunction} from "./table-function-ddls.mjs";
import {scalarTypeOf, unresolvedType, UnresolvedScalarType} from "./scalar-types.mjs";
import {typedParameters, relationSchemaOf} from "./signature-schemas.mjs";

const upper = (value) => String(value ?? "").toUpperCase().trim();

/** a column list of ABAP type texts into a schema; a type nobody resolves is carried marked */
function schemaOfColumns(columns, resolve, owner) {
  const schema = {};
  for (const column of columns) {
    try {
      schema[upper(column.name)] = scalarTypeOf(column.abapType, resolve);
    } catch (error) {
      if (!(error instanceof UnresolvedScalarType)) throw error;
      schema[upper(column.name)] = unresolvedType(`${owner}.${column.name}: ${error.message}`);
    }
  }
  return schema;
}

/** one declared parameter as the binder needs it: kind, and for a scalar its
 *  IR type (marked unresolved when no dictionary types it, so a call binds
 *  its argument against a type or is refused by name); OPTIONAL and DEFAULT
 *  both let a caller leave it out */
function typedParameter(p, resolve, owner) {
  const base = {name: upper(p.name), kind: p.kind ?? "scalar", abapType: p.abapType,
    ...(p.optional === true || p.default !== undefined ? {optional: true} : {}),
    ...(p.systemField === undefined ? {} : {systemField: p.systemField}),
    ...(p.schema === undefined ? {} : {schema: p.schema})};
  if (base.kind !== "scalar") return base;
  try {
    return {...base, type: scalarTypeOf(p.abapType, resolve)};
  } catch (error) {
    if (!(error instanceof UnresolvedScalarType)) throw error;
    return {...base, type: unresolvedType(`${owner}.${p.name}: ${error.message}`)};
  }
}

/**
 * Every table function declared as a DDLS the dictionary holds.
 * @param {{list: Function, read: Function}} ddic   a store with DDLS indexed
 * @param {Function} resolve   the scalar typer's data-element hook
 * @returns {{registry: object, unreadable: string[]}}
 */
export function registryFromDdls(ddic, resolve) {
  const registry = {};
  const unreadable = [];
  for (const {name} of ddic.list("DDLS")) {
    let tf;
    try {
      tf = parseTableFunction(ddic.read("DDLS", name).source);
    } catch (error) {
      unreadable.push(`${name}: ${String(error.message).slice(0, 60)}`);
      continue;
    }
    if (tf === undefined) continue;
    const {parameters} = typedParameters({parameters: tf.parameters}, {resolve});
    const entry = {
      name: tf.name,
      source: "ddls",
      parameters: parameters.map((p) => typedParameter(p, resolve, tf.name)),
      returns: schemaOfColumns(tf.returns, resolve, tf.name),
    };
    registry[tf.name] = entry;
    if (tf.implementedBy !== undefined) registry[`${tf.implementedBy.class}=>${tf.implementedBy.method}`] = entry;
  }
  return {registry, unreadable};
}

/**
 * The AMDP functions of one extracted class: methods `BY DATABASE FUNCTION`
 * with a RETURNING parameter of a table type.
 * @param {string} className
 * @param {Array} methods   from amdp-extract's `extract()`
 * @param {{types?: Map, store?: object, resolve?: Function}} where
 */
export function registryFromClass(className, methods, where) {
  const registry = {};
  const skipped = [];
  for (const m of methods) {
    if (m === undefined || String(m.dbKind).toUpperCase() !== "FUNCTION") continue;
    const returning = (m.parameters ?? []).find((p) => p.direction === "RETURNING");
    if (returning === undefined) {
      // a table function implementing a DDLS has its RETURNS there
      continue;
    }
    const returns = relationSchemaOf(returning.abapType, where);
    const key = `${upper(className)}=>${upper(m.name)}`;
    if (returns.schema === undefined) {
      skipped.push(`${key}: ${returns.reason ?? "returns a scalar"}`);
      continue;
    }
    const {parameters} = typedParameters({parameters: (m.parameters ?? []).filter((p) => p.direction === "IN")}, where);
    registry[key] = {
      name: key,
      source: "class",
      parameters: parameters.map((p) => typedParameter(p, where.resolve, key)),
      returns: returns.schema,
    };
  }
  return {registry, skipped};
}
