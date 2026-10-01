#!/usr/bin/env node
// The sXML reader contract's fixtures, one source for three ABAP files.
//
// test/fixtures/sxml-contract/cases.json is the source: every fixture's
// input bytes and its expected event lines (the normalisation is stated
// once, in the header of src/sxml/zcl_osd_sxml_contract.clas.abap). From it
// this tool writes
//
//   src/sxml/zcl_osd_sxml_fixtures.clas.abap      the fixtures as ABAP, so the
//       transpiler, gogen and a system all load them the same way;
//   test/fixtures/sxml-contract/recorder.abap      the A4H recorder: a
//       self-contained execute_abap snippet (statements only, 7-bit ASCII,
//       lines under 255, fixtures hex-encoded) that runs the system's
//       CL_SXML_STRING_READER over every fixture and reports the events
//       through cl_abap_unit_assert=>fail( msg = ... ), framed SXML<< >>SXML;
//   test/unit/zcl_osd_sxml_recorder_test.clas.*    the same statements as an
//       ABAP Unit test here, compared with ZCL_OSD_SXML_CONTRACT=>RECORD, so
//       the recorder's inline normalisation is proven equal to the class's
//       before anybody spends a system visit on it.
//
//   node tools/osd-sxml-contract.mjs                write the three
//   node tools/osd-sxml-contract.mjs --check        exit 1 if any is stale
//   node tools/osd-sxml-contract.mjs recorder [--only a,b]   print a recorder
//       for a subset (an alert title is not unlimited)
//   node tools/osd-sxml-contract.mjs provisional    run the transpiled
//       contract (output/, after npm run transpile) with the reference
//       factory, fixture by fixture: the result becomes the expectation of
//       every fixture whose status is provisional-fork, and every fixture's
//       "fork" mark is set from it (MISS: the fork gives another sequence,
//       DUMPS: it ends the run with a runtime error no CATCH sees); each
//       mark that changes is printed
//   node tools/osd-sxml-contract.mjs import <file> --date YYYY-MM-DD
//       read a recorder's output (the alert text, SXML<< ... >>SXML) and
//       make it the expectation of each fixture in it, status
//       measured-a4h-<date>; prints every fixture whose expectation changed,
//       which is the list of ANORMALIES candidates
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {join} from "node:path";
import {runsAs} from "./osd-main.mjs";

export const CASES = "test/fixtures/sxml-contract/cases.json";
export const FIXTURES_CLASS = "src/sxml/zcl_osd_sxml_fixtures.clas.abap";
export const RECORDER = "test/fixtures/sxml-contract/recorder.abap";
export const TWIN = "test/unit/zcl_osd_sxml_recorder_test.clas";
export const PROVISIONAL = "provisional-fork";
export const SPEC = "provisional-spec";
export const FORK = ["", "MISS", "DUMPS"];
export const OPEN = "SXML<<";
export const CLOSE = ">>SXML";
const CHUNK = 200;

export function loadCases(root = ".") {
  return JSON.parse(readFileSync(join(root, CASES), "utf8"));
}

/** the input of a fixture as bytes: strings UTF-8, {hex} raw */
export function bytesOf(fixture) {
  return Buffer.concat(fixture.input.map((p) => typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p.hex, "hex")));
}

export function validate(cases) {
  const problems = [];
  const seen = new Set();
  for (const f of cases.fixtures) {
    if (!/^[a-z0-9_]+$/.test(f.name)) problems.push(`${f.name}: a name is [a-z0-9_]`);
    if (seen.has(f.name)) problems.push(`${f.name}: twice`);
    seen.add(f.name);
    if (!FORK.includes(f.fork ?? "")) problems.push(`${f.name}: fork is one of ${FORK.join(", ")}`);
    if (f.status !== PROVISIONAL && f.status !== SPEC && !/^measured-a4h-\d{4}-\d{2}-\d{2}$/.test(f.status)) problems.push(`${f.name}: unknown status ${f.status}`);
    if (!Array.isArray(f.expected) || f.expected.length === 0) problems.push(`${f.name}: no expected events`);
    for (const line of f.expected ?? []) {
      if (!/^[\x20-\x7e]*$/.test(line)) problems.push(`${f.name}: expected line not 7-bit printable: ${line}`);
      if (line.includes("|")) problems.push(`${f.name}: an event line never holds a bare |: ${line}`);
      if (!/^(OPEN|ATTR|VALUE|CLOSE|NODE|FINAL|ERROR|ABORT)\b/.test(line)) problems.push(`${f.name}: unknown event ${line}`);
    }
  }
  return problems;
}

