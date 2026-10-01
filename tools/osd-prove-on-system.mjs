// The same ABAP Unit on OSG and on a sandbox system, in one command.
//
//   node tools/osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json]
//        [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <name>]
//   node tools/osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X     (needs the run's receipt)
//
// Why (Alice, 2026-10-01): "proven by runs on systems, OSG included". The
// first such proof was walked by hand on A4H for the L2 rules -- a zip of
// the folder, an abapGit offline import, ABAP Unit per class, a purge -- and
// it found two defects no run here could: a table XML without its closing
// tag, which abapGit's parser refuses, and a class XML without
// WITH_UNIT_TESTS, for which the system creates no CCAU include and ADT runs
// no test at all (#354). This is that walk as a program, so anybody with a
// sandbox can repeat it. docs/prove-on-system.md has the steps.
//
// **Sandboxes only.** A local `$` package is the only target it accepts; it
// imports, runs and deletes, and a productive or customer system is never
// the place for that. The system is whatever the MCP configuration names
// (`OSD_MCP_CONFIG`, default `.mcp.json`, gitignored): no host, user or
// client is written here.
//
// **It deletes only what it brought, unchanged.** The package must not
// exist when the run starts -- the run creates it -- and no object of the
// zip may exist anywhere. Right after an import that was not refused, the
// run reads a version stamp for every object the import wrote into the
// package and writes a receipt, `.local/prove-runs/<package>.json`. The
// cleanup -- the run's own, or `--cleanup` later -- deletes, in one snippet
// of ours and one dialog step, the objects that are still the receipt's: in
// the package, and the stamp unchanged -- or the stamp moved and the content
// hash (SHA-256 of abapGit's serialisation, read in the same step as the
// stamp) is still the receipt's, since a re-activation moves stamps and
// leaves content; then the repository row only when this run's import
// created it (`OSDPROVE <package>`, the receipt's key, checked in that same
// step), then the package if nothing is left. No receipt, no delete: the
// zip's object list alone never authorises one. vsp's git_delete_objects is
// not used: it has no conditional delete (no expected version per object, no
// expected repository key), so an object replaced between a decision and
// its call would be deleted.
//
// What vsp does (v2.58.0-54 or later, `MIN_VSP`) and what stays ours:
//   - the import is vsp's `git_import_zip` (abapGit on the system, as a
//     background job; overwrite false, so nothing that exists is touched);
//   - the deletion stays ours (cleanupAbap), decided and done in one step;
//   - the residue is read twice: vsp's `read DEVC <pkg> {inventory}` and our
//     own TADIR / repository / REPOSRC-and-DD count, and the two must agree;
//   - every snippet we still run (preflight, receipt stamps and hashes,
//     chunk reads, the cleanup, the residue count, the class check)
//     hands its result back with RETURN_VALUE( ) as a table of rows, which
//     vsp answers as JSON; no result is read out of an alert title any more.
//
// The steps, each a small MCP call:
//   1. zip the folder (tools/osd-abapgit-zip.mjs, fail closed on the unit);
//   2. preflight: refuse (exit 2) when the package exists or an object of
//      the zip exists already;
//   3. create the local package (`create DEVC`);
//   4. `git_import_zip` into the tool's own offline repository, recording
//      its key and whether this import created it; then stamp what it
//      wrote and write the receipt;
//   5. read SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class;
//   6. ABAP Unit per class (`test CLAS`), compared by method identity
//      (test class -> method), not by count;
//   7. cleanup as above; anything left fails the run (exit 1) and is listed.
//
// Missing evidence is never a pass: no status, no class-check entry, a unit
// result that is not vsp's JSON or does not name the class, an unnamed test
// method with an alert, a snippet result that is not JSON or has no end row,
// a zip without classes, or no test method run on the system all fail the run.
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import * as abaplint from "@abaplint/core";
import {runsAs} from "./osd-main.mjs";
import {layout, zipInProcess} from "./osd-abapgit-zip.mjs";
import {loadManifest, unitFor} from "./osd-deploy-manifest.mjs";
import {
  FILE_NAME, HASH_DECLS, canonicalXml, collectHashes, fetchFile, hashItemBlock, parseHashes, proveInPlace, readHashes,
  rollbackFromState, serializeBlock, sha256, snapshotDir,
} from "./osd-prove-inplace.mjs";

/** The vsp this tool needs: execute_abap answering JSON with result_text and
 *  RETURN_VALUE( ), ABAP Unit with ok and counts, git_import_zip /
 *  git_import_status, and `read DEVC` with inventory. */
export const MIN_VSP = "vsp v2.58.0-54 (vibing-steampunk main at 0a83078, #301)";
export const DEFAULT_PACKAGE = "$ZOSG_TMP_PROVE";
export const B64_LINE = 200;
// abapGit log messages the in-place deploy snippet carries back; the rest are counted
export const MAX_LOG = 20;
/** Seconds vsp may spend on one long call (`params.timeout`). */
export const CALL_TIMEOUT = 300;
/** How long git_import_zip waits for its job before it answers. */
export const IMPORT_WAIT_SECONDS = 300;
/** If the job is still running after that: how often, and how far apart,
 *  git_import_status is asked before the run gives up (fail closed). */
export const IMPORT_POLL = {tries: 20, delayMs: 15000};

// ------------------------------------------------------------------ refusals

/** A local package or nothing. Returns the upper-case name, throws a refusal. */
export function checkPackage(name) {
  const pkg = String(name ?? "").toUpperCase();
  if (!pkg.startsWith("$")) {
    const e = new Error(`refused: package "${name}" is not local. This tool imports, runs and deletes, `
      + "so it only takes a $ package, on a sandbox; never a transportable package, never a productive or customer system.");
    e.code = "REFUSED";
    throw e;
  }
  if (!/^\$[A-Z0-9_]{1,29}$/.test(pkg)) {
    const e = new Error(`refused: package "${name}" is not a valid local package name ($ + up to 29 of A-Z 0-9 _)`);
    e.code = "REFUSED";
    throw e;
  }
  return pkg;
}

export const CLASS_NAME = /^[A-Z0-9_/]{1,30}$/;

// ------------------------------------------------- the snippets' result rows
//
// Every snippet collects its result in lt_out, a table of {k, v} strings, and
// hands it back with one RETURN_VALUE( lt_out ) as its last statement. vsp
// answers execute_abap as JSON and serialises the table into result_text
// (`[{"K":..,"V":..}, ...]`). The last row is END_ROW: a result without it,
// or a result_text that is not JSON, may have been cut, and fails the run.

export const END_ROW = {k: "end", v: "OSDPROVE"};

/** The declarations every snippet needs for its result. */
export const OUT_DECLS = [
  "TYPES: BEGIN OF ty_osd_kv,",
  "         k TYPE string,",
  "         v TYPE string,",
  "       END OF ty_osd_kv.",
  "DATA lt_out TYPE STANDARD TABLE OF ty_osd_kv WITH EMPTY KEY.",
];

/** One result row: `k` is a literal name, `v` the inside of a string template. */
export const put = (k, v) => `APPEND VALUE #( k = '${k}' v = |${v}| ) TO lt_out.`;

/** The last lines of every snippet: the end row, and the one RETURN_VALUE( ). */
export const report = () => `APPEND VALUE #( k = '${END_ROW.k}' v = '${END_ROW.v}' ) TO lt_out.\nRETURN_VALUE( lt_out ).`;

/** The first line of every snippet names it (a comment, for a reader of the
 *  temporary program and for the tests' fake system). */
export const head = (kind) => `" osdprove:${kind}`;

/** The offline repository this tool creates is named so it can tell it
 *  from anybody else's: a repository in the package under any other name
 *  is not ours to deserialise into or to delete. */
export function ownRepoName(pkg) {
  return `OSDPROVE ${pkg}`;
}

export const REPO_KEY = /^[0-9]{1,12}$/;

// ------------------------------------------------------------ reading rows

export const all = (rows, k) => rows.filter((r) => r.k === k).map((r) => r.v);
export const one = (rows, k) => rows.find((r) => r.k === k)?.v;
export const num = (rows, k) => {
  const v = one(rows, k)?.trim();
  return v !== undefined && /^-?[0-9]+$/.test(v) ? Number(v) : NaN;
};
const ITEM_REF = /^([A-Z0-9]{4}):([^@]*)(?:@(.*))?$/s;
/** Rows `k` whose value is `TYPE:NAME` or `TYPE:NAME@where`. A row that is
 *  neither is not guessed at: it throws, and the caller fails. */
export const pairs = (rows, k) => all(rows, k).map((v) => {
  const m = ITEM_REF.exec(v);
  if (m === null) throw new Error(`the result row ${k}=${v.slice(0, 120)} is not TYPE:NAME`);
  return {item: `${m[1]} ${m[2].trim()}`, where: m[3]?.trim()};
});
/** The rows as one line, for the log. */
export const show = (rows) => rows.map((r) => `${r.k}=${r.v.length > 160 ? `${r.v.slice(0, 160)}...` : r.v}`).join("; ");

/** The rows of an execute_abap answer, or a throw that says why there are
 *  none: an answer that is not JSON (an older vsp, or a cut one), a snippet
 *  that did not finish (vsp's `failure`, with the snippet's line), no value
 *  or more than one, a result_text that is not JSON (cut), a row that is not
 *  {K, V}, or no END_ROW at the end. Never a partial result. */
export function rowsOf(text, step) {
  const s = String(text);
  const fail = (why, code) => { throw Object.assign(new Error(`${step}: ${why}`), {code}); };
  if (s.startsWith("ERROR:")) fail(`vsp refused the call: ${s.slice(0, 600)}`, "VSP_ERROR");
  let ans;
  try {
    ans = JSON.parse(s);
  } catch {
    fail(`the answer is not JSON (${MIN_VSP} or later answers execute_abap as JSON; a cut answer is not JSON either): ${s.slice(0, 300)}`, "NOT_JSON");
  }
  if (ans === null || typeof ans !== "object" || Array.isArray(ans)) fail(`the answer is not an execute_abap result: ${s.slice(0, 300)}`, "NOT_JSON");
  if (ans.failure !== undefined || ans.success !== true) {
    const f = ans.failure ?? {};
    fail(`the snippet did not finish: ${f.title ?? ans.message ?? "no reason given"}`
      + (f.line ? ` (line ${f.line} of the snippet)` : "")
      + (Array.isArray(f.details) && f.details.length ? `; ${f.details.slice(0, 5).join("; ")}` : ""), "FAILED");
  }
  const rt = ans.result_text;
  if (rt === undefined || rt === null) fail("no value came back (the snippet did not reach its RETURN_VALUE( ))", "NO_REPORT");
  if (typeof rt !== "string") fail("more than one value came back; every snippet returns exactly one", "NO_REPORT");
  let arr;
  try {
    arr = JSON.parse(rt);
  } catch {
    fail(`result_text is not JSON, so it may be cut: ${rt.slice(0, 300)}`, "TRUNCATED");
  }
  if (!Array.isArray(arr)) fail(`result_text is not the snippet's table of rows: ${rt.slice(0, 300)}`, "TRUNCATED");
  const rows = [];
  for (const o of arr) {
    const k = o?.K ?? o?.k;
    const v = o?.V ?? o?.v;
    if (typeof k !== "string" || typeof v !== "string") fail(`result_text holds a row that is not {K, V}: ${JSON.stringify(o)?.slice(0, 200)}`, "TRUNCATED");
    rows.push({k: k.trim(), v});
  }
  const last = rows.at(-1);
  if (last === undefined || last.k !== END_ROW.k || last.v !== END_ROW.v || rows.filter((r) => r.k === END_ROW.k).length !== 1) {
    fail(`the result has no end row, so it may be cut: ${show(rows).slice(0, 300)}`, "TRUNCATED");
  }
  return rows.slice(0, -1);
}

