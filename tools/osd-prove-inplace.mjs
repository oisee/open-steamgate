// osd-prove-on-system --in-place: prove a rewrite inside an existing package,
// then put the package back exactly as it was.
//
//   node tools/osd-prove-on-system.mjs --in-place --package $ZPKG <folder-with-AFTER> --unit <u> [--keep]
//   node tools/osd-prove-on-system.mjs --rollback --package $ZPKG        (needs the snapshot dir)
//
// Why (Alice, 2026-10-01): "if we have the original package and we are inside
// that perimeter, is that a sufficient perimeter for the output too?" Yes, if
// the perimeter is a SNAPSHOT and not the package. The snapshot is the
// package's objects, each serialised through abapGit, with a content hash
// (SHA-256 over abapGit's own file list). The run overwrites only objects that
// are in the snapshot and unchanged since it was taken, never touches
// anything that appeared later, and the snapshot is the rollback source:
//
//   1. snapshot: every TADIR object of the package is serialised by
//      zcl_abapgit_objects=>serialize; the files are fetched (in chunks, and
//      checked against the hash the system reported) and written under
//      `.local/prove-runs/<package>-snapshot/` (gitignored);
//   2. perimeter: every object of the AFTER zip must be in the snapshot, in
//      this package (no new objects in this mode: refused); every object of
//      the snapshot is hashed again right before the deploy and must still
//      equal its snapshot hash (refused otherwise); the deploy snippet hashes
//      once more inside the same call that deserialises, so nothing can slip
//      in between;
//   3. deploy through abapGit: an overwrite is approved only for an item of
//      that list, action update or overwrite, and nothing else;
//   4. the deployed version: the deploy snippet serialises and hashes the
//      AFTER objects again right after the deserialise, in the same dialog
//      step (the hash snippet's code), and an object is recorded as this
//      run's only when every file is the AFTER zip's (by hash, or as
//      normalised source / canonical XML) or, for XML and files the zip
//      lacks, unchanged since the snapshot (adoptDeployed);
//      then the same ABAP Unit comparison as the fresh-package mode;
//   5. rollback, always (`--keep` excepted): the objects whose current hash
//      equals the hash of the AFTER version this run deployed are re-imported
//      from the snapshot's files; an object someone else changed meanwhile is
//      refused and reported, never clobbered. Then EVERY object is hashed
//      again and must equal its snapshot hash; only then is the run
//      successful, the snapshot removed and the tool's repository row
//      deleted -- only a row this run created (`createdRepo` in the state,
//      from the deploy's own report), never one that was there before.
//
// Content hashes close the limits the fresh-package mode documents for its
// stamps (one-second resolution, active rows only): an edit in the same
// second, or a saved-but-inactive version, changes the serialised files.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {abapgitXml, zipInProcess} from "./osd-abapgit-zip.mjs";
import {
  B64_LINE, CLASS_NAME, MAX_LIST, MAX_LOG, OBJECT_ITEM, REPO_KEY, buildZip, checkItems, checkPackage, exec, field,
  judgeImport, listed, ownRepoName, pairs, parseImport, proveClasses, receiptPath, report,
} from "./osd-prove-on-system.mjs";

