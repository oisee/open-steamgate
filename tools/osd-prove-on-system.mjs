// The same ABAP Unit on OSG and on a sandbox system, in one command.
//
//   node tools/osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json]
//        [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <name>]
//   node tools/osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X
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
// imports, runs and purges, and a productive or customer system is never
// the place for that. The system is whatever the MCP configuration names
// (`OSD_MCP_CONFIG`, default `.mcp.json`, gitignored): no host, user or
// client is written here.
//
// The steps, each a small MCP call, because a long call can be cut by
// "context canceled":
//   1. zip the folder (tools/osd-abapgit-zip.mjs, fail closed on the unit);
//   2. create the local package (`create DEVC`, an existing one is reused);
//   3. import it with abapGit (`analyze execute_abap`), reusing the repo
//      the package already has;
//   4. read SEOCLASSDF-WITH_UNIT_TESTS and the CCAU line count per class;
//   5. ABAP Unit per class (`test CLAS`);
//   6. purge, delete the repo if it is still registered, and verify that no
//      package, no TADIR row and no repo is left.
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
import {layout, zip} from "./osd-abapgit-zip.mjs";
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
    const e = new Error(`refused: package "${name}" is not local. This tool imports, runs and purges, `
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

export function repoName(pkg) {
  return `OSG_${pkg.slice(1)}`.slice(0, 60);
}

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
    "    IF li_repo IS NOT BOUND.",
    "      li_repo = zcl_abapgit_repo_srv=>get_instance( )->new_offline(",
    `        iv_name = '${repoName(pkg)}' iv_package = '${pkg}' ).`,
    "    ENDIF.",
    "    lv_out = |{ lv_out } repo={ li_repo->get_key( ) };|.",
    "    li_repo->set_files_remote( lt_files ).",
    "    DATA(ls_checks) = li_repo->deserialize_checks( ).",
    "    LOOP AT ls_checks-overwrite ASSIGNING FIELD-SYMBOL(<ls_o>).",
    "      <ls_o>-decision = zif_abapgit_definitions=>c_yes.",
    "    ENDLOOP.",
    "    LOOP AT ls_checks-warning_package ASSIGNING FIELD-SYMBOL(<ls_w>).",
    "      <ls_w>-decision = zif_abapgit_definitions=>c_yes.",
    "    ENDLOOP.",
    "    ls_checks-requirements-decision = zif_abapgit_definitions=>c_yes.",
    "    ls_checks-dependencies-decision = zif_abapgit_definitions=>c_yes.",
    "    li_repo->deserialize( is_checks = ls_checks ii_log = li_log ).",
    "    lv_out = |{ lv_out } status={ li_log->get_status( ) };|.",
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

/** Step 6: purge, drop the repo if still registered, verify nothing is left. */
export function cleanupAbap(pkg) {
  return [
    "DATA lv_out TYPE string.",
    "DATA lv_key TYPE zif_abapgit_persistence=>ty_value.",
    "DATA li_repo TYPE REF TO zif_abapgit_repo.",
    "TRY.",
    "    zcl_abapgit_repo_srv=>get_instance( )->get_repo_from_package(",
    `      EXPORTING iv_package = '${pkg}' IMPORTING ei_repo = li_repo ).`,
    "    IF li_repo IS BOUND.",
    "      lv_key = li_repo->get_key( ).",
    "      DATA(ls_checks) = li_repo->delete_checks( ).",
    "      DATA(li_log) = zcl_abapgit_repo_srv=>get_instance( )->purge( ii_repo = li_repo is_checks = ls_checks ).",
    "      lv_out = |purged status={ li_log->get_status( ) };|.",
    "    ELSE.",
    "      lv_out = |no repo;|.",
    "    ENDIF.",
    "  CATCH cx_root INTO DATA(lx).",
    "    lv_out = |{ lv_out } ERR { lx->get_text( ) };|.",
    "ENDTRY.",
    "DATA(lv_tab) = zcl_abapgit_persistence_db=>c_tabname.",
    "DATA lv_repos TYPE i.",
    "IF lv_key IS NOT INITIAL.",
    "  SELECT COUNT(*) FROM (lv_tab) WHERE type = @zcl_abapgit_persistence_db=>c_type_repo",
    "    AND value = @lv_key INTO @lv_repos.",
    "  IF lv_repos > 0.",
    "    TRY.",
    "        zcl_abapgit_repo_srv=>get_instance( )->delete( li_repo ).",
    "        COMMIT WORK.",
    "        lv_out = |{ lv_out } repo_deleted={ lv_key };|.",
    "      CATCH cx_root INTO DATA(lx2).",
    "        lv_out = |{ lv_out } ERR delete: { lx2->get_text( ) };|.",
    "    ENDTRY.",
    "    SELECT COUNT(*) FROM (lv_tab) WHERE type = @zcl_abapgit_persistence_db=>c_type_repo",
    "      AND value = @lv_key INTO @lv_repos.",
    "  ENDIF.",
    "ENDIF.",
    "lv_out = |{ lv_out } repo_left={ lv_repos };|.",
    `SELECT object, obj_name FROM tadir WHERE devclass = '${pkg}' INTO TABLE @DATA(lt_tadir).`,
    "lv_out = |{ lv_out } tadir_left={ lines( lt_tadir ) };|.",
    "LOOP AT lt_tadir INTO DATA(ls_t).",
    "  lv_out = |{ lv_out } { ls_t-object } { ls_t-obj_name };|.",
    "ENDLOOP.",
    `SELECT COUNT(*) FROM tdevc WHERE devclass = '${pkg}' INTO @DATA(lv_devc).`,
    "lv_out = |{ lv_out } tdevc_left={ lv_devc };|.",
    report("lv_out"),
  ].join("\n") + "\n";
}

// ------------------------------------------------------------------- parsing

/** The framed message of a snippet's fail( ), or undefined when vsp's text
 *  carries none (the program did not reach its last line). */
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
    logCount: Number(field(msg, "logs") ?? logs.length),
    tadir: Number(field(msg, "tadir") ?? NaN),
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
    status: field(msg, "status"),
    err: [...msg.matchAll(/ERR ([^;]*);/g)].map((m) => m[1]),
    repoLeft: Number(field(msg, "repo_left") ?? NaN),
    tadirLeft: Number(field(msg, "tadir_left") ?? NaN),
    tdevcLeft: Number(field(msg, "tdevc_left") ?? NaN),
  };
}