/** an ABAP string expression for any 7-bit text: backtick literals of at most CHUNK characters */
function literals(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`not 7-bit printable: ${JSON.stringify(text)}`);
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  if (parts.length === 0) parts.push("");
  return parts.map((p) => "`" + p.replace(/`/g, "``") + "`");
}

/** statements that leave `text` in `variable` */
function assign(variable, text, indent) {
  const parts = literals(text);
  const lines = [`${indent}${variable} = ${parts[0]}.`];
  for (const p of parts.slice(1)) lines.push(`${indent}${variable} = ${variable} && ${p}.`);
  return lines;
}

const hexOf = (fixture) => bytesOf(fixture).toString("hex").toUpperCase();

export function fixturesClass(cases) {
  const out = [
    "\"! GENERATED by tools/osd-sxml-contract.mjs from test/fixtures/sxml-contract/cases.json;",
    "\"! edit that file and run the tool, never this one. The fixtures of",
    "\"! ZCL_OSD_SXML_CONTRACT as ABAP, so every host loads them the same way.",
    "\"! STATUS provisional-fork: generated from the pinned open-abap-core fork,",
    "\"! not an oracle. STATUS provisional-spec: written from the XML or",
    "\"! JSON-XML rules where the fork is visibly wrong. STATUS",
    "\"! measured-a4h-<date>: measured on A4H. FORK: what the pinned fork does",
    "\"! with it: empty = passes, MISS = another sequence, DUMPS = a runtime",
    "\"! error no CATCH sees, which ends the whole run.",
    "CLASS zcl_osd_sxml_fixtures DEFINITION PUBLIC FINAL CREATE PUBLIC.",
    "  PUBLIC SECTION.",
    "    CLASS-METHODS all",
    "      RETURNING VALUE(rt) TYPE zcl_osd_sxml_contract=>ty_fixtures.",
    "ENDCLASS.",
    "",
    "",
    "CLASS zcl_osd_sxml_fixtures IMPLEMENTATION.",
    "",
    "  METHOD all.",
    "    DATA ls TYPE zcl_osd_sxml_contract=>ty_fixture.",
    "    DATA lv_hex TYPE string.",
    "    DATA lv_line TYPE string.",
  ];
  for (const f of cases.fixtures) {
    out.push("", "    CLEAR ls.");
    out.push(...assign("ls-name", f.name, "    "));
    out.push(...assign("ls-group", f.group, "    "));
    out.push(...assign("ls-status", f.status, "    "));
    if (f.fork) out.push(...assign("ls-fork", f.fork, "    "));
    out.push(...assign("lv_hex", hexOf(f), "    "));
    out.push("    ls-input = lv_hex.");
    for (const line of f.expected) {
      out.push(...assign("lv_line", line, "    "));
      out.push("    APPEND lv_line TO ls-expected.");
    }
    out.push("    APPEND ls TO rt.");
  }
  out.push("  ENDMETHOD.", "", "ENDCLASS.", "");
  return out.join("\n");
}

/** the recorder's statements, which leave the report in lv_out */
export function recorderBody(cases, only, skip = () => false) {
  const fixtures = (only ? cases.fixtures.filter((f) => only.includes(f.name)) : cases.fixtures).filter((f) => !skip(f));
  if (only) for (const n of only) if (!cases.fixtures.some((f) => f.name === n)) throw new Error(`no fixture ${n}`);
  const i = "";
  const b = [
    "* sXML contract recorder. GENERATED by tools/osd-sxml-contract.mjs from",
    "* test/fixtures/sxml-contract/cases.json. Runs CL_SXML_STRING_READER over",
    "* every fixture with NEXT_NODE / NEXT_ATTRIBUTE and prints the events in",
    "* the normalisation stated in ZCL_OSD_SXML_CONTRACT (whose RECORD method",
    "* gives the same text; test/unit/zcl_osd_sxml_recorder_test proves it).",
    "* Run it through execute_abap; the report is the alert title, framed",
    "* SXML<< ... >>SXML. Save that text to a file and import it with",
    "*   node tools/osd-sxml-contract.mjs import <file> --date YYYY-MM-DD",
    "* If the title is cut (no >>SXML), print a recorder for fewer fixtures:",
    "*   node tools/osd-sxml-contract.mjs recorder --only a,b,c",
    "TYPES: BEGIN OF ty_ev,",
    "         kw TYPE string,",
    "         n  TYPE i,",
    "         f1 TYPE string,",
    "         f2 TYPE string,",
    "         f3 TYPE string,",
    "       END OF ty_ev.",
    "DATA lt_names TYPE string_table.",
    "DATA lt_hex TYPE string_table.",
    "DATA lv_hex TYPE string.",
    "DATA lv_name TYPE string.",
    "DATA lv_x TYPE xstring.",
    "DATA lv_out TYPE string.",
    "DATA li_reader TYPE REF TO if_sxml_reader.",
    "DATA lx_error TYPE REF TO cx_root.",
    "DATA lx_parse TYPE REF TO cx_sxml_parse_error.",
    "DATA lt_ev TYPE STANDARD TABLE OF ty_ev WITH DEFAULT KEY.",
    "DATA ls_ev TYPE ty_ev.",
    "DATA lv_field TYPE string.",
    "DATA lv_esc TYPE string.",
    "DATA lv_line TYPE string.",
    "DATA lv_len TYPE i.",
    "DATA lv_pos TYPE i.",
    "DATA lv_c TYPE c LENGTH 1.",
    "DATA lv_code TYPE x LENGTH 2.",
    "DATA lv_code_hex TYPE string.",
    "DATA lv_class TYPE string.",
    "DATA lv_offset TYPE string.",
    "DATA lv_index TYPE i.",
    "DATA lv_done TYPE abap_bool.",
    "DATA lv_plain TYPE string.",
    "lv_plain = ` !#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_``abcdefghijklmnopqrstuvwxyz{}~`.",
  ];
  for (const f of fixtures) {
    b.push(...assign("lv_hex", hexOf(f), i));
    b.push("APPEND lv_hex TO lt_hex.");
    b.push(`APPEND \`${f.name}\` TO lt_names.`);
  }
  b.push(
    "lv_out = `" + OPEN + "`.",
    "LOOP AT lt_names INTO lv_name.",
    "  lv_index = sy-tabix.",
    "  READ TABLE lt_hex INDEX lv_index INTO lv_hex.",
    "  lv_x = lv_hex.",
    "  IF lv_index > 1.",
    "    lv_out = lv_out && `|`.",
    "  ENDIF.",
    "  lv_out = lv_out && `@` && lv_name.",
    "  CLEAR: lt_ev, lv_done.",
    "  TRY.",
    "      li_reader = cl_sxml_string_reader=>create( lv_x ).",
    "      WHILE lv_done = abap_false.",
    "        IF lines( lt_ev ) >= 256.",
    "          CLEAR ls_ev.",
    "          ls_ev-kw = `ABORT`.",
    "          APPEND ls_ev TO lt_ev.",
    "          EXIT.",
    "        ENDIF.",
    "        li_reader->next_node( ).",
    "        CLEAR ls_ev.",
    "        CASE li_reader->node_type.",
    "          WHEN if_sxml_node=>co_nt_final.",
    "            ls_ev-kw = `FINAL`.",
    "            APPEND ls_ev TO lt_ev.",
    "            lv_done = abap_true.",
    "          WHEN if_sxml_node=>co_nt_element_open.",
    "            ls_ev-kw = `OPEN`.",
    "            ls_ev-n = 2.",
    "            ls_ev-f1 = li_reader->name.",
    "            ls_ev-f2 = li_reader->nsuri.",
    "            APPEND ls_ev TO lt_ev.",
    "            DO.",
    "              IF lines( lt_ev ) >= 256.",
    "                EXIT.",
    "              ENDIF.",
    "              li_reader->next_attribute( ).",
    "              IF li_reader->node_type <> if_sxml_node=>co_nt_attribute.",
    "                EXIT.",
    "              ENDIF.",
    "              CLEAR ls_ev.",
    "              ls_ev-kw = `ATTR`.",
    "              ls_ev-n = 3.",
    "              ls_ev-f1 = li_reader->name.",
    "              ls_ev-f2 = li_reader->nsuri.",
    "              ls_ev-f3 = li_reader->value.",
    "              APPEND ls_ev TO lt_ev.",
    "            ENDDO.",
    "          WHEN if_sxml_node=>co_nt_element_close.",
    "            ls_ev-kw = `CLOSE`.",
    "            ls_ev-n = 1.",
    "            ls_ev-f1 = li_reader->name.",
    "            APPEND ls_ev TO lt_ev.",
    "          WHEN if_sxml_node=>co_nt_value.",
    "            ls_ev-kw = `VALUE`.",
    "            ls_ev-n = 1.",
    "            ls_ev-f1 = li_reader->value.",
    "            APPEND ls_ev TO lt_ev.",
    "          WHEN OTHERS.",
    "            lv_line = li_reader->node_type.",
    "            CONDENSE lv_line.",
    "            ls_ev-kw = `NODE ` && lv_line.",
    "            APPEND ls_ev TO lt_ev.",
    "        ENDCASE.",
    "      ENDWHILE.",
    "    CATCH cx_root INTO lx_error.",
    "      lv_class = cl_abap_classdescr=>get_class_name( lx_error ).",
    "      FIND REGEX `=([^=]*)$` IN lv_class SUBMATCHES lv_class.",
    "      lv_offset = `-`.",
    "      TRY.",
    "          lx_parse ?= lx_error.",
    "          lv_offset = lx_parse->xml_offset.",
    "          CONDENSE lv_offset.",
    "        CATCH cx_sy_move_cast_error.",
    "          lv_offset = `-`.",
    "      ENDTRY.",
    "      CLEAR ls_ev.",
    "      ls_ev-kw = `ERROR ` && lv_class && ` ` && lv_offset.",
    "      APPEND ls_ev TO lt_ev.",
    "  ENDTRY.",
    "  LOOP AT lt_ev INTO ls_ev.",
    "    lv_line = ls_ev-kw.",
    "    DO ls_ev-n TIMES.",
    "      CASE sy-index.",
    "        WHEN 1.",
    "          lv_field = ls_ev-f1.",
    "        WHEN 2.",
    "          lv_field = ls_ev-f2.",
    "        WHEN OTHERS.",
    "          lv_field = ls_ev-f3.",
    "      ENDCASE.",
    "      IF lv_field CO lv_plain.",
    "        lv_esc = lv_field.",
    "      ELSE.",
    "        CLEAR lv_esc.",
    "        lv_len = strlen( lv_field ).",
    "        lv_pos = 0.",
    "        WHILE lv_pos < lv_len.",
    "          lv_c = lv_field+lv_pos(1).",
    "          IF lv_field+lv_pos(1) = ` `.",
    "            lv_esc = lv_esc && ` `.",
    "          ELSEIF lv_c CA lv_plain.",
    "            lv_esc = lv_esc && lv_c.",
    "          ELSE.",
    "            TRY.",
    "                lv_code = cl_abap_conv_out_ce=>uccp( lv_c ).",
    "                lv_code_hex = lv_code.",
    "              CATCH cx_root.",
    "                lv_code_hex = `????`.",
    "            ENDTRY.",
    "            lv_esc = lv_esc && `\\u` && lv_code_hex.",
    "          ENDIF.",
    "          lv_pos = lv_pos + 1.",
    "        ENDWHILE.",
    "      ENDIF.",
    "      lv_line = lv_line && ` \"` && lv_esc && `\"`.",
    "    ENDDO.",
    "    lv_out = lv_out && `|` && lv_line.",
    "  ENDLOOP.",
    "ENDLOOP.",
    "lv_out = lv_out && `" + CLOSE + "`.",
  );
  return b;
}

export function recorder(cases, only) {
  return [...recorderBody(cases, only), "cl_abap_unit_assert=>fail( msg = lv_out ).", ""].join("\n");
}

const TWIN_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><VSEOCLASS><CLSNAME>ZCL_OSD_SXML_RECORDER_TEST</CLSNAME><LANGU>E</LANGU><DESCRIPT>The A4H sXML recorder, run here (generated)</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE><WITH_UNIT_TESTS>X</WITH_UNIT_TESTS></VSEOCLASS></asx:values>
 </asx:abap>
</abapGit>
`;

const TWIN_MAIN = `"! GENERATED by tools/osd-sxml-contract.mjs. The test class runs the A4H
"! recorder's statements (test/fixtures/sxml-contract/recorder.abap) here and
"! compares their report with ZCL_OSD_SXML_CONTRACT=>RECORD over the same
"! reader: the recorder's inline normalisation and the class's are one.
CLASS zcl_osd_sxml_recorder_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
ENDCLASS.


CLASS zcl_osd_sxml_recorder_test IMPLEMENTATION.
ENDCLASS.
`;

export function twinTestclasses(cases) {
  const body = recorderBody(cases, undefined, (f) => f.fork === "DUMPS").map((l) => (l.startsWith("*") ? l : "    " + l));
  return [
    "CLASS ltcl_recorder DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.",
    "  PRIVATE SECTION.",
    "    METHODS same_as_contract FOR TESTING RAISING cx_static_check.",
    "    METHODS recorded",
    "      RETURNING VALUE(rv) TYPE string.",
    "ENDCLASS.",
    "",
    "CLASS ltcl_recorder IMPLEMENTATION.",
    "",
    "  METHOD same_as_contract.",
    "    DATA lo_contract TYPE REF TO zcl_osd_sxml_contract.",
    "    DATA li_factory TYPE REF TO zif_osd_sxml_factory.",
    "    DATA lv_exp TYPE string.",
    "    DATA lt_fixtures TYPE zcl_osd_sxml_contract=>ty_fixtures.",
    "* a fixture that DUMPS the pinned fork ends the run; the recorder here leaves",
    "* it out too (on A4H it is in)",
    "    lt_fixtures = zcl_osd_sxml_fixtures=>all( ).",
    "    DELETE lt_fixtures WHERE fork = `DUMPS`.",
    "    CREATE OBJECT li_factory TYPE zcl_osd_sxml_factory_concat.",
    "    CREATE OBJECT lo_contract EXPORTING ii_factory = li_factory.",
    `    lv_exp = \`${OPEN}\` && lo_contract->record( lt_fixtures ) && \`${CLOSE}\`.`,
    "    cl_abap_unit_assert=>assert_equals( act = recorded( )",
    "                                        exp = lv_exp ).",
    "  ENDMETHOD.",
    "",
    "  METHOD recorded.",
    ...body,
    "    rv = lv_out.",
    "  ENDMETHOD.",
    "",
    "ENDCLASS.",
    "",
  ].join("\n");
}

