#!/usr/bin/env node
// Transaction codes -> the transaction registry and the generated starter.
//
// A transaction code is a route like any other route in this tree, and
// abapGit already serialises one, so nothing here is invented. A
// `*.tran.xml` carries the four tables SE93 keeps:
//
//     <TSTC>  TCODE, PGMNA, DYPNO     what it starts
//     <TSTCC> S_WEBGUI, ...           where it may be started from
//     <TSTCT> SPRSL, TTEXT            what it is called
//     <TSTCP> PARAM                   the parameters, and for an OO
//                                     transaction \PROGRAM=..\CLASS=..\METHOD=..
//
// Reading them is the same trick tools/osd-icf.mjs plays with *.sicf.xml and
// tools/segw-registry.mjs with *.iwsv.xml, for the same reason: the object
// in the tree is the source of truth and the registry is derived, so a pack
// that brings a transaction brings it with no change here.
//
// What "runnable" means is the one decision this file makes, and
// docs/webgui.md carries the reasoning:
//
//   a class      TSTCP-PARAM names \CLASS=..\METHOD=.., SAP's own
//                "transaction with class method" form (zcl_abapgit_object_tran,
//                split_parameters), the class is in the tree and it
//                implements ZIF_OSD_TRANSACTION           -> runs
//   a report     TSTC-PGMNA names a program and there is no TSTCP
//                -> refused: the transpiler's SUBMIT throws
//                (packages/transpiler/src/statements/submit.ts)
//   a dynpro     TSTC-DYPNO is a screen number -> refused: there is no
//                dynpro processor here
//
// Two classes come out, both under gen/tran/:
//
//   zcl_osd_tran_registry - every transaction the tree declares, what it
//   names, whether this system can enter it and why not. The screen reads
//   this for its Tools folder and for the command field.
//
//   its create( ) - one WHEN per runnable transaction doing a static
//   CREATE OBJECT. Generated rather than dynamic for the reason
//   zcl_osd_fm_call is generated: a generated name is one abaplint checks,
//   and a transaction whose class is not in the tree gets no WHEN at all.
import {readdirSync, readFileSync, statSync, writeFileSync, mkdirSync} from "node:fs";
import {basename, join} from "node:path";
import {contentFoldersOf} from "./osd-packs.mjs";

const OUT = "gen/tran";

// the interface a class must implement to be entered as a transaction
const CONTRACT = "ZIF_OSD_TRANSACTION";

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
    } else if (/\.(tran|clas)\.(xml|abap)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const text = (xml, name) => (new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml) ?? [])[1]?.trim() ?? "";

// one section of the XML, so TCODE inside TSTC is not read as TCODE inside TSTCT
const block = (xml, name) => (new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(xml) ?? [])[1];