/** ADT's unit result as vsp returns it: classes[].testMethods[], a failure
 *  carries alerts[] with a title. No classes is a run of nothing. */
export function parseUnit(text, className) {
  const s = String(text);
  const i = s.indexOf("{");
  let json;
  try {
    json = i < 0 ? {} : JSON.parse(s.slice(i));
  } catch {
    return {methods: 0, failing: [], unreadable: s.slice(0, 300)};
  }
  const classes = (json.classes ?? []).filter((c) => c.parentName === undefined
    || String(c.parentName).toUpperCase() === className);
  const failing = [];
  let methods = 0;
  for (const c of classes) {
    for (const a of c.alerts ?? []) failing.push({method: `${c.name} (class)`, title: a.title});
    for (const m of c.testMethods ?? []) {
      methods += 1;
      if ((m.alerts ?? []).length > 0) {
        failing.push({method: `${c.name}->${m.name}`, title: m.alerts.map((a) => a.title).join(" | ")});
      }
    }
  }
  return {methods, failing};
}

// ---------------------------------------------------------------- OSG side

/** Every class of the folder with its FOR TESTING methods, from abaplint's
 *  parse of the source and the testclasses include. */
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
    let n = 0;
    for (const file of o.getABAPFiles()) {
      for (const c of file.getInfo().listClassDefinitions()) {
        if (!c.isForTesting) continue;
        n += c.methods.filter((m) => m.isForTesting).length;
      }
    }
    out.set(o.getName().toUpperCase(), n);
  }
  return out;
}

/** OSG providers: `count` reads the parse; `run` runs the class's ABAP Unit
 *  on this runtime (tools/osd-unit.mjs), which needs the folder in the build. */
export function osgCounter(folder) {
  const counts = countTestMethods(folder);
  return {
    mode: "count",
    async methods(cls) { return {methods: counts.get(cls) ?? 0, failing: []}; },
  };
}