/** A JSON answer of another vsp operation (git_*, read DEVC, test). vsp
 *  marks an error result, which this transport passes as `ERROR: <text>`;
 *  its text is often JSON too (a refused import, a failed delete). */
export function jsonAnswer(text, step) {
  const s = String(text);
  const isError = s.startsWith("ERROR:");
  const body = isError ? s.slice(6).trim() : s.trim();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw Object.assign(new Error(`${step}: ${isError ? "vsp refused the call" : "the answer is not JSON"}: ${s.slice(0, 600)}`),
      {code: isError ? "VSP_ERROR" : "NOT_JSON"});
  }
  if (json === null || typeof json !== "object") throw Object.assign(new Error(`${step}: the answer is not a JSON object: ${s.slice(0, 300)}`), {code: "NOT_JSON"});
  return {json, isError};
}

/** One snippet, run: its rows and a printable line. */
export async function exec(mcp, code, step) {
  const text = await mcp.call("analyze", undefined, {type: "execute_abap", code, timeout: CALL_TIMEOUT});
  const rows = rowsOf(text, step);
  return {rows, message: show(rows)};
}

// ----------------------------------------------------------------- snippets
// ASCII only, every value validated before it is interpolated.

/** Step 5: SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class. */
export function classCheckAbap(classes) {
  for (const c of classes) if (!CLASS_NAME.test(c)) throw new Error(`class name ${c} cannot be put into an ABAP literal`);
  return [
    head("check"),
    ...OUT_DECLS,
    "DATA lt_cls TYPE string_table.",
    "DATA lv_wut TYPE c LENGTH 1.",
    "DATA lv_found TYPE i.",
    "DATA lt_src TYPE string_table.",
    "DATA lv_inc TYPE program.",
    ...classes.map((c) => `APPEND \`${c}\` TO lt_cls.`),
    "LOOP AT lt_cls INTO DATA(lv_cls).",
    "  CLEAR: lv_wut, lt_src.",
    "  SELECT SINGLE with_unit_tests FROM seoclassdf",
    "    WHERE clsname = @lv_cls AND version = '1' INTO @lv_wut.",
    "  lv_found = sy-subrc.",
    "  lv_inc = cl_oo_classname_service=>get_ccau_name( CONV seoclsname( lv_cls ) ).",
    "  READ REPORT lv_inc INTO lt_src.",
    `  ${put("cls", "{ lv_cls }\\|{ lv_found }\\|{ lv_wut }\\|{ lines( lt_src ) }")}`,
    "ENDLOOP.",
    report(),
  ].join("\n") + "\n";
}

// how many rows one list carries; a list that is longer is counted and not
// shown, and a check that needs the list fails rather than guess
export const MAX_LIST = 200;

export const OBJECT_ITEM = /^[A-Z0-9]{4} [A-Z0-9_/]{1,40}$/;

export function checkItems(items) {
  for (const i of items) if (!OBJECT_ITEM.test(i)) throw new Error(`object "${i}" cannot be put into an ABAP literal`);
}

// ---------------------------------------------------------------- receipt
//
// A run receipt says which objects this run's import wrote into the package
// and what each looked like right after: its TADIR identity and a version
// stamp read on the system. Only an object in the receipt with the same
// stamp (or a moved stamp and the same content hash) is ever deleted, by the
// run's own cleanup or by `--cleanup` later. The zip's object list alone
// never authorises a delete.

/** The kinds of object a stamp can be read for, and from where:
 *  CLAS/INTF the newest REPOSRC UDAT+UTIME over abapGit's own include list
 *  (zcl_abapgit_oo_factory, the list abapGit's changed_by reads) and how
 *  many of those includes exist; PROG its REPOSRC row; TABL/DTEL/DOMA/TTYP
 *  the active DD02L/DD04L/DD01L/DD40L row's AS4DATE+AS4TIME; DDLS the
 *  active DDDDLSRC row's AS4DATE+AS4TIME (the table abapGit's own DDLS
 *  object reads through IF_DD_DDL_HANDLER~READ, get_state 'A'; the
 *  field names are read off abapGit's source, not yet measured on a
 *  system). Any other kind gets no stamp, so it is never in a receipt and
 *  never deleted. DCLS has none either: abapGit reads it through a
 *  handler into ACM_S_DCLSRC and the table behind that is not known here. */
export const STAMPED_KINDS = ["CLAS", "INTF", "PROG", "TABL", "DTEL", "DOMA", "TTYP", "DDLS"];
const STAMP = /^[A-Z]{4}:[0-9]{14}(\/[0-9]+)?$/;

const STAMP_DECLARATIONS = [
  "DATA lv_stamp TYPE string.",
  "DATA lv_max TYPE string.",
  "DATA lv_cnt TYPE i.",
  "DATA lv_d TYPE d.",
  "DATA lv_t TYPE t.",
  "DATA lt_incs TYPE zif_abapgit_oo_object_fnc=>ty_includes_tt.",
];

/** ABAP that sets lv_stamp for lv_type / lv_name (empty: no stamp). The
 *  residue check uses it too: a deleted object must have none left. */
const STAMP_BLOCK = [
  "CLEAR: lv_stamp, lv_max, lv_cnt, lt_incs, lv_d, lv_t.",
  "CASE lv_type.",
  "  WHEN 'CLAS' OR 'INTF'.",
  "    TRY.",
  "        lt_incs = zcl_abapgit_oo_factory=>get_by_type( lv_type )->get_includes( lv_name ).",
  "      CATCH cx_root.",
  "        CLEAR lt_incs.",
  "    ENDTRY.",
  "    LOOP AT lt_incs INTO DATA(lv_inc).",
  "      SELECT SINGLE udat, utime FROM reposrc WHERE progname = @lv_inc-programm AND r3state = 'A' INTO (@lv_d, @lv_t).",
  "      IF sy-subrc = 0.",
  "        lv_cnt = lv_cnt + 1.",
  "        IF |{ lv_d }{ lv_t }| > lv_max.",
  "          lv_max = |{ lv_d }{ lv_t }|.",
  "        ENDIF.",
  "      ENDIF.",
  "    ENDLOOP.",
  "    IF lv_cnt > 0.",
  "      lv_stamp = |{ lv_type }:{ lv_max }/{ lv_cnt }|.",
  "    ENDIF.",
  "  WHEN 'PROG'.",
  "    SELECT SINGLE udat, utime FROM reposrc WHERE progname = @lv_name AND r3state = 'A' INTO (@lv_d, @lv_t).",
  "  WHEN 'TABL'.",
  "    SELECT SINGLE as4date, as4time FROM dd02l WHERE tabname = @lv_name AND as4local = 'A' AND as4vers = '0000' INTO (@lv_d, @lv_t).",
  "  WHEN 'DTEL'.",
  "    SELECT SINGLE as4date, as4time FROM dd04l WHERE rollname = @lv_name AND as4local = 'A' AND as4vers = '0000' INTO (@lv_d, @lv_t).",
  "  WHEN 'DOMA'.",
  "    SELECT SINGLE as4date, as4time FROM dd01l WHERE domname = @lv_name AND as4local = 'A' AND as4vers = '0000' INTO (@lv_d, @lv_t).",
  "  WHEN 'TTYP'.",
  "    SELECT SINGLE as4date, as4time FROM dd40l WHERE typename = @lv_name AND as4local = 'A' INTO (@lv_d, @lv_t).",
  "  WHEN 'DDLS'.",
  "    SELECT SINGLE as4date, as4time FROM ddddlsrc WHERE ddlname = @lv_name AND as4local = 'A' INTO (@lv_d, @lv_t).",
  "ENDCASE.",
  "IF lv_stamp IS INITIAL AND lv_d IS NOT INITIAL.",
  "  lv_stamp = |{ lv_type }:{ lv_d }{ lv_t }|.",
  "ENDIF.",
];

/** The prefix of the content-hash rows in the receipt snippet's result. */
export const RECEIPT_HASH = "h_";

/** After the import: each object of the zip whose TADIR row is in the
 *  package, with its stamp and content hash. Nothing is changed. */
export function receiptAbap(pkg, items) {
  checkItems(items);
  return [
    head("receipt"),
    ...OUT_DECLS,
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lv_n TYPE i.",
    ...STAMP_DECLARATIONS,
    ...HASH_DECLS,
    ...items.map((i) => `APPEND \`${i}\` TO lt_items.`),
    "LOOP AT lt_items INTO DATA(lv_item).",
    "  SPLIT lv_item AT space INTO lv_type lv_name.",
    "  SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "    INTO @DATA(lv_where).",
    "  IF sy-subrc <> 0.",
    `    ${put("absent", "{ lv_type }:{ lv_name }")}`,
    `  ELSEIF lv_where <> '${pkg}'.`,
    `    ${put("elsewhere", "{ lv_type }:{ lv_name }@{ lv_where }")}`,
    "  ELSE.",
    ...STAMP_BLOCK.map((l) => `    ${l}`),
    "    IF lv_stamp IS INITIAL.",
    `      ${put("nostamp", "{ lv_type }:{ lv_name }")}`,
    "    ELSE.",
    `      ${put("stamp", "{ lv_type }:{ lv_name }@{ lv_stamp }")}`,
    "      \" the content hash in the same dialog step as the stamp, with the",
    "      \" in-place mode's own serialisation and digest (hashItemBlock)",
    ...hashItemBlock(pkg, RECEIPT_HASH).map((l) => `      ${l}`),
    "    ENDIF.",
    "  ENDIF.",
    "ENDLOOP.",
    put("items", "{ lines( lt_items ) }"),
    report(),
  ].join("\n") + "\n";
}

/** Step 2, the preflight: nothing is changed. Does the package exist, has
 *  it a repository, and does any object of the zip exist already (in any
 *  package)? */
