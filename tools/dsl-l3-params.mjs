// DSL L3: the set parameters of a manifest (docs/dsl-l3.md, "Piles and set parameters" and "Range
// set parameters"). One per name an enabled rule declares as an L2 parameter, of the same type; a
// range (`range: true`) is a selection table, which the rules take as `field in $name`.
import {LENGTHLESS} from "./dsl-l2-params.mjs";
import {selectRows} from "./dsl-l2-selopt.mjs";
import {misfit} from "./dsl-l2.mjs";

// the job report's own selection fields; a set parameter's field is another name
export const REPORT_PARAMETERS = ["p_rule", "p_date", "p_run", "p_pile", "p_bind", "p_mode"];
// the rows of a selection field a job step carries (docs/gui-reports.md, "Immediate JOB_OPEN ...")
export const JOB_RANGE_ROWS = 20;

export function compileSetParams({doc, enabled, set, line, fail}) {
  // one per
  // name an enabled rule declares as an L2 parameter, of the same type
  const paramDocs = doc.params === undefined ? {} : doc.params;
  if (!paramDocs || typeof paramDocs !== "object" || Array.isArray(paramDocs)) fail(line("params"), "params is a mapping of names to {type, default}");
  const screens = new Set(REPORT_PARAMETERS);
  const params = Object.entries(paramDocs).map(([name, spec]) => {
    const at = line(`params/${name}`);
    if (!/^[a-z][a-z0-9_]{0,26}$/.test(name)) fail(at, `set parameter ${name} is a lower-case ABAP name of at most 27 characters`);
    if (!spec || typeof spec !== "object" || Array.isArray(spec) || typeof spec.type !== "string") fail(at, `set parameter ${name} is {type: <type>, default: <value>}, with a type`);
    for (const key of Object.keys(spec)) if (!["type", "default", "range"].includes(key)) fail(line(`params/${name}/${key}`), `unknown key ${key} of set parameter ${name} (type, default, range)`);
    if (spec.range !== undefined && spec.range !== "true" && spec.range !== "false") fail(line(`params/${name}/range`), `range is true or false, not ${JSON.stringify(spec.range)}`);
    const isRange = spec.range === "true";
    if (isRange && name.length > 24) fail(at, `range set parameter ${name} is at most 24 characters (its table type is tt_p_<name>)`);
    if (LENGTHLESS.has(spec.type.toUpperCase())) fail(line(`params/${name}/type`), `set parameter ${name} is ${spec.type.toUpperCase()}, which has no length and which a class or report refuses; name a data element or <TABLE>-<field>, as the rule does`);
    const uses = enabled.flatMap((r) => (r.compiled.params ?? []).filter((p) => p.name === name).map((p) => ({...p, rule: r.compiled.rule})));
    if (!uses.length) fail(at, `set parameter ${name} is not used: no enabled rule declares $${name}`);
    const shape = uses.find((p) => Boolean(p.is_selopt) !== isRange);
    if (shape) fail(at, `set parameter ${name} is ${isRange ? "a range (range: true)" : "a scalar"}; rule ${shape.rule} declares $${name} as ${isRange ? "a scalar" : "a range"}`);
    const other = uses.find((p) => p.type_name !== spec.type.toLowerCase() || JSON.stringify(p.type) !== JSON.stringify(uses[0].type));
    if (other) fail(line(`params/${name}/type`), `set parameter ${name} is ${spec.type}; rule ${other.rule} declares $${name} as ${other.type_name.toUpperCase()}, and a set parameter has the type of every L2 parameter it binds`);
    if (["STRG", "SSTR", "RSTR"].includes(uses[0].type.built_in)) fail(line(`params/${name}/type`), `set parameter ${name} is a string; a job receives it through a selection field, which has a fixed length`);
    // a range parameter's default is a list of rows (docs/dsl-l2.md, "Range parameters"); a job carries up to 20 rows per selection field
    let rows;
    if (isRange && spec.default !== undefined) {
      const need = (value, path, what, kind = "string") => {
        const ok = kind === "list" ? Array.isArray(value) : kind === "map" ? value && typeof value === "object" && !Array.isArray(value) : typeof value === "string" && value.trim() !== "";
        if (!ok) fail(line(path), `${path.replaceAll("/", ".")} must be ${what}`);
        return value;
      };
      rows = selectRows({value: spec.default, path: `params/${name}/default`, nodeId: `set/${set}/param/${name}/default`, line, failAt: (at2) => (message) => fail(at2, message),
        need, misfit, type: uses[0].type, text: spec.type.toUpperCase()});
      if (rows.rows.length > JOB_RANGE_ROWS) fail(line(`params/${name}/default`), `the default of set parameter ${name} has ${rows.rows.length} rows; a job carries up to ${JOB_RANGE_ROWS} rows per selection field`);
    } else if (!isRange && spec.default !== undefined && (typeof spec.default !== "string" || misfit(spec.default, uses[0].type))) fail(line(`params/${name}/default`), `the default of set parameter ${name} does not fit ${spec.type}`);
    if (!isRange && Array.isArray(spec.default)) fail(line(`params/${name}/default`), `the default of set parameter ${name} is a list; write range: true for a range parameter`);
    // the job report's selection field: P_<first six characters> (S_ for a range, a SELECT-OPTIONS), made unique with digits
    let screen = `${isRange ? "s" : "p"}_${name.slice(0, 6)}`;
    for (let n = 1; screens.has(screen) && n < 1e5; n++) screen = `p_${name.slice(0, 6 - String(n).length)}${n}`;
    if (screen.length > 8 || screens.has(screen)) fail(at, `the selection field of set parameter ${name} cannot be made unique in eight characters`);
    screens.add(screen);
    if (isRange) {
      return {"@id": `set/${set}/param/${name}`, set_line: at, name, screen, type_name: spec.type.toLowerCase(), is_selopt: true, sel: `gv_s_${name}`, elem_type: uses[0].type,
        ...(rows ? {has_default: true, default_rows: rows.nodes.map(({rule_line, ...node}) => ({...node, set_line: rule_line}))} : {})};
    }
    return {"@id": `set/${set}/param/${name}`, set_line: at, name, screen, type_name: spec.type.toLowerCase(),
      ...(spec.default !== undefined ? {default: spec.default, "default@type": uses[0].type} : {})};
  });
  for (const r of enabled) {
    for (const p of r.compiled.params ?? []) {
      if (p.is_selopt) {
        // a range the set states without a default would pass an empty table, which is every value, over the rule's own default
        if (paramDocs[p.name] && paramDocs[p.name].default === undefined && p.has_default) {
          fail(line(`params/${p.name}`), `set parameter ${p.name} is a range with no default, and rule ${r.compiled.rule} has one for $${p.name}; an empty table is every value, so give the set parameter a default (the rule's own is not used)`);
        }
        continue;
      }
      if (!paramDocs[p.name] && p.default === undefined) fail(r.at, `rule ${r.compiled.rule} needs $${p.name}, which has no default in the rule: declare a set parameter ${p.name} (params:)`);
    }
  }
  return {paramDocs, params};
}