// \PROGRAM=X\CLASS=Y\METHOD=Z, as SE93 stores an OO transaction and as
// zcl_abapgit_object_tran=>split_parameters reads it back. A component runs
// to the next backslash or to the end.
export function ooParameters(param) {
  const out = {};
  if (typeof param !== "string" || param.startsWith("\\") === false) {
    return out;
  }
  for (const m of param.matchAll(/\\([A-Z_]+)=([^\\]*)/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

// one *.tran.xml -> what SE93 would show for it
export function transactionOf(xml, file) {
  const tstc = block(xml, "TSTC");
  if (tstc === undefined) {
    return undefined;
  }
  const tcode = text(tstc, "TCODE").toUpperCase();
  if (tcode === "") {
    return undefined;
  }
  const oo = ooParameters(text(block(xml, "TSTCP") ?? "", "PARAM"));
  const dynpro = text(tstc, "DYPNO").replace(/^0+/, "");
  return {
    tcode,
    text: text(block(xml, "TSTCT") ?? "", "TTEXT"),
    program: (oo.PROGRAM ?? text(tstc, "PGMNA")).toUpperCase(),
    dynpro,
    className: (oo.CLASS ?? "").toUpperCase(),
    method: (oo.METHOD ?? "").toUpperCase(),
    webgui: text(block(xml, "TSTCC") ?? "", "S_WEBGUI"),
    file,
  };
}

// why this system cannot enter a transaction, or "" when it can
function refuse(tran, classes) {
  if (tran.className === "") {
    if (tran.dynpro !== "" && tran.dynpro !== "1000") {
      return `screen ${tran.dynpro} of ${tran.program}: there is no dynpro processor here`;
    }
    if (tran.program !== "") {
      return `report ${tran.program}: SUBMIT is not implemented by the transpiler`;
    }
    return "names neither a class nor a program";
  }
  const source = classes.get(tran.className);
  if (source === undefined) {
    return `class ${tran.className} is not in this tree`;
  }
  if (source.implementsContract === false) {
    return `class ${tran.className} does not implement ${CONTRACT}`;
  }
  return "";
}

// every transaction below the folders, later folder winning a code the way
// the layers do everywhere else (backlog E.1)
export function transactions(folders) {
  const found = new Map();
  const classes = new Map();
  for (const folder of folders) {
    for (const file of walk(folder)) {
      if (/\.clas\.abap$/i.test(file)) {
        const name = basename(file).replace(/\.clas\.abap$/i, "").toUpperCase();
        const source = readFileSync(file, "utf8");
        classes.set(name, {
          file,
          implementsContract: new RegExp(`INTERFACES\\s+${CONTRACT}`, "i").test(source),
        });
        continue;
      }
      const one = transactionOf(readFileSync(file, "utf8"), file);
      if (one !== undefined) {
        found.set(one.tcode, one);
      }
    }
  }
  return [...found.values()].map((tran) => {
    const reason = refuse(tran, classes);
    return {...tran, reason, runnable: reason === "", kind: tran.className !== "" ? "CLASS" : tran.dynpro !== "" && tran.dynpro !== "1000" ? "DYNPRO" : "REPORT"};
  }).sort((a, b) => a.tcode.localeCompare(b.tcode));
}

// ------------------------------------------------------------------ ABAP out

const q = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
const bool = (b) => (b ? "abap_true" : "abap_false");

export function registryClass(list) {
  const rows = list.map((t) => `    CLEAR ls_tran.
    ls_tran-tcode    = ${q(t.tcode)}.
    ls_tran-text     = ${q(t.text)}.
    ls_tran-kind     = ${q(t.kind)}.
    ls_tran-program  = ${q(t.program)}.
    ls_tran-dynpro   = ${q(t.dynpro)}.
    ls_tran-classname = ${q(t.className)}.
    ls_tran-method   = ${q(t.method)}.
    ls_tran-runnable = ${bool(t.runnable)}.
    ls_tran-reason   = ${q(t.reason)}.
    APPEND ls_tran TO rt_tran.`).join("\n\n");

  const runnable = list.filter((t) => t.runnable);
  const cases = runnable.map((t) => `      WHEN ${q(t.tcode)}.
        CREATE OBJECT ri_tran TYPE ${t.className.toLowerCase()}.`).join("\n");
  const refused = list.filter((t) => t.runnable === false)
    .map((t) => `* ${t.tcode}: ${t.reason}, no WHEN here`);

  return `CLASS zcl_osd_tran_registry DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/osd-tran-registry.mjs from the *.tran.xml objects - do not edit
*
* Every transaction code this tree declares, read out of the TSTC / TSTCC /
* TSTCT / TSTCP tables abapGit serialises, and whether this system can enter
* it. A transaction runs here when TSTCP-PARAM names a class the way SE93
* stores a transaction with class method, the class is in the tree and it
* implements ${CONTRACT}; everything else is listed with the reason it
* cannot, which is a better answer than "not yet". docs/webgui.md has the
* rule and why it is that rule.
*
* CREATE is a CASE rather than a dynamic CREATE OBJECT for the reason
* zcl_osd_fm_call is a CASE: a generated name is one abaplint checks, and a
* transaction whose class is not here gets no branch at all.
${refused.length > 0 ? "*\n" + refused.join("\n") : ""}
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_tran,
*            the code, as it is typed into the command field
             tcode     TYPE string,
*            what SE93 calls it (TSTCT-TTEXT)
             text      TYPE string,
*            CLASS, REPORT or DYNPRO: what the tran object names
             kind      TYPE string,
             program   TYPE string,
             dynpro    TYPE string,
             classname TYPE string,
             method    TYPE string,
*            abap_true when this system can enter it
             runnable  TYPE abap_bool,
*            and when it cannot, why not, in words for a status bar
             reason    TYPE string,
           END OF ty_tran.
    TYPES tt_tran TYPE STANDARD TABLE OF ty_tran WITH DEFAULT KEY.

    CLASS-METHODS list
      RETURNING VALUE(rt_tran) TYPE tt_tran.

*   what SE93 knows about one code; TCODE initial when there is no such thing
    CLASS-METHODS describe
      IMPORTING iv_tcode       TYPE string
      RETURNING VALUE(rs_tran) TYPE ty_tran.

*   the transaction itself, or an unbound reference when it is not runnable
    CLASS-METHODS create
      IMPORTING iv_tcode       TYPE string
      RETURNING VALUE(ri_tran) TYPE REF TO zif_osd_transaction.
ENDCLASS.

CLASS zcl_osd_tran_registry IMPLEMENTATION.

  METHOD list.
    DATA ls_tran TYPE ty_tran.

${rows || "*   no *.tran.xml in any layer"}
  ENDMETHOD.

  METHOD describe.
    DATA lt_tran TYPE tt_tran.
    DATA ls_tran TYPE ty_tran.
    DATA lv_code TYPE string.

    lv_code = to_upper( iv_tcode ).
    lt_tran = list( ).
    LOOP AT lt_tran INTO ls_tran.
      IF ls_tran-tcode = lv_code.
        rs_tran = ls_tran.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD create.
    CASE to_upper( iv_tcode ).
${cases || "*     nothing runnable in this tree"}
      WHEN OTHERS.
        CLEAR ri_tran.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
`;
}

if (process.argv[1] && /osd-tran-registry\.mjs$/.test(process.argv[1])) {
  const folders = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const list = process.argv.includes("--list");
  const found = transactions(folders.length > 0 ? folders : [...contentFoldersOf(process.env.OSD_ROOT ?? process.cwd()), "gen"]);
  for (const t of found) {
    const how = t.runnable ? `runs ${t.className}` : `refused: ${t.reason}`;
    console.log(`osd-tran-registry: ${t.tcode} (${t.kind}) -> ${how}${t.text ? " - " + t.text : ""}`);
  }
  if (found.length === 0) {
    console.log("osd-tran-registry: no *.tran.xml found");
  }
  if (!list) {
    mkdirSync(OUT, {recursive: true});
    writeFileSync(join(OUT, "zcl_osd_tran_registry.clas.abap"), registryClass(found));
  }
}