// ------------------------------------------------------------------- hashes

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** An object's content hash: SHA-256 over its files' names and SHA-256s,
 *  sorted by name, one `name=hex` per line. The paths are not part of it
 *  (abapGit's serialize answers `/` and the layout decides the folder). */
export function objectHash(files) {
  return sha256([...files].sort(byName).map((f) => `${f.name}=${f.sha256}\n`).join(""));
}

/** A file name that can sit in an ABAP literal and in a zip entry. */
const FILE_NAME = /^[A-Za-z0-9_.#%$+-]{1,120}$/;
const CHUNK_BYTES = 8000;
const BATCH = 12;

// ------------------------------------------------------------------ snippets
// ASCII only, every one ends with the fail( msg ) report, every value is
// validated before it is interpolated.

const SERIALIZE_DECLS = [
  "DATA lv_out TYPE string.",
  "DATA lt_items TYPE string_table.",
  "DATA lv_item TYPE string.",
  "DATA lv_type TYPE tadir-object.",
  "DATA lv_name TYPE tadir-obj_name.",
  "DATA lv_dev TYPE tadir-devclass.",
  "DATA ls_item TYPE zif_abapgit_definitions=>ty_item.",
  "DATA ls_ser TYPE zif_abapgit_objects=>ty_serialization.",
  "DATA ls_file TYPE zif_abapgit_git_definitions=>ty_file.",
  "DATA lv_hx TYPE xstring.",
  "DATA lv_n TYPE i.",
  "DATA lx_s TYPE REF TO cx_root.",
];

/** The lines that serialise lv_item (an item of lt_items) through abapGit and
 *  hash every file: absent / elsewhere when TADIR says so, then `onFile` per
 *  file, `onOk` after the last, `onFail` when abapGit or the digest raised.
 *  The same ABAP serves the hash report, the chunk reader and the deploy
 *  guard, so all three see the same bytes. */
function serializeBlock(pkg, {onFile = [], onOk = [], onFail = [], onMissing = [], prefix = ""}) {
  return [
    "SPLIT lv_item AT space INTO lv_type lv_name.",
    "SELECT SINGLE devclass FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name",
    "  INTO @lv_dev.",
    "IF sy-subrc <> 0.",
    `  lv_out = |{ lv_out } ${prefix}absent={ lv_type }:{ lv_name };|.`,
    ...onMissing.map((l) => `  ${l}`),
    `ELSEIF lv_dev <> '${pkg}'.`,
    `  lv_out = |{ lv_out } ${prefix}elsewhere={ lv_type }:{ lv_name }@{ lv_dev };|.`,
    ...onMissing.map((l) => `  ${l}`),
    "ELSE.",
    "  CLEAR: ls_item, ls_ser, lv_n.",
    "  ls_item-obj_type = lv_type.",
    "  ls_item-obj_name = lv_name.",
    "  ls_item-devclass = lv_dev.",
    "  ls_item-abap_language_version = '*'.",
    "  TRY.",
    "      ls_ser = zcl_abapgit_objects=>serialize(",
    "        is_item        = ls_item",
    "        io_i18n_params = zcl_abapgit_i18n_params=>new(",
    "          iv_main_language      = zif_abapgit_definitions=>c_english",
    "          iv_main_language_only = abap_true ) ).",
    "      LOOP AT ls_ser-files INTO ls_file.",
    "        cl_abap_message_digest=>calculate_hash_for_raw(",
    "          EXPORTING if_algorithm = 'SHA256' if_data = ls_file-data",
    "          IMPORTING ef_hashxstring = lv_hx ).",
    "        lv_n = lv_n + 1.",
    ...onFile.map((l) => `        ${l}`),
    "      ENDLOOP.",
    ...onOk.map((l) => `      ${l}`),
    "    CATCH cx_root INTO lx_s.",
    `      lv_out = |{ lv_out } ${prefix}fail={ lv_type }:{ lv_name }\\|{ lx_s->get_text( ) };|.`,
    ...onFail.map((l) => `      ${l}`),
    "  ENDTRY.",
    "ENDIF.",
  ];
}

const itemLines = (items) => items.map((i) => `APPEND \`${i}\` TO lt_items.`);

/** What the package holds and who versions it. Nothing is changed. */
export function listAbap(pkg) {
  return [
    "DATA lv_out TYPE string.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "DATA lv_n TYPE i.",
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
    `SELECT object, obj_name FROM tadir WHERE pgmid = 'R3TR' AND devclass = '${pkg}' AND object <> 'DEVC'`,
    "  INTO TABLE @DATA(lt_t).",
    "lv_out = |{ lv_out } items={ lines( lt_t ) };|.",
    "LOOP AT lt_t INTO DATA(ls_t).",
    "  lv_n = lv_n + 1.",
    `  IF lv_n <= ${MAX_LIST}.`,
    "    lv_out = |{ lv_out } item={ ls_t-object }:{ ls_t-obj_name };|.",
    "  ENDIF.",
    "ENDLOOP.",
    `SELECT COUNT(*) FROM tdevc WHERE parentcl = '${pkg}' INTO @DATA(lv_kids).`,
    "lv_out = |{ lv_out } children={ lv_kids };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

/** The hash report of every item of lt_items, as `[prefix]file=` and
 *  `[prefix]obj=` entries: one text for the hash snippet and for the
 *  post-deploy read inside the deploy snippet, so both report the same
 *  serialisation and the same digest. */
const hashLoop = (pkg, prefix = "") => [
  "LOOP AT lt_items INTO lv_item.",
  ...serializeBlock(pkg, {
    prefix,
    onFile: [`lv_out = |{ lv_out } ${prefix}file={ lv_type }:{ lv_name }\\|{ ls_file-filename }\\|{ lv_hx }\\|{ xstrlen( ls_file-data ) };|.`],
    onOk: [`lv_out = |{ lv_out } ${prefix}obj={ lv_type }:{ lv_name } files={ lv_n };|.`],
  }).map((l) => `  ${l}`),
  "ENDLOOP.",
];

/** The prefix of the post-deploy hash report inside the deploy snippet. */
export const DEPLOYED = "dep_";

/** The files of each item as abapGit serialises them now, with their
 *  SHA-256. Nothing is changed. */
export function hashAbap(pkg, items) {
  checkItems(items);
  return [
    ...SERIALIZE_DECLS,
    ...itemLines(items),
    ...hashLoop(pkg),
    report("lv_out"),
  ].join("\n") + "\n";
}

/** One slice of one file, as hex: the snapshot's content travels in pieces
 *  because a long answer can be cut. The file's own hash comes with each
 *  piece, so pieces of two different versions cannot be joined. */
export function chunkAbap(pkg, item, filename, offset, length) {
  checkItems([item]);
  if (!FILE_NAME.test(filename)) throw new Error(`file name "${filename}" cannot be put into an ABAP literal`);
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1 || length > CHUNK_BYTES) {
    throw new Error(`not a chunk: ${offset}+${length}`);
  }
  return [
    ...SERIALIZE_DECLS,
    "DATA lv_chunk TYPE xstring.",
    "DATA lv_found TYPE abap_bool.",
    ...itemLines([item]),
    "LOOP AT lt_items INTO lv_item.",
    ...serializeBlock(pkg, {
      onFile: [
        `IF ls_file-filename = '${filename}'.`,
        "  lv_found = abap_true.",
        `  lv_chunk = ls_file-data+${offset}(${length}).`,
        "  lv_out = |{ lv_out } fhash={ lv_hx }; chunk={ lv_chunk };|.",
        "ENDIF.",
      ],
    }).map((l) => `  ${l}`),
    "ENDLOOP.",
    "lv_out = |{ lv_out } found={ lv_found };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

const HEX = (s) => String(s).toUpperCase();

/** Deploy (AFTER) or restore (the snapshot's files) into the package, with
 *  the tool's own offline repository. `expected` is, per item that may be
 *  overwritten, the files and hashes it must have RIGHT NOW: the snippet
 *  serialises each once more before it touches anything and refuses the whole
 *  import when one differs. Approved overwrites: those items, action update
 *  or overwrite. Nothing else, and no data loss. */
export function deployAbap(zipBytes, pkg, expected) {
  const items = expected.map((e) => e.item);
  checkItems(items);
  const lines = [];
  for (const e of expected) {
    for (const f of e.files) {
      if (!FILE_NAME.test(f.name) || !/^[0-9a-fA-F]{64}$/.test(f.sha256)) throw new Error(`not a file entry: ${f.name}`);
      lines.push(`APPEND \`${e.item}@${f.name}=${HEX(f.sha256)}\` TO lt_exp.`);
    }
  }
  const b64 = Buffer.from(zipBytes).toString("base64");
  const zipLines = [];
  for (let i = 0; i < b64.length; i += B64_LINE) zipLines.push(`APPEND \`${b64.slice(i, i + B64_LINE)}\` TO lt_b64.`);
  return [
    ...SERIALIZE_DECLS,
    "DATA lt_b64 TYPE string_table.",
    "DATA lt_exp TYPE string_table.",
    "DATA lt_got TYPE string_table.",
    "DATA lt_a TYPE string_table.",
    "DATA lt_b TYPE string_table.",
    "DATA lv_l TYPE string.",
    "DATA lv_line TYPE string.",
    "DATA lv_pre TYPE string.",
    "DATA lv_pl TYPE i.",
    "DATA lv_key TYPE string.",
    "DATA lv_logs TYPE i.",
    "DATA lv_foreign TYPE abap_bool.",
    ...zipLines,
    ...lines,
    ...itemLines(items),
    "DATA(lv_b64) = concat_lines_of( table = lt_b64 ).",
    "DATA(lv_zip) = cl_http_utility=>decode_x_base64( lv_b64 ).",
    "DATA(li_log) = CAST zif_abapgit_log( NEW zcl_abapgit_log( ) ).",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "TRY.",
    "    DATA(lt_files) = zcl_abapgit_zip=>load( lv_zip ).",
    "    lv_out = |files={ lines( lt_files ) };|.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    `    IF li_repo IS BOUND AND li_repo->get_name( ) <> '${ownRepoName(pkg)}'.`,
    "      lv_out = |{ lv_out } ERR the package has repository { li_repo->get_key( ) } named { li_repo->get_name( ) }, not this tool's;|.",
    "    ELSE.",
    "      \" the guard: every item that may be overwritten is serialised again",
    "      \" right now, inside the call that deserialises, and must equal what",
    "      \" the caller expects (the snapshot, or the version this run deployed)",
    "      LOOP AT lt_items INTO lv_item.",
    ...serializeBlock(pkg, {
      onFile: ["lv_line = |{ lv_item }@{ ls_file-filename }={ lv_hx }|.", "APPEND lv_line TO lt_got."],
      onFail: ["lv_foreign = abap_true."],
      onMissing: ["lv_foreign = abap_true."],
    }).map((l) => `        ${l}`),
    "      ENDLOOP.",
    "      SORT lt_got.",
    "      LOOP AT lt_items INTO lv_item.",
    "        CLEAR: lt_a, lt_b.",
    "        lv_pre = |{ lv_item }@|.",
    "        lv_pl = strlen( lv_pre ).",
    "        LOOP AT lt_exp INTO lv_l.",
    "          IF strlen( lv_l ) > lv_pl AND substring( val = lv_l len = lv_pl ) = lv_pre.",
    "            APPEND lv_l TO lt_a.",
    "          ENDIF.",
    "        ENDLOOP.",
    "        LOOP AT lt_got INTO lv_l.",
    "          IF strlen( lv_l ) > lv_pl AND substring( val = lv_l len = lv_pl ) = lv_pre.",
    "            APPEND lv_l TO lt_b.",
    "          ENDIF.",
    "        ENDLOOP.",
    "        SORT lt_a.",
    "        SORT lt_b.",
    "        IF lt_a <> lt_b.",
    "          SPLIT lv_item AT space INTO lv_type lv_name.",
    "          lv_out = |{ lv_out } changed={ lv_type }:{ lv_name };|.",
    "          lv_foreign = abap_true.",
    "        ENDIF.",
    "      ENDLOOP.",
    "      IF lv_foreign = abap_true.",
    "        lv_out = |{ lv_out } import refused;|.",
    "      ELSE.",
    "        IF li_repo IS NOT BOUND.",
    "          li_repo = zcl_abapgit_repo_srv=>get_instance( )->new_offline(",
    `            iv_name = '${ownRepoName(pkg)}' iv_package = '${pkg}' ).`,
    "          \" this call created the row: only such a row is the run's to delete",
    "          lv_out = |{ lv_out } repo_new={ li_repo->get_key( ) };|.",
    "        ENDIF.",
    "        lv_out = |{ lv_out } repo={ li_repo->get_key( ) };|.",
    "        li_repo->set_files_remote( lt_files ).",
    "        DATA(ls_checks) = li_repo->deserialize_checks( ).",
    "        LOOP AT ls_checks-overwrite ASSIGNING FIELD-SYMBOL(<ls_o>).",
    "          lv_key = |{ <ls_o>-obj_type } { <ls_o>-obj_name }|.",
    "          READ TABLE lt_items WITH KEY table_line = lv_key TRANSPORTING NO FIELDS.",
    "          IF sy-subrc = 0 AND ( <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-update",
    "              OR <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-overwrite ).",
    "            <ls_o>-decision = zif_abapgit_definitions=>c_yes.",
    "          ELSEIF <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-delete.",
    "            \" in place nothing is deleted: abapGit plans a delete for what the",
    "            \" AFTER zip does not carry (the package's own DEVC, measured on A4H,",
    "            \" and any object outside the AFTER set); decline it, keep the object",
    "            <ls_o>-decision = zif_abapgit_definitions=>c_no.",
    "            lv_out = |{ lv_out } keep={ <ls_o>-obj_type }:{ <ls_o>-obj_name };|.",
    "          ELSE.",
    "            lv_foreign = abap_true.",
    "            lv_out = |{ lv_out } ERR would overwrite { <ls_o>-obj_type } { <ls_o>-obj_name } (action { <ls_o>-action });|.",
    "          ENDIF.",
    "        ENDLOOP.",
    "        LOOP AT ls_checks-data_loss ASSIGNING FIELD-SYMBOL(<ls_d>).",
    "          lv_foreign = abap_true.",
    "          lv_out = |{ lv_out } ERR would lose data in { <ls_d>-obj_type } { <ls_d>-obj_name };|.",
    "        ENDLOOP.",
    "        IF lv_foreign = abap_true.",
    "          lv_out = |{ lv_out } import refused;|.",
    "        ELSE.",
    "          LOOP AT ls_checks-warning_package ASSIGNING FIELD-SYMBOL(<ls_w>).",
    "            <ls_w>-decision = zif_abapgit_definitions=>c_no.",
    "          ENDLOOP.",
    "          ls_checks-requirements-decision = zif_abapgit_definitions=>c_yes.",
    "          ls_checks-dependencies-decision = zif_abapgit_definitions=>c_yes.",
    "          li_repo->deserialize( is_checks = ls_checks ii_log = li_log ).",
    "          lv_out = |{ lv_out } status={ li_log->get_status( ) };|.",
    "          \" what the import left, read in this same dialog step with the",
    "          \" serialisation and digest of the hash snippet: the run records",
    "          \" this as its deployed version, not a later read another session",
    "          \" could have written into",
    ...hashLoop(pkg, DEPLOYED).map((l) => `          ${l}`),
    "        ENDIF.",
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

/** Delete the tool's own repository row, and nothing else: only when it is
 *  the one named for this package and has the key the run recorded. */
export function dropRepoAbap(pkg, key) {
  if (!REPO_KEY.test(key ?? "")) throw new Error(`not a repository key: ${key}`);
  return [
    "DATA lv_out TYPE string.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "DATA lv_repos TYPE i.",
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "  CATCH cx_root INTO DATA(lx).",
    "    lv_out = |ERR repository lookup: { lx->get_text( ) };|.",
    "ENDTRY.",
    "IF li_repo IS BOUND.",
    `  IF li_repo->get_key( ) <> '${key}' OR li_repo->get_name( ) <> '${ownRepoName(pkg)}'.`,
    "    lv_out = |{ lv_out } ERR refused: repository { li_repo->get_key( ) } named { li_repo->get_name( ) } is not the one this run used;|.",
    "  ELSE.",
    "    TRY.",
    "        zcl_abapgit_repo_srv=>get_instance( )->delete( li_repo ).",
    "        COMMIT WORK.",
    "        lv_out = |{ lv_out } repo_deleted={ li_repo->get_key( ) };|.",
    "      CATCH cx_root INTO DATA(lx2).",
    "        lv_out = |{ lv_out } ERR repo delete: { lx2->get_text( ) };|.",
    "    ENDTRY.",
    "  ENDIF.",
    "ENDIF.",
    "DATA(lv_tab) = zcl_abapgit_persistence_db=>c_tabname.",
    `SELECT COUNT(*) FROM (lv_tab) WHERE type = @zcl_abapgit_persistence_db=>c_type_repo AND value = '${key}' INTO @lv_repos.`,
    "lv_out = |{ lv_out } repo_left={ lv_repos };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

// ------------------------------------------------------------------- parsing

export function parseList(msg) {
  return {
    err: /ERR ([^;]*);/.exec(msg)?.[1],
    tdevc: Number(field(msg, "tdevc") ?? NaN),
    repo: field(msg, "repo"),
    repoName: /repo_name=([^;]*);/.exec(msg)?.[1]?.trim(),
    items: Number(field(msg, "items") ?? NaN),
    item: pairs(msg, "item").map((p) => p.item),
    children: Number(field(msg, "children") ?? NaN),
  };
}

/** item -> {files: [{name, sha256, size}]}, plus what was not readable. */
export function parseHashes(msg, prefix = "") {
  const files = new Map();
  for (const m of msg.matchAll(new RegExp(` ${prefix}file=([A-Z0-9]{4}):([^|;]*)\\|([^|;]*)\\|([0-9A-F]{64})\\|(\\d+);`, "g"))) {
    const item = `${m[1]} ${m[2].trim()}`;
    if (!files.has(item)) files.set(item, []);
    files.get(item).push({name: m[3], sha256: m[4].toLowerCase(), size: Number(m[5])});
  }
  const objs = new Map();
  for (const m of msg.matchAll(new RegExp(` ${prefix}obj=([A-Z0-9]{4}):([^;@]*?) files=(\\d+);`, "g"))) objs.set(`${m[1]} ${m[2].trim()}`, Number(m[3]));
  return {
    files, objs,
    absent: pairs(msg, `${prefix}absent`).map((p) => p.item),
    elsewhere: pairs(msg, `${prefix}elsewhere`),
    fail: [...msg.matchAll(new RegExp(` ${prefix}fail=([A-Z0-9]{4}):([^|;]*)\\|([^;]*);`, "g"))].map((m) => ({item: `${m[1]} ${m[2].trim()}`, text: m[3].trim()})),
  };
}

export function parseDeploy(msg) {
  return {
    changed: pairs(msg, "changed").map((p) => p.item),
    absent: pairs(msg, "absent").map((p) => p.item),
    elsewhere: pairs(msg, "elsewhere"),
    fail: [...msg.matchAll(/ fail=([A-Z0-9]{4}):([^|;]*)\|([^;]*);/g)].map((m) => `${m[1]} ${m[2].trim()}: ${m[3].trim()}`),
    refused: /import refused;/.test(msg),
    repoNew: field(msg, "repo_new"),
    wouldOverwrite: [...msg.matchAll(/ERR (would [^;]*);/g)].map((m) => m[1]),
  };
}

// --------------------------------------------------------------------- state

/** `.local/prove-runs/<package>-snapshot/`, beside the fresh mode's receipts. */
export function snapshotDir(pkg, runsDir = dirname(receiptPath(pkg))) {
  return join(runsDir, `${pkg}-snapshot`);
}

export const statePath = (dir) => join(dir, "snapshot.json");

export function readState(dir) {
  const f = statePath(dir);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
}

export function writeState(dir, state) {
  mkdirSync(dir, {recursive: true});
  writeFileSync(statePath(dir), JSON.stringify(state, undefined, 1) + "\n");
}

/** An abapGit repository (zip layout) of the snapshot's files of `items`. */
export function snapshotZip(dir, state, items) {
  const stage = mkdtempSync(join(tmpdir(), "osd-prove-restore-"));
  try {
    mkdirSync(join(stage, "src"), {recursive: true});
    writeFileSync(join(stage, ".abapgit.xml"), abapgitXml());
    for (const item of items) {
      const obj = state.objects.find((o) => o.item === item);
      if (obj === undefined) throw new Error(`${item} is not in the snapshot`);
      for (const f of obj.files) {
        if (!FILE_NAME.test(f.name)) throw new Error(`file name "${f.name}" cannot go into a zip`);
        const data = readFileSync(join(dir, f.data));
        if (sha256(data) !== f.sha256) throw new Error(`the snapshot's copy of ${f.name} does not match its hash; refusing to restore from it`);
        writeFileSync(join(stage, "src", f.name), data);
      }
    }
    return zipInProcess(stage);
  } finally {
    rmSync(stage, {recursive: true, force: true});
  }
}

// ------------------------------------------------------------ reading a system

/** The files and hash of every item, as abapGit serialises them now. */
export async function readHashes(mcp, pkg, items, log = () => {}) {
  const out = {byItem: new Map(), absent: [], elsewhere: [], fail: [], incomplete: []};
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const r = await exec(mcp, hashAbap(pkg, batch), "hash");
    log(`hash: ${batch.length} object(s)`);
    collectHashes(parseHashes(r.message), batch, out);
  }
  return out;
}

/** A parsed hash report of `items` into `out` (readHashes' shape). */
function collectHashes(p, items, out = {byItem: new Map(), absent: [], elsewhere: [], fail: [], incomplete: []}) {
  out.absent.push(...p.absent);
  out.elsewhere.push(...p.elsewhere);
  out.fail.push(...p.fail);
  for (const item of items) {
    if (p.absent.includes(item) || p.elsewhere.some((e) => e.item === item) || p.fail.some((f) => f.item === item)) continue;
    const files = p.files.get(item) ?? [];
    if (!p.objs.has(item) || p.objs.get(item) !== files.length) {
      out.incomplete.push(item);
      continue;
    }
    out.byItem.set(item, {files, hash: objectHash(files)});
  }
  return out;
}

const problemsOf = (h) => [
  ...h.absent.map((i) => `${i} is not in the package`),
  ...h.elsewhere.map((e) => `${e.item} is in package ${e.where}`),
  ...h.fail.map((f) => `${f.item} could not be serialised: ${f.text}`),
  ...h.incomplete.map((i) => `the hash report for ${i} is incomplete`),
];

async function fetchFile(mcp, pkg, item, file) {
  const parts = [];
  for (let off = 0; off < file.size; off += CHUNK_BYTES) {
    const len = Math.min(CHUNK_BYTES, file.size - off);
    const r = await exec(mcp, chunkAbap(pkg, item, file.name, off, len), "chunk");
    const hex = /chunk=([0-9A-F]*);/.exec(r.message)?.[1];
    const fhash = /fhash=([0-9A-F]{64});/.exec(r.message)?.[1];
    if (field(r.message, "found") !== "X" || hex === undefined || fhash?.toLowerCase() !== file.sha256 || hex.length !== len * 2) {
      throw new Error(`${item} ${file.name}: the chunk at ${off} is not the version that was hashed (${r.message.trim().slice(0, 200)})`);
    }
    parts.push(Buffer.from(hex, "hex"));
  }
  const data = Buffer.concat(parts);
  if (sha256(data) !== file.sha256) throw new Error(`${item} ${file.name}: the fetched bytes do not match the hash the system reported`);
  return data;
}

/** Step 1. Returns {state} or {refusals}. Nothing on the system is changed. */
export async function takeSnapshot(mcp, pkg, dir, log = () => {}) {
  const r = await exec(mcp, listAbap(pkg), "snapshot list");
  const l = parseList(r.message);
  if (l.err !== undefined) return {refusals: [`refused: snapshot: ${l.err}`]};
  if (Number.isNaN(l.tdevc) || Number.isNaN(l.items) || l.repo === undefined || Number.isNaN(l.children)) {
    return {refusals: [`refused: snapshot: the report is incomplete: ${r.message.trim()}`]};
  }
  if (l.tdevc === 0) return {refusals: [`refused: package ${pkg} does not exist. --in-place works inside an existing package; the fresh mode creates one.`]};
  if (l.repo !== "none" && l.repoName !== ownRepoName(pkg)) {
    return {refusals: [`refused: package ${pkg} is versioned by abapGit repository ${l.repo} named "${l.repoName}", not this tool's. `
      + "The restore needs a repository of its own in the package; unlink the package first or use another one."]};
  }
  if (l.items > l.item.length) {
    return {refusals: [`refused: ${pkg} holds ${l.items} objects and the report lists ${l.item.length}; a snapshot must be complete`]};
  }
  const refusals = [];
  for (const i of l.item) if (!OBJECT_ITEM.test(i)) refusals.push(`refused: object "${i}" cannot be handled (its name does not fit an ABAP literal), so it cannot be in a snapshot`);
  if (refusals.length > 0) return {refusals};
  const items = [...l.item].sort();
  log(`snapshot: ${items.length} object(s) in ${pkg}${l.children > 0 ? `, ${l.children} subpackage(s) outside the perimeter` : ""}`);
  const h = await readHashes(mcp, pkg, items, log);
  const bad = problemsOf(h);
  if (bad.length > 0) return {refusals: bad.map((b) => `refused: snapshot: ${b}; an object that cannot be serialised cannot be shown restored`)};
  // repoAtSnapshot: a row with the tool's name that was there before this
  // run (a fresh-mode --keep run leaves one) is never this run's to delete;
  // createdRepo is set only from the deploy's own repo_new= report
  const state = {package: pkg, repoKey: l.repo === "none" ? null : l.repo, repoAtSnapshot: l.repo === "none" ? null : l.repo,
    createdRepo: null, phase: "snapshot", taken: new Date().toISOString(), objects: [], after: [], deployed: null};
  let n = 0;
  for (const item of items) {
    const got = h.byItem.get(item);
    const obj = {item, hash: got.hash, files: []};
    let k = 0;
    for (const f of got.files) {
      if (!FILE_NAME.test(f.name)) return {refusals: [`refused: ${item} has a file named "${f.name}", which cannot be stored or restored safely`]};
      const data = await fetchFile(mcp, pkg, item, f);
      const rel = join("files", `${n}-${k}.bin`);
      mkdirSync(join(dir, "files"), {recursive: true});
      writeFileSync(join(dir, rel), data);
      obj.files.push({name: f.name, sha256: f.sha256, size: f.size, data: rel});
      k += 1;
    }
    state.objects.push(obj);
    n += 1;
  }
  writeState(dir, state);
  log(`snapshot: ${state.objects.length} object(s) stored under ${dir}`);
  return {state};
}

// --------------------------------------------------------------- the rollback

/** Put the package back to its snapshot, then show that it is. Re-imports
 *  only the objects whose current hash is the hash of the AFTER version this
 *  run deployed; everything else that differs is reported and left alone.
 *  Success is: every object of the snapshot hashes to its snapshot hash. */
export async function rollbackToSnapshot(mcp, pkg, dir, state, {log = () => {}} = {}) {
  const problems = [];
  const notes = [];
  const snap = new Map(state.objects.map((o) => [o.item, o]));
  const items = [...snap.keys()];
  const now = await readHashes(mcp, pkg, items, log);
  for (const b of problemsOf(now)) problems.push(`rollback: ${b}; not touched`);
  const candidates = [];
  for (const [item, o] of snap) {
    const cur = now.byItem.get(item);
    if (cur === undefined || cur.hash === o.hash) continue;
    const dep = state.deployed?.[item];
    if (state.after.includes(item) && dep !== undefined && dep === cur.hash) candidates.push({item, files: cur.files});
    else {
      problems.push(`rollback: ${item} was changed by somebody else since the deploy (hash ${cur.hash.slice(0, 12)}, `
        + `the deployed version had ${dep === undefined ? "none recorded" : dep.slice(0, 12)}); not rolled back. `
        + `To restore it by hand, import the snapshot's files: ${snapshotFilesOf(dir, state, item)}`);
    }
  }
  if (candidates.length > 0) {
    log(`rollback: re-importing ${candidates.length} object(s) from the snapshot`);
    try {
      const zip = snapshotZip(dir, state, candidates.map((c) => c.item));
      const r = await exec(mcp, deployAbap(zip, pkg, candidates), "restore");
      log(`restore: ${r.message.trim()}`);
      const d = parseDeploy(r.message);
      const imp = parseImport(r.message);
      if (imp.repo !== undefined && REPO_KEY.test(imp.repo)) state.repoKey = imp.repo;
      if (d.repoNew !== undefined && REPO_KEY.test(d.repoNew)) state.createdRepo = d.repoNew;
      for (const i of d.changed) problems.push(`rollback: ${i} changed while the restore was starting; refused`);
      for (const i of d.wouldOverwrite) problems.push(`rollback: ${i}`);
      if (d.refused) problems.push("rollback: the restore was refused");
      else problems.push(...judgeImport(imp).map((p) => `rollback: ${p}`));
    } catch (e) {
      problems.push(`rollback: ${e.message}`);
    }
  }
  // the proof: every object, hashed again, equals its snapshot hash
  const after = await readHashes(mcp, pkg, items, log);
  for (const b of problemsOf(after)) problems.push(`verification: ${b}`);
  let verified = 0;
  for (const [item, o] of snap) {
    const cur = after.byItem.get(item);
    if (cur === undefined) continue;
    if (cur.hash === o.hash) {
      verified += 1;
      continue;
    }
    const names = new Set(cur.files.map((f) => f.name));
    const extra = cur.files.filter((f) => !o.files.some((s) => s.name === f.name)).map((f) => f.name);
    const gone = o.files.filter((f) => !names.has(f.name)).map((f) => f.name);
    problems.push(`verification: ${item} differs from its snapshot (hash ${cur.hash.slice(0, 12)}, snapshot ${o.hash.slice(0, 12)})`
      + (extra.length ? `; files not in the snapshot: ${extra.join(", ")}` : "")
      + (gone.length ? `; snapshot files missing: ${gone.join(", ")}` : ""));
  }
  try {
    const l = parseList((await exec(mcp, listAbap(pkg), "verification list")).message);
    const fresh = l.item.filter((i) => !snap.has(i));
    if (fresh.length > 0) notes.push(`appeared in ${pkg} since the snapshot, not ours and not touched:\n${listed(fresh)}`);
    if (l.items > l.item.length) notes.push(`the package now holds ${l.items} objects and only ${l.item.length} are listed`);
  } catch (e) {
    problems.push(`verification: ${e.message}`);
  }
  const ok = problems.length === 0 && verified === items.length;
  if (ok) {
    // the tool's own repository row: only one this run created (the deploy
    // or the restore reported repo_new=), by name and that key. A row that
    // was there at the snapshot, even under the tool's name, is left alone
    const key = state.createdRepo;
    if (key === undefined && REPO_KEY.test(state.repoKey ?? "")) {
      notes.push(`the snapshot does not record whether this run created repository ${state.repoKey}, so it is left in place; `
        + "delete it by hand if it is this tool's");
    } else if (key === null && REPO_KEY.test(state.repoKey ?? "")) {
      notes.push(`repository ${state.repoKey} was not created by this run${state.repoAtSnapshot ? " (it was there at the snapshot)" : ""}; left in place`);
    }
    if (REPO_KEY.test(key ?? "")) {
      try {
        const r = await exec(mcp, dropRepoAbap(pkg, key), "repository");
        log(`repository: ${r.message.trim()}`);
        for (const e of [...r.message.matchAll(/ERR ([^;]*);/g)]) problems.push(`repository: ${e[1]}`);
        if (field(r.message, "repo_left") !== "0") problems.push("repository: the tool's repository row is still there");
      } catch (e) {
        problems.push(`repository: ${e.message}`);
      }
    }
  }
  return {ok: problems.length === 0 && verified === items.length, problems, notes, verified, total: items.length};
}

// ------------------------------------------------------ the deployed version

/** abapGit's file-name prefix of an item: `zcl_x.clas.`, `#ns#x.clas.`. */
export const filePrefix = (item) => {
  const [type, name] = item.split(" ");
  return `${name.toLowerCase().replace(/\//g, "#")}.${type.toLowerCase()}.`;
};

/** Source text as a system keeps it: no BOM, LF, no trailing blanks on a
 *  line (a source line is stored without them), no trailing empty lines. */
export function normalisedSource(buf) {
  return Buffer.from(buf).toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
    .split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");
}

const ENTITY = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'"};
const unescapeXml = (t) => t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e) => (e[0] === "#"
  ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e]));

/** An XML document as a canonical string: elements with their attributes
 *  sorted by name and values unescaped, text unescaped (CDATA as text,
 *  adjacent text joined), whitespace-only text dropped; the declaration,
 *  comments and processing instructions do not count. Undefined when the
 *  text is not one well-formed element tree (unbalanced tags, a second
 *  root, text outside the root, a DOCTYPE): such a file is not decided. */
export function canonicalXml(buf) {
  const src = Buffer.from(buf).toString("utf8").replace(/^\uFEFF/, "");
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|</g;
  const out = [];
  const stack = [];
  let roots = 0;
  let text = "";
  let at = 0;
  const flush = () => {
    if (text.trim() !== "") {
      if (stack.length === 0) return false;
      out.push(`T${JSON.stringify(text)}`);
    }
    text = "";
    return true;
  };
  for (const m of src.matchAll(tag)) {
    text += unescapeXml(src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[0].startsWith("<!--") || m[0].startsWith("<?")) continue;
    if (m[1] !== undefined) { text += m[1]; continue; }
    if (m[0] === "<!" || m[0] === "<") return undefined;
    if (!flush()) return undefined;
    if (m[2] !== undefined) {
      if (stack.pop() !== m[2]) return undefined;
      out.push(")");
      continue;
    }
    if (stack.length === 0 && (roots += 1) > 1) return undefined;
    const attrs = [...m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((a) => [a[1], unescapeXml(a[2] ?? a[3])]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (new Set(attrs.map(([n]) => n)).size !== attrs.length) return undefined;
    out.push(`(${m[3]}${JSON.stringify(attrs)}`);
    if (m[5] === "/") out.push(")");
    else stack.push(m[3]);
  }
  text += unescapeXml(src.slice(at));
  if (!flush() || stack.length > 0 || roots !== 1) return undefined;
  return out.join("");
}

/** Where a snapshot's copy of an object lies, for a restore by hand. */
export function snapshotFilesOf(dir, state, item) {
  const o = state.objects?.find((x) => x.item === item);
  return o === undefined ? "" : o.files.map((f) => `${join(dir, f.data)} = ${f.name}`).join(", ");
}

/** The deployed hashes of `items`, from the post-deploy report the deploy
 *  snippet wrote in the same dialog step as the deserialise (`dep_` entries),
 *  cross-checked file by file. An object is adopted (and so may be
 *  overwritten by the rollback) only when every file it shows is decided:
 *    (a) its hash equals the zip's file;
 *    (b) a source file: equal to the zip's after the normalisation a system
 *        applies; an XML file: the same canonical element tree as the zip's
 *        (both read back by chunks that must carry the in-step hash);
 *    (c) an XML file, or one the zip lacks: its hash equals the snapshot's
 *        file of that name, so the deploy did not change it and nothing of
 *        ours is in it. A source file the zip carries that is still the
 *        snapshot's is refused: the deploy did not apply it.
 *  A file the zip carries and the system does not show is a failed deploy of
 *  that file; one the system shows and the zip lacks passes only by (c).
 *  Anything else refuses the object: not recorded, the run fails. */
export async function adoptDeployed({mcp, pkg, items, message, zipFiles, snapshot = [], problems, log = () => {}}) {
  const dep = collectHashes(parseHashes(message, DEPLOYED), items);
  for (const b of problemsOf(dep)) problems.push(`deployed version: ${b}`);
  const flagged = new Set([...dep.absent, ...dep.elsewhere.map((e) => e.item), ...dep.fail.map((f) => f.item), ...dep.incomplete]);
  const deployed = {};
  for (const item of items) {
    const got = dep.byItem.get(item);
    if (got === undefined) {
      if (!flagged.has(item)) problems.push(`deployed version: the deploy reported no hashes for ${item}`);
      continue;
    }
    if (zipFiles === undefined) {
      problems.push(`deployed version: ${item} cannot be compared with the AFTER zip (its files were not kept); not adopted`);
      continue;
    }
    const pre = filePrefix(item);
    const mine = new Map([...zipFiles].filter(([n]) => n.startsWith(pre)));
    const snap = new Map((snapshot.find((o) => o.item === item)?.files ?? []).map((f) => [f.name, f.sha256]));
    const refused = [];
    const how = [];
    for (const f of got.files) {
      const z = mine.get(f.name);
      if (z !== undefined && sha256(z) === f.sha256) continue; // (a)
      const xml = f.name.endsWith(".xml");
      const unchanged = snap.get(f.name) === f.sha256;
      if (unchanged && (xml || z === undefined)) { // (c)
        how.push(`${f.name} unchanged since the snapshot`);
        continue;
      }
      if (z === undefined) {
        refused.push(`${f.name} is shown by the system, is not in the AFTER zip and is not the snapshot's`);
        continue;
      }
      if (unchanged) {
        // a source the zip rewrites still reads as before: the tests would
        // run against BEFORE, and there is nothing of ours to roll back
        refused.push(`${f.name} is still the snapshot's, not the AFTER zip's: the deploy did not apply it`);
        continue;
      }
      // (b)
      try {
        const sys = await fetchFile(mcp, pkg, item, f);
        const a = xml ? canonicalXml(sys) : normalisedSource(sys);
        if (a !== undefined && a === (xml ? canonicalXml(z) : normalisedSource(z))) {
          how.push(`${f.name} equal to the zip's ${xml ? "as an element tree" : "after normalisation"}`);
          continue;
        }
        refused.push(`${f.name} is neither the AFTER zip's${xml ? " (as an element tree)" : ""} nor the snapshot's`);
      } catch (e) {
        refused.push(`${f.name} could not be read back as the version deployed (${e.message})`);
      }
    }
    for (const n of mine.keys()) {
      if (!got.files.some((f) => f.name === n)) refused.push(`${n} is in the AFTER zip and the system does not show it: the deploy of that file failed`);
    }
    if (refused.length > 0) {
      problems.push(`deployed version: ${item} is not what this run deployed (${refused.join("; ")}); `
        + "not recorded as this run's, so the rollback will not touch it");
      continue;
    }
    if (how.length > 0) log(`deployed version: ${item}: ${how.join(", ")}`);
    deployed[item] = got.hash;
  }
  return deployed;
}

// ---------------------------------------------------------------------- run

/** `--in-place`: snapshot, perimeter, deploy AFTER, tests, rollback, verify. */
export async function proveInPlace({folder, unit, manifest, pkg, keep = false, mcp, osg, runsDir, zipper = buildZip, log = () => {}}) {
  pkg = checkPackage(pkg);
  const dir = snapshotDir(pkg, runsDir);
  const problems = [];
  const rows = [];
  const done = (extra = {}) => ({ok: problems.length === 0, problems, rows, pkg, osgMode: osg.mode, inPlace: true,
    systemMethods: rows.reduce((n, r) => n + r.system, 0), osgMethods: rows.reduce((n, r) => n + r.osg, 0), ...extra});

  const built = zipper(folder, {unit, manifest, withPackageXml: false});
  const classes = built.classes;
  if (classes.length === 0) {
    problems.push(`nothing to prove: unit "${built.unit}" puts no class in the zip`);
    return done();
  }
  for (const c of classes) if (!CLASS_NAME.test(c)) throw new Error(`class name ${c} cannot be put into an ABAP literal`);
  checkItems(built.objects);
  log(`zip: ${built.bytes.length} bytes, unit "${built.unit}", ${built.objects.length} object(s), ${classes.length} class(es), no package.devc.xml`);

  if (existsSync(statePath(dir))) {
    problems.push(`refused: ${dir} exists: an earlier in-place run left its snapshot, which may be the only way back. `
      + `Run  node tools/osd-prove-on-system.mjs --rollback --package '${pkg}'  or inspect and remove it by hand.`);
    return done({refused: true});
  }

  let snap;
  try {
    snap = await takeSnapshot(mcp, pkg, dir, log);
  } catch (e) {
    rmSync(dir, {recursive: true, force: true});
    problems.push(`refused: snapshot: ${e.message}`);
    return done({refused: true});
  }
  const refuse = (...msgs) => {
    rmSync(dir, {recursive: true, force: true});
    problems.push(...msgs);
    return done({refused: true});
  };
  if (snap.refusals) return refuse(...snap.refusals);
  const state = snap.state;
  const inSnapshot = new Set(state.objects.map((o) => o.item));

  // the perimeter: the AFTER version may only rewrite what the snapshot holds
  const added = built.objects.filter((o) => !inSnapshot.has(o));
  if (added.length > 0) {
    return refuse(`refused: ${added.length} object(s) of the AFTER version are not in the snapshot of ${pkg}. `
      + `--in-place only rewrites objects that are there; it adds nothing:\n${listed(added)}`);
  }
  // and the package must still be what the snapshot says, all of it
  let pre;
  try {
    pre = await readHashes(mcp, pkg, [...inSnapshot].sort(), log);
  } catch (e) {
    return refuse(`refused: ${e.message}`);
  }
  const moved = [...problemsOf(pre).map((b) => `${b}`)];
  for (const o of state.objects) {
    const cur = pre.byItem.get(o.item);
    if (cur !== undefined && cur.hash !== o.hash) moved.push(`${o.item} changed since the snapshot (hash ${cur.hash.slice(0, 12)}, snapshot ${o.hash.slice(0, 12)})`);
  }
  if (moved.length > 0) {
    return refuse(`refused: the package is not what the snapshot says; nothing was deployed:\n${listed(moved)}`);
  }

  state.after = [...built.objects];
  state.phase = "deploying";
  writeState(dir, state);
  const expected = built.objects.map((item) => ({item, files: state.objects.find((o) => o.item === item).files}));

  let ran = false;
  let deployMsg;
  try {
    try {
      const r = await exec(mcp, deployAbap(built.bytes, pkg, expected), "deploy");
      deployMsg = r.message;
      log(`deploy: ${r.message.trim()}`);
      const d = parseDeploy(r.message);
      const imp = parseImport(r.message);
      ran = imp.status !== undefined && !d.refused;
      if (imp.repo !== undefined && REPO_KEY.test(imp.repo)) state.repoKey = imp.repo;
      if (d.repoNew !== undefined && REPO_KEY.test(d.repoNew)) state.createdRepo = d.repoNew;
      writeState(dir, state);
      for (const i of d.changed) problems.push(`deploy: ${i} changed since the snapshot; refused, nothing was deployed`);
      for (const i of d.absent) problems.push(`deploy: ${i} is not in the package any more`);
      for (const e of d.elsewhere) problems.push(`deploy: ${e.item} is in package ${e.where}`);
      for (const f of d.fail) problems.push(`deploy: could not serialise ${f}`);
      for (const w of d.wouldOverwrite) problems.push(`deploy: ${w}; refused`);
      if (!d.refused) problems.push(...judgeImport(imp));
      else if (!problems.some((p) => p.startsWith("deploy:"))) problems.push("deploy: refused");
    } catch (e) {
      problems.push(`deploy: ${e.message}`);
    }
    // record what the import left, so the rollback re-imports only an object
    // that is still exactly this. Only when abapGit reported a status: a
    // refused or unreported import wrote nothing we can vouch for, and an
    // object a colleague edited must never look like our deploy. The hashes
    // are the ones the deploy snippet read in its own dialog step, right
    // after the deserialise -- never a later read, which would adopt an edit
    // made in between -- and each object is checked against the AFTER zip
    try {
      if (!ran) throw Object.assign(new Error("the import reported no status, so the deployed hashes are unknown and the rollback will not touch an object that differs"), {skip: true});
      state.deployed = await adoptDeployed({mcp, pkg, items: [...built.objects], message: deployMsg, zipFiles: built.files,
        snapshot: state.objects, problems, log});
    } catch (e) {
      if (!e.skip) problems.push(`deployed version could not be hashed, so nothing can be rolled back safely: ${e.message}`);
    }
    state.phase = "deployed";
    writeState(dir, state);

    if (problems.length === 0) await proveClasses({mcp, classes, osg, problems, rows, log});
  } finally {
    if (keep) {
      log(`--keep: the AFTER version is left in ${pkg}. Put the package back with\n`
        + `  node tools/osd-prove-on-system.mjs --rollback --package '${pkg}'\n`
        + `(it needs ${dir})`);
    } else {
      const rb = await rollbackToSnapshot(mcp, pkg, dir, state, {log});
      for (const n of rb.notes) log(`note: ${n}`);
      problems.push(...rb.problems);
      if (rb.ok) {
        rmSync(dir, {recursive: true, force: true});
        log(`rollback: ${rb.verified}/${rb.total} object(s) equal their snapshot hash; snapshot removed`);
      } else {
        writeState(dir, state);
        log(`rollback: NOT verified (${rb.verified}/${rb.total}); the snapshot stays in ${dir}`);
      }
      state.restored = rb.ok ? `${rb.verified} object(s) verified` : undefined;
    }
  }
  return done({kept: keep, restored: state.restored});
}

/** `--rollback --package`: only with the snapshot a run left. */
export async function rollbackFromState(mcp, pkg, dir, out) {
  const state = readState(dir);
  if (state === undefined) {
    out(`refused: no snapshot for ${pkg} at ${dir}. Without one there is nothing to put the package back to, so nothing is changed.`);
    return 2;
  }
  if (state.package !== pkg || !Array.isArray(state.objects) || !Array.isArray(state.after)) {
    out(`refused: the snapshot at ${dir} is not a snapshot of ${pkg}`);
    return 2;
  }
  const rb = await rollbackToSnapshot(mcp, pkg, dir, state, {log: out});
  for (const n of rb.notes) out(`note: ${n}`);
  for (const p of rb.problems) out(`FAIL ${p}`);
  if (rb.ok) rmSync(dir, {recursive: true, force: true});
  else writeState(dir, state);
  out(rb.ok ? `rollback of ${pkg}: complete, ${rb.verified}/${rb.total} object(s) equal their snapshot hash`
    : `rollback of ${pkg}: NOT verified (${rb.verified}/${rb.total})`);
  return rb.ok ? 0 : 1;
}
