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
// run reads `git_object_versions` (sha256 asked for) for every object the
// import wrote into the package and writes a receipt,
// `.local/prove-runs/<package>.json`. The cleanup -- the run's own, or
// `--cleanup` later -- is ONE vsp `git_delete_objects` call: every receipt
// object with `expect: {sha256}`, which vsp checks under the lock its DELETE
// takes (an object that is another version, or has an inactive one, comes
// back `changed` and is kept, with the repository and the package), and the
// repository row only when this run's import created it (`delete_repo` with
// `expect_repo {key, name}`, rechecked by ZADT_VSP in the step that deletes
// it). No receipt, no delete: the zip's object list alone never authorises
// one. vsp too old for this (no `git_object_versions`) is refused before
// anything is written, and there is no unconditional fallback.
//
// What vsp does (v2.58.0-72 or later, `MIN_VSP`) and what stays ours:
//   - the import is vsp's `git_import_zip` (abapGit on the system, as a
//     background job; overwrite false, so nothing that exists is touched);
//   - the versions and the conditional delete are vsp's (#320);
//   - the residue is read twice: vsp's `read DEVC <pkg> {inventory}` and our
//     own TADIR / repository / REPOSRC-and-DD count, and the two must agree;
//   - every snippet we still run (preflight, the residue count, the class
//     check) hands its result back with RETURN_VALUE( ) as a table
//     of rows, which vsp answers as JSON.
//
// The steps, each a small MCP call:
//   1. zip the folder (tools/osd-abapgit-zip.mjs, fail closed on the unit);
//   2. preflight: refuse (exit 2) when the package exists or an object of
//      the zip exists already, or when vsp has no `git_object_versions`;
//   3. create the local package (`create DEVC`);
//   4. `git_import_zip` into the tool's own offline repository, recording
//      its key and whether this import created it; then read the sha256 of
//      what it wrote and write the receipt;
//   5. read SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class;
//   6. ABAP Unit per class (`test CLAS`), compared by method identity
//      (test class -> method), not by count;
//   7. cleanup as above; anything left fails the run (exit 1) and is listed.
//
// Missing evidence is never a pass (no status, no class-check entry, a unit
// result that is not vsp's JSON, a snippet result without its end row, no test
// method run on the system): each fails the run.
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import * as abaplint from "@abaplint/core";
import {runsAs} from "./osd-main.mjs";
import {layout, zipInProcess} from "./osd-abapgit-zip.mjs";
import {loadManifest, unitFor} from "./osd-deploy-manifest.mjs";
import {proveInPlace, rollbackFromState, snapshotDir} from "./osd-prove-inplace.mjs";

/** The vsp this tool needs: execute_abap answering JSON with result_text and
 *  RETURN_VALUE( ), ABAP Unit with ok and counts, git_import_zip /
 *  git_import_status, `git_object_versions`, `git_delete_objects` with `expect`
 *  and `expect_repo`, and `read DEVC` with inventory. */
export const MIN_VSP = "vsp v2.58.0-72 (vibing-steampunk #320: git_object_versions and expect on git_delete_objects)";
export const DEFAULT_PACKAGE = "$ZOSG_TMP_PROVE";
export const B64_LINE = 200;
export const MAX_LOG = 20;
export const CALL_TIMEOUT = 300;
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
const SHA256 = /^[0-9a-f]{64}$/;
/** How many objects one git_object_versions call may name (vsp: 500). */
const MAX_VERSIONS = 500;

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

// a name may hold inner spaces: abapGit pads the registration objects of a
// service (IWSV, IWMO) to a fixed width before their version, and TADIR keeps
// them so; the snippets put an item in a backtick literal and SPLIT it at the
// first space, which leaves the padded name whole
export const OBJECT_ITEM = /^[A-Z0-9]{4} [A-Z0-9_/](?:[A-Z0-9_/ ]{0,38}[A-Z0-9_/])?$/;

export function checkItems(items) {
  for (const i of items) if (!OBJECT_ITEM.test(i)) throw new Error(`object "${i}" cannot be put into an ABAP literal`);
}