export function preflightAbap(pkg, items) {
  checkItems(items);
  return [
    head("preflight"),
    ...OUT_DECLS,
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lv_n TYPE i.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    ...items.map((i) => `APPEND \`${i}\` TO lt_items.`),
    `SELECT COUNT(*) FROM tdevc WHERE devclass = '${pkg}' INTO @DATA(lv_devc).`,
    put("tdevc", "{ lv_devc }"),
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "    IF li_repo IS BOUND.",
    `      ${put("repo", "{ li_repo->get_key( ) }")}`,
    `      ${put("repo_name", "{ li_repo->get_name( ) }")}`,
    "    ELSE.",
    `      ${put("repo", "none")}`,
    "    ENDIF.",
    "  CATCH cx_root INTO DATA(lx).",
    `    ${put("err", "{ lx->get_text( ) }")}`,
    "ENDTRY.",
    "LOOP AT lt_items INTO DATA(lv_item).",
    "  SPLIT lv_item AT space INTO lv_type lv_name.",
    "  SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "    INTO @DATA(lv_where).",
    "  IF sy-subrc = 0.",
    "    lv_n = lv_n + 1.",
    `    IF lv_n <= ${MAX_LIST}.`,
    `      ${put("exists", "{ lv_type }:{ lv_name }@{ lv_where }")}`,
    "    ENDIF.",
    "  ENDIF.",
    "ENDLOOP.",
    put("existing", "{ lv_n }"),
    report(),
  ].join("\n") + "\n";
}

/** The decision's content check of lv_item: abapGit serialises it now with
 *  the in-place mode's serializeBlock (same serialisation, same digest),
 *  every file becomes `ITEM@name=HEX` in lt_b, and the object is the
 *  receipt's when lt_b equals lt_a (the receipt's lines for the item). A
 *  serialisation that raises, or an object that is not there, leaves
 *  lv_same false: kept. */
const hashCompare = (pkg) => serializeBlock(pkg, {
  prefix: "h_",
  onFile: ["lv_line = |{ lv_item }@{ ls_file-filename }={ lv_hx }|.", "APPEND lv_line TO lt_b."],
  onOk: ["SORT lt_a.", "SORT lt_b.", "IF lt_a = lt_b.", "  lv_same = abap_true.", "ENDIF."],
});

/** Step 7a, the cleanup, in ONE snippet so nothing changes between the
 *  check and the delete (vsp's git_delete_objects cannot be used here: it
 *  takes no expected version per object and no expected repository key,
 *  so an object replaced between a decision and its call would be deleted):
 *   a. the package's repository, if any, must be the tool's own by name and,
 *      when `expectedKey` is given, the one this run imported into -- else
 *      `go` is not set and nothing at all is deleted;
 *   b. each receipt entry whose TADIR row is in this package and whose stamp
 *      is unchanged -- or moved, with the receipt's content hashes -- goes
 *      into one list for zcl_abapgit_objects=>delete (abapGit's object
 *      layer, dependency order, a commit per object), in the same step; an
 *      entry in another package, or one that is not there, is reported and
 *      not touched; a changed one is kept; nothing outside the receipt is
 *      ever handed to it;
 *   c. the repository row is deleted (zcl_abapgit_repo_srv->delete, which
 *      removes the persisted repository and no object) only when `dropRepo`:
 *      this run's import created it, and (a) just checked it is that row;
 *   d. the package is deleted (abapGit's DEVC object, which deletes only an
 *      empty package) only if no repository is left registered for it,
 *      TADIR holds nothing else under it and TDEVC has no subpackage of it.
 *      Subpackages are never deleted. */
export function cleanupAbap(pkg, entries, expectedKey, dropRepo = false) {
  const items = entries.map((e) => e.item);
  checkItems(items);
  for (const e of entries) if (!STAMP.test(e.stamp ?? "")) throw new Error(`not a stamp: ${e.stamp} (${e.item})`);
  // the receipt's content hashes: `ITEM@file=HEX`, one per file; an entry
  // without any (an old receipt) is decided by its stamp alone
  const expected = [];
  for (const e of entries) {
    for (const f of e.files ?? []) {
      if (!FILE_NAME.test(f.name) || !/^[0-9a-fA-F]{64}$/.test(f.sha256)) throw new Error(`not a file entry: ${f.name} (${e.item})`);
      expected.push(`APPEND \`${e.item}@${f.name}=${f.sha256.toUpperCase()}\` TO lt_exp.`);
    }
  }
  if (expectedKey !== undefined && expectedKey !== "" && !REPO_KEY.test(expectedKey)) throw new Error(`not a repository key: ${expectedKey}`);
  const keyCheck = expectedKey === undefined ? "" : `li_repo->get_key( ) <> '${expectedKey}' OR `;
  return [
    head("cleanup"),
    ...OUT_DECLS,
    "DATA lv_go TYPE abap_bool VALUE abap_true.",
    `DATA lv_drop TYPE abap_bool VALUE ${dropRepo === true ? "abap_true" : "abap_false"}.`,
    "DATA lv_gone TYPE abap_bool.",
    "DATA lv_logs TYPE i.",
    "DATA lt_tadir TYPE zif_abapgit_definitions=>ty_tadir_tt.",
    "DATA ls_tadir TYPE zif_abapgit_definitions=>ty_tadir.",
    "DATA lv_key TYPE string.",
    "DATA(li_log) = CAST zif_abapgit_log( NEW zcl_abapgit_log( ) ).",
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lv_n TYPE i.",
    "DATA lv_del TYPE i.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "DATA lt_stamps TYPE string_table.",
    "DATA lv_want TYPE string.",
    "DATA lv_same TYPE abap_bool.",
    "DATA lt_exp TYPE string_table.",
    "DATA lt_a TYPE string_table.",
    "DATA lt_b TYPE string_table.",
    "DATA lv_l TYPE string.",
    "DATA lv_line TYPE string.",
    "DATA lv_pre TYPE string.",
    "DATA lv_pl TYPE i.",
    ...STAMP_DECLARATIONS,
    ...HASH_DECLS,
    ...entries.map((e) => `APPEND \`${e.item}\` TO lt_items.`),
    ...entries.map((e) => `APPEND \`${e.stamp}\` TO lt_stamps.`),
    ...expected,
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "  CATCH cx_root INTO DATA(lx).",
    `    ${put("err", "repository lookup: { lx->get_text( ) }")}`,
    "    lv_go = abap_false.",
    "ENDTRY.",
    "IF li_repo IS BOUND.",
    `  ${put("repo", "{ li_repo->get_key( ) }")}`,
    `  ${put("repo_name", "{ li_repo->get_name( ) }")}`,
    "ELSE.",
    `  ${put("repo", "none")}`,
    "ENDIF.",
    `IF li_repo IS BOUND AND ( ${keyCheck}li_repo->get_name( ) <> '${ownRepoName(pkg)}' ).`,
    `  ${put("err", "refused: repository { li_repo->get_key( ) } named { li_repo->get_name( ) } is not the one this run imported into")}`,
    "  lv_go = abap_false.",
    "ENDIF.",
    "IF lv_go = abap_true.",
    "  LOOP AT lt_items INTO DATA(lv_item).",
    "    DATA(lv_ix) = sy-tabix.",
    "    READ TABLE lt_stamps INDEX lv_ix INTO lv_want.",
    "    SPLIT lv_item AT space INTO lv_type lv_name.",
    "    SELECT SINGLE * FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "      INTO @DATA(ls_db).",
    "    IF sy-subrc <> 0.",
    `      ${put("absent", "{ lv_type }:{ lv_name }")}`,
    `    ELSEIF ls_db-devclass <> '${pkg}'.`,
    `      ${put("elsewhere", "{ lv_type }:{ lv_name }@{ ls_db-devclass }")}`,
    "    ELSE.",
    ...STAMP_BLOCK.map((l) => `      ${l}`),
    "      lv_same = abap_true.",
    "      IF lv_stamp IS INITIAL OR lv_stamp <> lv_want.",
    "        \" the stamp moved. A re-activation moves it and leaves the content,",
    "        \" so the object is still ours when abapGit serialises it now to the",
    "        \" files the receipt hashed; any other edit changes a hash",
    "        lv_same = abap_false.",
    "        CLEAR: lt_a, lt_b.",
    "        lv_pre = |{ lv_item }@|.",
    "        lv_pl = strlen( lv_pre ).",
    "        LOOP AT lt_exp INTO lv_l.",
    "          IF strlen( lv_l ) > lv_pl AND substring( val = lv_l len = lv_pl ) = lv_pre.",
    "            APPEND lv_l TO lt_a.",
    "          ENDIF.",
    "        ENDLOOP.",
    "        IF lt_a IS NOT INITIAL.",
    ...hashCompare(pkg).map((l) => `          ${l}`),
    "        ENDIF.",
    "        IF lv_same = abap_true.",
    `          ${put("rehashed", "{ lv_type }:{ lv_name }@{ lv_stamp }")}`,
    "        ELSE.",
    `          ${put("changed", "{ lv_type }:{ lv_name }@{ lv_stamp }")}`,
    "          IF lt_a IS NOT INITIAL.",
    `            ${put("hashdiff", "{ lv_type }:{ lv_name }")}`,
    "          ENDIF.",
    "        ENDIF.",
    "      ENDIF.",
    "      IF lv_same = abap_true.",
    "        lv_del = lv_del + 1.",
    `        ${put("delete", "{ lv_type }:{ lv_name }")}`,
    "        CLEAR ls_tadir.",
    "        MOVE-CORRESPONDING ls_db TO ls_tadir.",
    "        APPEND ls_tadir TO lt_tadir.",
    "      ENDIF.",
    "    ENDIF.",
    "  ENDLOOP.",
    "  \" the delete, in the step that checked: exactly what was decided above",
    "  IF lt_tadir IS NOT INITIAL.",
    "    TRY.",
    "        zcl_abapgit_objects=>delete( it_tadir = lt_tadir ii_log = li_log ).",
    "      CATCH cx_root INTO DATA(lx2).",
    `        ${put("err", "delete: { lx2->get_text( ) }")}`,
    "    ENDTRY.",
    "  ENDIF.",
    "  LOOP AT li_log->get_messages( ) INTO DATA(ls_m) WHERE type = 'E' OR type = 'A'.",
    "    lv_logs = lv_logs + 1.",
    `    IF lv_logs <= ${MAX_LOG}.`,
    `      ${put("log", "{ ls_m-type }\\|{ ls_m-obj_type } { ls_m-obj_name }: { ls_m-text }")}`,
    "    ENDIF.",
    "  ENDLOOP.",
    `  ${put("logs", "{ lv_logs }")}`,
    "  IF li_repo IS BOUND.",
    "    lv_key = li_repo->get_key( ).",
    "    IF lv_drop = abap_true.",
    "      TRY.",
    "          zcl_abapgit_repo_srv=>get_instance( )->delete( li_repo ).",
    "          COMMIT WORK.",
    "          lv_gone = abap_true.",
    `          ${put("repo_deleted", "{ lv_key }")}`,
    "        CATCH cx_root INTO DATA(lx3).",
    `          ${put("err", "repo delete: { lx3->get_text( ) }")}`,
    "      ENDTRY.",
    "    ELSE.",
    `      ${put("repo_kept", "{ lv_key }")}`,
    "    ENDIF.",
    "  ENDIF.",
    "ENDIF.",
    `SELECT object, obj_name FROM tadir WHERE devclass = '${pkg}'`,
    `  AND NOT ( object = 'DEVC' AND obj_name = '${pkg}' ) INTO TABLE @DATA(lt_rest).`,
    `SELECT devclass FROM tdevc WHERE parentcl = '${pkg}' INTO TABLE @DATA(lt_children).`,
    "IF lv_go = abap_true AND ( li_repo IS NOT BOUND OR lv_gone = abap_true )",
    "    AND lt_rest IS INITIAL AND lt_children IS INITIAL.",
    "  CLEAR: ls_tadir, lt_tadir.",
    `  SELECT SINGLE * FROM tadir WHERE pgmid = 'R3TR' AND object = 'DEVC' AND obj_name = '${pkg}' INTO @DATA(ls_devc).`,
    "  IF sy-subrc = 0.",
    "    MOVE-CORRESPONDING ls_devc TO ls_tadir.",
    "  ELSE.",
    "    ls_tadir-pgmid = 'R3TR'.",
    "    ls_tadir-object = 'DEVC'.",
    `    ls_tadir-obj_name = '${pkg}'.`,
    `    ls_tadir-devclass = '${pkg}'.`,
    "  ENDIF.",
    "  APPEND ls_tadir TO lt_tadir.",
    "  TRY.",
    "      zcl_abapgit_objects=>delete( it_tadir = lt_tadir ).",
    "      COMMIT WORK.",
    `      ${put("package_deleted", "X")}`,
    "    CATCH cx_root INTO DATA(lx4).",
    `      ${put("err", "package delete: { lx4->get_text( ) }")}`,
    "  ENDTRY.",
    "ENDIF.",
    put("go", "{ lv_go }"),
    put("to_delete", "{ lv_del }"),
    put("items", "{ lines( lt_items ) }"),
    report(),
  ].join("\n") + "\n";
}