export function outputs(cases) {
  return {
    [FIXTURES_CLASS]: fixturesClass(cases),
    [RECORDER]: recorder(cases),
    [`${TWIN}.abap`]: TWIN_MAIN,
    [`${TWIN}.xml`]: TWIN_XML,
    [`${TWIN}.testclasses.abap`]: twinTestclasses(cases),
  };
}

/** "SXML<<@a|E|E|@b|E>>SXML" somewhere in a text -> Map name -> lines */
export function parseReport(text) {
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE, start);
  if (start < 0 || end < 0) throw new Error(`no ${OPEN} ... ${CLOSE} in the text (a report without its end marker may have been cut)`);
  const body = text.slice(start + OPEN.length, end);
  const result = new Map();
  let current;
  for (const item of body.split("|")) {
    if (item.startsWith("@")) {
      current = item.slice(1);
      result.set(current, []);
    } else if (current !== undefined) {
      result.get(current).push(item);
    } else {
      throw new Error(`event before the first fixture: ${item}`);
    }
  }
  return result;
}

function writeCases(root, cases) {
  const json = JSON.stringify(cases, null, 2).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  writeFileSync(join(root, CASES), json + "\n");
}

function writeOutputs(root, cases) {
  for (const [path, content] of Object.entries(outputs(cases))) writeFileSync(join(root, path), content);
}