// ---------------------------------------------------------------- receipt
//
// A run receipt says which objects this run's import wrote into the package
// and what each was right after: its TADIR identity, and the sha256 (and the
// stamp, for the reader) vsp's `git_object_versions` reports. Only an object
// in the receipt is ever deleted, by the run's own cleanup or by `--cleanup`
// later, and vsp deletes it only while it still has the receipt's sha256
// (`expect`, read under the lock the DELETE takes). The zip's object list
// alone never authorises a delete.

// The residue read looks for source and dictionary rows of an object whose
// TADIR row is gone (STAMP_BLOCK: rows found, lv_stamp set).
const STAMP_DECLARATIONS = [
  "DATA lv_stamp TYPE string.",
  "DATA lv_max TYPE string.",
  "DATA lv_cnt TYPE i.",
  "DATA lv_d TYPE d.",
  "DATA lv_t TYPE t.",
  "DATA lt_incs TYPE zif_abapgit_oo_object_fnc=>ty_includes_tt.",
];

/** ABAP that sets lv_stamp for lv_type / lv_name (empty: no rows). A deleted
 *  object must have none left. */
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

/** The receipt's shape: 2 = sha256 versions of git_object_versions. A receipt
 *  without it (stamps and a content snippet) is not deleted by. */
export const RECEIPT_FORMAT = 2;

export function writeReceipt(file, receipt) {
  mkdirSync(join(file, ".."), {recursive: true});
  writeFileSync(file, JSON.stringify(receipt, undefined, 1) + "\n");
}