/** Step 7b, what is left, read from the database after the cleanup:
 *  the repository rows with this run's key, the receipt's objects still in
 *  the package's TADIR, the REPOSRC / DD rows of a receipt object that has
 *  no TADIR row any more (`stamp_left`: STAMP_BLOCK finds a stamp, so its
 *  source or dictionary rows survived), anything else in the package, its
 *  subpackages, and the package itself. Reads only. */
export function residueAbap(pkg, items, key) {
  checkItems(items);
  if (key !== undefined && key !== "" && !REPO_KEY.test(key)) throw new Error(`not a repository key: ${key}`);
  return [
    head("residue"),
    ...OUT_DECLS,
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lv_n TYPE i.",
    "DATA lv_repos TYPE i.",
    "DATA lv_items_left TYPE i.",
    "DATA lv_key TYPE zif_abapgit_persistence=>ty_value.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    ...STAMP_DECLARATIONS,
    ...items.map((i) => `APPEND \`${i}\` TO lt_items.`),
    ...(key ? [`lv_key = '${key}'.`,
      "DATA(lv_tab) = zcl_abapgit_persistence_db=>c_tabname.",
      "SELECT COUNT(*) FROM (lv_tab) WHERE type = @zcl_abapgit_persistence_db=>c_type_repo",
      "  AND value = @lv_key INTO @lv_repos."] : []),
    put("repo_left", "{ lv_repos }"),
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "    IF li_repo IS BOUND.",
    `      ${put("repo", "{ li_repo->get_key( ) }")}`,
    `      ${put("repo_name", "{ li_repo->get_name( ) }")}`,
    "    ELSE.",
    `      ${put("repo", "none")}`,
    "    ENDIF.",
    "  CATCH cx_root INTO DATA(lx).",
    `    ${put("err", "repository lookup: { lx->get_text( ) }")}`,
    "ENDTRY.",
    "LOOP AT lt_items INTO DATA(lv_item).",
    "  SPLIT lv_item AT space INTO lv_type lv_name.",
    "  SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "    INTO @DATA(lv_where).",
    "  IF sy-subrc = 0.",
    `    IF lv_where = '${pkg}'.`,
    "      lv_items_left = lv_items_left + 1.",
    `      ${put("item_left", "{ lv_type }:{ lv_name }")}`,
    "    ENDIF.",
    "  ELSE.",
    ...STAMP_BLOCK.map((l) => `    ${l}`),
    "    IF lv_stamp IS NOT INITIAL.",
    `      ${put("stamp_left", "{ lv_type }:{ lv_name }@{ lv_stamp }")}`,
    "    ENDIF.",
    "  ENDIF.",
    "ENDLOOP.",
    put("items_left", "{ lv_items_left }"),
    `SELECT object, obj_name FROM tadir WHERE devclass = '${pkg}'`,
    `  AND NOT ( object = 'DEVC' AND obj_name = '${pkg}' ) INTO TABLE @DATA(lt_rest).`,
    put("others", "{ lines( lt_rest ) }"),
    "LOOP AT lt_rest INTO DATA(ls_r).",
    "  lv_n = lv_n + 1.",
    `  IF lv_n <= ${MAX_LIST}.`,
    `    ${put("other", "{ ls_r-object }:{ ls_r-obj_name }")}`,
    "  ENDIF.",
    "ENDLOOP.",
    `SELECT devclass FROM tdevc WHERE parentcl = '${pkg}' INTO TABLE @DATA(lt_children).`,
    put("children", "{ lines( lt_children ) }"),
    "LOOP AT lt_children INTO DATA(ls_child).",
    `  ${put("child", "{ ls_child-devclass }")}`,
    "ENDLOOP.",
    `SELECT COUNT(*) FROM tdevc WHERE devclass = '${pkg}' INTO @DATA(lv_devc).`,
    put("tdevc_left", "{ lv_devc }"),
    report(),
  ].join("\n") + "\n";
}

// ------------------------------------------------------------------- parsing

/** The in-place deploy snippet's import report (status, repository, log). */
export function parseImport(rows) {
  return {
    files: num(rows, "files"),
    repo: one(rows, "repo"),
    status: one(rows, "status"),
    err: one(rows, "err"),
    logs: all(rows, "log").map((v) => {
      const i = v.indexOf("|");
      return {type: v.slice(0, i), text: v.slice(i + 1).trim()};
    }),
    logCount: num(rows, "logs"),
    tadir: num(rows, "tadir"),
  };
}

export function parsePreflight(rows) {
  return {
    err: one(rows, "err"),
    tdevc: num(rows, "tdevc"),
    repo: one(rows, "repo"),
    repoName: one(rows, "repo_name")?.trim(),
    existing: num(rows, "existing"),
    exists: pairs(rows, "exists"),
  };
}

export function parseClassCheck(rows) {
  const out = new Map();
  for (const v of all(rows, "cls")) {
    const m = /^([A-Z0-9_/]+)\|(\d+)\|(\S*)\|(\d+)$/.exec(v.trim());
    if (m !== null) out.set(m[1], {found: m[2] === "0", wut: m[3] === "X", ccau: Number(m[4])});
  }
  return out;
}

export function parseReceipt(rows) {
  return {
    // one entry per object: abapGit must never be handed the same object twice
    stamped: [...new Map(pairs(rows, "stamp").map((p) => [p.item, {item: p.item, stamp: p.where}])).values()],
    nostamp: pairs(rows, "nostamp").map((p) => p.item),
    absent: pairs(rows, "absent").map((p) => p.item),
    elsewhere: pairs(rows, "elsewhere"),
    items: num(rows, "items"),
  };
}

export function parseCleanup(rows) {
  return {
    err: all(rows, "err"),
    logs: all(rows, "log").map((v) => { const i = v.indexOf("|"); return `[${v.slice(0, i)}] ${v.slice(i + 1).trim()}`; }),
    repoDeleted: one(rows, "repo_deleted"),
    repoKept: one(rows, "repo_kept"),
    packageDeleted: one(rows, "package_deleted") === "X",
    repo: one(rows, "repo"),
    repoName: one(rows, "repo_name")?.trim(),
    go: one(rows, "go") === "X",
    goSeen: one(rows, "go") !== undefined,
    toDelete: num(rows, "to_delete"),
    items: num(rows, "items"),
    delete: pairs(rows, "delete").map((p) => p.item),
    absent: pairs(rows, "absent").map((p) => p.item),
    changed: pairs(rows, "changed"),
    // the stamp moved and the content is the receipt's: deleted as ours
    rehashed: pairs(rows, "rehashed"),
    // the stamp moved, the receipt had hashes and the content differs
    hashdiff: pairs(rows, "hashdiff").map((p) => p.item),
    // abapGit could not serialise the object to compare it
    hashFail: parseHashes(rows, "h_").fail,
    elsewhere: pairs(rows, "elsewhere"),
  };
}

export function parseResidue(rows) {
  return {
    err: all(rows, "err"),
    repoLeft: num(rows, "repo_left"),
    repo: one(rows, "repo"),
    repoName: one(rows, "repo_name")?.trim(),
    itemsLeft: num(rows, "items_left"),
    itemLeft: pairs(rows, "item_left").map((p) => p.item),
    stampLeft: pairs(rows, "stamp_left"),
    others: num(rows, "others"),
    other: pairs(rows, "other").map((p) => p.item),
    children: num(rows, "children"),
    child: all(rows, "child").map((c) => c.trim()),
    tdevcLeft: num(rows, "tdevc_left"),
  };
}

/** vsp's ABAP Unit report (ok, counts, classes[].testMethods[]; a failure
 *  carries alerts[] with a title). `error` is set when the text is not that
 *  JSON, when its counts do not match the methods it lists, or when the
 *  class is not in it: no evidence, which is never a pass. A run vsp calls
 *  not ok with no failure behind it (no method ran, a class not run) is a
 *  failure too. */