/** the provisional expectations, out of the transpiled contract in output/ */
export async function provisional(root = ".") {
  const cases = loadCases(root);
  if (!existsSync(join(root, "output/zcl_osd_sxml_contract.clas.mjs"))) throw new Error("output/ has no ZCL_OSD_SXML_CONTRACT: run npm run transpile first");
  const {initializeABAP} = await import(join(process.cwd(), root, "output/init.mjs"));
  await initializeABAP();
  const abap = globalThis.abap;
  const contractClass = abap.Classes.ZCL_OSD_SXML_CONTRACT;
  const factoryClass = abap.Classes.ZCL_OSD_SXML_FACTORY_CONCAT;
  const factory = await new factoryClass().constructor_();
  const contract = await new contractClass().constructor_({ii_factory: factory});
  const fixtures = await abap.Classes.ZCL_OSD_SXML_FIXTURES.all();
  let changed = 0;
  const forks = [];
  for (const row of fixtures.array()) {
    const name = row.get().name.get();
    const f = cases.fixtures.find((x) => x.name === name);
    if (!f) throw new Error(`${name} is in the generated class and not in ${CASES}: run the tool first`);
    const one = abap.types.TableFactory.construct(row, fixtures.options);
    one.append(row);
    let lines;
    try {
      lines = parseReport(OPEN + (await contract.record({it_fixtures: one})).get() + CLOSE).get(name);
    } catch (e) {
      if (f.status === PROVISIONAL) throw new Error(`${name}: the fork ends the run (${e.message}), so it cannot give a provisional expectation`);
    }
    if (f.status === PROVISIONAL) {
      if (JSON.stringify(lines) !== JSON.stringify(f.expected)) changed++;
      f.expected = lines;
    }
    const fork = lines === undefined ? "DUMPS" : JSON.stringify(lines) === JSON.stringify(f.expected) ? "" : "MISS";
    if (fork !== (f.fork ?? "")) forks.push(`${name}: fork ${f.fork || "passes"} -> ${fork || "passes"}`);
    if (fork) f.fork = fork;
    else delete f.fork;
  }
  for (const line of forks) console.log(`osd-sxml-contract: ${line}`);
  writeCases(root, cases);
  writeOutputs(root, cases);
  return changed;
}