export function readReceipt(file) {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
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

/** One `git_object_versions` call (sha256 asked for): per object, vsp's
 *  answer as `{type, name, package, inPackage, stamp, sha256, sha256Error,
 *  inactive, ...}`, in the order asked. A throw that says why when vsp does
 *  not know the operation (an older vsp or ZADT_VSP: `needs ...`, code
 *  NEEDS_VSP), answers an error or something else than the objects asked
 *  about, or does not say whether an object has an inactive version. */
export async function objectVersions(mcp, pkg, items, {sha256 = true} = {}) {
  const needs = (why) => Object.assign(new Error(`git_object_versions: ${why}. The conditional delete needs ${MIN_VSP} `
    + "and the ZADT_VSP it installs (vsp install zadt-vsp); nothing is deleted without it, and never unconditionally"), {code: "NEEDS_VSP"});
  const out = [];
  for (let i = 0; i < items.length; i += MAX_VERSIONS) {
    const part = items.slice(i, i + MAX_VERSIONS);
    let json;
    try {
      let isError;
      ({json, isError} = jsonAnswer(await mcp.call("system", undefined, {type: "git_object_versions", package: pkg, objects: part, sha256}), "object versions"));
      if (isError) throw new Error(JSON.stringify(json).slice(0, 300));
    } catch (e) {
      throw needs(e.message.slice(0, 400));
    }
    if (!Array.isArray(json.objects) || json.objects.length !== part.length) throw needs(`${json.objects?.length ?? "no"} answer(s) for ${part.length} object(s)`);
    part.forEach((item, k) => {
      const o = json.objects[k];
      if (`${String(o?.type).trim().toUpperCase()} ${String(o?.name).trim().toUpperCase()}` !== item) throw needs(`the answer names ${o?.type} ${o?.name} where ${item} was asked`);
      if (typeof o.inactive !== "boolean") throw needs(`it does not say whether ${item} has an inactive version`);
      out.push(o);
    });
  }
  return out;
}

/** Right after the import: each object of the zip with the sha256 (and the
 *  stamp) vsp reads for it. An object with no version it can be deleted by
 *  (not in the package, no sha256, an inactive version) is not in the receipt
 *  and is named in `problems`; it will not be deleted. */
export async function receiptVersions(mcp, pkg, items) {
  const versions = [];
  const problems = [];
  for (const o of await objectVersions(mcp, pkg, items)) {
    const item = `${String(o.type).trim().toUpperCase()} ${String(o.name).trim().toUpperCase()}`;
    const here = String(o.package ?? "").trim();
    if (o.inPackage !== true && here === "") problems.push(`receipt: ${item} is not on the system after the import`);
    else if (o.inPackage !== true) problems.push(`receipt: ${item} is in package ${here}, not ${pkg}; not in the receipt, not touched`);
    else if (o.inactive) problems.push(`receipt: ${item} has an inactive version, which no sha256 covers; it will not be deleted`);
    else if (!SHA256.test(o.sha256 ?? "")) problems.push(`receipt: no sha256 for ${item}${o.sha256Error ? ` (${o.sha256Error})` : ""}; it will not be deleted`);
    else versions.push({item, devclass: pkg, sha256: o.sha256, stamp: o.stamp || undefined});
  }
  return {versions, problems};
}

// vsp deletes in the given order, and a table whose data element went first serialises
// with COMPTYPE N and comes back `changed` (A4H 2026-10-02): users before what they use
export const deleteRank = (type) => ({INTF: 1, DDLS: 2, SHLP: 3, ENQU: 3, TTYP: 4, VIEW: 5, TABL: 5, DTEL: 6, DOMA: 7})[type] ?? 0;

/** Step 7: one `git_delete_objects` call, users first (deleteRank). Each object goes
 *  with the receipt's `expect: {sha256}`: vsp locks, reads the version under the
 *  lock and deletes only on a match, else answers `changed` and keeps the object,
 *  the repository and the package. The repository row goes only when `createdKey`
 *  is this run's (`delete_repo` + `expect_repo`, rechecked by ZADT_VSP). With no
 *  receipt entry the one (skipped) item is the package, deleted only if empty.
 *  Then the residue is read twice. Returns the problems; anything left is one. */
export async function cleanup(mcp, pkg, entries, {expectedKey, createdKey, log = () => {}} = {}) {
  const dropRepo = createdKey !== undefined && REPO_KEY.test(createdKey) && createdKey === expectedKey;
  const problems = [];
  let asked;
  let params;
  let res;
  try {
    asked = entries.map((e) => {
      if (!OBJECT_ITEM.test(e.item) || !SHA256.test(e.sha256 ?? "")) throw new Error(`not a receipt entry: ${e.item}`);
      return {type: e.item.slice(0, 4), name: e.item.slice(5), expect: {sha256: e.sha256}};
    }).sort((a, b) => deleteRank(a.type) - deleteRank(b.type));
    params = {type: "git_delete_objects", package: pkg, objects: asked.length > 0 ? asked : [{type: "DEVC", name: pkg}]};
    if (dropRepo) Object.assign(params, {delete_repo: true, expect_repo: {key: createdKey, name: ownRepoName(pkg)}});
    const {json, isError} = jsonAnswer(await mcp.call("system", undefined, params), "delete");
    // a changed or failed object is an error answer that still carries the result
    res = isError ? json.result : json;
    if (res === undefined || !Array.isArray(res.objects)) throw new Error(`vsp answered no result: ${JSON.stringify(json).slice(0, 300)}`);
    log(`cleanup: ${res.objects.map((o) => `${o.type} ${o.name} ${o.status}`).join(", ")}`);
    if (isError && json.error) log(`cleanup: vsp's error text: ${json.error}`);
  } catch (e) {
    return {ok: false, problems: [`cleanup: ${e.message}`]};
  }
  const want = new Map(params.objects.map((o) => [`${o.type} ${o.name}`, o]));
  for (const o of res.objects) {
    const item = `${o.type} ${o.name}`;
    if (!want.delete(item)) problems.push(`cleanup: vsp answered for ${item}, which was not asked about`);
    else if (o.status === "changed") problems.push(`cleanup: ${item} changed since the import (${o.reason ?? "no reason given"}): a foreign edit; kept`);
    else if (o.status === "failed") problems.push(`cleanup: ${item} could not be deleted: ${o.reason ?? "no reason given"}`);
    else if (o.status === "skipped" && asked.length === 0) continue;
    else if (o.status === "skipped") problems.push(`cleanup: ${item} is not in ${pkg} any more (moved out of the package?)${o.reason ? `: ${o.reason}` : ""}; not touched`);
    else if (o.status !== "deleted") problems.push(`cleanup: ${item} came back ${o.status ?? "without a status"}${o.reason ? ` (${o.reason})` : ""}`);
  }
  for (const item of want.keys()) problems.push(`cleanup: vsp did not answer for ${item}`);
  if (res.repoDeleted === true) log(`cleanup: repository ${res.repo?.key ?? createdKey} (${ownRepoName(pkg)}) deleted`);
  else if (dropRepo && /registered repository is/.test(res.repoNote ?? "")) problems.push(`cleanup: repository ${createdKey}: ${res.repoNote}`);
  else if (res.repo?.key !== undefined && !dropRepo) {
    log(`cleanup: repository ${res.repo.key} is not one this run's import created${createdKey === undefined ? " (the receipt does not say it did)" : ""}; it is left registered, and the package with it`);
  }
  if (entries.length === 0) log("cleanup: no receipt entries, so no object was deleted");
  // what is left, read twice: our count, and vsp's inventory; they must agree
  let left;
  try {
    const r = await exec(mcp, residueAbap(pkg, entries.map((e) => e.item), expectedKey || undefined), "residue");
    left = parseResidue(r.rows);
    log(`residue: ${r.message}`);
  } catch (e) {
    problems.push(`residue: ${e.message}`);
    return {ok: false, problems};
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
  return {ok: problems.length === 0, problems, residue: left};
}

/** git_import_zip's answer, waited for: a job that is still pending after
 *  git_import_zip's own wait is asked about through git_import_status, a
 *  bounded number of times. Returns the last answer. */
export async function importZip(mcp, pkg, bytes, {poll = IMPORT_POLL, log = () => {}} = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let {json} = jsonAnswer(await mcp.call("system", undefined, {type: "git_import_zip", zip_base64: Buffer.from(bytes).toString("base64"),
    package: pkg, repo_name: ownRepoName(pkg), overwrite: false, wait_seconds: IMPORT_WAIT_SECONDS}), "import");
  for (let i = 0; i < poll.tries && (json.status === "pending" || json.status === "unknown") && /^[0-9]{6}[0-9A-Z]{2}$/.test(String(json.jobCount ?? "")); i += 1) {
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
  // fail closed before anything is written: no conditional delete, no import
  if (refusals.length === 0) {
    try {
      await objectVersions(mcp, pkg, built.objects.slice(0, 1), {sha256: false});
    } catch (e) {
      refusals = [`refused: ${e.message}`];
    }
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
        const got = await receiptVersions(mcp, pkg, built.objects);
        receipt = {format: RECEIPT_FORMAT, package: pkg, repoKey: importedKey, repoName: ownRepoName(pkg), repoCreated: createdKey !== undefined,
          objects: built.objects, versions: got.versions, written: new Date().toISOString()};
        writeReceipt(receiptFile, receipt);
        log(`receipt: ${receipt.versions.length} object(s) with their sha256, ${receiptFile}`);
        problems.push(...got.problems);
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
      const c = await cleanup(mcp, pkg, receipt?.versions ?? [], {expectedKey: importedKey, createdKey, log});
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
  if (receipt.package !== pkg || !REPO_KEY.test(receipt.repoKey ?? "")) {
    out(`refused: the receipt at ${file} is not a receipt for ${pkg}`);
    return 2;
  }
  if (receipt.format !== RECEIPT_FORMAT || !Array.isArray(receipt.versions) || !receipt.versions.every((v) => SHA256.test(v?.sha256 ?? ""))) {
    out(`refused: the receipt at ${file} was written by an older version (stamps, no sha256), which vsp's conditional delete cannot take. `
      + `Nothing is deleted; inspect ${pkg} by hand (SE80 / ADT, abapGit's repository list) and remove what this run brought.`);
    return 2;
  }
  if (receipt.repoCreated === undefined) {
    out(`note: the receipt does not record whether its run created repository ${receipt.repoKey} (older version), `
      + "so the row and the package are left; remove them by hand in abapGit if they are this tool's");
  }
  // an older vsp drops `expect` and `expect_repo` and deletes unconditionally: probe first
  try { await objectVersions(mcp, pkg, [receipt.versions[0]?.item ?? receipt.objects?.[0] ?? `DEVC ${pkg}`], {sha256: false}); } catch (e) { out(`refused: ${e.message}`); return 2; }
  const c = await cleanup(mcp, pkg, receipt.versions, {expectedKey: receipt.repoKey,
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
