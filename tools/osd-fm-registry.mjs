#!/usr/bin/env node
// Function groups -> the callable-module registry and the typed call bridge.
//
// A real system keeps two facts about a function module in TFDIR/ENLFDIR:
// what its interface is, and whether it may be called from outside. Both are
// already in the tree, because abapGit serialises a function group's modules
// into <group>.fugr.xml: one <item> per module with FUNCNAME, REMOTE_CALL
// ('R' = remote-enabled), SHORT_TEXT and the four parameter sections
// (IMPORT/RSIMP, EXPORT/RSEXP, CHANGING/RSCHA, TABLES/RSTBL) plus
// EXCEPTION/RSEXC. Reading them is what lets a cloned repository say which of
// its modules a caller may reach: nothing registered by hand. Same trick as
// tools/segw-registry.mjs with *.iwsv.xml and tools/segw-shlp.mjs with
// *.shlp.xml, for the same reason.
//
// Two classes come out, both under gen/rfc/:
//
//   zcl_osd_fm_registry - every module the tree declares, its group, whether
//   it is remote-enabled, whether this tree actually implements it, whether
//   its signature can be marshalled, and the signature itself. This is what
//   the channel answers metadata from (docs/rfc-channel.md).
//
//   zcl_osd_fm_call - one private method per *exposed* module: declare the
//   parameters with their real types, deserialize the request JSON into them,
//   CALL FUNCTION, serialize the outputs. The transpiler has no
//   PARAMETER-TABLE and no dynamic parameter list (packages/transpiler/src/
//   statements/call_function.ts builds the parameter object at transpile
//   time), so a generic call is generated rather than reflected. A module
//   that is not remote-enabled gets no method here at all: the door is not
//   locked, it is not built.
import {readdirSync, readFileSync, statSync, writeFileSync, mkdirSync} from "node:fs";
import {basename, join} from "node:path";
import {contentFoldersOf} from "./osd-packs.mjs";
import {ObjectStore} from "./osd-store.mjs";
import {typeGraph} from "./osd-type-graph.mjs";

const OUT = "gen/rfc";

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) {
        continue;
      }
      walk(full, out);
    } else if (/\.fugr\.xml$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const text = (xml, name) => (new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml) ?? [])[1]?.trim() ?? "";

function rows(block, tag) {
  if (block === undefined) {
    return [];
  }
  const out = [];
  for (const m of block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
    const r = {};
    for (const f of m[1].matchAll(/<([A-Z_0-9]+)>([^<]*)<\/\1>/g)) {
      r[f[1]] = f[2].trim();
    }
    out.push(r);
  }
  return out;
}

// one function group file -> its modules, in the order the XML lists them
export function parseFunctionGroup(xml, file) {
  const group = basename(file ?? "").replace(/\.fugr\.xml$/i, "").toUpperCase();
  const funcs = /<FUNCTIONS>([\s\S]*?)<\/FUNCTIONS>/.exec(xml);
  if (funcs === null) {
    return [];
  }
  const out = [];
  for (const m of funcs[1].matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    if (!/<FUNCNAME>/.test(item)) {
      continue;
    }
    const section = (tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item) ?? [])[1];
    const param = (r, kind) => ({
      kind,
      name: r.PARAMETER,
      // abaplint reads it the same way: TYP or DBFIELD for a scalar, and for
      // TABLES a DBSTRUCT is a line type while a TYP is a whole table type
      type: kind === "TABLES" ? (r.DBSTRUCT || r.TYP || "") : (r.TYP || r.DBFIELD || ""),
      lineType: kind === "TABLES" ? (r.DBSTRUCT || "") : "",
      optional: r.OPTIONAL === "X" || kind === "EXPORTING",
      byValue: r.REFERENCE !== "X",
      defaultValue: r.DEFAULT ?? "",
    });
    const parameters = [
      ...rows(section("IMPORT"), "RSIMP").map((r) => param(r, "IMPORTING")),
      ...rows(section("CHANGING"), "RSCHA").map((r) => param(r, "CHANGING")),
      ...rows(section("EXPORT"), "RSEXP").map((r) => param(r, "EXPORTING")),
      ...rows(section("TABLES"), "RSTBL").map((r) => param(r, "TABLES")),
    ];
    // <EXCEPTION> is both the section and the field inside RSEXC, so a lazy
    // match for the section stops at the field's own closing tag. The RSEXC
    // rows are unambiguous, so they are read straight off the item.
    const exceptions = rows(item, "RSEXC")
      .map((r) => r.EXCEPTION).filter((n) => n !== undefined && n !== "");
    out.push({
      name: text(item, "FUNCNAME"),
      group,
      shortText: text(item, "SHORT_TEXT"),
      remote: text(item, "REMOTE_CALL") === "R",
      updateTask: /<UPDATE_TASK>/.test(item),
      parameters,
      exceptions,
      file,
    });
  }
  return out;
}

