// DSL L2, slice 7: a rule's typed parameters (docs/dsl-l2.md, "Slice 7").
// `params: {name: {type, default}}`; a type is a data element, a built-in
// with a length of its own (D, T, I, STRING, ...), or a table field written
// <TABLE>-<field>, which the generated ABAP names as it is written. A bare
// C, N, P or X is refused: it has no length, and a system refuses such a type
// in a class or a report ("Lengths must be specified explicitly when using
// types C, P, X, and N in the OO context", A4H 2026-10-02, ZL3_FLEET).
// `range: true` makes the parameter a selection table (docs/dsl-l2.md, "Range
// parameters"): `default` is then a list of SELECT-OPTIONS rows (or of bare
// values, each I EQ), and a condition says `field in $name`.
import {createRequire} from "node:module";
import {DDIC_PROVIDER} from "./dsl-ddic.mjs";
import {selectRows} from "./dsl-l2-selopt.mjs";

const {DDIC} = createRequire(import.meta.url)("@abaplint/core/build/src/ddic.js");

// the built-in types whose length is the declaration's to give
export const LENGTHLESS = new Set(["C", "N", "P", "X"]);
const STRING_TYPES = new Set(["STRG", "SSTR", "RSTR"]);

/** the parameters of a rule, by name; `fieldType(table, field)` resolves <TABLE>-<field> */
export function compileParams({doc, registry, id, line, failAt, need, misfit, typeText, fieldType}) {
  const parameterTypes = new DDIC(registry);
  const params = new Map();
  if (doc.params === undefined) return params;
  need(doc.params, "params", "a mapping of parameter names to types", "map");
  for (const [rawName, spec] of Object.entries(doc.params)) {
    const path = `params/${rawName}`;
    const name = rawName.toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(rawName) || rawName !== name || name.length > 27) failAt(line(path))(`parameter ${rawName} must be a lower-case ABAP name of at most 27 characters`);
    if (name === "date") failAt(line(path))("parameter date clashes with the built-in $date");
    need(spec, path, "a mapping with type and optional default", "map");
    for (const key of Object.keys(spec)) if (!["type", "default", "range"].includes(key)) failAt(line(`${path}/${key}`))(`unknown key params.${rawName}.${key}`);
    if (spec.range !== undefined && spec.range !== "true" && spec.range !== "false") failAt(line(`${path}/range`))(`range is true or false, not ${JSON.stringify(spec.range)}`);
    const isRange = spec.range === "true";
    if (isRange && name.length > 24) failAt(line(path))(`range parameter ${rawName} must be at most 24 characters (its local copy is lt_p_<name>)`);
    if (isRange && name === "range") failAt(line(path))("a range parameter cannot be named range: its table type tt_range is the driving key range's");
    const typeName = need(spec.type, `${path}/type`, "a DDIC element, <TABLE>-<field> or built-in type").toUpperCase();
    if (LENGTHLESS.has(typeName)) {
      failAt(line(`${path}/type`))(`parameter $${name} type ${typeName} has no length, which a class or report refuses; name a data element or the field it stands for (<TABLE>-<field>)`);
    }
    const field = /^([A-Z0-9_/]+)-([A-Z0-9_]+)$/.exec(typeName);
    const type = field ? fieldType(field[1], field[2].toLowerCase())
      : DDIC_PROVIDER.literalType(registry, parameterTypes.lookupBuiltinType(typeName) ?? parameterTypes.lookup(typeName)?.type, typeName);
    if (!type || type.resolved === false) failAt(line(`${path}/type`))(`parameter $${name} type ${typeName} cannot resolve: ${type?.reason ?? `${field?.[1]} has no field ${field?.[2]}`}`);
    if (isRange) {
      if (STRING_TYPES.has(type.built_in) || type.built_in === "FLTP") {
        failAt(line(`${path}/type`))(`parameter $${name} is a range over ${typeText(type)}, which Open SQL does not compare as a selection table; use a character, numeric, date or time type`);
      }
      const given = spec.default === undefined ? {rows: [], nodes: []} : selectRows({value: spec.default, path: `${path}/default`,
        nodeId: `${id}/param/${name}/default`, line, failAt, need, misfit, type, text: typeText(type)});
      const hasDefault = spec.default !== undefined;
      params.set(name, {"@id": `${id}/param/${name}`, rule_line: line(path), name, type_name: typeName.toLowerCase(), type,
        ref: `iv_${name}`, is_selopt: true, selopt_type: `tt_${name}`, row: `ls_p_${name}`,
        // what a condition names: the parameter, or its local copy when a default fills it in
        use: hasDefault ? `lt_p_${name}` : `iv_${name}`, ...(hasDefault ? {has_default: true, default_rows: given.nodes} : {})});
      continue;
    }
    if (spec.default !== undefined) {
      if (Array.isArray(spec.default)) failAt(line(`${path}/default`))(`default for $${name} is a list; write range: true for a range parameter`);
      const value = need(spec.default, `${path}/default`, "a scalar default");
      const why = misfit(value, type);
      if (why) failAt(line(`${path}/default`))(`default for $${name} is ${typeText(type)}; ${why}`);
    }
    params.set(name, {"@id": `${id}/param/${name}`, rule_line: line(path), name, type_name: typeName.toLowerCase(), type,
      ref: `iv_${name}`, ...(spec.default !== undefined ? {default: spec.default, "default@type": type} : {})});
  }
  return params;
}
