// A CDS table function and the AMDP method that implements it must describe
// the same row, and the CDS `returns` list is the authority -- it is what a
// client of the view sees.
//
// A silent mismatch is the worst outcome available here: the body fills
// columns by position, so a swapped pair of same-width fields produces rows
// that look plausible and are wrong. This refuses instead.
//
//   node tools/amdp-tablefunc.mjs [--check]
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {basename,join} from "node:path";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);

/** abap.<type> as a CDS `returns` list writes it -> the HANA column type */
export function cdsType(text) {
  const t = String(text).replace(/\s+/g, "").toLowerCase();
  const m = /^abap\.(\w+)(?:\((\d+)(?:,(\d+))?\))?$/.exec(t);
  if (m === null) return undefined;
  const [, name, a, b] = m;
  switch (name) {
    case "int4": case "int": return "INTEGER";
    case "int8": return "BIGINT";
    case "int2": return "SMALLINT";
    case "int1": return "SMALLINT";
    case "clnt": return "NVARCHAR(3)";
    case "char": case "numc": case "cuky": case "unit": case "lang": return a === undefined ? undefined : `NVARCHAR(${a})`;
    case "dats": return "DATS";
    case "tims": return "TIMS";
    case "string": return "NCLOB";
    case "rawstring": return "BLOB";
    case "fltp": return "DOUBLE";
    case "dec": case "curr": case "quan": return a === undefined ? undefined : `DECIMAL(${a}, ${b ?? 0})`;
    default: return undefined;
  }
}

/** every `define table function` under the folders */
export function tableFunctions(folders) {
  const abaplint = require("@abaplint/core");
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.ddls\.asddls$/i.test(e.name)) continue;
      const source = readFileSync(p, "utf8");
      if (!/define\s+table\s+function/i.test(source)) continue;
      found.push({file: p, ...parseTableFunction(source, abaplint)});
    }
  };
  for (const f of folders) walk(f);
  return found;
}

/** the name, the parameters, the returns list and the implementing method.
 *  abaplint parses the shape (CDSDefineTableFunction, CDSWithParameters and
 *  the CDSName/CDSType pairs); `implemented by method` has no node of its own
 *  and is read from the source, which is safe because the clause is fixed. */
export function parseTableFunction(source, abaplint) {
  const text = source.replace(/\/\/[^\n]*/g, " ").replace(/\s+/g, " ");
  const name = /define\s+table\s+function\s+([\w\/]+)/i.exec(text)?.[1]?.toUpperCase();
  const implemented = /implemented\s+by\s+method\s+([\w\/]+)\s*=>\s*(\w+)/i.exec(text);
  const paramsText = /with\s+parameters(.*?)returns/is.exec(text)?.[1] ?? "";
  const returnsText = /returns\s*\{(.*?)\}/is.exec(text)?.[1] ?? "";
  const fields = (block, separator) => [...block.matchAll(/(?:^|[,;{])\s*(?:@[^\s]+(?:\s*:\s*[^\s,;]+)?\s*)*(\w+)\s*:\s*(abap\.[\w()., ]+?)\s*(?=[,;}]|$)/gi)]
    .map((m) => ({name: m[1].toLowerCase(), cdsType: m[2].replace(/\s+/g, ""), hanaType: cdsType(m[2])}));
  return {
    name,
    parameters: fields(paramsText),
    returns: fields(returnsText),
    class: implemented?.[1]?.toUpperCase(),
    method: implemented?.[2]?.toLowerCase(),
  };
}

/** the CDS declaration against what the method actually returns */
export function check(tf, procedure) {
  const problems = [];
  if (procedure === undefined) {
    problems.push(`${tf.name}: no AMDP method ${tf.class}=>${tf.method} was generated; is the class under src/?`);
    return problems;
  }
  if (procedure.kind !== "function") {
    problems.push(`${tf.name}: ${tf.class}=>${tf.method} is a database PROCEDURE; a table function must be BY DATABASE FUNCTION`);
  }
  const returning = procedure.parameters.find((p) => p.direction === "RETURNING");
  if (returning === undefined) {
    problems.push(`${tf.name}: ${tf.class}=>${tf.method} returns nothing; a table function needs RETURNING VALUE(...) TYPE <table type>`);
    return problems;
  }
  const declared = /^TABLE\s*\((.*)\)$/is.exec(String(returning.hanaType).trim())?.[1];
  const actual = declared === undefined ? [] : declared.split(/,\s*(?![^(]*\))/).map((c) => {
    const [n, ...rest] = c.trim().split(/\s+/);
    return {name: n.toLowerCase(), hanaType: rest.join(" ")};
  });
  if (actual.length !== tf.returns.length) {
    problems.push(`${tf.name}: the CDS returns ${tf.returns.length} field(s) and ${tf.class}=>${tf.method} returns ${actual.length}`);
  }
  for (const [i, want] of tf.returns.entries()) {
    const got = actual[i];
    if (got === undefined) continue;
    if (got.name !== want.name) {
      problems.push(`${tf.name}: field ${i + 1} is '${want.name}' in the CDS and '${got.name}' in the method`);
    } else if (want.hanaType === undefined) {
      problems.push(`${tf.name}.${want.name}: ${want.cdsType} has no HANA type here`);
    } else if (got.hanaType.toUpperCase().replace(/\s+/g, "") !== want.hanaType.toUpperCase().replace(/\s+/g, "")) {
      problems.push(`${tf.name}.${want.name}: the CDS says ${want.cdsType} (${want.hanaType}) and the method says ${got.hanaType}`);
    }
  }
  return problems;
}

if (basename(process.argv[1] ?? "") === "amdp-tablefunc.mjs") {
  const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
  const folders = config.input_folder.filter((f) => f === "src" || f.startsWith("packs/"));
  const functions = tableFunctions(folders);
  const file = "gen/amdp/procedures.json";
  const procedures = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).procedures : [];
  let problems = 0;
  for (const tf of functions) {
    const p = procedures.find((x) => x.class === tf.class && x.method.toLowerCase() === tf.method);
    const found = check(tf, p);
    problems += found.length;
    console.log(`${tf.name}  <- ${tf.class}=>${tf.method}  ${tf.returns.length} field(s)  ${found.length === 0 ? "ok" : "MISMATCH"}`);
    for (const f of found) console.log(`  ${f}`);
  }
  if (functions.length === 0) console.log("amdp-tablefunc: no CDS table functions");
  if (problems > 0) process.exit(1);
}