// why a module cannot be carried, or "" when it can
function refuse(fm) {
  if (!fm.implemented) {
    return "declared in the group but not implemented in this tree";
  }
  if (fm.updateTask) {
    return "update-task module, not callable synchronously";
  }
  for (const p of fm.parameters) {
    if (p.type === "") {
      return `parameter ${p.name} is untyped, nothing to marshal it as`;
    }
  }
  return "";
}

// every function module of every group below the folders
export function functionModules(folders) {
  const out = [];
  const seen = new Set();
  for (const folder of folders) {
    for (const file of walk(folder)) {
      const dir = file.slice(0, file.length - basename(file).length);
      const group = basename(file).replace(/\.fugr\.xml$/i, "");
      let beside = [];
      try {
        beside = readdirSync(dir);
      } catch {
        beside = [];
      }
      for (const fm of parseFunctionGroup(readFileSync(file, "utf8"), file)) {
        if (seen.has(fm.name)) {
          continue;
        }
        seen.add(fm.name);
        fm.implemented = beside.includes(`${group}.fugr.${fm.name.toLowerCase()}.abap`);
        fm.reason = refuse(fm);
        fm.exposed = fm.remote && fm.reason === "";
        out.push(fm);
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ ABAP out

const q = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
const bool = (b) => (b ? "abap_true" : "abap_false");
const KINDS = ["IMPORTING", "CHANGING", "EXPORTING", "TABLES"];

// the local declaration a parameter needs inside the generated call
function declare(p) {
  if (p.kind === "TABLES") {
    return p.lineType !== ""
      ? `STANDARD TABLE OF ${p.lineType.toLowerCase()} WITH DEFAULT KEY`
      : p.type.toLowerCase();
  }
  return p.type.toLowerCase();
}

// a DEFAULT the generator dares to reproduce. An optional parameter the
// caller leaves out must arrive as the module's default and not as the
// type's initial value, and since a deserialize cannot tell "absent" from
// "initial" the default is written into the structure before it runs.
// Anything that is not a literal or a known constant is left alone rather
// than guessed at; the registry still reports it.
function defaultLiteral(value) {
  const v = String(value ?? "").trim();
  if (v === "") {
    return undefined;
  }
  if (/^'([^']|'')*'$/.test(v) || /^-?\d+$/.test(v)) {
    return v;
  }
  if (/^(SPACE|ABAP_TRUE|ABAP_FALSE|ABAP_UNDEFINED)$/i.test(v)) {
    return v.toLowerCase();
  }
  return undefined;
}

/** The types a module's parameters name, resolved, as flat rows.
 *
 *  **Flat on purpose.** A resolved type is a tree -- a structure's component
 *  is a type again -- and ABAP carries a tree badly. One row per type, plus
 *  one row per component with `field` set, says the same thing and
 *  serialises to JSON a caller can read in one pass.
 *
 *  Generated rather than resolved at run time for the reason everything in
 *  `gen/rfc/` is: the dictionary is files, and the runtime has no files. */
export function typeRows(list, store) {
  const rows = [];
  for (const fm of list) {
    const graph = typeGraph(store, fm.parameters.map((p) =>
      ({TYPE: p.lineType !== "" ? p.lineType : p.type})));
    for (const [name, t] of Object.entries(graph)) {
      rows.push({fm: fm.name, name, field: "", kind: t.KIND, datatype: t.DATATYPE ?? "",
        leng: t.LENG ?? 0, decimals: t.DECIMALS ?? 0, letter: t.LETTER ?? "",
        text: t.TEXT ?? "", reason: t.REASON ?? ""});
      for (const f of t.FIELDS ?? []) {
        const inner = f.TYPE ?? f;
        rows.push({fm: fm.name, name, field: f.NAME, kind: inner.KIND ?? "INLINE",
          datatype: inner.DATATYPE ?? "", leng: inner.LENG ?? 0, decimals: inner.DECIMALS ?? 0,
          letter: inner.LETTER ?? "", text: f.KEY === true ? "KEY" : "", reason: inner.REASON ?? ""});
      }
    }
  }
  return rows;
}

export function registryClass(list, store = new ObjectStore()) {
  const rows = list.map((fm) => `    ls_function-name        = ${q(fm.name)}.
    ls_function-fgroup      = ${q(fm.group)}.
    ls_function-short_text  = ${q(fm.shortText)}.
    ls_function-remote      = ${bool(fm.remote)}.
    ls_function-implemented = ${bool(fm.implemented)}.
    ls_function-exposed     = ${bool(fm.exposed)}.
    ls_function-reason      = ${q(fm.reason)}.
    APPEND ls_function TO rt_function.`).join("\n\n");

  const rowsByFm = new Map();
  for (const row of typeRows(list, store)) {
    if (!rowsByFm.has(row.fm)) rowsByFm.set(row.fm, []);
    rowsByFm.get(row.fm).push(row);
  }
  const typeCases = [...rowsByFm].map(([name, rows]) => [`      WHEN ${q(name)}.`,
    ...rows.map((r) => `        ls_type-name     = ${q(r.name)}.
        ls_type-field    = ${q(r.field)}.
        ls_type-kind     = ${q(r.kind)}.
        ls_type-datatype = ${q(r.datatype)}.
        ls_type-leng     = ${r.leng}.
        ls_type-decimals = ${r.decimals}.
        ls_type-letter   = ${q(r.letter)}.
        ls_type-text     = ${q(r.text)}.
        ls_type-reason   = ${q(r.reason)}.
        APPEND ls_type TO rt_type.`)].join("\n")).join("\n");

  const cases = list.map((fm) => {
    const lines = [`      WHEN ${q(fm.name)}.`];
    for (const p of fm.parameters) {
      lines.push(`        ls_parameter-kind     = ${q(p.kind)}.
        ls_parameter-name     = ${q(p.name)}.
        ls_parameter-type     = ${q(p.lineType !== "" ? p.lineType : p.type)}.
        ls_parameter-of_table = ${bool(p.kind === "TABLES" && p.lineType !== "")}.
        ls_parameter-optional = ${bool(p.optional)}.
        ls_parameter-by_value = ${bool(p.byValue)}.
        ls_parameter-def_val  = ${q(p.defaultValue)}.
        APPEND ls_parameter TO rt_parameter.`);
    }
    for (const e of fm.exceptions) {
      lines.push(`        CLEAR ls_parameter.
        ls_parameter-kind = 'EXCEPTION'.
        ls_parameter-name = ${q(e)}.
        APPEND ls_parameter TO rt_parameter.`);
    }
    if (fm.parameters.length === 0 && fm.exceptions.length === 0) {
      lines.push("        RETURN. \" no parameters and no exceptions");
    }
    return lines.join("\n");
  }).join("\n");

  return `CLASS zcl_osd_fm_registry DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/osd-fm-registry.mjs from the *.fugr.xml objects - do not edit
*
* What a system keeps in TFDIR/ENLFDIR/FUNCT, derived from the function
* groups this tree carries: which modules exist, which of them are
* remote-enabled, which this tree implements, and what their interfaces are.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_function,
             name        TYPE string,
             fgroup      TYPE string,
             short_text  TYPE string,
             remote      TYPE abap_bool,
             implemented TYPE abap_bool,
             exposed     TYPE abap_bool,
             reason      TYPE string,
           END OF ty_function.
    TYPES tt_function TYPE STANDARD TABLE OF ty_function WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_parameter,
             kind     TYPE string,
             name     TYPE string,
             type     TYPE string,
             of_table TYPE abap_bool,
             optional TYPE abap_bool,
             by_value TYPE abap_bool,
             def_val  TYPE string,
           END OF ty_parameter.
    TYPES tt_parameter TYPE STANDARD TABLE OF ty_parameter WITH DEFAULT KEY.

*   What a parameter's type IS, not only what it is called (backlog D.3).
*   A caller that has to encode a value needs the letter and the length, and
*   a data element usually carries neither: it names a domain, and the domain
*   carries them. Flat because a resolved type is a tree and ABAP carries a
*   tree badly - one row per type, one more per component with FIELD set.
    TYPES: BEGIN OF ty_type,
             name     TYPE string,
             field    TYPE string,
             kind     TYPE string,
             datatype TYPE string,
             leng     TYPE i,
             decimals TYPE i,
             letter   TYPE string,
             text     TYPE string,
             reason   TYPE string,
           END OF ty_type.
    TYPES tt_type TYPE STANDARD TABLE OF ty_type WITH DEFAULT KEY.

*   every module the tree declares, remote-enabled or not
    CLASS-METHODS list
      RETURNING VALUE(rt_function) TYPE tt_function.
*   one of them, or an initial row when there is no such module
    CLASS-METHODS get
      IMPORTING iv_name           TYPE string
      RETURNING VALUE(rs_function) TYPE ty_function.
*   its interface, in declaration order, exceptions last
    CLASS-METHODS parameters
      IMPORTING iv_name            TYPE string
      RETURNING VALUE(rt_parameter) TYPE tt_parameter.

*   the closure of DDIC types those parameters name
    CLASS-METHODS types
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rt_type) TYPE tt_type.
ENDCLASS.

CLASS zcl_osd_fm_registry IMPLEMENTATION.

  METHOD list.
    DATA ls_function TYPE ty_function.

${rows === "" ? "    RETURN." : rows}
  ENDMETHOD.

  METHOD get.
    DATA lt_function TYPE tt_function.

    lt_function = list( ).
    READ TABLE lt_function INTO rs_function WITH KEY name = to_upper( iv_name ).
    IF sy-subrc <> 0.
      CLEAR rs_function.
    ENDIF.
  ENDMETHOD.

  METHOD types.
    DATA ls_type TYPE ty_type.

    CASE to_upper( iv_name ).
${typeCases === "" ? "      WHEN OTHERS." : typeCases}
      WHEN OTHERS.
        RETURN.
    ENDCASE.
  ENDMETHOD.

  METHOD parameters.
    DATA ls_parameter TYPE ty_parameter.

    CASE to_upper( iv_name ).
${cases === "" ? "      WHEN OTHERS." : cases}
      WHEN OTHERS.
        RETURN.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
`;
}

// the body of one exposed module: types, deserialize, CALL FUNCTION, serialize
function callMethod(fm, id) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, fm.parameters.filter((p) => p.kind === k)]));
  const inKinds = KINDS.filter((k) => k !== "EXPORTING" && byKind[k].length > 0);
  const outKinds = KINDS.filter((k) => k !== "IMPORTING" && byKind[k].length > 0);

  const struct = (kind) => `ty_${kind.toLowerCase()}`;
  const types = [];
  for (const kind of KINDS) {
    if (byKind[kind].length === 0) {
      continue;
    }
    types.push(`    TYPES: BEGIN OF ${struct(kind)},\n`
      + byKind[kind].map((p) => `             ${p.name.toLowerCase()} TYPE ${declare(p)},`).join("\n")
      + `\n           END OF ${struct(kind)}.`);
  }
  const envelope = (name, kinds) => `    TYPES: BEGIN OF ${name},\n`
    + kinds.map((k) => `             ${k.toLowerCase()} TYPE ${struct(k)},`).join("\n")
    + `\n           END OF ${name}.`;
  if (inKinds.length > 0) {
    types.push(envelope("ty_in", inKinds));
  }
  if (outKinds.length > 0) {
    types.push(envelope("ty_out", outKinds));
  }

  const body = [];
  if (inKinds.length > 0) {
    body.push("    DATA ls_in  TYPE ty_in.");
  }
  if (outKinds.length > 0) {
    body.push("    DATA ls_out TYPE ty_out.");
  }
  body.push("");
  for (const p of byKind.IMPORTING) {
    const d = defaultLiteral(p.defaultValue);
    if (d !== undefined) {
      body.push(`    ls_in-importing-${p.name.toLowerCase()} = ${d}. " the module's DEFAULT, for a caller that omits it`);
    }
  }
  if (inKinds.length > 0) {
    body.push(`    IF iv_json IS NOT INITIAL.
      /ui2/cl_json=>deserialize( EXPORTING json = iv_json
                                 CHANGING  data = ls_in ).
    ENDIF.`);
  }
  // CHANGING and TABLES travel in and out in the same variable
  for (const kind of ["CHANGING", "TABLES"]) {
    for (const p of byKind[kind]) {
      body.push(`    ls_out-${kind.toLowerCase()}-${p.name.toLowerCase()} = ls_in-${kind.toLowerCase()}-${p.name.toLowerCase()}.`);
    }
  }
  body.push("");

  const call = ["    CALL FUNCTION " + q(fm.name)];
  const clause = (word, kind, side) => {
    if (byKind[kind].length === 0) {
      return;
    }
    call.push(`      ${word}`);
    const width = Math.max(...byKind[kind].map((p) => p.name.length));
    for (const p of byKind[kind]) {
      call.push(`        ${p.name.toLowerCase().padEnd(width)} = ls_${side}-${kind.toLowerCase()}-${p.name.toLowerCase()}`);
    }
  };
  clause("EXPORTING", "IMPORTING", "in");
  clause("IMPORTING", "EXPORTING", "out");
  clause("CHANGING", "CHANGING", "out");
  clause("TABLES", "TABLES", "out");
  if (fm.exceptions.length > 0) {
    call.push("      EXCEPTIONS");
    const width = Math.max(...fm.exceptions.map((e) => e.length), 6);
    fm.exceptions.forEach((e, i) => call.push(`        ${e.toLowerCase().padEnd(width)} = ${i + 1}`));
    call.push(`        ${"OTHERS".padEnd(width)} = 999`);
  }
  call[call.length - 1] += ".";
  body.push(call.join("\n"));

  if (fm.exceptions.length > 0) {
    body.push("");
    body.push("    CASE sy-subrc.\n      WHEN 0.\n"
      + fm.exceptions.map((e, i) => `      WHEN ${i + 1}.\n        rs_result-exception = '${e}'.`).join("\n")
      + "\n      WHEN OTHERS.\n        rs_result-exception = 'OTHERS'.\n    ENDCASE.");
  }
  body.push("");
  body.push("    rs_result-handled = abap_true.");
  const serialize = outKinds.length > 0
    ? "    rs_result-json = /ui2/cl_json=>serialize( data = ls_out )."
    : "    rs_result-json = '{}'.";
  if (fm.exceptions.length > 0) {
    // a module that raised gives nothing back, the way an RFC exception does
    body.push(`    IF rs_result-exception IS INITIAL.\n  ${serialize}\n    ELSE.\n      rs_result-json = '{}'.\n    ENDIF.`);
  } else {
    body.push(serialize);
  }

  return `  METHOD ${id}.
* ${fm.name}${fm.shortText ? " - " + fm.shortText : ""}
${types.join("\n")}
${body.join("\n")}
  ENDMETHOD.`;
}