function main(argv) {
  const root = ".";
  const [command, ...rest] = argv;
  if (command === "--check") {
    const cases = loadCases(root);
    const problems = validate(cases);
    for (const [path, content] of Object.entries(outputs(cases))) {
      const now = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined;
      if (now !== content) problems.push(`${path} is stale: run node tools/osd-sxml-contract.mjs`);
    }
    for (const p of problems) console.error(`osd-sxml-contract: ${p}`);
    if (problems.length) process.exitCode = 1;
    else console.log(`osd-sxml-contract: ${loadCases(root).fixtures.length} fixtures, generated files current`);
    return;
  }
  if (command === "recorder") {
    const at = rest.indexOf("--only");
    const only = at >= 0 ? rest[at + 1].split(",") : undefined;
    process.stdout.write(recorder(loadCases(root), only));
    return;
  }
  if (command === "provisional") {
    provisional(root).then((n) => console.log(`osd-sxml-contract: provisional expectations written, ${n} changed`),
      (e) => { console.error(`osd-sxml-contract: ${e.message}`); process.exitCode = 1; });
    return;
  }
  if (command === "import") {
    const file = rest[0];
    const at = rest.indexOf("--date");
    const date = at >= 0 ? rest[at + 1] : undefined;
    if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      console.error("usage: osd-sxml-contract.mjs import <file> --date YYYY-MM-DD");
      process.exitCode = 2;
      return;
    }
    const cases = loadCases(root);
    const got = parseReport(readFileSync(file, "utf8"));
    for (const [name, lines] of got) {
      const f = cases.fixtures.find((x) => x.name === name);
      if (!f) throw new Error(`the report names ${name}, which is not a fixture`);
      if (JSON.stringify(lines) !== JSON.stringify(f.expected)) {
        console.log(`changed ${name} (was ${f.status}):\n  - ${f.expected.join("\n  - ")}\n  + ${lines.join("\n  + ")}`);
      }
      f.expected = lines;
      f.status = `measured-a4h-${date}`;
    }
    writeCases(root, cases);
    writeOutputs(root, cases);
    console.log(`osd-sxml-contract: ${got.size} fixtures imported as measured-a4h-${date}`);
    console.log("osd-sxml-contract: the fork marks are now stale: npm run transpile, then node tools/osd-sxml-contract.mjs provisional;"
      + " every 'changed' line above where the fork was right before is an ANORMALIES candidate");
    return;
  }
  if (command !== undefined) {
    console.error(`osd-sxml-contract: unknown command ${command}`);
    process.exitCode = 2;
    return;
  }
  const cases = loadCases(root);
  writeOutputs(root, cases);
  const problems = validate(cases);
  for (const p of problems) console.error(`osd-sxml-contract: ${p}`);
  console.log(`osd-sxml-contract: wrote ${Object.keys(outputs(cases)).length} files for ${cases.fixtures.length} fixtures`);
}

if (runsAs("osd-sxml-contract.mjs")) main(process.argv.slice(2));