export function parseUnit(text, className) {
  const s = String(text);
  if (s.startsWith("ERROR:")) return {methods: 0, failing: [], error: `the unit run was refused: ${s.slice(0, 300)}`};
  const i = s.indexOf("{");
  let json;
  try {
    if (i < 0) throw new Error("no JSON");
    json = JSON.parse(s.slice(i));
  } catch {
    return {methods: 0, failing: [], error: `unit result is not JSON: ${s.slice(0, 200)}`};
  }
  if (typeof json?.ok !== "boolean" || typeof json?.counts?.methods !== "number") {
    return {methods: 0, failing: [], error: `the unit result is not vsp's ABAP Unit report (ok, counts; ${MIN_VSP}): ${s.slice(0, 200)}`};
  }
  if (json.onlyFailures === true) return {methods: 0, failing: [], error: "the unit result lists failures only; the method comparison needs every method"};
  const listedAll = Array.isArray(json.classes) ? json.classes : [];
  const listed = listedAll.reduce((n, c) => n + (Array.isArray(c?.testMethods) ? c.testMethods.length : 0), 0);
  if (listed !== json.counts.methods) {
    return {methods: 0, failing: [], error: `the unit result counts ${json.counts.methods} test method(s) and lists ${listed}`};
  }
  const classes = listedAll.filter((c) => String(c?.parentName ?? "").toUpperCase() === className);
  if (classes.length === 0) {
    return {methods: 0, failing: [], error: `the unit result names no test class of ${className}`
      + (json.ok === false && json.note ? ` (${json.note})` : "")};
  }
  const failing = [];
  const names = [];
  let nameless = 0;
  for (const c of classes) {
    for (const a of c.alerts ?? []) failing.push({method: `${c.name} (class)`, title: a.title});
    for (const m of c.testMethods ?? []) {
      // a method without a name is not evidence of a test that ran -- but
      // one that carries an alert is evidence of a test that failed
      if (typeof m?.name !== "string" || m.name.trim() === "" || typeof c.name !== "string" || c.name.trim() === "") {
        nameless += 1;
        if ((m?.alerts ?? []).length > 0) {
          failing.push({method: `${c.name ?? "?"}-><unnamed>`,
            title: `an unnamed test method failed: ${m.alerts.map((a) => a?.title).join(" | ")}`});
        }
        continue;
      }
      names.push(methodId(c.name, m.name));
      if ((m.alerts ?? []).length > 0) {
        failing.push({method: `${c.name}->${m.name}`, title: m.alerts.map((a) => a.title).join(" | ")});
      }
    }
  }
  for (const n of json.notRunClasses ?? []) failing.push({method: `${n} (class)`, title: "not run"});
  if (json.ok === false && failing.length === 0) {
    failing.push({method: `${className} (run)`, title: `vsp reports the run not ok${json.note ? `: ${json.note}` : ""}`});
  }
  return {methods: names.length, names, nameless, failing};
}

/** A test method's identity: test class and method, upper case. */
export const methodId = (testClass, method) => `${String(testClass).trim().toUpperCase()}->${String(method).trim().toUpperCase()}`;

/** What differs between two sets of method identities. */
export function methodDiff(osgNames, systemNames) {
  const here = new Set(osgNames);
  const there = new Set(systemNames);
  return {missing: [...here].filter((n) => !there.has(n)).sort(), extra: [...there].filter((n) => !here.has(n)).sort()};
}
// ---------------------------------------------------------------- OSG side

/** Every class of the folder with its FOR TESTING methods ("LTCL->METHOD"),
 *  from abaplint's parse of the source and the testclasses include. A test
 *  method inherited from an abstract local test class is attributed to the
 *  class that declares it, where ADT names the subclass; such a class shows
 *  as a difference, not as a pass. */
export function countTestMethods(folder) {
  const reg = new abaplint.Registry();
  for (const f of readdirSync(folder).sort()) {
    if (/\.clas\.(abap|xml|testclasses\.abap|locals_imp\.abap|locals_def\.abap|macros\.abap)$/.test(f)) {
      reg.addFile(new abaplint.MemoryFile(f, readFileSync(join(folder, f), "utf8")));
    }
  }
  reg.parse();
  const out = new Map();
  for (const o of reg.getObjects()) {
    if (o.getType() !== "CLAS") continue;
    const names = [];
    for (const file of o.getABAPFiles()) {
      for (const c of file.getInfo().listClassDefinitions()) {
        if (!c.isForTesting) continue;
        for (const m of c.methods.filter((x) => x.isForTesting)) names.push(methodId(c.name, m.name));
      }
    }
    out.set(o.getName().toUpperCase(), names.sort());
  }
  return out;
}

/** OSG providers: `count` reads the parse; `run` runs the class's ABAP Unit
 *  on this runtime (tools/osd-unit.mjs), which needs the folder in the build. */
export function osgCounter(folder) {
  const counts = countTestMethods(folder);
  return {
    mode: "count",
    async methods(cls) {
      const names = counts.get(cls) ?? [];
      return {methods: names.length, names, failing: []};
    },
  };
}

export function osgRunner(load = () => import("./osd-unit.mjs")) {
  return {
    mode: "run",
    async methods(cls) {
      const {UnitRun} = await load();
      const r = await new UnitRun().run("CLAS", cls, {});
      const failing = [];
      const names = [];
      for (const tc of r.testClasses) {
        for (const m of tc.testMethods) {
          names.push(methodId(tc.name, m.name));
          if (m.alerts.length > 0) failing.push(`${tc.name}->${m.name}`);
        }
        // class_setup / class_teardown / a class that could not be run:
        // every method may pass and the class still failed
        for (const a of tc.alerts ?? []) failing.push(`${tc.name} (class): ${a.title ?? a.kind ?? "alert"}`);
      }
      if (r.ok === false && failing.length === 0) failing.push(`${cls}: the OSG run reported not ok`);
      return {methods: names.length, names, failing};
    },
  };
}

// --------------------------------------------------------------------- zip

/** abapGit file name -> "TYPE NAME" (`#ns#x.clas.xml` -> "CLAS /NS/X"). */
const objectKey = (type, name) => `${type} ${String(name).toUpperCase().replace(/#/g, "/")}`;

/** Step 1, as tools/osd-abapgit-zip.mjs lays a folder out: only what the
 *  unit lists, fail closed. The zip itself is written in this process
 *  (`zipInProcess`), not by the `zip` binary, so no child is spawned.
 *  Returns the bytes, the objects ("TYPE NAME") and the classes. */