export function osgRunner() {
  return {
    mode: "run",
    async methods(cls) {
      const {UnitRun} = await import("./osd-unit.mjs");
      const r = await new UnitRun().run("CLAS", cls, {});
      const failing = [];
      for (const tc of r.testClasses) {
        for (const m of tc.testMethods) if (m.alerts.length > 0) failing.push(`${tc.name}->${m.name}`);
      }
      return {methods: r.counts.methods, failing};
    },
  };
}

// --------------------------------------------------------------------- zip

/** Step 1, as tools/osd-abapgit-zip.mjs does it for a folder: only what the
 *  unit lists, fail closed. Returns the bytes and the classes. */
export function buildZip(folder, {unit: unitName, manifest} = {}) {
  const unit = unitFor(loadManifest(manifest), folder, unitName);
  const work = mkdtempSync(join(tmpdir(), "osd-prove-"));
  try {
    const staging = join(work, "repo");
    const out = join(work, "repo.zip");
    const laid = layout(folder, staging, `open-steamgate prove: ${basename(resolve(folder))}`, undefined, unit);
    zip(staging, out);
    return {bytes: readFileSync(out), classes: [...(laid.objects.get("CLAS") ?? [])].map((c) => c.toUpperCase()).sort(),
      unit: unit.name};
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
  return r;
}

/** Steps 6: returns {ok, problems, parsed}. */
export async function cleanup(mcp, pkg, log = () => {}) {
  const problems = [];
  let r;
  try {
    r = await exec(mcp, cleanupAbap(pkg), "cleanup");
  } catch (e) {
    return {ok: false, problems: [`cleanup: ${e.message}`]};
  }
  const c = parseCleanup(r.message);
  log(`cleanup: ${r.message.trim()}`);
  for (const e of c.err) problems.push(`cleanup error: ${e}`);
  if (c.status !== undefined && c.status !== "S" && c.status !== "W") problems.push(`cleanup: purge status ${c.status}`);
  for (const [name, n] of [["repo", c.repoLeft], ["TADIR object", c.tadirLeft], ["package", c.tdevcLeft]]) {
    if (!(n === 0)) problems.push(`cleanup incomplete: ${Number.isNaN(n) ? "unknown number of" : n} ${name}(s) left`);
  }
  return {ok: problems.length === 0, problems, parsed: c};
}

/** Steps 1-6. `mcp` is {call(action, target, params) -> text}; `osg` is a
 *  provider ({mode, methods(cls)}); `zipper` builds the zip. */
export async function prove({folder, unit, manifest, pkg = DEFAULT_PACKAGE, keep = false, mcp, osg, zipper = buildZip,
  log = () => {}}) {
  pkg = checkPackage(pkg);
  const problems = [];
  const rows = [];

  const built = zipper(folder, {unit, manifest});
  const classes = built.classes;
  for (const c of classes) {
    if (!CLASS_NAME.test(c)) throw new Error(`class name ${c} cannot be put into an ABAP literal`);
  }
  log(`zip: ${built.bytes.length} bytes, unit "${built.unit}", ${classes.length} class(es)`);

  const devc = await mcp.call("create", `DEVC ${pkg}`, {name: pkg, description: "open-steamgate prove-on-system (temporary)"});
  if (/^ERROR/i.test(devc) && !/exist/i.test(devc)) {
    problems.push(`package ${pkg} not created: ${devc.slice(0, 300)}`);
    return {ok: false, problems, rows, classes, pkg, osgMode: osg.mode};
  }
  log(`package ${pkg}: ${/exist/i.test(devc) ? "exists, reused" : "created"}`);

  let imported;
  try {
    try {
      const r = await exec(mcp, importAbap(built.bytes, pkg), "import");
      imported = parseImport(r.message);
      log(`import: ${r.message.trim()}${r.truncated ? " (truncated)" : ""}`);
      if (imported.err !== undefined) problems.push(`import failed: ${imported.err}`);
      if (imported.status === "E" || imported.status === "A") problems.push(`import status ${imported.status}`);
      for (const l of imported.logs) {
        if (l.type !== "W") problems.push(`import log [${l.type}] ${l.text}`);
      }
      if (imported.logCount > imported.logs.length) {
        problems.push(`import log: ${imported.logCount - imported.logs.length} more message(s) not carried back`);
      }
    } catch (e) {
      problems.push(e.message);
    }

    let check = new Map();
    if (classes.length > 0 && problems.length === 0) {
      try {
        const r = await exec(mcp, classCheckAbap(classes), "class check");
        check = parseClassCheck(r.message);
        log(`classes: ${r.message.trim()}`);
      } catch (e) {
        problems.push(e.message);
      }
    }

    if (problems.length === 0) {
      for (const cls of classes) {
        const here = await osg.methods(cls);
        const text = await mcp.call("test", `CLAS ${cls}`,
          {object_url: `/sap/bc/adt/oo/classes/${encodeURIComponent(cls.toLowerCase())}`, include_dangerous: true});
        const there = parseUnit(text, cls);
        const info = check.get(cls);
        const row = {cls, osg: here.methods, system: there.methods, failing: there.failing, notes: []};
        if (info !== undefined && !info.found) row.notes.push("not active on the system");
        if (here.methods > 0 && info !== undefined && info.found && !info.wut) {
          row.notes.push("WITH_UNIT_TESTS is not set on the system");
        }
        if (here.methods > 0 && info !== undefined && info.found && info.ccau === 0) {
          row.notes.push("no CCAU include on the system (WITH_UNIT_TESTS missing from the class XML?)");
        }
        if (there.unreadable !== undefined) row.notes.push(`unit result not readable: ${there.unreadable}`);
        rows.push(row);
        for (const f of here.failing) problems.push(`${cls}: fails on OSG: ${f}`);
        if (here.methods !== there.methods) {
          problems.push(`${cls}: ${here.methods} test method(s) on OSG, ${there.methods} on the system`
            + (row.notes.length ? ` (${row.notes.join("; ")})` : ""));
        }
        for (const f of there.failing) problems.push(`${cls}: fails on the system: ${f.method}: ${f.title}`);
      }
    }
  } finally {
    if (keep) {
      log(`--keep: package ${pkg} and its objects are left on the system. Remove them with\n`
        + `  node tools/osd-prove-on-system.mjs --cleanup --package '${pkg}'`);
    } else {
      const c = await cleanup(mcp, pkg, log);
      problems.push(...c.problems);
    }
  }
  return {ok: problems.length === 0, problems, rows, classes, pkg, osgMode: osg.mode};
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
  const cleanupOnly = argv.includes("--cleanup");
  if (!cleanupOnly && folder === undefined) {
    out("usage: osd-prove-on-system.mjs <folder> --unit <unit> [--manifest m.json] [--package $ZOSG_TMP_X] [--keep] "
      + "[--osg count|run] [--server <mcp server>]\n       osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X");
    return 2;
  }
  const mcp = givenMcp ?? mcpStdio({server: flag("server")});
  try {
    if (cleanupOnly) {
      const c = await cleanup(mcp, pkg, out);
      for (const p of c.problems) out(`FAIL ${p}`);
      out(c.ok ? `cleanup of ${pkg}: complete` : `cleanup of ${pkg}: INCOMPLETE`);
      return c.ok ? 0 : 1;
    }
    const osg = flag("osg") === "run" ? osgRunner() : osgCounter(folder);
    const r = await prove({folder, unit: flag("unit"), manifest: flag("manifest"), pkg, keep: argv.includes("--keep"),
      mcp, osg, log: out});
    out("");
    out(table(r.rows));
    for (const row of r.rows) for (const n of row.notes) out(`  ${row.cls}: ${n}`);
    out(`\nOSG side: ${r.osgMode === "run" ? "ABAP Unit run on this runtime (tools/osd-unit.mjs)"
      : "FOR TESTING methods counted from the source (abaplint parse); not run"}`);
    for (const p of r.problems) out(`FAIL ${p}`);
    out(r.ok ? "proved: the same tests pass on OSG and on the system" : `NOT proved: ${r.problems.length} problem(s)`);
    return r.ok ? 0 : 1;
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
