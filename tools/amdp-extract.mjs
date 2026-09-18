// Cut an AMDP body out of an ABAP class, with the signature it needs.
//
// Backlog B.19. The body of an AMDP method is already valid SQLScript -- that
// is the whole point of the design: HANA runs it natively and we never write
// an interpreter for a second language. So what is needed is not a
// transpiler, it is a pair of scissors and a type map.
//
//   node tools/amdp-extract.mjs <class.clas.abap> [--json] [--procedure]
//
// The body is taken **by source position**, between the end of the
// MethodImplementation statement and the start of its ENDMETHOD, because
// abaplint parses an AMDP body as a run of NativeSQL statements whose
// concatenated tokens do not reproduce the source. The signature comes from
// the class definition, which abaplint does parse properly.
import {readFileSync} from "node:fs";
import * as abaplint from "@abaplint/core";

/** ABAP type -> the HANA type a generated procedure declares */
const HANA_TYPE = {
  I: "INTEGER", INT4: "INTEGER", INT8: "BIGINT", INT2: "SMALLINT", INT1: "SMALLINT",
  F: "DOUBLE", STRING: "NCLOB", XSTRING: "BLOB",
  D: "DATS", T: "TIMS", DATS: "DATS", TIMS: "TIMS",
};

/** the HANA type of one ABAP-typed component */
export function hanaType(t) {
  const name = String(t ?? "").trim().toUpperCase();
  if (HANA_TYPE[name] !== undefined) return HANA_TYPE[name];
  // ABAP writes a length two ways: "c LENGTH 20" in a modern declaration and
  // "c(20)" in an old one, and a packed type adds DECIMALS.
  const len = /\bLENGTH\s+(\d+)/.exec(name)?.[1] ?? /^\w+\s*\(\s*(\d+)\s*\)/.exec(name)?.[1] ?? /^(?:CHAR|NUMC)(\d+)$/.exec(name)?.[1];
  const dec = /\bDECIMALS\s+(\d+)/.exec(name)?.[1];
  const base = /^([A-Z_/]+)/.exec(name)?.[1] ?? "";
  if (base === "P" || base === "DEC") return `DECIMAL(${len ?? 16}, ${dec ?? 2})`;
  if ((base === "C" || base === "CHAR" || base === "N" || base === "NUMC") && len !== undefined) return `NVARCHAR(${len})`;
  if (base === "X" || base === "XSEQUENCE") return len === undefined ? "BLOB" : `VARBINARY(${len})`;
  if (HANA_TYPE[base] !== undefined) return HANA_TYPE[base];
  return undefined; // a type we do not know: the caller decides what to do
}

// The TYPES a class declares for itself. abaplint's parsed class definition
// carries attributes, constants and methods but not local type definitions,
// and a table parameter of an AMDP method is almost always one of these --
// so this reads them out of the source. It is a small reader on purpose: a
// structure, a table of a structure, and a table of a scalar are the three
// shapes an AMDP signature can use, and anything else comes back undefined
// rather than guessed at.
export function localTypes(source) {
  const types = new Map();
  const text = source.replace(/\r/g, "");
  // BEGIN OF <name> ... END OF <name>
  for (const m of text.matchAll(/BEGIN\s+OF\s+(\w+)\s*,?([\s\S]*?)END\s+OF\s+\1/gi)) {
    const components = [];
    for (const c of m[2].matchAll(/(\w+)\s+TYPE\s+([\w\/]+(?:\s+LENGTH\s+\d+)?(?:\s+DECIMALS\s+\d+)?)/gi)) {
      components.push({name: c[1], abapType: c[2].trim()});
    }
    types.set(m[1].toUpperCase(), {kind: "structure", components});
  }
  // <name> TYPE [STANDARD|SORTED|HASHED] TABLE OF <row>
  for (const m of text.matchAll(/(\w+)\s+TYPE\s+(?:STANDARD\s+|SORTED\s+|HASHED\s+)?TABLE\s+OF\s+([\w\/]+)/gi)) {
    types.set(m[1].toUpperCase(), {kind: "table", of: m[2].toUpperCase()});
  }
  return types;
}

/** the HANA type of a parameter, resolving a class-local type when it is one */
export function parameterType(abapType, types) {
  const direct = hanaType(abapType);
  if (direct !== undefined) return direct;
  const t = types?.get(String(abapType).toUpperCase());
  if (t === undefined) return undefined;
  if (t.kind === "structure") {
    const cols = t.components.map((c) => `${c.name.toLowerCase()} ${hanaType(c.abapType) ?? "NCLOB"}`);
    return cols.length === 0 ? undefined : `TABLE(${cols.join(", ")})`;
  }
  if (t.kind === "table") {
    const row = types.get(t.of);
    if (row?.kind === "structure") {
      const cols = row.components.map((c) => `${c.name.toLowerCase()} ${hanaType(c.abapType) ?? "NCLOB"}`);
      return cols.length === 0 ? undefined : `TABLE(${cols.join(", ")})`;
    }
    const scalar = hanaType(t.of);
    return scalar === undefined ? undefined : `TABLE(value ${scalar})`;
  }
  return undefined;
}