export function buildZip(folder, {unit: unitName, manifest, withPackageXml = true} = {}) {
  const unit = unitFor(loadManifest(manifest), folder, unitName);
  const work = mkdtempSync(join(tmpdir(), "osd-prove-"));
  try {
    const staging = join(work, "repo");
    const laid = layout(folder, staging, `open-steamgate prove: ${basename(resolve(folder))}`, undefined, unit);
    // --in-place: the package exists and is not ours to rewrite, so the
    // zip must not carry a package.devc.xml that would update its attributes
    if (!withPackageXml) rmSync(join(staging, "src", "package.devc.xml"), {force: true});
    const objects = [];
    for (const [type, names] of laid.objects) for (const n of names) objects.push(objectKey(type, n));
    objects.sort();
    const classes = objects.filter((o) => o.startsWith("CLAS ")).map((o) => o.slice(5));
    // the zip's object files by name, for the in-place mode's check that
    // what a deploy left is what the zip carried
    const files = new Map(readdirSync(join(staging, "src"), {withFileTypes: true}).filter((e) => e.isFile())
      .map((e) => e.name).sort().map((n) => [n, readFileSync(join(staging, "src", n))]));
    return {bytes: zipInProcess(staging), objects, classes, unit: unit.name, files};
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

// --------------------------------------------------------------------- run

export const listed = (list) => list.map((o) => `    ${o}`).join("\n");

/** Step 2: refusals before anything is written. The package must not
 *  exist: the run creates it and so owns it. No object of the zip may exist
 *  yet, in any package: an import would take it over. */
export async function preflight(mcp, pkg, items) {
  const r = await exec(mcp, preflightAbap(pkg, items), "preflight");
  const p = parsePreflight(r.rows);
  const refusals = [];
  if (p.err !== undefined) refusals.push(`refused: preflight: ${p.err}`);
  if (Number.isNaN(p.tdevc) || p.repo === undefined || Number.isNaN(p.existing)) {
    return [`refused: preflight: the result is incomplete: ${r.message}`];
  }
  if (p.tdevc > 0 || p.repo !== "none") {
    refusals.push(`refused: package ${pkg} exists`
      + (p.repo !== "none" ? ` (abapGit repository ${p.repo} named "${p.repoName}" is registered for it)` : "")
      + ". This tool only works in a package it creates, so it owns everything it deletes. "
      + `Inspect it (SE80 / ADT package ${pkg}, abapGit's repository list) and remove it by hand, `
      + "or pass another --package.");
  }
  if (p.existing > 0) {
    refusals.push(`refused: ${p.existing} object(s) of the zip exist already; an import would take them over:\n`
      + listed(p.exists.map((e) => `${e.item} in ${e.where}`))
      + (p.existing > p.exists.length ? `\n    ... and ${p.existing - p.exists.length} more` : ""));
  }
  return refusals;
}

/** Where a run keeps its receipt: `.local/prove-runs/<package>.json`
 *  (gitignored), or OSD_PROVE_RUNS. */
export function receiptPath(pkg, dir = process.env.OSD_PROVE_RUNS ?? join(process.env.OSD_ROOT ?? process.cwd(), ".local", "prove-runs")) {
  return join(dir, `${pkg}.json`);
}

export function writeReceipt(file, receipt) {
  mkdirSync(join(file, ".."), {recursive: true});
  writeFileSync(file, JSON.stringify(receipt, undefined, 1) + "\n");
}

export function readReceipt(file) {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The receipt's entries with their content hashes, from the same result
 *  as the stamps (the receipt snippet serialised each object in the step
 *  that read its stamp). An XML file also gets `cx`, the SHA-256 of its
 *  canonical element tree, read back by chunks that must carry the reported
 *  hash (so it is that version): the cleanup uses it to tell abapGit
 *  re-writing an XML file from somebody editing it. An object abapGit could
 *  not hash, or whose result is incomplete, keeps no hash and is decided by
 *  its stamp alone, as before; a file that cannot be read back keeps no
 *  `cx` and is compared by bytes only. Neither fails the run: the hashes
 *  only ever add a reason to delete. */
export async function withHashes(mcp, pkg, entries, rows, log = () => {}) {
  const h = collectHashes(parseHashes(rows, RECEIPT_HASH), entries.map((e) => e.item));
  const out = [];
  for (const e of entries) {
    const got = h.byItem.get(e.item);
    if (got === undefined) {
      log(`receipt: no content hash for ${e.item} (${h.fail.find((f) => f.item === e.item)?.text ?? "the result is incomplete"}); it is decided by its stamp alone`);
      out.push(e);
      continue;
    }
    const files = [];
    for (const f of got.files) {
      const entry = {name: f.name, sha256: f.sha256, size: f.size};
      if (f.name.endsWith(".xml")) {
        try {
          const canon = canonicalXml(await fetchFile(mcp, pkg, e.item, f));
          if (canon !== undefined) entry.cx = sha256(canon);
        } catch (err) {
          log(`receipt: ${e.item} ${f.name} could not be read back (${err.message}); compared by bytes only`);
        }
      }
      files.push(entry);
    }
    out.push({...e, hash: got.hash, files});
  }
  return out;
}

/** The pre-pass of a second cleanup call. `names` are the items whose stamp
 *  moved and whose content hash differs from the receipt's. For each, the
 *  files abapGit serialises now are hashed; when every file that differs is
 *  XML and its canonical element tree equals the one the receipt recorded
 *  (`cx`), and the set of files is the same, the object's expected hashes
 *  become the current ones, and the decision snippet re-checks them in its own
 *  step. Anything else (a source file differs, a file came or went, no `cx`,
 *  a file that is not one well-formed tree, a read that fails) leaves the
 *  entry as it was: kept, a foreign edit. */
export async function acceptCanonicalXml(mcp, pkg, entries, names, log = () => {}) {
  const want = entries.filter((e) => names.includes(e.item) && e.files?.length);
  if (want.length === 0) return {entries, accepted: []};
  const now = await readHashes(mcp, pkg, want.map((e) => e.item), log);
  const accepted = [];
  const next = [];
  for (const e of entries) {
    const cur = now.byItem.get(e.item);
    if (!want.includes(e) || cur === undefined) { next.push(e); continue; }
    const recorded = new Map(e.files.map((f) => [f.name, f]));
    const same = cur.files.length === e.files.length && cur.files.every((f) => recorded.has(f.name));
    const differing = same ? cur.files.filter((f) => recorded.get(f.name).sha256 !== f.sha256) : [];
    let ok = same && differing.length > 0 && differing.every((f) => f.name.endsWith(".xml") && recorded.get(f.name).cx !== undefined);
    for (const f of ok ? differing : []) {
      try {
        const canon = canonicalXml(await fetchFile(mcp, pkg, e.item, f));
        if (canon === undefined || sha256(canon) !== recorded.get(f.name).cx) ok = false;
      } catch {
        ok = false;
      }
      if (!ok) break;
    }
    if (!ok) { next.push(e); continue; }
    accepted.push({item: e.item, files: differing.map((f) => f.name)});
    next.push({...e, files: cur.files.map((f) => ({name: f.name, sha256: f.sha256}))});
  }
  return {entries: next, accepted};
}

/** vsp's `read DEVC <pkg> {inventory}`: the package's TADIR objects (its own
 *  entry left out), subpackages and abapGit repositories, or a throw when
 *  the answer is not that (or says it is incomplete). */
export async function inventory(mcp, pkg) {
  const {json, isError} = jsonAnswer(await mcp.call("read", `DEVC ${pkg}`, {inventory: true}), "inventory");
  if (isError) throw new Error(`inventory: vsp answered an error: ${JSON.stringify(json).slice(0, 300)}`);
  // both lists must be there; null is how vsp (Go) writes an empty one
  const list = (k) => Object.hasOwn(json, k) && (json[k] === null || Array.isArray(json[k]));
  if (!list("objects") || !list("subpackages")) throw new Error(`inventory: the answer has no objects or subpackages list: ${JSON.stringify(json).slice(0, 200)}`);
  if (json.objects_truncated || json.subpackages_truncated) throw new Error("inventory: the answer is truncated");
  if (!Array.isArray(json.abapgit_repos)) {
    throw new Error(`inventory: the abapGit repositories were not checked${json.skipped?.length ? ` (${json.skipped.join("; ")})` : ""}`);
  }
  return {
    objects: (json.objects ?? []).map((o) => `${String(o.type).trim()} ${String(o.name).trim()}`).filter((o) => o !== `DEVC ${pkg}`).sort(),
    subpackages: (json.subpackages ?? []).map((s) => String(s.name).trim()).sort(),
    repos: json.abapgit_repos.map((r) => String(r.key).trim()),
  };
}

/** Step 7: the cleanup snippet decides and deletes in one dialog step
 *  (cleanupAbap: stamps, content hashes and the repository key checked where
 *  the delete happens) -- the repository row only when `createdKey` names
 *  this run's own -- then the residue is read twice (our count and vsp's
 *  inventory). `entries` are the receipt's stamped objects; with none, no
 *  object is deleted. Returns the problems; anything left is one. */
export async function cleanup(mcp, pkg, entries, {expectedKey, createdKey, log = () => {}} = {}) {
  // without the key of this run's import the repository cannot be told from
  // one that appeared since; the snippet then refuses any repository at all
  if (expectedKey === undefined) expectedKey = "";
  const dropRepo = createdKey !== undefined && REPO_KEY.test(createdKey) && createdKey === expectedKey;
  const unhashed = entries.filter((e) => !(e.files?.length > 0));
  if (unhashed.length > 0) {
    log(`cleanup: ${unhashed.length === entries.length ? "the receipt carries" : `${unhashed.length} receipt entr(ies) carry`} no content hashes `
      + "(written by an older version, or an object that could not be hashed): decided by the version stamp alone, as before");
  }
  const problems = [];
  let c;
  const accepted = [];
  // errors and abapGit log lines of every call count, not only the last's
  const seen = [];
  const check = (x, r) => {
    if (!x.goSeen || x.items !== entries.length || x.toDelete !== x.delete.length) throw new Error(`cleanup: the result is incomplete: ${r.message}`);
    seen.push(...x.err.map((e) => `cleanup: ${e}`), ...x.logs.map((l) => `cleanup log ${l}`));
    if (x.repoDeleted) log(`cleanup: repository ${x.repoDeleted} (${ownRepoName(pkg)}) deleted`);
    if (x.repoKept) log(`cleanup: repository ${x.repoKept} is not one this run's import created${createdKey === undefined ? " (the receipt does not say it did)" : ""}; it is left registered, and the package with it`);
  };
  try {
    let r = await exec(mcp, cleanupAbap(pkg, entries, expectedKey, dropRepo), "cleanup");
    c = parseCleanup(r.rows);
    log(`cleanup: ${r.message}`);
    check(c, r);
    // an XML file abapGit rewrote (same tree, other bytes) is not an edit:
    // when the only difference of a moved object is such a file, say so to
    // the snippet through the object's current hashes and run it again; the
    // snippet re-checks them in its own step, so nothing slips in between
    if (c.hashdiff.length > 0) {
      const acc = await acceptCanonicalXml(mcp, pkg, entries, c.hashdiff, log);
      if (acc.accepted.length > 0) {
        for (const a of acc.accepted) {
          log(`cleanup: ${a.item}: ${a.files.join(", ")} differs in bytes from the receipt's but is the same XML element tree; accepted as unchanged`);
        }
        accepted.push(...acc.accepted);
        r = await exec(mcp, cleanupAbap(pkg, acc.entries, expectedKey, dropRepo), "cleanup");
        c = parseCleanup(r.rows);
        log(`cleanup (second call): ${r.message}`);
        check(c, r);
      }
    }
  } catch (e) {
    return {ok: false, problems: [...seen, `cleanup: ${e.message}`]};
  }
  for (const f of c.hashFail) problems.push(`cleanup: ${f.item} could not be serialised to compare its content (${f.text}); kept`);
  problems.push(...new Set(seen));
  for (const e of c.elsewhere) problems.push(`cleanup: ${e.item} is in package ${e.where}, not ${pkg}; not touched`);
  for (const e of c.changed) {
    problems.push(`cleanup: ${e.item} changed since the import (stamp now "${e.where ?? ""}")`
      + (c.hashdiff.includes(e.item) && !c.hashFail.some((f) => f.item === e.item) ? " and its content differs from the receipt's hash: a foreign edit" : "")
      + "; kept");
  }
  for (const e of c.rehashed) {
    log(`cleanup: ${e.item}: stamp moved to "${e.where ?? ""}" but the content equals the receipt's hash (re-activated, not edited); deleted as ours`);
  }
  if (entries.length === 0) log("cleanup: no receipt entries, so no object was deleted");
  if (!c.go) log("cleanup: refused, so nothing was deleted");
  // what is left, read twice: our count, and vsp's inventory; they must agree
  let left;
  try {
    const r = await exec(mcp, residueAbap(pkg, entries.map((e) => e.item), expectedKey || undefined), "residue");
    left = parseResidue(r.rows);
    log(`residue: ${r.message}`);
  } catch (e) {
    problems.push(`residue: ${e.message}`);
    return {ok: false, problems, parsed: c, accepted};
  }
  for (const e of left.err) problems.push(`residue: ${e}`);
  for (const [name, n] of [["repository", left.repoLeft], ["object(s) of the zip", left.itemsLeft]]) {
    if (!(n === 0)) problems.push(`cleanup incomplete: ${Number.isNaN(n) ? "unknown number of" : n} ${name} left`);
  }
  if (left.itemLeft.length) problems.push(`cleanup: left in ${pkg}:\n${listed(left.itemLeft)}`);
  for (const s of left.stampLeft) problems.push(`cleanup incomplete: ${s.item} has no TADIR row but its source or dictionary rows are still there (${s.where})`);
  if (!(left.others === 0) || !(left.children === 0)) {
    problems.push(`cleanup: package ${pkg} kept, it holds what this run did not bring`
      + (left.others > 0 ? `\n  ${left.others} object(s):\n${listed(left.other)}` : "")
      + (left.children > 0 ? `\n  ${left.children} subpackage(s):\n${listed(left.child)}` : "")
      + (Number.isNaN(left.others) || Number.isNaN(left.children) ? "\n  (the result does not say what)" : ""));
  } else if (!(left.tdevcLeft === 0)) {
    problems.push(`cleanup incomplete: package ${pkg} ${Number.isNaN(left.tdevcLeft) ? "may be" : "is"} still there`
      + (left.repo !== undefined && left.repo !== "none" ? ` (repository ${left.repo} named "${left.repoName}" is registered for it)` : ""));
  }
  try {
    const inv = await inventory(mcp, pkg);
    // `other` is every TADIR row of the package but its own, the receipt's
    // objects that are left included
    const ours = [...left.other].sort();
    if (left.others <= left.other.length && JSON.stringify(inv.objects) !== JSON.stringify(ours)) {
      problems.push(`residue: vsp's inventory and the residue read disagree about ${pkg}: inventory [${inv.objects.join(", ")}], residue [${ours.join(", ")}]`);
    }
    if (JSON.stringify(inv.subpackages) !== JSON.stringify([...left.child].sort())) {
      problems.push(`residue: vsp's inventory and the residue read disagree about the subpackages of ${pkg}: inventory [${inv.subpackages.join(", ")}], residue [${left.child.join(", ")}]`);
    }
    if (expectedKey && inv.repos.includes(expectedKey) !== (left.repoLeft > 0)) {
      problems.push(`residue: vsp's inventory and the residue read disagree about repository ${expectedKey}`);
    }
  } catch (e) {
    problems.push(`residue: ${e.message}`);
  }
  return {ok: problems.length === 0, problems, parsed: c, residue: left, accepted};
}

/** git_import_zip's answer, waited for: a job that is still pending after
 *  git_import_zip's own wait is asked about through git_import_status, a
 *  bounded number of times. Returns the last answer. */
export async function importZip(mcp, pkg, bytes, {poll = IMPORT_POLL, log = () => {}} = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let {json} = jsonAnswer(await mcp.call("system", undefined, {type: "git_import_zip", zip_base64: Buffer.from(bytes).toString("base64"),
    package: pkg, repo_name: ownRepoName(pkg), overwrite: false, wait_seconds: IMPORT_WAIT_SECONDS}), "import");
  for (let i = 0; i < poll.tries && (json.status === "pending" || json.status === "unknown") && /^[0-9]{8}$/.test(String(json.jobCount ?? "")); i += 1) {
    log(`import: job ${json.job ?? ""} ${json.jobCount} is ${json.status}; asking again`);
    await sleep(poll.delayMs);
    try {
      ({json} = jsonAnswer(await mcp.call("system", undefined, {type: "git_import_status", job: json.jobCount}), "import status"));
    } catch (e) {
      // the job was started: whatever went wrong asking about it, it may be running
      throw Object.assign(e, {code: "STATUS_UNKNOWN"});
    }
  }
  return json;
}

const logLine = (l) => `[${l?.type ?? "?"}] ${[l?.objType, l?.objName].filter(Boolean).join(" ")}${l?.objType || l?.objName ? ": " : ""}${l?.text ?? ""}`;

/** git_import_zip's evidence, checked. `imported` passes, with its W
 *  messages shown (abapGit's W is a warning about an object it still
 *  deserialised); an E or A message in its log fails it all the same.
 *  `imported_with_errors`, `refused` and `failed` fail the run with the
 *  whole log; so does any other status (a job still running, unknown). A
 *  TADIR row the import wrote into another package fails it too. */
export function judgeGitImport(ans, pkg) {
  const problems = [];
  const logs = Array.isArray(ans.log) ? ans.log : undefined;
  const status = ans.status;
  if (status === "imported") {
    for (const l of logs ?? []) if (l?.type !== "W") problems.push(`import log ${logLine(l)}`);
  } else if (status === "imported_with_errors" || status === "refused" || status === "failed") {
    problems.push(`import ${status}${ans.message ? `: ${ans.message}` : ""}${ans.note ? ` (${ans.note})` : ""}`);
    for (const l of logs ?? []) problems.push(`import log ${logLine(l)}`);
  } else {
    problems.push(`import: status ${status ?? "missing"}${ans.note ? ` (${ans.note})` : ""}`
      + (ans.jobCount ? `; ask vsp with git_import_status job=${ans.jobCount}` : ""));
  }
  if (typeof ans.error === "string") problems.push(`import: ${ans.error}`);
  if (status !== undefined && logs === undefined && ["imported", "imported_with_errors", "refused", "failed"].includes(status)) {
    problems.push("import: the answer carries no log");
  }
  if (["imported", "imported_with_errors", "failed"].includes(status)) {
    if (!Array.isArray(ans.tadir)) problems.push("import: the answer carries no TADIR rows");
    else {
      for (const t of ans.tadir) {
        if (String(t?.devclass ?? "").trim() !== pkg) problems.push(`import wrote ${t?.object} ${t?.objName} into package ${t?.devclass}, not ${pkg}`);
      }
    }
  }
  if (ans.package !== undefined && String(ans.package).trim() !== pkg) problems.push(`import: the answer is about package ${ans.package}, not ${pkg}`);
  return problems;
}

/** The in-place deploy's import evidence (our own snippet's rows): a parsed
 *  status of S, or W with its W messages carried back and shown; E, A, no
 *  status, an unknown status, an exception, or messages not carried back
 *  fail. */
export function judgeImport(imp) {
  const problems = [];
  if (imp.err !== undefined) problems.push(`import failed: ${imp.err}`);
  if (imp.status === undefined) problems.push("import: the result carries no abapGit status");
  else if (imp.status === "W") {
    if (!imp.logs.some((l) => l.type === "W")) problems.push("import status W with no W message carried back");
  } else if (imp.status !== "S") problems.push(`import status ${imp.status}`);
  for (const l of imp.logs) if (l.type !== "W") problems.push(`import log [${l.type}] ${l.text}`);
  if (Number.isNaN(imp.logCount)) problems.push("import: the result carries no log count");
  else if (imp.logCount > imp.logs.length) {
    problems.push(`import log: ${imp.logCount - imp.logs.length} more message(s) not carried back`);
  }
  if (Number.isNaN(imp.tadir)) problems.push("import: the result carries no TADIR count");
  return problems;
}

/** Steps 5-6, shared with the in-place mode: the class check, then ABAP
 *  Unit per class, compared with OSG by method identity. Pushes into
 *  `problems` and `rows`; touches nothing on the system. */
export async function proveClasses({mcp, classes, osg, problems, rows, log = () => {}}) {
  let check = new Map();
  if (problems.length === 0) {
    try {
      const r = await exec(mcp, classCheckAbap(classes), "class check");
      check = parseClassCheck(r.rows);
      log(`classes: ${r.message}`);
      for (const cls of classes) {
        if (!check.has(cls)) problems.push(`class check: no entry for ${cls}`);
      }
    } catch (e) {
      problems.push(e.message);
    }
  }

  if (problems.length === 0) {
    for (const cls of classes) {
      const here = await osg.methods(cls);
      const info = check.get(cls);
      const row = {cls, osg: here.methods, system: 0, failing: [], notes: []};
      rows.push(row);
      for (const f of here.failing) problems.push(`${cls}: fails on OSG: ${f}`);
      if (!info.found) {
        row.notes.push("not active on the system");
        problems.push(`${cls}: not active on the system`);
        continue;
      }
      if (here.methods === 0 && !info.wut && info.ccau === 0) {
        // no tests here and, by SEOCLASSDF and the CCAU include, none there
        row.notes.push("no tests on either side; ABAP Unit not called");
        continue;
      }
      if (here.methods > 0 && !info.wut) row.notes.push("WITH_UNIT_TESTS is not set on the system");
      if (here.methods > 0 && info.ccau === 0) {
        row.notes.push("no CCAU include on the system (WITH_UNIT_TESTS missing from the class XML?)");
      }
      const text = await mcp.call("test", `CLAS ${cls}`,
        {object_url: `/sap/bc/adt/oo/classes/${encodeURIComponent(cls.toLowerCase())}`, include_dangerous: true, timeout: CALL_TIMEOUT});
      const there = parseUnit(text, cls);
      row.system = there.methods;
      row.failing = there.failing;
      if (there.error !== undefined) problems.push(`${cls}: ${there.error}`);
      if (there.nameless > 0) row.notes.push(`${there.nameless} test method entr(ies) without a name, not counted`);
      // the same tests, by name: a count can match with different methods behind it
      const diff = methodDiff(here.names, there.names ?? []);
      if (diff.missing.length > 0 || diff.extra.length > 0) {
        problems.push(`${cls}: test methods differ: ${here.methods} test method(s) on OSG, ${there.methods} on the system`
          + (diff.missing.length ? `; on OSG, not on the system: ${diff.missing.join(", ")}` : "")
          + (diff.extra.length ? `; on the system, not on OSG: ${diff.extra.join(", ")}` : "")
          + (row.notes.length ? ` (${row.notes.join("; ")})` : ""));
      }
      for (const f of there.failing) problems.push(`${cls}: fails on the system: ${f.method}: ${f.title}`);
    }
    if (rows.reduce((n, r) => n + r.system, 0) === 0) {
      problems.push("nothing to prove: no test method ran on the system");
    }
  }
}

/** Steps 1-7. `mcp` is {call(action, target, params) -> text}; `osg` is a
 *  provider ({mode, methods(cls)}); `zipper` builds the zip. */
export async function prove({folder, unit, manifest, pkg = DEFAULT_PACKAGE, keep = false, mcp, osg,
  receiptFile = receiptPath(pkg), importPoll = IMPORT_POLL,
  zipper = buildZip, log = () => {}}) {
  pkg = checkPackage(pkg);
  const problems = [];
  const rows = [];
  const done = (extra = {}) => ({ok: problems.length === 0, problems, rows, pkg, osgMode: osg.mode,
    systemMethods: rows.reduce((n, r) => n + r.system, 0), osgMethods: rows.reduce((n, r) => n + r.osg, 0), ...extra});

  const built = zipper(folder, {unit, manifest});
  const classes = built.classes;
  if (classes.length === 0) {
    problems.push(`nothing to prove: unit "${built.unit}" puts no class in the zip`);
    return done();
  }
  for (const c of classes) {
    if (!CLASS_NAME.test(c)) throw new Error(`class name ${c} cannot be put into an ABAP literal`);
  }
  log(`zip: ${built.bytes.length} bytes, unit "${built.unit}", ${built.objects.length} object(s), ${classes.length} class(es)`);

  // read before anything is written: the run must create the package itself
  let refusals;
  try {
    refusals = await preflight(mcp, pkg, built.objects);
  } catch (e) {
    refusals = [`refused: ${e.message}`];
  }
  if (refusals.length > 0) {
    problems.push(...refusals);
    return done({refused: true});
  }

  const devc = await mcp.call("create", `DEVC ${pkg}`, {name: pkg, description: "open-steamgate prove-on-system (temporary)"});
  if (/^ERROR/i.test(devc)) {
    problems.push(`package ${pkg} not created: ${devc.slice(0, 300)}`);
    return done();
  }
  log(`package ${pkg}: created`);

  // the repository key the import reports; the cleanup takes that repository and no other
  let importedKey;
  // the key of a repository this run's import created: only that row is the run's to delete
  let createdKey;
  // the objects this run may delete: those in its receipt, none until the
  // import has written them. A refused import wrote nothing of ours and gets
  // no receipt, so the cleanup then deletes no object at all, only the
  // package if it is empty and no repository is registered for it (vsp
  // removes the repository a refused import created)
  let receipt;
  // an import job that has not finished may still be writing into the
  // package: then nothing at all is deleted, not even an empty package. Open
  // until vsp says the import is over, or that it refused the call before
  // any job (an error answer that is not JSON); a call that timed out or
  // broke may have started one
  let open = true;
  try {
    let wrote = false;
    try {
      const ans = await importZip(mcp, pkg, built.bytes, {poll: importPoll, log});
      open = !["imported", "imported_with_errors", "refused", "failed"].includes(ans.status);
      log(`import: status ${ans.status}; repository ${ans.repoKey ?? "none"} "${ans.repoName ?? ""}"${ans.repoCreated ? " (created)" : ""}; `
        + `${Array.isArray(ans.tadir) ? ans.tadir.length : "no"} TADIR row(s); `
        + `${Array.isArray(ans.log) ? ans.log.length : "no"} log line(s)${Array.isArray(ans.log) && ans.log.length ? `: ${ans.log.map(logLine).join("; ")}` : ""}`);
      // objects may be on the system: imported (with or without errors), or stopped partway
      wrote = ["imported", "imported_with_errors", "failed"].includes(ans.status);
      const key = String(ans.repoKey ?? "").trim();
      if (REPO_KEY.test(key)) {
        importedKey = key;
        if (ans.repoCreated === true) createdKey = key;
        else log(`import: repository ${key} was not created by this import; the cleanup will leave it registered`);
        if (String(ans.repoName ?? "").trim() !== ownRepoName(pkg)) {
          problems.push(`import: the repository is named "${ans.repoName ?? ""}", not "${ownRepoName(pkg)}"`);
        }
      } else if (wrote) problems.push("import: the answer carries no repository key");
      problems.push(...judgeGitImport(ans, pkg));
    } catch (e) {
      if (e.code === "VSP_ERROR") open = false;
      problems.push(e.message);
    }

    // the receipt: what the import wrote, as it was right after
    if (wrote && importedKey !== undefined) {
      try {
        const r = await exec(mcp, receiptAbap(pkg, built.objects), "receipt");
        const got = parseReceipt(r.rows);
        if (got.items !== built.objects.length) throw new Error(`receipt: the result is incomplete: ${r.message}`);
        const stamped = await withHashes(mcp, pkg, got.stamped.map((e) => ({...e, devclass: pkg})), r.rows, log);
        receipt = {package: pkg, repoKey: importedKey, repoName: ownRepoName(pkg), repoCreated: createdKey !== undefined,
          objects: built.objects, stamped, written: new Date().toISOString()};
        writeReceipt(receiptFile, receipt);
        log(`receipt: ${receipt.stamped.length} object(s) stamped, ${receiptFile}`);
        for (const i of got.nostamp) problems.push(`receipt: no stamp for ${i}; it will not be deleted`);
        for (const e of got.elsewhere) problems.push(`receipt: ${e.item} is in package ${e.where}, not ${pkg}; not in the receipt, not touched`);
        for (const i of got.absent) problems.push(`receipt: ${i} is not on the system after the import`);
      } catch (e) {
        problems.push(`receipt not written, so no object will be deleted: ${e.message}`);
        receipt = undefined;
      }
    }

    if (problems.length === 0) await proveClasses({mcp, classes, osg, problems, rows, log});
  } finally {
    if (open) {
      problems.push(`cleanup skipped: the import job may still be running in ${pkg}, so nothing is deleted. `
        + "Ask vsp with git_import_status, and remove the package by hand (SE80 / ADT, abapGit's repository list) once the job is over");
    } else if (keep) {
      log(`--keep: package ${pkg} and its objects are left on the system. Remove them with\n`
        + `  node tools/osd-prove-on-system.mjs --cleanup --package '${pkg}'\n`
        + `(it deletes only what the receipt ${receiptFile} lists, unchanged)`);
    } else {
      const c = await cleanup(mcp, pkg, receipt?.stamped ?? [], {expectedKey: importedKey, createdKey, log});
      problems.push(...c.problems);
      if (c.ok && receipt !== undefined) rmSync(receiptFile, {force: true});
    }
  }
  return done();
}

/** The last line says what was established, and no more: only a run on
 *  both sides may say the same tests pass on both. */
export function verdict(r) {
  if (!r.ok) return `NOT proved: ${r.problems.length} problem(s)`;
  // --in-place: success also means the package was put back and shown equal to its snapshot
  const back = r.inPlace ? (r.kept ? "; AFTER left deployed (--keep)" : r.restored ? `; package restored: ${r.restored}` : "") : "";
  if (r.osgMode === "run") return `proved: the same ${r.systemMethods} tests pass on OSG and on the system${back}`;
  return `system: ${r.systemMethods} tests pass; OSG: ${r.osgMethods} test methods counted from source, not run${back}`;
}

export function table(rows) {
  const head = ["class", "methods on OSG", "methods on system", "failing on system"];
  const body = rows.map((r) => [r.cls, String(r.osg), String(r.system), String(r.failing.length)]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join(" | ");
  return [line(head), w.map((n) => "-".repeat(n)).join("-|-"), ...body.map(line)].join("\n");
}

// ------------------------------------------------------------ MCP transport

/** The real transport: vsp over stdio, as the MCP configuration names it. */
export function mcpStdio({config = process.env.OSD_MCP_CONFIG ?? join(process.cwd(), ".mcp.json"),
  server = process.env.OSD_MCP_SERVER, timeoutMs = 900000} = {}) {
  if (!existsSync(config)) throw new Error(`no MCP configuration at ${config} (set OSD_MCP_CONFIG)`);
  const servers = JSON.parse(readFileSync(config, "utf8")).mcpServers ?? {};
  const names = Object.keys(servers);
  const name = server ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined || servers[name] === undefined) {
    throw new Error(`pick the MCP server with --server or OSD_MCP_SERVER (configured: ${names.join(", ") || "none"})`);
  }
  const cfg = servers[name];
  let child;
  let buf = "";
  let id = 0;
  const pending = new Map();
  const start = async () => {
    child = spawn(cfg.command, cfg.args ?? [], {env: {...process.env, ...(cfg.env ?? {})}, stdio: ["pipe", "pipe", "inherit"]});
    child.on("exit", (code) => {
      for (const [, p] of pending) p.reject(new Error(`MCP server exited (${code})`));
      pending.clear();
    });
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
      }
    });
    await rpc("initialize", {protocolVersion: "2024-11-05", capabilities: {}, clientInfo: {name: "osd-prove-on-system", version: "1"}});
    child.stdin.write(JSON.stringify({jsonrpc: "2.0", method: "notifications/initialized"}) + "\n");
  };
  const rpc = (method, params) => new Promise((res, rej) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); rej(new Error(`MCP ${method} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    pending.set(n, {resolve: res, reject: rej, timer});
    child.stdin.write(JSON.stringify({jsonrpc: "2.0", id: n, method, params}) + "\n");
  });
  let started;
  return {
    async call(action, target, params) {
      started ??= start();
      await started;
      const args = {action, params};
      if (target !== undefined) args.target = target;
      const r = await rpc("tools/call", {name: "SAP", arguments: args});
      // the whole text: a cut answer must be seen as cut, not repaired
      const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n") || JSON.stringify(r.error ?? r);
      return r.result?.isError || r.error ? `ERROR: ${text}` : text;
    },
    close() { child?.kill(); },
  };
}

// --------------------------------------------------------------------- CLI

/** `--cleanup`: only with the receipt a run wrote. */
export async function cleanupFromReceipt(mcp, pkg, file, out) {
  const receipt = readReceipt(file);
  if (receipt === undefined) {
    out(`refused: no receipt for ${pkg} at ${file}. Without one nothing shows that a run of this tool created `
      + `what is in ${pkg}, so nothing is deleted. Inspect it by hand (SE80 / ADT package ${pkg}, abapGit's `
      + "repository list) and remove what is yours there.");
    return 2;
  }
  if (receipt.package !== pkg || !REPO_KEY.test(receipt.repoKey ?? "") || !Array.isArray(receipt.stamped)) {
    out(`refused: the receipt at ${file} is not a receipt for ${pkg}`);
    return 2;
  }
  if (receipt.repoCreated === undefined) {
    out(`note: the receipt does not record whether its run created repository ${receipt.repoKey} (written by an older version), `
      + "so the row is left registered and the package with it; remove them by hand in abapGit if they are this tool's");
  }
  const c = await cleanup(mcp, pkg, receipt.stamped, {expectedKey: receipt.repoKey,
    createdKey: receipt.repoCreated === true ? receipt.repoKey : undefined, log: out});
  for (const p of c.problems) out(`FAIL ${p}`);
  if (c.ok) rmSync(file, {force: true});
  out(c.ok ? `cleanup of ${pkg}: complete` : `cleanup of ${pkg}: INCOMPLETE`);
  return c.ok ? 0 : 1;
}

const readFileOrNone = (dir) => (existsSync(join(dir, "snapshot.json")) ? dir : undefined);

export async function main(argv, {mcp: givenMcp, out = console.log, receiptDir} = {}) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
  const valued = new Set(["--unit", "--manifest", "--package", "--osg", "--server"]);
  const folder = argv.find((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
  let pkg;
  try {
    pkg = checkPackage(flag("package") ?? DEFAULT_PACKAGE);
  } catch (e) {
    out(e.message);
    return 2;
  }
  const cleanupOnly = argv.includes("--cleanup");
  const inPlace = argv.includes("--in-place");
  const rollbackOnly = argv.includes("--rollback");
  if (inPlace || rollbackOnly) {
    if (flag("package") === undefined) {
      out("refused: --in-place and --rollback work in an existing package: name it with --package");
      return 2;
    }
    if ([inPlace, rollbackOnly, cleanupOnly].filter(Boolean).length > 1) {
      out("refused: --in-place, --rollback and --cleanup are separate modes");
      return 2;
    }
  }
  if (folder === undefined && !cleanupOnly && !rollbackOnly) {
    out("usage: osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json] [--package $ZOSG_TMP_X] [--keep] "
      + "[--osg count|run] [--server <mcp server>]\n"
      + "       osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X   (needs the run's receipt)\n"
      + "       osd-prove-on-system.mjs --in-place --package $ZEXISTING <folder> --unit <unit> [--keep]\n"
      + "       osd-prove-on-system.mjs --rollback --package $ZEXISTING   (needs the snapshot of an --in-place --keep run)\n"
      + `       needs ${MIN_VSP}`);
    return 2;
  }
  const file = receiptPath(pkg, receiptDir);
  if (cleanupOnly && readReceipt(file) === undefined) {
    // refused before any connection is made
    return cleanupFromReceipt(undefined, pkg, file, out);
  }
  if (rollbackOnly && readFileOrNone(snapshotDir(pkg, receiptDir ?? dirname(file))) === undefined) {
    // refused before any connection is made
    return rollbackFromState(undefined, pkg, snapshotDir(pkg, receiptDir ?? dirname(file)), out);
  }
  const mcp = givenMcp ?? mcpStdio({server: flag("server")});
  try {
    if (rollbackOnly) return await rollbackFromState(mcp, pkg, snapshotDir(pkg, receiptDir ?? dirname(file)), out);
    if (cleanupOnly) return await cleanupFromReceipt(mcp, pkg, file, out);
    const osg = flag("osg") === "run" ? osgRunner() : osgCounter(folder);
    const r = inPlace
      ? await proveInPlace({folder, unit: flag("unit"), manifest: flag("manifest"), pkg, keep: argv.includes("--keep"),
        mcp, osg, log: out, runsDir: receiptDir ?? dirname(file)})
      : await prove({folder, unit: flag("unit"), manifest: flag("manifest"), pkg, keep: argv.includes("--keep"),
        mcp, osg, log: out, receiptFile: file});
    out("");
    if (r.rows.length > 0) out(table(r.rows));
    for (const row of r.rows) for (const n of row.notes) out(`  ${row.cls}: ${n}`);
    out(`\nOSG side: ${r.osgMode === "run" ? "ABAP Unit run on this runtime (tools/osd-unit.mjs)"
      : "FOR TESTING methods counted from the source (abaplint parse); not run"}`);
    for (const p of r.problems) out(`FAIL ${p}`);
    out(verdict(r));
    return r.ok ? 0 : r.refused ? 2 : 1;
  } catch (e) {
    out(`${e.code ?? "ERROR"}: ${e.message}`);
    return e.code === "REFUSED" ? 2 : 1;
  } finally {
    if (givenMcp === undefined) mcp.close?.();
  }
}

if (runsAs("osd-prove-on-system.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
