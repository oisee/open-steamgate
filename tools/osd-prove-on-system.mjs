// The same ABAP Unit on OSG and on a sandbox system, in one command.
//
//   node tools/osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json]
//        [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <name>]
//   node tools/osd-prove-on-system.mjs <folder> --unit <unit> --cleanup --package $ZOSG_TMP_X
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
// **It deletes only what it brought.** The package must not exist when the
// run starts -- the run creates it and so owns it -- and no object of the
// zip may exist anywhere. The cleanup does not purge: it hands exactly the
// zip's objects found in that package to abapGit's object layer, deletes
// the repository row (only the tool's own, `OSDPROVE <package>`, with the
// key this run imported into), and deletes the package only when nothing
// else and no subpackage is in it.
//
// The steps, each a small MCP call, because a long call can be cut by
// "context canceled":
//   1. zip the folder (tools/osd-abapgit-zip.mjs, fail closed on the unit);
//   2. preflight: refuse (exit 2) when the package exists or an object of
//      the zip exists already;
//   3. create the local package (`create DEVC`);
//   4. import with abapGit (`analyze execute_abap`) into the tool's own
//      offline repository, recording its key;
//   5. read SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class;
//   6. ABAP Unit per class (`test CLAS`), compared by method identity
//      (test class -> method), not by count;
//   7. cleanup as above; anything left fails the run (exit 1) and is listed.
//
// Missing evidence is never a pass: no status, no class-check entry, a unit
// result that is not JSON or does not name the class, an unnamed test
// method with an alert, a report without its end marker, a zip without
// classes, or no test method run on the system all fail the run.
//
// `execute_abap` prints nothing a caller can read: the program's result
// comes back as the title of a failed assertion. So every snippet ends with
// `cl_abap_unit_assert=>fail( msg = ... )`, and the message is framed by
// MARK_OPEN / MARK_CLOSE so it is found in vsp's text whatever surrounds it
// ("no output captured" is normal and means nothing).
import {spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import * as abaplint from "@abaplint/core";
import {runsAs} from "./osd-main.mjs";
import {layout, zipInProcess} from "./osd-abapgit-zip.mjs";
import {loadManifest, unitFor} from "./osd-deploy-manifest.mjs";

export const MARK_OPEN = "OSDPROVE<<";
export const MARK_CLOSE = ">>OSDPROVE";
export const DEFAULT_PACKAGE = "$ZOSG_TMP_PROVE";
const B64_LINE = 200;
// abapGit log messages carried back in one alert title; the rest are counted
const MAX_LOG = 20;

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

const CLASS_NAME = /^[A-Z0-9_/]{1,30}$/;

// ----------------------------------------------------------------- templates
// ASCII only, and every one ends with the fail( msg ) report.

const report = (expr) => `cl_abap_unit_assert=>fail( msg = |${MARK_OPEN}{ ${expr} }${MARK_CLOSE}| ).`;

/** The offline repository this tool creates is named so it can tell it
 *  from anybody else's: a repository in the package under any other name
 *  is not ours to deserialise into or to delete. */
export function ownRepoName(pkg) {
  return `OSDPROVE ${pkg}`;
}

const REPO_KEY = /^[0-9]{1,12}$/;

/** Step 3: base64 zip -> abapGit offline repo in `pkg` -> deserialize. */
export function importAbap(zipBytes, pkg) {
  const b64 = Buffer.from(zipBytes).toString("base64");
  const lines = [];
  for (let i = 0; i < b64.length; i += B64_LINE) lines.push(`APPEND \`${b64.slice(i, i + B64_LINE)}\` TO lt_b64.`);
  return [
    "DATA lt_b64 TYPE string_table.",
    "DATA lv_out TYPE string.",
    "DATA lv_logs TYPE i.",
    ...lines,
    "DATA(lv_b64) = concat_lines_of( table = lt_b64 ).",
    "DATA(lv_zip) = cl_http_utility=>decode_x_base64( lv_b64 ).",
    "DATA(li_log) = CAST zif_abapgit_log( NEW zcl_abapgit_log( ) ).",
    "TRY.",
    "    DATA(lt_files) = zcl_abapgit_zip=>load( lv_zip ).",
    "    lv_out = |files={ lines( lt_files ) };|.",
    "    DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    `    IF li_repo IS BOUND AND li_repo->get_name( ) <> '${ownRepoName(pkg)}'.`,
    "      lv_out = |{ lv_out } ERR the package has repository { li_repo->get_key( ) } named { li_repo->get_name( ) }, not this tool's;|.",
    "    ELSE.",
    "      IF li_repo IS NOT BOUND.",
    "        li_repo = zcl_abapgit_repo_srv=>get_instance( )->new_offline(",
    `          iv_name = '${ownRepoName(pkg)}' iv_package = '${pkg}' ).`,
    "      ENDIF.",
    "      lv_out = |{ lv_out } repo={ li_repo->get_key( ) };|.",
    "      li_repo->set_files_remote( lt_files ).",
    "      DATA(ls_checks) = li_repo->deserialize_checks( ).",
    "      \" abapGit lists new objects here too (action add, measured on A4H);",
    "      \" the package is new and the preflight found none of the zip's",
    "      \" objects, so any other action is an object that appeared since,",
    "      \" not ours: refuse rather than overwrite it",
    "      DATA lv_foreign TYPE abap_bool.",
    "      LOOP AT ls_checks-overwrite ASSIGNING FIELD-SYMBOL(<ls_o>).",
    "        \" the package itself was created by this run; its package.devc.xml",
    "        \" updates it (action update, measured on A4H)",
    `        IF <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-add OR ( <ls_o>-obj_type = 'DEVC' AND <ls_o>-obj_name = '${pkg}' ).`,
    "          <ls_o>-decision = zif_abapgit_definitions=>c_yes.",
    "        ELSE.",
    "          lv_foreign = abap_true.",
    "          lv_out = |{ lv_out } ERR would overwrite { <ls_o>-obj_type } { <ls_o>-obj_name } (action { <ls_o>-action });|.",
    "        ENDIF.",
    "      ENDLOOP.",
    "      IF lv_foreign = abap_true.",
    "        lv_out = |{ lv_out } import refused;|.",
    "      ELSE.",
    "        LOOP AT ls_checks-warning_package ASSIGNING FIELD-SYMBOL(<ls_w>).",
    "          <ls_w>-decision = zif_abapgit_definitions=>c_no.",
    "        ENDLOOP.",
    "        ls_checks-requirements-decision = zif_abapgit_definitions=>c_yes.",
    "        ls_checks-dependencies-decision = zif_abapgit_definitions=>c_yes.",
    "        li_repo->deserialize( is_checks = ls_checks ii_log = li_log ).",
    "        lv_out = |{ lv_out } status={ li_log->get_status( ) };|.",
    "      ENDIF.",
    "    ENDIF.",
    "  CATCH cx_root INTO DATA(lx).",
    "    lv_out = |{ lv_out } ERR { cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) };|.",
    "ENDTRY.",
    "LOOP AT li_log->get_messages( ) INTO DATA(ls_m) WHERE type = 'E' OR type = 'W' OR type = 'A'.",
    "  lv_logs = lv_logs + 1.",
    `  IF lv_logs <= ${MAX_LOG}.`,
    "    lv_out = |{ lv_out } [{ ls_m-type }] { ls_m-obj_type } { ls_m-obj_name }: { ls_m-text };|.",
    "  ENDIF.",
    "ENDLOOP.",
    "lv_out = |{ lv_out } logs={ lv_logs };|.",
    `SELECT object, obj_name FROM tadir WHERE devclass = '${pkg}' INTO TABLE @DATA(lt_tadir).`,
    "lv_out = |{ lv_out } tadir={ lines( lt_tadir ) };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

/** Step 4: SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class. */
export function classCheckAbap(classes) {
  return [
    "DATA lt_cls TYPE string_table.",
    "DATA lv_out TYPE string.",
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
    "  lv_out = |{ lv_out } { lv_cls } found={ lv_found } wut={ lv_wut } ccau={ lines( lt_src ) };|.",
    "ENDLOOP.",
    report("lv_out"),
  ].join("\n") + "\n";
}

// how many rows one alert title lists; a list that is longer is counted
// and not shown, and a check that needs the list fails rather than guess
const MAX_LIST = 200;

const OBJECT_ITEM = /^[A-Z0-9]{4} [A-Z0-9_/]{1,40}$/;

function checkItems(items) {
  for (const i of items) if (!OBJECT_ITEM.test(i)) throw new Error(`object "${i}" cannot be put into an ABAP literal`);
}

/** Step 2, the preflight: nothing is changed. Does the package exist, has
 *  it a repository, and does any object of the zip exist already (in any
 *  package)? */
export function preflightAbap(pkg, items) {
  checkItems(items);
  return [
    "DATA lv_out TYPE string.",
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lv_n TYPE i.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    ...items.map((i) => `APPEND \`${i}\` TO lt_items.`),
    `SELECT COUNT(*) FROM tdevc WHERE devclass = '${pkg}' INTO @DATA(lv_devc).`,
    "lv_out = |tdevc={ lv_devc };|.",
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "    IF li_repo IS BOUND.",
    "      lv_out = |{ lv_out } repo={ li_repo->get_key( ) }; repo_name={ li_repo->get_name( ) };|.",
    "    ELSE.",
    "      lv_out = |{ lv_out } repo=none;|.",
    "    ENDIF.",
    "  CATCH cx_root INTO DATA(lx).",
    "    lv_out = |{ lv_out } ERR { lx->get_text( ) };|.",
    "ENDTRY.",
    "LOOP AT lt_items INTO DATA(lv_item).",
    "  SPLIT lv_item AT space INTO lv_type lv_name.",
    "  SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "    INTO @DATA(lv_where).",
    "  IF sy-subrc = 0.",
    "    lv_n = lv_n + 1.",
    `    IF lv_n <= ${MAX_LIST}.`,
    "      lv_out = |{ lv_out } exists={ lv_type }:{ lv_name }@{ lv_where };|.",
    "    ENDIF.",
    "  ENDIF.",
    "ENDLOOP.",
    "lv_out = |{ lv_out } existing={ lv_n };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

/** Step 7, the cleanup, in one snippet so nothing changes between the
 *  check and the delete:
 *   a. the package's repository, if any, must be the tool's own by name and,
 *      when `expectedKey` is given, the one this run imported into -- else
 *      nothing at all is deleted;
 *   b. each object of the zip whose TADIR row is in this package goes into
 *      one list for zcl_abapgit_objects=>delete (abapGit's object layer,
 *      which deletes them one by one in dependency order and commits each);
 *      an object of the zip in another package, or one that is not there,
 *      is reported and not touched; nothing outside the zip's list is ever
 *      handed to it;
 *   c. the repository row is deleted with zcl_abapgit_repo_srv->delete,
 *      which removes the persisted repository and no object;
 *   d. the package is deleted (abapGit's DEVC object, which deletes only an
 *      empty package) only if TADIR holds nothing else under it and TDEVC
 *      has no subpackage of it; otherwise it is kept and what is there is
 *      listed. Subpackages are never deleted. */
export function cleanupAbap(pkg, items, expectedKey) {
  checkItems(items);
  if (expectedKey !== undefined && expectedKey !== "" && !REPO_KEY.test(expectedKey)) throw new Error(`not a repository key: ${expectedKey}`);
  const keyCheck = expectedKey === undefined ? "" : `li_repo->get_key( ) <> '${expectedKey}' OR `;
  return [
    "DATA lv_out TYPE string.",
    "DATA lv_go TYPE abap_bool VALUE abap_true.",
    "DATA lt_items TYPE string_table.",
    "DATA lv_type TYPE tadir-object.",
    "DATA lv_name TYPE tadir-obj_name.",
    "DATA lt_tadir TYPE zif_abapgit_definitions=>ty_tadir_tt.",
    "DATA ls_tadir TYPE zif_abapgit_definitions=>ty_tadir.",
    "DATA lv_key TYPE zif_abapgit_persistence=>ty_value.",
    "DATA lv_n TYPE i.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "DATA(li_log) = CAST zif_abapgit_log( NEW zcl_abapgit_log( ) ).",
    ...items.map((i) => `APPEND \`${i}\` TO lt_items.`),
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "  CATCH cx_root INTO DATA(lx).",
    "    lv_out = |ERR repository lookup: { lx->get_text( ) };|.",
    "    lv_go = abap_false.",
    "ENDTRY.",
    `IF li_repo IS BOUND AND ( ${keyCheck}li_repo->get_name( ) <> '${ownRepoName(pkg)}' ).`,
    "  lv_out = |{ lv_out } ERR refused: repository { li_repo->get_key( ) } named { li_repo->get_name( ) } is not the one this run imported into;|.",
    "  lv_go = abap_false.",
    "ENDIF.",
    "IF lv_go = abap_true.",
    "  LOOP AT lt_items INTO DATA(lv_item).",
    "    SPLIT lv_item AT space INTO lv_type lv_name.",
    "    SELECT SINGLE * FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "      INTO @DATA(ls_db).",
    "    IF sy-subrc <> 0.",
    "      lv_out = |{ lv_out } absent={ lv_type }:{ lv_name };|.",
    `    ELSEIF ls_db-devclass <> '${pkg}'.`,
    "      lv_out = |{ lv_out } elsewhere={ lv_type }:{ lv_name }@{ ls_db-devclass };|.",
    "    ELSE.",
    "      CLEAR ls_tadir.",
    "      MOVE-CORRESPONDING ls_db TO ls_tadir.",
    "      APPEND ls_tadir TO lt_tadir.",
    "    ENDIF.",
    "  ENDLOOP.",
    "  lv_out = |{ lv_out } to_delete={ lines( lt_tadir ) };|.",
    "  TRY.",
    "      zcl_abapgit_objects=>delete( it_tadir = lt_tadir ii_log = li_log ).",
    "    CATCH cx_root INTO DATA(lx2).",
    "      lv_out = |{ lv_out } ERR delete: { lx2->get_text( ) };|.",
    "  ENDTRY.",
    "  LOOP AT li_log->get_messages( ) INTO DATA(ls_m) WHERE type = 'E' OR type = 'A'.",
    "    lv_n = lv_n + 1.",
    `    IF lv_n <= ${MAX_LOG}.`,
    "      lv_out = |{ lv_out } [{ ls_m-type }] { ls_m-obj_type } { ls_m-obj_name }: { ls_m-text };|.",
    "    ENDIF.",
    "  ENDLOOP.",
    "  IF li_repo IS BOUND.",
    "    lv_key = li_repo->get_key( ).",
    "    TRY.",
    "        zcl_abapgit_repo_srv=>get_instance( )->delete( li_repo ).",
    "        COMMIT WORK.",
    "        lv_out = |{ lv_out } repo_deleted={ lv_key };|.",
    "      CATCH cx_root INTO DATA(lx3).",
    "        lv_out = |{ lv_out } ERR repo delete: { lx3->get_text( ) };|.",
    "    ENDTRY.",
    "  ENDIF.",
    "ENDIF.",
    // what is left, read from the database whatever happened above
    "DATA lv_repos TYPE i.",
    "IF lv_key IS NOT INITIAL.",
    "  DATA(lv_tab) = zcl_abapgit_persistence_db=>c_tabname.",
    "  SELECT COUNT(*) FROM (lv_tab) WHERE type = @zcl_abapgit_persistence_db=>c_type_repo",
    "    AND value = @lv_key INTO @lv_repos.",
    "ENDIF.",
    "lv_out = |{ lv_out } repo_left={ lv_repos };|.",
    "DATA lv_items_left TYPE i.",
    "LOOP AT lt_items INTO lv_item.",
    "  SPLIT lv_item AT space INTO lv_type lv_name.",
    "  SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    `    AND devclass = '${pkg}' INTO @DATA(lv_dummy).`,
    "  IF sy-subrc = 0.",
    "    lv_items_left = lv_items_left + 1.",
    "    lv_out = |{ lv_out } item_left={ lv_type }:{ lv_name };|.",
    "  ENDIF.",
    "ENDLOOP.",
    "lv_out = |{ lv_out } items_left={ lv_items_left };|.",
    `SELECT object, obj_name FROM tadir WHERE devclass = '${pkg}'`,
    `  AND NOT ( object = 'DEVC' AND obj_name = '${pkg}' ) INTO TABLE @DATA(lt_rest).`,
    "lv_out = |{ lv_out } others={ lines( lt_rest ) };|.",
    "lv_n = 0.",
    "LOOP AT lt_rest INTO DATA(ls_r).",
    "  lv_n = lv_n + 1.",
    `  IF lv_n <= ${MAX_LIST}.`,
    "    lv_out = |{ lv_out } other={ ls_r-object }:{ ls_r-obj_name };|.",
    "  ENDIF.",
    "ENDLOOP.",
    `SELECT devclass FROM tdevc WHERE parentcl = '${pkg}' INTO TABLE @DATA(lt_children).`,
    "lv_out = |{ lv_out } children={ lines( lt_children ) };|.",
    "LOOP AT lt_children INTO DATA(ls_child).",
    "  lv_out = |{ lv_out } child={ ls_child-devclass };|.",
    "ENDLOOP.",
    "IF lv_go = abap_true AND lt_rest IS INITIAL AND lt_children IS INITIAL.",
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
    "    CATCH cx_root INTO DATA(lx4).",
    "      lv_out = |{ lv_out } ERR package delete: { lx4->get_text( ) };|.",
    "  ENDTRY.",
    "ENDIF.",
    `SELECT COUNT(*) FROM tdevc WHERE devclass = '${pkg}' INTO @DATA(lv_devc).`,
    "lv_out = |{ lv_out } tdevc_left={ lv_devc };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

// ------------------------------------------------------------------- parsing

/** The framed message of a snippet's fail( ), or undefined when vsp's text
 *  carries none (the program did not reach its last line). A message whose
 *  end marker is missing is returned as truncated, and a caller fails it. */
export function reportOf(text) {
  const s = String(text);
  const i = s.indexOf(MARK_OPEN);
  if (i < 0) return undefined;
  const j = s.indexOf(MARK_CLOSE, i);
  if (j < 0) return {message: s.slice(i + MARK_OPEN.length).split("\n")[0], truncated: true};
  return {message: s.slice(i + MARK_OPEN.length, j), truncated: false};
}

const field = (msg, name) => new RegExp(`(?:^|\\s|;)${name}=([^;\\s]*)`).exec(msg)?.[1];

export function parseImport(msg) {
  const logs = [...msg.matchAll(/\[([EWA])\] ([^;]*);/g)].map((m) => ({type: m[1], text: m[2].trim()}));
  const err = /ERR ([^;]*);/.exec(msg)?.[1];
  return {
    files: Number(field(msg, "files") ?? NaN),
    repo: field(msg, "repo"),
    status: field(msg, "status"),
    err,
    logs,
    logCount: Number(field(msg, "logs") ?? NaN),
    tadir: Number(field(msg, "tadir") ?? NaN),
  };
}

const pairs = (msg, name) => [...msg.matchAll(new RegExp(`(?:^|\\s|;)${name}=([A-Z0-9]+):([^;@]*)(?:@([^;]*))?;`, "g"))]
  .map((m) => ({item: `${m[1]} ${m[2].trim()}`, where: m[3]?.trim()}));

export function parsePreflight(msg) {
  return {
    err: /ERR ([^;]*);/.exec(msg)?.[1],
    tdevc: Number(field(msg, "tdevc") ?? NaN),
    repo: field(msg, "repo"),
    repoName: /repo_name=([^;]*);/.exec(msg)?.[1]?.trim(),
    existing: Number(field(msg, "existing") ?? NaN),
    exists: pairs(msg, "exists"),
  };
}

export function parseClassCheck(msg) {
  const out = new Map();
  for (const m of msg.matchAll(/([A-Z0-9_/]+) found=(\d+) wut=(\S*) ccau=(\d+);/g)) {
    out.set(m[1], {found: m[2] === "0", wut: m[3] === "X", ccau: Number(m[4])});
  }
  return out;
}

export function parseCleanup(msg) {
  return {
    err: [...msg.matchAll(/ERR ([^;]*);/g)].map((m) => m[1]),
    logs: [...msg.matchAll(/\[([EA])\] ([^;]*);/g)].map((m) => `[${m[1]}] ${m[2].trim()}`),
    toDelete: Number(field(msg, "to_delete") ?? NaN),
    absent: pairs(msg, "absent").map((p) => p.item),
    elsewhere: pairs(msg, "elsewhere"),
    repoLeft: Number(field(msg, "repo_left") ?? NaN),
    itemsLeft: Number(field(msg, "items_left") ?? NaN),
    itemLeft: pairs(msg, "item_left").map((p) => p.item),
    others: Number(field(msg, "others") ?? NaN),
    other: pairs(msg, "other").map((p) => p.item),
    children: Number(field(msg, "children") ?? NaN),
    child: [...msg.matchAll(/child=([^;]*);/g)].map((m) => m[1].trim()),
    tdevcLeft: Number(field(msg, "tdevc_left") ?? NaN),
  };
}

/** ADT's unit result as vsp returns it: classes[].testMethods[], a failure
 *  carries alerts[] with a title. `error` is set when the text is not JSON
 *  or the class is not in it: no evidence, which is never a pass. */
export function parseUnit(text, className) {
  const s = String(text);
  const i = s.indexOf("{");
  let json;
  try {
    if (i < 0) throw new Error("no JSON");
    json = JSON.parse(s.slice(i));
  } catch {
    return {methods: 0, failing: [], error: `unit result is not JSON: ${s.slice(0, 200)}`};
  }
  const classes = (Array.isArray(json.classes) ? json.classes : [])
    .filter((c) => String(c.parentName ?? "").toUpperCase() === className);
  if (classes.length === 0) {
    return {methods: 0, failing: [], error: `the unit result names no test class of ${className}`};
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
export function buildZip(folder, {unit: unitName, manifest} = {}) {
  const unit = unitFor(loadManifest(manifest), folder, unitName);
  const work = mkdtempSync(join(tmpdir(), "osd-prove-"));
  try {
    const staging = join(work, "repo");
    const laid = layout(folder, staging, `open-steamgate prove: ${basename(resolve(folder))}`, undefined, unit);
    const objects = [];
    for (const [type, names] of laid.objects) for (const n of names) objects.push(objectKey(type, n));
    objects.sort();
    const classes = objects.filter((o) => o.startsWith("CLAS ")).map((o) => o.slice(5));
    return {bytes: zipInProcess(staging), objects, classes, unit: unit.name};
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

// --------------------------------------------------------------------- run

async function exec(mcp, code, step) {
  const text = await mcp.call("analyze", undefined, {type: "execute_abap", code});
  const r = reportOf(text);
  if (r === undefined) {
    throw Object.assign(new Error(`${step}: the system sent no report (the snippet did not reach its fail( )): `
      + String(text).slice(0, 600)), {code: "NO_REPORT"});
  }
  if (r.truncated) {
    throw Object.assign(new Error(`${step}: the report has no end marker, so it may be cut: ${r.message.slice(0, 300)}`),
      {code: "TRUNCATED"});
  }
  return r;
}

/** What the package holds, read and checked for completeness. Throws when
 *  the answer cannot be relied on. */
const listed = (list) => list.map((o) => `    ${o}`).join("\n");

/** Step 2: refusals before anything is written. The package must not
 *  exist: the run creates it and so owns it. No object of the zip may exist
 *  yet, in any package: an import would take it over. */
export async function preflight(mcp, pkg, items) {
  const r = await exec(mcp, preflightAbap(pkg, items), "preflight");
  const p = parsePreflight(r.message);
  const refusals = [];
  if (p.err !== undefined) refusals.push(`refused: preflight: ${p.err}`);
  if (Number.isNaN(p.tdevc) || p.repo === undefined || Number.isNaN(p.existing)) {
    return [`refused: preflight: the report is incomplete: ${r.message.trim()}`];
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

/** Step 7: delete the zip's objects in the package, the repository row, and
 *  the package if nothing else is in it (cleanupAbap says how). Returns the
 *  problems; anything left is one. */
export async function cleanup(mcp, pkg, items, {expectedKey, standalone = false, log = () => {}} = {}) {
  if (!standalone && expectedKey === undefined) {
    // without the key of this run's import the repository cannot be told from
    // one that appeared since; the snippet then refuses any repository at all
    expectedKey = "";
  }
  let r;
  try {
    r = await exec(mcp, cleanupAbap(pkg, items, standalone ? undefined : expectedKey), "cleanup");
  } catch (e) {
    return {ok: false, problems: [`cleanup: ${e.message}`]};
  }
  const c = parseCleanup(r.message);
  log(`cleanup: ${r.message.trim()}`);
  const problems = [];
  for (const e of c.err) problems.push(`cleanup: ${e}`);
  for (const l of c.logs) problems.push(`cleanup log ${l}`);
  for (const e of c.elsewhere) problems.push(`cleanup: ${e.item} is in package ${e.where}, not ${pkg}; not touched`);
  for (const [name, n] of [["repository", c.repoLeft], ["object(s) of the zip", c.itemsLeft]]) {
    if (!(n === 0)) problems.push(`cleanup incomplete: ${Number.isNaN(n) ? "unknown number of" : n} ${name} left`);
  }
  if (c.itemLeft.length) problems.push(`cleanup: left in ${pkg}:\n${listed(c.itemLeft)}`);
  if (!(c.others === 0) || !(c.children === 0)) {
    problems.push(`cleanup: package ${pkg} kept, it holds what this run did not bring`
      + (c.others > 0 ? `\n  ${c.others} object(s):\n${listed(c.other)}` : "")
      + (c.children > 0 ? `\n  ${c.children} subpackage(s):\n${listed(c.child)}` : "")
      + (Number.isNaN(c.others) || Number.isNaN(c.children) ? "\n  (the report does not say what)" : ""));
  } else if (!(c.tdevcLeft === 0)) {
    problems.push(`cleanup incomplete: package ${pkg} ${Number.isNaN(c.tdevcLeft) ? "may be" : "is"} still there`);
  }
  return {ok: problems.length === 0, problems, parsed: c};
}

/** The import's evidence, checked: a parsed status of S, or W with its W
 *  messages carried back and shown (W passes then: abapGit's W is a
 *  warning about an object that was still deserialised); E, A, no status,
 *  an unknown status, an exception, or messages not carried back fail. */
export function judgeImport(imp) {
  const problems = [];
  if (imp.err !== undefined) problems.push(`import failed: ${imp.err}`);
  if (imp.status === undefined) problems.push("import: the report carries no abapGit status");
  else if (imp.status === "W") {
    if (!imp.logs.some((l) => l.type === "W")) problems.push("import status W with no W message carried back");
  } else if (imp.status !== "S") problems.push(`import status ${imp.status}`);
  for (const l of imp.logs) if (l.type !== "W") problems.push(`import log [${l.type}] ${l.text}`);
  if (Number.isNaN(imp.logCount)) problems.push("import: the report carries no log count");
  else if (imp.logCount > imp.logs.length) {
    problems.push(`import log: ${imp.logCount - imp.logs.length} more message(s) not carried back`);
  }
  if (Number.isNaN(imp.tadir)) problems.push("import: the report carries no TADIR count");
  return problems;
}

/** Steps 1-6. `mcp` is {call(action, target, params) -> text}; `osg` is a
 *  provider ({mode, methods(cls)}); `zipper` builds the zip. */
export async function prove({folder, unit, manifest, pkg = DEFAULT_PACKAGE, keep = false, mcp, osg,
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
  // the zip's objects this run may delete: none until the import has written
  // them. An import refused because a zip-named object appeared in the
  // package after the preflight wrote nothing of ours, so the cleanup then
  // deletes no object at all (critic round 6), only our repository row and,
  // if it is empty, the package
  let ours = [];
  try {
    try {
      const r = await exec(mcp, importAbap(built.bytes, pkg), "import");
      log(`import: ${r.message.trim()}`);
      if (!/import refused;/.test(r.message)) ours = built.objects;
      const imp = parseImport(r.message);
      if (imp.repo !== undefined && REPO_KEY.test(imp.repo)) importedKey = imp.repo;
      else problems.push("import: the report carries no repository key");
      problems.push(...judgeImport(imp));
    } catch (e) {
      problems.push(e.message);
    }

    let check = new Map();
    if (problems.length === 0) {
      try {
        const r = await exec(mcp, classCheckAbap(classes), "class check");
        check = parseClassCheck(r.message);
        log(`classes: ${r.message.trim()}`);
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
          {object_url: `/sap/bc/adt/oo/classes/${encodeURIComponent(cls.toLowerCase())}`, include_dangerous: true});
        const there = parseUnit(text, cls);
        row.system = there.methods;
        row.failing = there.failing;
        if (there.error !== undefined) problems.push(`${cls}: ${there.error}`);
        if (there.nameless > 0) row.notes.push(`${there.nameless} test method entr(ies) without a name, not counted`);
        // the same tests, by name: a count can match with different methods behind it
        const diff = methodDiff(here.names, there.names);
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
  } finally {
    if (keep) {
      log(`--keep: package ${pkg} and its objects are left on the system. Remove them with\n`
        + `  node tools/osd-prove-on-system.mjs ${folder} --unit ${unit}${manifest ? ` --manifest ${manifest}` : ""} `
        + `--cleanup --package '${pkg}'`);
    } else {
      const c = await cleanup(mcp, pkg, ours, {expectedKey: importedKey, log});
      problems.push(...c.problems);
    }
  }
  return done();
}

/** The last line says what was established, and no more: only a run on
 *  both sides may say the same tests pass on both. */
export function verdict(r) {
  if (!r.ok) return `NOT proved: ${r.problems.length} problem(s)`;
  if (r.osgMode === "run") return `proved: the same ${r.systemMethods} tests pass on OSG and on the system`;
  return `system: ${r.systemMethods} tests pass; OSG: ${r.osgMethods} test methods counted from source, not run`;
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
  server = process.env.OSD_MCP_SERVER, timeoutMs = 600000} = {}) {
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
      // the whole text: a truncated response is the failure mode measured on A4H
      const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n") || JSON.stringify(r.error ?? r);
      return r.result?.isError || r.error ? `ERROR: ${text}` : text;
    },
    close() { child?.kill(); },
  };
}

// --------------------------------------------------------------------- CLI

export async function main(argv, {mcp: givenMcp, out = console.log} = {}) {
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
  if (folder === undefined) {
    out("usage: osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json] [--package $ZOSG_TMP_X] [--keep] "
      + "[--osg count|run] [--server <mcp server>]\n"
      + "       osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json] --cleanup --package $ZOSG_TMP_X");
    return 2;
  }
  const mcp = givenMcp ?? mcpStdio({server: flag("server")});
  try {
    if (argv.includes("--cleanup")) {
      // the zip's object list is what may be deleted, so the folder is needed here too
      const built = buildZip(folder, {unit: flag("unit"), manifest: flag("manifest")});
      const c = await cleanup(mcp, pkg, built.objects, {standalone: true, log: out});
      for (const p of c.problems) out(`FAIL ${p}`);
      out(c.ok ? `cleanup of ${pkg}: complete` : `cleanup of ${pkg}: INCOMPLETE`);
      return c.ok ? 0 : 1;
    }
    const osg = flag("osg") === "run" ? osgRunner() : osgCounter(folder);
    const r = await prove({folder, unit: flag("unit"), manifest: flag("manifest"), pkg, keep: argv.includes("--keep"),
      mcp, osg, log: out});
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