export function extract(source, filename = "x.clas.abap", extraTypeSources = []) {
  const reg = new abaplint.Registry().addFile(new abaplint.MemoryFile(filename, source)).parse();
  const obj = reg.getFirstObject();
  if (obj === undefined) throw new Error("nothing parsed out of " + filename);
  const file = obj.getABAPFiles()[0];
  const lines = source.split("\n");

  // The method definitions, so a body can be given its parameters. abaplint
  // gives the name and the direction of each parameter but not its type --
  // the type needs a resolved registry with the DDIC in it, which we do not
  // have for a class read off a system. The token's own row is enough: the
  // type text is on that line of the definition, and reading it there is
  // exact rather than a guess.
  const defs = new Map();
  const direction = {importing: "IN", exporting: "OUT", changing: "INOUT", returning: "OUT"};
  for (const m of obj.getClassDefinition?.()?.methods ?? []) {
    const params = [];
    for (const p of m.parameters ?? []) {
      const row = p.identifier?.token?.start?.row;
      const line = row === undefined ? "" : (lines[row - 1] ?? "");
      const after = line.slice(line.toUpperCase().indexOf(String(p.name).toUpperCase()));
      const abapType = /\bTYPE\s+(?:REF\s+TO\s+)?([\w\/]+(?:\s+LENGTH\s+\d+)?(?:\s+DECIMALS\s+\d+)?)/i.exec(after)?.[1] ?? "";
      params.push({name: p.name, direction: direction[p.direction] ?? "IN", abapType: abapType.trim()});
    }
    defs.set(String(m.name).toUpperCase(), params);
  }

  const out = [];
  let open;
  for (const st of file.getStatements()) {
    const kind = st.get().constructor.name;
    if (kind === "MethodImplementation") {
      const text = st.concatTokens();
      if (!/BY\s+DATABASE\s+(PROCEDURE|FUNCTION)/i.test(text)) { open = undefined; continue; }
      open = {
        name: /METHOD\s+(\S+)/i.exec(text)?.[1] ?? "",
        forDb: /FOR\s+(\w+)/i.exec(text)?.[1] ?? "",
        language: /LANGUAGE\s+(\w+)/i.exec(text)?.[1] ?? "",
        readOnly: /OPTIONS\s+READ-ONLY/i.test(text),
        usings: (/\bUSING\b([^.]*)/i.exec(text)?.[1] ?? "").split(/[\s,]+/).filter(Boolean),
        bodyFrom: st.getEnd(),
      };
    } else if (kind === "EndMethod" && open !== undefined) {
      const from = open.bodyFrom, to = st.getStart();
      const body = lines.slice(from.getRow() - 1, to.getRow())
        .map((l, i, a) => (i === 0 ? l.slice(from.getCol() - 1) : i === a.length - 1 ? l.slice(0, to.getCol() - 1) : l))
        .join("\n").trim();
      out.push({...open, bodyFrom: undefined, body, parameters: defs.get(open.name.toUpperCase()) ?? []});
      open = undefined;
    }
  }
  // Types an AMDP signature uses are often not in the class: the Z80 CPU
  // keeps them in ZIF_Z80_00_AMDP_TYPES. Extra sources contribute theirs, and
  // the class's own win a name they share.
  const types = new Map();
  for (const extra of extraTypeSources) for (const [k, v] of localTypes(extra)) types.set(k, v);
  for (const [k, v] of localTypes(source)) types.set(k, v);
  return {className: obj.getName(), methods: out, types};
}

/** the CREATE PROCEDURE a cut body needs in order to run in HANA */
export function procedure(cls, m, schema, types) {
  const args = m.parameters.map((p) => {
    const t = parameterType(p.abapType, types);
    return `${p.direction} ${p.name.toLowerCase()} ${t ?? `/* unmapped: ${p.abapType} */`}`;
  });
  const name = `"${schema}"."${cls}=>${m.name.toUpperCase()}"`;
  return [
    `CREATE PROCEDURE ${name} (${args.join(", ")})`,
    `  LANGUAGE ${m.language || "SQLSCRIPT"}`,
    `  SQL SECURITY INVOKER`,
    m.readOnly ? "  READS SQL DATA" : "",
    `AS BEGIN`,
    m.body,
    `END;`,
  ].filter((x) => x !== "").join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--types");
  if (path === undefined) { console.error("usage: node tools/amdp-extract.mjs <class.clas.abap> [--types <file>]... [--json] [--procedure]"); process.exit(2); }
  const extras = args.map((a, i) => (a === "--types" ? args[i + 1] : undefined)).filter(Boolean).map((f) => readFileSync(f, "utf8"));
  const result = extract(readFileSync(path, "utf8"), path.split("/").pop(), extras);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(result, undefined, 2)); }
  else if (process.argv.includes("--procedure")) {
    for (const m of result.methods) console.log(procedure(result.className, m, process.env.HXE_SCHEMA ?? "OSD", result.types) + "\n");
  } else {
    console.log(`${result.className}: ${result.methods.length} AMDP method(s)`);
    for (const m of result.methods) {
      const unmapped = m.parameters.filter((p) => parameterType(p.abapType, result.types) === undefined);
      console.log(`  ${m.name}  FOR ${m.forDb} ${m.language}${m.readOnly ? " READ-ONLY" : ""}` +
        `  ${m.parameters.length} parameter(s)${unmapped.length ? `, ${unmapped.length} unmapped` : ""}` +
        `  body ${m.body.split("\n").length} lines`);
      for (const p of m.parameters) console.log(`      ${p.direction.padEnd(5)} ${p.name.toLowerCase().padEnd(14)} ${p.abapType} -> ${parameterType(p.abapType, result.types) ?? "?"}`);
    }
  }
}