export function callClass(list) {
  const exposed = list.filter((fm) => fm.exposed);
  const ids = new Map(exposed.map((fm, i) => [fm.name, "fm_" + String(i + 1).padStart(4, "0")]));
  const skipped = list.filter((fm) => !fm.exposed)
    .map((fm) => `* ${fm.name}: ${fm.remote ? fm.reason : "not remote-enabled"}, no method here`);
  const defs = exposed.map((fm) => `*   ${fm.name}
    CLASS-METHODS ${ids.get(fm.name)}
      IMPORTING iv_json          TYPE string
      RETURNING VALUE(rs_result) TYPE ty_result.`);
  const cases = exposed.map((fm) => `      WHEN ${q(fm.name)}.
        rs_result = ${ids.get(fm.name)}( iv_json ).`);
  const bodies = exposed.map((fm) => callMethod(fm, ids.get(fm.name)));

  return `CLASS zcl_osd_fm_call DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/osd-fm-registry.mjs from the *.fugr.xml objects - do not edit
*
* One method per remote-enabled function module of this tree: the parameters
* declared with their real types, the request JSON deserialized into them,
* CALL FUNCTION, the outputs serialized back. Generated rather than
* reflected because the transpiler resolves a CALL FUNCTION's parameter list
* at transpile time and has no PARAMETER-TABLE.
*
* A module that is not remote-enabled has no method here. That is the gate,
* and zcl_osd_rfc_channel refuses it earlier with a reason worth reading.
${skipped.length > 0 ? "*\n" + skipped.join("\n") : ""}
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_result,
*            abap_false when no module of that name is exposed here
             handled   TYPE abap_bool,
*            the outputs, or {} when the module raised
             json      TYPE string,
*            the classic exception the module raised, if it did
             exception TYPE string,
           END OF ty_result.

    CLASS-METHODS call
      IMPORTING iv_name          TYPE string
                iv_json          TYPE string
      RETURNING VALUE(rs_result) TYPE ty_result.

  PRIVATE SECTION.
${defs.join("\n") || "*   nothing exposed"}
ENDCLASS.

CLASS zcl_osd_fm_call IMPLEMENTATION.

  METHOD call.
    CASE to_upper( iv_name ).
${cases.join("\n")}
      WHEN OTHERS.
        CLEAR rs_result.
    ENDCASE.
  ENDMETHOD.

${bodies.join("\n\n")}

ENDCLASS.
`;
}

if (process.argv[1] && /osd-fm-registry\.mjs$/.test(process.argv[1])) {
  const folders = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const list = process.argv.includes("--list");
  const modules = functionModules(folders.length > 0 ? folders : [...contentFoldersOf(process.env.OSD_ROOT ?? process.cwd()), "gen"]);
  for (const fm of modules) {
    const how = fm.exposed ? "exposed" : fm.remote ? "refused: " + fm.reason : "local only";
    console.log(`osd-fm-registry: ${fm.name} (${fm.group}) -> ${how}, ${fm.parameters.length} parameters, ${fm.exceptions.length} exceptions`);
  }
  if (!list) {
    mkdirSync(OUT, {recursive: true});
    writeFileSync(join(OUT, "zcl_osd_fm_registry.clas.abap"), registryClass(modules));
    writeFileSync(join(OUT, "zcl_osd_fm_call.clas.abap"), callClass(modules));
  }
}
