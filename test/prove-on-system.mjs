// tools/osd-prove-on-system.mjs against a fake system. Nothing here talks
// to SAP: the MCP transport is a model of what vsp v2.58.0-54 answers --
// execute_abap as JSON with result_text (the snippet's RETURN_VALUE( lt_out ),
// a table serialised as [{"K","V"}]), ABAP Unit as {ok, counts, classes},
// git_import_zip / git_import_status, git_delete_objects and `read DEVC`
// with inventory, in the shapes vsp's own source gives them. It is driven
// by the zip the tool really builds: the model reads the zip -- the class
// XML, the test include -- so the WITH_UNIT_TESTS case is the system's
// behaviour following from the file, not a canned answer.
// The cleanup snippet (decide and delete in one dialog step) is modelled as
// one call that does what the snippet asks of abapGit and nothing more: it
// deletes the receipt's objects whose stamp is unchanged (or whose content is
// the receipt's), the repository row only when the snippet says this run
// created it, and the package only when nothing and no repository is left --
// so a test can see what survives. git_delete_objects and the split decision
// are still modelled, so the previous, split design can be run against these
// tests (it fails the one-step test).
// No child process is spawned: the tool writes its zip in process and the
// fake reads it in process (a sandbox may refuse to spawn `zip`/`unzip`).
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {inflateRawSync} from "node:zlib";
import * as abaplint from "@abaplint/core";
import {
  STAMPED_KINDS, buildZip, checkPackage, classCheckAbap, cleanupAbap, countTestMethods, main, osgRunner, preflightAbap,
  prove, receiptAbap, residueAbap, rowsOf, verdict,
} from "../tools/osd-prove-on-system.mjs";
import {chunkAbap, deployAbap, dropRepoAbap, hashAbap, listAbap} from "../tools/osd-prove-inplace.mjs";

const FIXTURE = resolve("test/fixtures/prove-on-system");
const MANIFEST = join(FIXTURE, "manifest.json");
const PKG = "$ZOSG_TMP_TEST";
const OWN = `OSDPROVE ${PKG}`;
const ZIP_OBJECTS = ["CLAS ZCL_OSD_PROVE_DEMO", "CLAS ZCL_OSD_PROVE_PLAIN"];

/** what vsp answers for an execute_abap whose snippet returned `rows`
 *  ([k, v] pairs) with RETURN_VALUE( lt_out ): result_text is the table as
 *  JSON, its last row the end row the snippet appends */
export const answer = (rows, {end = true, edit = (t) => t} = {}) => JSON.stringify({
  success: true, programName: "ZTEMP_EXEC_12345678", output: ["..."], executionTime: 0.12,
  message: "Executed successfully, 1 output(s) returned", cleanedUp: true,
  result_text: edit(JSON.stringify([...rows.map(([k, v]) => ({K: k, V: String(v)})), ...(end ? [{K: "end", V: "OSDPROVE"}] : [])])),
}, undefined, 2);

/** a zip's files, read the way cl_abap_zip would: local headers, deflate */
function unzip(buf) {
  const files = new Map();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extra;
    const data = buf.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    at = start + size;
  }
  return files;
}

const sha = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex").toUpperCase();
const itemsOf = (code) => [...code.matchAll(/APPEND `([A-Z0-9]{4} [A-Z0-9_/]+)` TO lt_items\./g)].map((m) => m[1]);
const colon = (item) => item.replace(" ", ":");
const kindOf = (code) => /^" osdprove:(\w+)$/m.exec(code)?.[1];

/** A sandbox system as far as this tool can see it: packages (name ->
 *  parent), TADIR rows ({item, devclass}), abapGit repositories ({key, name,
 *  pkg}). Knobs inject the failures and the missing evidence each test is
 *  about. */
function fakeSystem({
  importErrors = [], importWarnings = [], status, failing = new Set(),
  before = {}, intruder, childPackage, undeletable = new Set(), editImport = (a) => a,
  dropCheck = new Set(), checkOverride = {}, unitText = {}, afterImport = () => {}, touchAfterReceipt = new Set(),
  afterReceipt = () => {}, beforeCheck = () => {}, withHashes = true, hashFail = new Set(), execAnswer = {},
  failedImport = false, refuseImport, pendingPolls = 0, inventoryEdit = (i) => i, deleteEdit = (r) => r,
  beforeCall = () => {},
} = {}) {
  const sys = {
    packages: new Map(Object.entries(before.packages ?? {})),
    tadir: [...(before.tadir ?? [])],
    repos: [...(before.repos ?? [])],
    classes: new Map(), calls: [], deleted: [],
    // the version stamp each object carries on the system; an edit changes it
    stamps: new Map(),
    // the files abapGit would serialise each object to: item -> Map(name -> text)
    files: new Map(),
    importAnswer: undefined, polls: 0,
  };
  const fileHashes = (item) => [...(sys.files.get(item) ?? [])].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([n, t]) => ({n, h: sha(t), size: Buffer.byteLength(t)}));
  const stampOf = (item) => {
    const type = item.slice(0, 4);
    return `${type}:20261001120000${type === "CLAS" || type === "INTF" ? "/9" : ""}`;
  };
  const repoOf = (pkg) => sys.repos.find((r) => r.pkg === pkg);
  const row = (item) => sys.tadir.find((t) => t.item === item);
  const json = (o, isError = false) => `${isError ? "ERROR: " : ""}${JSON.stringify(o, undefined, 2)}`;
  const hashRows = (out, item, prefix) => {
    for (const f of fileHashes(item)) out.push([`${prefix}file`, `${colon(item)}|${f.n}|${f.h}|${f.size}`]);
    out.push([`${prefix}obj`, `${colon(item)}|${sys.files.get(item)?.size ?? 0}`]);
  };
  const exec = (kind, code, pkg) => {
    const out = [];
    if (kind === "chunk") {
      const [, name, off, len] = /ls_file-filename = '([^']+)'[\s\S]*ls_file-data\+(\d+)\((\d+)\)/.exec(code);
      let found = "";
      for (const item of itemsOf(code)) {
        const text = sys.files.get(item)?.get(name);
        if (text !== undefined) {
          found = "X";
          out.push(["fhash", sha(text)], ["chunk", Buffer.from(text, "utf8").subarray(Number(off), Number(off) + Number(len)).toString("hex").toUpperCase()]);
        }
      }
      out.push(["found", found]);
      return out;
    }
    if (kind === "hash") {
      for (const item of itemsOf(code)) hashRows(out, item, "");
      return out;
    }
    if (kind === "preflight") {
      const repo = repoOf(pkg);
      const exists = itemsOf(code).map(row).filter(Boolean);
      out.push(["tdevc", sys.packages.has(pkg) ? 1 : 0]);
      if (repo) out.push(["repo", repo.key], ["repo_name", repo.name]);
      else out.push(["repo", "none"]);
      for (const t of exists) out.push(["exists", `${colon(t.item)}@${t.devclass}`]);
      out.push(["existing", exists.length]);
      return out;
    }
    if (kind === "receipt") {
      assert.match(code, /zcl_abapgit_oo_factory=>get_by_type\( lv_type \)->get_includes\( lv_name \)/);
      const items = itemsOf(code);
      for (const item of items) {
        const t = row(item);
        if (!t) out.push(["absent", colon(item)]);
        else if (t.devclass !== pkg) out.push(["elsewhere", `${colon(item)}@${t.devclass}`]);
        else if (!sys.stamps.has(item)) out.push(["nostamp", colon(item)]);
        else {
          out.push(["stamp", `${colon(item)}@${sys.stamps.get(item)}`]);
          // abapGit serialised it in the same step: h_file / h_obj
          if (hashFail.has(item)) out.push(["h_fail", `${colon(item)}|serialisation failed`]);
          else if (withHashes) hashRows(out, item, "h_");
        }
      }
      // somebody edits an object after the receipt was taken
      for (const item of touchAfterReceipt) sys.stamps.set(item, `${item.slice(0, 4)}:20261001130000/9`);
      afterReceipt(sys);
      out.push(["items", items.length]);
      return out;
    }
    if (kind === "check") {
      beforeCheck(sys); // an edit after the receipt step is done, chunk reads included
      const names = [...code.matchAll(/APPEND `([A-Z0-9_]+)` TO lt_cls\./g)].map((m) => m[1]);
      for (const n of names.filter((x) => !dropCheck.has(x))) {
        if (checkOverride[n]) { out.push(["cls", `${n}|${checkOverride[n]}`]); continue; }
        const c = sys.classes.get(n);
        out.push(["cls", c === undefined ? `${n}|4||0` : `${n}|0|${c.wut ? "X" : ""}|${c.methods.length ? 10 + c.methods.length * 3 : 0}`]);
      }
      return out;
    }
    if (kind === "decide") {
      const want = /get_key\( \) <> '([0-9]*)'/.exec(code)?.[1];
      const ownName = /get_name\( \) <> '([^']+)'/.exec(code)[1];
      const items = itemsOf(code);
      const wants = [...code.matchAll(/APPEND `([A-Z]{4}:[0-9/]+)` TO lt_stamps\./g)].map((m) => m[1]);
      assert.equal(wants.length, items.length, "a stamp per item");
      const expLines = [...code.matchAll(/APPEND `([A-Z0-9]{4} [A-Z0-9_/]+)@([^=`]+)=([0-9A-F]{64})` TO lt_exp\./g)];
      const repo = repoOf(pkg);
      if (repo) out.push(["repo", repo.key], ["repo_name", repo.name]);
      else out.push(["repo", "none"]);
      const go = !(repo && ((want !== undefined && repo.key !== want) || repo.name !== ownName));
      if (!go) out.push(["err", `refused: repository ${repo.key} named ${repo.name} is not the one this run imported into`]);
      let n = 0;
      if (go) {
        items.forEach((item, i) => {
          const t = row(item);
          if (!t) out.push(["absent", colon(item)]);
          else if (t.devclass !== pkg) out.push(["elsewhere", `${colon(item)}@${t.devclass}`]);
          else {
            let same = true;
            if (sys.stamps.get(item) !== wants[i]) {
              // the snippet: a moved stamp is still ours when the files hash as the receipt says
              const exp = expLines.filter((m) => m[1] === item).map((m) => `${m[2]}=${m[3]}`).sort();
              const cur = fileHashes(item).map((f) => `${f.n}=${f.h}`).sort();
              same = exp.length > 0 && JSON.stringify(exp) === JSON.stringify(cur);
              if (same) out.push(["rehashed", `${colon(item)}@${sys.stamps.get(item) ?? ""}`]);
              else {
                out.push(["changed", `${colon(item)}@${sys.stamps.get(item) ?? ""}`]);
                if (exp.length > 0) out.push(["hashdiff", colon(item)]);
              }
            }
            if (same) { n += 1; out.push(["delete", colon(item)]); }
          }
        });
      }
      out.push(["go", go ? "X" : ""], ["to_delete", n], ["items", items.length]);
      return out;
    }
    if (kind === "cleanup") {
      // the decision, exactly as above, and in the same call what it decided
      assert.doesNotMatch(code, /->purge\(/, "no purge");
      const decided = exec("decide", code.replace(/zcl_abapgit_objects=>delete|->delete\(/g, ""), pkg);
      const go = decided.find(([k]) => k === "go")[1] === "X";
      const drop = /DATA lv_drop TYPE abap_bool VALUE abap_true\./.test(code);
      const rows = decided.filter(([k]) => !["go", "to_delete", "items"].includes(k));
      let repo = repoOf(pkg);
      if (go) {
        let logs = 0;
        for (const [, v] of decided.filter(([k]) => k === "delete")) {
          const item = v.replace(":", " ");
          if (undeletable.has(item)) { rows.push(["log", `E|${item}: Deletion of object failed`]); logs += 1; continue; }
          sys.tadir = sys.tadir.filter((t) => t.item !== item);
          sys.files.delete(item);
          sys.stamps.delete(item);
          sys.deleted.push(item);
        }
        rows.push(["logs", logs]);
        if (repo && drop) { sys.repos = sys.repos.filter((r) => r !== repo); rows.push(["repo_deleted", repo.key]); repo = undefined; }
        else if (repo) rows.push(["repo_kept", repo.key]);
      }
      const rest = sys.tadir.filter((t) => t.devclass === pkg && t.item !== `DEVC ${pkg}`);
      const children = [...sys.packages].filter(([, parent]) => parent === pkg);
      if (go && !repo && rest.length === 0 && children.length === 0 && sys.packages.has(pkg)) {
        sys.packages.delete(pkg);
        sys.tadir = sys.tadir.filter((t) => t.item !== `DEVC ${pkg}`);
        rows.push(["package_deleted", "X"]);
      }
      rows.push(...decided.filter(([k]) => ["go", "to_delete", "items"].includes(k)));
      return rows;
    }
    if (kind === "residue") {
      const key = /lv_key = '([0-9]+)'\./.exec(code)?.[1];
      out.push(["repo_left", key && sys.repos.some((r) => r.key === key) ? 1 : 0]);
      const repo = repoOf(pkg);
      if (repo) out.push(["repo", repo.key], ["repo_name", repo.name]);
      else out.push(["repo", "none"]);
      const items = itemsOf(code);
      const left = items.filter((i) => row(i)?.devclass === pkg);
      for (const i of left) out.push(["item_left", colon(i)]);
      for (const i of items) if (!row(i) && sys.stamps.has(i)) out.push(["stamp_left", `${colon(i)}@${sys.stamps.get(i)}`]);
      out.push(["items_left", left.length]);
      const rest = sys.tadir.filter((t) => t.devclass === pkg && t.item !== `DEVC ${pkg}`);
      out.push(["others", rest.length], ...rest.map((t) => ["other", colon(t.item)]));
      const children = [...sys.packages].filter(([, parent]) => parent === pkg).map(([c]) => c);
      out.push(["children", children.length], ...children.map((c) => ["child", c]));
      out.push(["tdevc_left", sys.packages.has(pkg) ? 1 : 0]);
      return out;
    }
    throw new Error(`unexpected snippet ${kind}`);
  };
  /** git_import_zip as vsp answers it once its job is done */
  const importZip = (params) => {
    const pkg = params.package;
    const files = unzip(Buffer.from(params.zip_base64, "base64"));
    const base = {job: "ZVSP_GIT_IMPORT", jobCount: "12345678", system: "XYZ", client: "001", package: pkg, transport: "",
      packages: [pkg], jobStatus: "F", repoName: params.repo_name, repoCreated: false, packageCreated: false, infoCount: 3,
      code: "", message: "", log: [], tadir: [], decisions: []};
    let repo = repoOf(pkg);
    if (repo || refuseImport) {
      // vsp's job: an existing repository without overwrite, or a conflict, refuses; nothing is written
      return {...base, status: "refused", message: refuseImport ?? `package ${pkg} has repository ${repo.key} named ${repo.name}`,
        log: [{type: "E", text: refuseImport ?? "refused"}], repoName: ""};
    }
    repo = {key: "000000000042", name: params.repo_name, pkg};
    sys.repos.push(repo);
    const tadir = [];
    const written = [];
    for (const [f, text] of files) {
      const o = /^src\/([a-z0-9_]+)\.([a-z]+)\.(.+)$/.exec(f);
      if (o === null || o[2] === "devc") continue;
      const item = `${o[2].toUpperCase()} ${o[1].toUpperCase()}`;
      if (!sys.files.has(item)) sys.files.set(item, new Map());
      sys.files.get(item).set(f.slice(4), text);
      if (o[2] === "ddls" && o[3] === "xml" && !row(item)) {
        sys.tadir.push({item, devclass: pkg});
        sys.stamps.set(item, stampOf(item));
        written.push(item);
      }
    }
    for (const [f, text] of files) {
      const m = /^src\/(zcl_[a-z0-9_]+)\.clas\.xml$/.exec(f);
      if (m === null) continue;
      const name = m[1].toUpperCase();
      const tests = files.get(`src/${m[1]}.clas.testclasses.abap`) ?? "";
      const wut = /<WITH_UNIT_TESTS>X</.test(text);
      // what A4H did (#354): without WITH_UNIT_TESTS no CCAU include is created
      const methods = wut ? [...tests.matchAll(/METHODS (\w+) FOR TESTING/g)].map((x) => x[1].toUpperCase()) : [];
      sys.classes.set(name, {wut, methods});
      if (!row(`CLAS ${name}`)) {
        sys.tadir.push({item: `CLAS ${name}`, devclass: pkg});
        sys.stamps.set(`CLAS ${name}`, stampOf(`CLAS ${name}`));
        written.push(`CLAS ${name}`);
      }
      if (failedImport) break; // deserialize stopped partway
    }
    for (const item of written) tadir.push({pgmid: "R3TR", object: item.slice(0, 4), objName: item.slice(5), devclass: pkg, created: true});
    // what the job reports is what it did; a change after it (afterImport) is somebody else's
    const reported = {repoKey: repo.key, repoName: repo.name};
    if (intruder) sys.tadir.push({item: intruder, devclass: pkg});
    if (childPackage) sys.packages.set(childPackage, pkg);
    afterImport(sys);
    const log = [...importErrors.map((t) => ({type: "E", text: t, objType: "TABL", objName: "ZOSD_BROKEN"})),
      ...importWarnings.map((t) => ({type: "W", text: t, objType: "CLAS", objName: "ZCL_OSD_PROVE_DEMO"}))];
    const st = status ?? (failedImport ? "failed" : importErrors.length ? "imported_with_errors" : "imported");
    return {...base, status: st, ...reported, repoCreated: true, log, tadir,
      message: failedImport ? "deserialize stopped partway: CX_SY_ITAB_LINE_NOT_FOUND" : ""};
  };
  return {
    sys,
    async call(action, target, params) {
      sys.calls.push({action, target, params});
      const pre = action === "analyze" ? kindOf(params.code)
        : action === "system" ? {git_import_zip: "import", git_import_status: "status", git_delete_objects: "delete"}[params.type]
          : action === "read" ? "inventory" : action;
      beforeCall(sys, pre);
      if (action === "create") {
        if (sys.packages.has(params.name)) return `ERROR: package ${params.name} already exists`;
        sys.packages.set(params.name, "");
        sys.tadir.push({item: `DEVC ${params.name}`, devclass: params.name});
        return `Created package ${params.name}`;
      }
      if (action === "analyze" && params.type === "execute_abap") {
        const code = params.code;
        assert.match(code.trimEnd().split("\n").at(-1), /^RETURN_VALUE\( lt_out \)\.$/, "every snippet ends in its one RETURN_VALUE( )");
        assert.equal(code.match(/RETURN_VALUE\(/g).length, 1, "and calls it once");
        assert.doesNotMatch(code, /cl_abap_unit_assert=>fail/, "no result through an alert title");
        assert.ok(/^[\x00-\x7f]*$/.test(code), "snippet is ASCII");
        const kind = kindOf(code);
        sys.calls.at(-1).kind = kind;
        const pkg = /iv_package = '([^']+)'/.exec(code)?.[1] ?? /lv_where <> '([^']+)'/.exec(code)?.[1]
          ?? /lv_dev <> '([^']+)'/.exec(code)?.[1] ?? /devclass = '([^']+)'/.exec(code)?.[1];
        const rows = exec(kind, code, pkg);
        return execAnswer[kind] !== undefined ? execAnswer[kind](rows) : answer(rows);
      }
      if (action === "system" && params.type === "git_import_zip") {
        sys.calls.at(-1).kind = "import";
        assert.equal(params.overwrite, false, "the import never overwrites");
        assert.equal(params.repo_name, `OSDPROVE ${params.package}`);
        const a = editImport(importZip(params));
        sys.importAnswer = a;
        if (pendingPolls > 0) return json({job: a.job, jobCount: a.jobCount, status: "pending", package: a.package, note: "still running"});
        return json(a, ["refused", "failed", "unknown"].includes(a.status));
      }
      if (action === "system" && params.type === "git_import_status") {
        sys.calls.at(-1).kind = "status";
        assert.equal(params.job, "12345678");
        sys.polls += 1;
        if (sys.polls < pendingPolls) return json({job: "ZVSP_GIT_IMPORT", jobCount: "12345678", status: "pending"});
        const a = sys.importAnswer;
        return json(a, ["refused", "failed", "unknown"].includes(a.status));
      }
      if (action === "system" && params.type === "git_delete_objects") {
        sys.calls.at(-1).kind = "delete";
        const pkg = params.package;
        const res = {package: pkg, objects: [], repoDeleted: false, packageDeleted: false};
        let failed;
        for (const it of params.objects) {
          const [type, name] = it.split(" ");
          const o = {type, name};
          if (type === "DEVC") Object.assign(o, {status: "skipped", reason: "a package is not deleted as an item"});
          else if (row(it)?.devclass !== pkg) Object.assign(o, {status: "skipped", reason: `not in package ${pkg} (TADIR)`});
          else if (undeletable.has(it)) { Object.assign(o, {status: "failed", reason: "Deletion of object failed"}); failed = o; }
          else {
            sys.tadir = sys.tadir.filter((t) => t.item !== it);
            sys.files.delete(it);
            sys.stamps.delete(it);
            sys.deleted.push(it);
            o.status = "deleted";
          }
          res.objects.push(o);
        }
        if (failed) {
          res.repoNote = "kept: not every object could be deleted";
          res.packageNote = "kept: not every object could be deleted";
          return json({error: `${failed.type} ${failed.name} could not be deleted: ${failed.reason}`, result: deleteEdit(res)}, true);
        }
        const rest = sys.tadir.filter((t) => t.devclass === pkg && t.item !== `DEVC ${pkg}`);
        const children = [...sys.packages].filter(([, parent]) => parent === pkg);
        const empty = rest.length === 0 && children.length === 0;
        let repo = repoOf(pkg);
        if (repo) res.repo = {key: repo.key, name: repo.name, offline: true, state: "offline"};
        if (repo && params.delete_repo && empty) {
          sys.repos = sys.repos.filter((r) => r !== repo);
          res.repoDeleted = true;
          repo = undefined;
        }
        if (empty && !repo && sys.packages.has(pkg)) {
          sys.packages.delete(pkg);
          sys.tadir = sys.tadir.filter((t) => t.item !== `DEVC ${pkg}`);
          res.packageDeleted = true;
        }
        return json(deleteEdit(res));
      }
      if (action === "read" && String(target).startsWith("DEVC ") && params?.inventory === true) {
        sys.calls.at(-1).kind = "inventory";
        const pkg = target.slice(5);
        return json(inventoryEdit({package: pkg, source: "TADIR, TDEVC (data preview)",
          objects: sys.tadir.filter((t) => t.devclass === pkg).map((t) => ({type: t.item.slice(0, 4), name: t.item.slice(5)})),
          subpackages: [...sys.packages].filter(([, parent]) => parent === pkg).map(([n]) => ({name: n})),
          abapgit_repos: sys.repos.filter((r) => r.pkg === pkg).map((r) => ({key: r.key, package: pkg, offline: true}))}));
      }
      if (action === "test") {
        const name = target.replace(/^CLAS /, "");
        assert.equal(params.object_url, `/sap/bc/adt/oo/classes/${name.toLowerCase()}`);
        if (unitText[name] !== undefined) return unitText[name];
        const c = sys.classes.get(name);
        return unitReport(c === undefined || c.methods.length === 0 ? [] : [{name: "LTCL_DOUBLE", parentName: name, testMethods: c.methods.map((m) => ({
          name: m,
          ...(failing.has(m) ? {alerts: [{kind: "failedAssertion", severity: "critical",
            title: `Critical Assertion Error: 'Expected 4, got 5'`}]} : {}),
        }))}]);
      }
      throw new Error(`unexpected call ${action} ${target}`);
    },
  };
}

/** vsp's ABAP Unit answer (full form): ok and counts over the classes */
function unitReport(classes, extra = {}) {
  const methods = classes.reduce((n, c) => n + (c.testMethods?.length ?? 0), 0);
  const failed = classes.reduce((n, c) => n + (c.testMethods ?? []).filter((m) => (m.alerts ?? []).length > 0).length, 0);
  const ok = methods > 0 && failed === 0;
  return JSON.stringify({ok, counts: {classes: classes.length, methods, passed: methods - failed, failed, classFailures: 0, warnings: 0, notRun: 0},
    ...(ok ? {} : methods === 0 ? {note: "ABAP Unit reported no test class for this object, so nothing ran"} : {}), classes, ...extra}, undefined, 2);
}

async function run(args, mcp, receiptDir = mkdtempSync(join(tmpdir(), "osd-prove-runs-")), {disagree = false} = {}) {
  const lines = [];
  const code = await main(args, {mcp, out: (l) => lines.push(String(l)), receiptDir});
  const text = lines.join("\n");
  // the two residue reads agree in every case but the one that makes them differ
  if (!disagree) assert.doesNotMatch(text, /disagree/, text);
  return {code, text, receiptDir};
}
const receiptIn = (dir) => join(dir, `${PKG}.json`);

const base = (folder = join(FIXTURE, "src")) => [folder, "--unit", "prove-demo", "--manifest", MANIFEST, "--package", PKG];
const kinds = (mcp) => mcp.sys.calls.map((c) => c.kind ?? c.action);
/** the cleanup snippets sent: the receipt items they carry, and whether
 *  they may drop the repository row */
const cleanupCalls = (mcp) => mcp.sys.calls.filter((c) => c.kind === "cleanup")
  .map((c) => ({items: itemsOf(c.params.code), drop: /DATA lv_drop TYPE abap_bool VALUE abap_true\./.test(c.params.code)}));
const clean = (mcp) => {
  assert.equal(mcp.sys.packages.size, 0);
  assert.deepEqual(mcp.sys.tadir, []);
  assert.deepEqual(mcp.sys.repos, []);
};

describe("osd-prove-on-system", () => {
  it("counts FOR TESTING methods from the parse (helpers are not tests)", () => {
    const counts = countTestMethods(join(FIXTURE, "src"));
    assert.deepEqual(counts.get("ZCL_OSD_PROVE_DEMO"), ["LTCL_DOUBLE->TWO_IS_FOUR", "LTCL_DOUBLE->ZERO_IS_ZERO"]);
    assert.deepEqual(counts.get("ZCL_OSD_PROVE_PLAIN"), []);
  });

  it("builds the zip in process, with the unit's objects", () => {
    const z = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
    assert.deepEqual(z.objects, ZIP_OBJECTS);
    const files = unzip(z.bytes);
    assert.ok(files.has(".abapgit.xml") && files.has("src/zcl_osd_prove_demo.clas.testclasses.abap"));
  });

  describe("happy path and the failures it must not hide", () => {
    it("happy path: preflight, create, git_import_zip, run, compare, cleanup in one step, residue, exit 0", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
      assert.match(text, /ZCL_OSD_PROVE_PLAIN\s+\| 0\s+\| 0\s+\| 0/);
      // one chunk read per XML file: the receipt keeps its canonical digest
      assert.deepEqual(kinds(mcp), ["preflight", "create", "import", "receipt", "chunk", "chunk", "check", "test",
        "cleanup", "residue", "inventory"]);
      const imp = mcp.sys.calls.find((c) => c.kind === "import").params;
      assert.equal(imp.package, PKG);
      assert.equal(imp.overwrite, false);
      assert.deepEqual(unzip(Buffer.from(imp.zip_base64, "base64")), unzip(buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST}).bytes));
      assert.deepEqual(cleanupCalls(mcp), [{items: ZIP_OBJECTS, drop: true}]);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      clean(mcp);
    });

    it("a deserialize error (imported_with_errors) fails the run with its log, and the receipt still cleans up", async () => {
      const mcp = fakeSystem({importErrors: ["XML parser error, unexpected end of document"]});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import imported_with_errors/);
      assert.match(text, /FAIL import log \[E\] TABL ZOSD_BROKEN: XML parser error, unexpected end of document/);
      assert.ok(!kinds(mcp).includes("test"), "no unit run over a broken import");
      assert.equal(kinds(mcp).at(-1), "inventory");
      clean(mcp);
    });

    it("a class XML without WITH_UNIT_TESTS: no CCAU on the system, the methods differ, the run fails and says why", async () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-prove-nowut-"));
      try {
        const src = join(dir, "src");
        cpSync(join(FIXTURE, "src"), src, {recursive: true});
        const xml = join(src, "zcl_osd_prove_demo.clas.xml");
        writeFileSync(xml, readFileSync(xml, "utf8").replace("<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>", ""));
        const {code, text} = await run([src, "--unit", "prove-demo", "--manifest", MANIFEST, "--package", PKG], fakeSystem());
        assert.equal(code, 1, text);
        assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 0\s+\| 0/);
        assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: test methods differ: 2 test method\(s\) on OSG, 0 on the system/);
        assert.match(text, /WITH_UNIT_TESTS is not set on the system/);
        assert.match(text, /no CCAU include on the system/);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });

    it("a failing test method on the system fails the run with its alert title", async () => {
      const {code, text} = await run(base(), fakeSystem({failing: new Set(["TWO_IS_FOUR"])}));
      assert.equal(code, 1, text);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 1/);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: fails on the system: LTCL_DOUBLE->TWO_IS_FOUR: .*Expected 4, got 5/);
    });

    it("an object abapGit could not delete fails the run: it is named and the package is kept", async () => {
      const mcp = fakeSystem({undeletable: new Set(["CLAS ZCL_OSD_PROVE_PLAIN"])});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup log \[E\] CLAS ZCL_OSD_PROVE_PLAIN: Deletion of object failed/);
      assert.match(text, /FAIL cleanup incomplete: 1 object\(s\) of the zip left/);
      assert.ok(mcp.sys.packages.has(PKG));
      assert.match(text, /^NOT proved/m);
    });

    it("a run plus --keep followed by --cleanup cleans completely, by the receipt, and removes it", async () => {
      const mcp = fakeSystem();
      const {code, text, receiptDir} = await run([...base(), "--keep"], mcp);
      assert.equal(code, 0, text);
      assert.ok(!kinds(mcp).includes("cleanup"));
      assert.match(text, /node tools\/osd-prove-on-system\.mjs --cleanup --package '\$ZOSG_TMP_TEST'/);
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      assert.equal(receipt.package, PKG);
      assert.equal(receipt.repoKey, "000000000042");
      assert.equal(receipt.repoName, OWN);
      assert.equal(receipt.repoCreated, true);
      assert.deepEqual(receipt.objects, ZIP_OBJECTS);
      assert.deepEqual(receipt.stamped.map((e) => e.item).sort(), ZIP_OBJECTS);
      assert.ok(receipt.stamped.every((e) => e.devclass === PKG && /^CLAS:\d{14}\/\d+$/.test(e.stamp)));
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 0, again.text);
      assert.match(again.text, /cleanup of \$ZOSG_TMP_TEST: complete/);
      assert.ok(!existsSync(receiptIn(receiptDir)), "the receipt goes with a complete cleanup");
      clean(mcp);
    });

    it("a complete automatic cleanup removes the receipt", async () => {
      const mcp = fakeSystem();
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /receipt: 2 object\(s\) stamped/);
      assert.ok(!existsSync(receiptIn(receiptDir)));
    });

    it("a package that is not local ($) is refused before anything is sent", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run([join(FIXTURE, "src"), "--unit", "prove-demo", "--manifest", MANIFEST,
        "--package", "ZOSG_TMP_TEST"], mcp);
      assert.equal(code, 2);
      assert.match(text, /refused: package "ZOSG_TMP_TEST" is not local/);
      assert.equal(mcp.sys.calls.length, 0);
      assert.throws(() => checkPackage("ZPROD"), /not local/);
      assert.equal(checkPackage("$zosg_tmp_x"), "$ZOSG_TMP_X");
    });
  });

  describe("P1: the run owns its package and deletes only what it brought", () => {
    it("an existing package is refused, empty or not, and nothing is written", async () => {
      for (const before of [
        {packages: {[PKG]: ""}},
        {packages: {[PKG]: ""}, tadir: [{item: "PROG ZSOMEBODY_ELSES", devclass: PKG}]},
        {packages: {[PKG]: ""}, repos: [{key: "000000000007", name: OWN, pkg: PKG}]},
      ]) {
        const mcp = fakeSystem({before});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 2, text);
        assert.match(text, /refused: package \$ZOSG_TMP_TEST exists.*Inspect it/);
        assert.deepEqual(kinds(mcp), ["preflight"]);
      }
    });

    it("an object of the zip that exists already, in any package, is refused", async () => {
      const mcp = fakeSystem({before: {packages: {ZOTHER: ""}, tadir: [{item: "CLAS ZCL_OSD_PROVE_DEMO", devclass: "ZOTHER"}]}});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 2, text);
      assert.match(text, /refused: 1 object\(s\) of the zip exist already.*\n\s+CLAS ZCL_OSD_PROVE_DEMO in ZOTHER/);
      assert.deepEqual(kinds(mcp), ["preflight"]);
    });

    it("a foreign object and a subpackage inside the package survive the cleanup and are reported", async () => {
      const mcp = fakeSystem({intruder: "PROG ZARRIVED_MEANWHILE", childPackage: "$ZOSG_TMP_TEST_SUB"});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: package \$ZOSG_TMP_TEST kept, it holds what this run did not bring\n\s+1 object\(s\):\n\s+PROG ZARRIVED_MEANWHILE\n\s+1 subpackage\(s\):\n\s+\$ZOSG_TMP_TEST_SUB/);
      assert.ok(mcp.sys.packages.has(PKG) && mcp.sys.packages.has("$ZOSG_TMP_TEST_SUB"));
      assert.deepEqual(mcp.sys.tadir.map((t) => t.item).sort(), [`DEVC ${PKG}`, "PROG ZARRIVED_MEANWHILE"]);
      assert.deepEqual(cleanupCalls(mcp)[0].items, ZIP_OBJECTS, "only the receipt's objects are in the snippet");
    });

    it("a refused import (a zip-named object that appeared after the preflight) deletes no object and writes no receipt", async () => {
      // the object is there (somebody wrote it into the package); vsp refuses
      // the import, so the object is not ours to delete
      const mcp = fakeSystem({refuseImport: "CLAS ZCL_OSD_PROVE_DEMO exists: would overwrite (action update)"});
      // the preflight does not see it: it appears right before the import
      const call = mcp.call.bind(mcp);
      let seen = false;
      mcp.call = async (action, target, params) => {
        if (action === "system" && !seen) { seen = true; mcp.sys.tadir.push({item: "CLAS ZCL_OSD_PROVE_DEMO", devclass: PKG}); }
        return call(action, target, params);
      };
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import refused: CLAS ZCL_OSD_PROVE_DEMO exists: would overwrite/);
      assert.match(text, /FAIL import log \[E\]/);
      assert.ok(!kinds(mcp).includes("receipt"));
      assert.ok(!existsSync(receiptIn(receiptDir)));
      assert.deepEqual(mcp.sys.deleted, []);
      assert.deepEqual(cleanupCalls(mcp)[0].items, [], "no receipt, no object in the cleanup");
      assert.ok(mcp.sys.tadir.some((r) => r.item === "CLAS ZCL_OSD_PROVE_DEMO"), "the foreign object stays");
      assert.ok(mcp.sys.packages.has(PKG), "and so does the package that holds it");
      const calls = mcp.sys.calls.length;
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 2, again.text);
      assert.match(again.text, /refused: no receipt for \$ZOSG_TMP_TEST.*nothing is deleted. Inspect it by hand/);
      assert.equal(mcp.sys.calls.length, calls, "no call to the system");
    });

    it("a refused import into an empty package: the cleanup deletes the empty package the run created, and only that", async () => {
      const mcp = fakeSystem({refuseImport: "an unmet requirement"});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.deepEqual(mcp.sys.deleted, []);
      assert.deepEqual(cleanupCalls(mcp), [{items: [], drop: false}]);
      clean(mcp);
    });

    it("--cleanup without a receipt refuses before any connection to a system is made", async () => {
      const saved = process.env.OSD_MCP_CONFIG;
      process.env.OSD_MCP_CONFIG = join(tmpdir(), "osd-prove-no-such-mcp.json");
      try {
        const lines = [];
        const code = await main(["--cleanup", "--package", PKG],
          {out: (l) => lines.push(l), receiptDir: mkdtempSync(join(tmpdir(), "osd-prove-runs-"))});
        assert.equal(code, 2, lines.join("\n"));
        assert.match(lines.join("\n"), /refused: no receipt/);
      } finally {
        if (saved === undefined) delete process.env.OSD_MCP_CONFIG;
        else process.env.OSD_MCP_CONFIG = saved;
      }
    });

    it("--cleanup with a zip list but no receipt refuses: the zip list alone never authorises a delete", async () => {
      const mcp = fakeSystem({before: {packages: {[PKG]: ""}, tadir: [{item: "CLAS ZCL_OSD_PROVE_DEMO", devclass: PKG}],
        repos: [{key: "000000000042", name: OWN, pkg: PKG}]}});
      const again = await run([...base(), "--cleanup"], mcp);
      assert.equal(again.code, 2, again.text);
      assert.equal(mcp.sys.calls.length, 0);
    });

    it("an object changed after the import survives the automatic cleanup and a later --cleanup", async () => {
      const mcp = fakeSystem({touchAfterReceipt: new Set(["CLAS ZCL_OSD_PROVE_PLAIN"]),
        afterReceipt: (sys) => sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN").set("zcl_osd_prove_plain.clas.abap", "edited by somebody\n")});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import \(stamp now "CLAS:20261001130000\/9"\) and its content differs from the receipt's hash: a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(existsSync(receiptIn(receiptDir)), "an incomplete cleanup keeps the receipt");
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 1, again.text);
      assert.match(again.text, /CLAS ZCL_OSD_PROVE_PLAIN changed since the import/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(mcp.sys.tadir.some((r) => r.item === "CLAS ZCL_OSD_PROVE_PLAIN"));
    });

    it("an object replaced right before the cleanup call is not deleted", async () => {
      // somebody puts another version in place after the receipt and the
      // tests: its stamp and its content differ, and the step that checks
      // them is the step that deletes
      const replaced = "CLASS zcl_osd_prove_plain DEFINITION PUBLIC. \" somebody else's version\nENDCLASS.\n";
      const mcp = fakeSystem({beforeCall: (sys, kind) => {
        if (kind !== "cleanup" || sys.replaced) return;
        sys.replaced = true;
        sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN").set("zcl_osd_prove_plain.clas.abap", replaced);
        sys.stamps.set("CLAS ZCL_OSD_PROVE_PLAIN", "CLAS:20261001130500/9");
      }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.equal(mcp.sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN").get("zcl_osd_prove_plain.clas.abap"), replaced);
    });

    it("the check and the delete are one call: a replacement after the cleanup's first call is never deleted", async () => {
      // the pin on the single step: whatever the tool sends after its first
      // cleanup call, a version put in place at that moment must survive. A
      // design that decides in one call and deletes in the next (the split
      // through vsp's git_delete_objects, which takes no expected version)
      // deletes it, and fails here
      const replaced = "CLASS zcl_osd_prove_plain DEFINITION PUBLIC. \" put in place after the check\nENDCLASS.\n";
      let cleanupSeen = false;
      const mcp = fakeSystem({beforeCall: (sys, kind) => {
        if (kind === "cleanup" || kind === "decide") { cleanupSeen = true; return; }
        if (!cleanupSeen || sys.replaced) return;
        sys.replaced = true;
        if (!sys.tadir.some((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN")) sys.tadir.push({item: "CLAS ZCL_OSD_PROVE_PLAIN", devclass: PKG});
        if (!sys.files.has("CLAS ZCL_OSD_PROVE_PLAIN")) sys.files.set("CLAS ZCL_OSD_PROVE_PLAIN", new Map());
        sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN").set("zcl_osd_prove_plain.clas.abap", replaced);
        sys.stamps.set("CLAS ZCL_OSD_PROVE_PLAIN", "CLAS:20261001130500/9");
      }});
      await run(base(), mcp);
      assert.ok(mcp.sys.replaced, "the replacement happened");
      assert.ok(mcp.sys.tadir.some((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN"), "the replaced class survives");
      assert.equal(mcp.sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN")?.get("zcl_osd_prove_plain.clas.abap"), replaced);
      assert.ok(!kinds(mcp).includes("delete"), "no unconditional delete through vsp");
    });

    it("the cleanup hands vsp only the zip's items, even when the package holds more", async () => {
      const mcp = fakeSystem({intruder: "TABL ZSOMEBODY_ELSES"});
      await run(base(), mcp);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      const code = mcp.sys.calls.find((c) => c.kind === "cleanup").params.code;
      assert.deepEqual(code.match(/APPEND `[^`]+` TO lt_items\./g).map((l) => l.slice(8, -14)), ZIP_OBJECTS);
      assert.doesNotMatch(code, /ZSOMEBODY_ELSES/);
      assert.match(code, /SELECT SINGLE \* FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_type AND obj_name = @lv_name/);
      assert.match(code, /ELSEIF ls_db-devclass <> '\$ZOSG_TMP_TEST'\./);
      assert.match(code, /zcl_abapgit_objects=>delete\( it_tadir = lt_tadir ii_log = li_log \)/);
      assert.match(code, /zcl_abapgit_repo_srv=>get_instance\( \)->delete\( li_repo \)/);
      assert.match(code, /SELECT devclass FROM tdevc WHERE parentcl = '\$ZOSG_TMP_TEST'/);
      assert.match(code, /IF lv_go = abap_true AND \( li_repo IS NOT BOUND OR lv_gone = abap_true \)\n\s+AND lt_rest IS INITIAL AND lt_children IS INITIAL\./);
      assert.doesNotMatch(code, /purge/);
      const res = mcp.sys.calls.find((c) => c.kind === "residue").params.code;
      assert.match(res, /SELECT devclass FROM tdevc WHERE parentcl = '\$ZOSG_TMP_TEST'/);
      assert.match(res, /stamp_left/);
    });

    it("a zip item found in another package is not touched and is reported", async () => {
      const mcp = fakeSystem({afterImport: (sys) => {
        sys.tadir.find((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN").devclass = "ZOTHER";
      }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL receipt: CLAS ZCL_OSD_PROVE_PLAIN is in package ZOTHER, not \$ZOSG_TMP_TEST; not in the receipt, not touched/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(mcp.sys.tadir.some((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN" && t.devclass === "ZOTHER"));
    });

    it("a foreign repository that appears after the preflight: vsp refuses the import, and the cleanup deletes nothing", async () => {
      const mcp = fakeSystem();
      const call = mcp.call.bind(mcp);
      mcp.call = async (action, target, params) => {
        const r = await call(action, target, params);
        if (action === "create") mcp.sys.repos.push({key: "000000000007", name: "TEAM_X_PROJECT", pkg: PKG});
        return r;
      };
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import refused: package \$ZOSG_TMP_TEST has repository 000000000007 named TEAM_X_PROJECT/);
      assert.match(text, /FAIL cleanup: refused: repository 000000000007 named TEAM_X_PROJECT/);
      assert.deepEqual(mcp.sys.deleted, []);
      assert.equal(mcp.sys.repos.length, 1);
    });

    it("a repository key that changed between import and cleanup refuses the cleanup", async () => {
      const mcp = fakeSystem({afterImport: (sys) => { sys.repos[0].key = "000000000099"; }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: refused: repository 000000000099 named OSDPROVE \$ZOSG_TMP_TEST is not the one this run imported into/);
      assert.deepEqual(mcp.sys.deleted, []);
    });

    it("a renamed repository refuses the cleanup", async () => {
      const mcp = fakeSystem({afterImport: (sys) => { sys.repos[0].name = "RENAMED"; }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: refused: repository 000000000042 named RENAMED/);
      assert.deepEqual(mcp.sys.deleted, []);
    });

    it("an import answer without a repository key: the cleanup refuses any repository", async () => {
      const mcp = fakeSystem({editImport: (a) => ({...a, repoKey: undefined})});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: the answer carries no repository key/);
      assert.match(text, /FAIL cleanup: refused: repository 000000000042/);
      assert.deepEqual(mcp.sys.deleted, []);
    });

    it("the repository row goes only when this run's import created it: repoCreated false keeps it", async () => {
      const mcp = fakeSystem({editImport: (a) => ({...a, repoCreated: false})});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /import: repository 000000000042 was not created by this import/);
      assert.deepEqual(cleanupCalls(mcp), [{items: ZIP_OBJECTS, drop: false}]);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS, "the objects of the receipt still go");
      assert.deepEqual(mcp.sys.repos.map((r) => r.key), ["000000000042"], "the row is left registered");
      assert.match(text, /FAIL cleanup incomplete: 1 repository left/);
      assert.equal(JSON.parse(readFileSync(receiptIn(receiptDir), "utf8")).repoCreated, false);
    });

    it("a receipt that does not record repoCreated (an older version) never deletes the row", async () => {
      const mcp = fakeSystem();
      const {receiptDir} = await run([...base(), "--keep"], mcp);
      const file = receiptIn(receiptDir);
      const receipt = JSON.parse(readFileSync(file, "utf8"));
      delete receipt.repoCreated;
      writeFileSync(file, JSON.stringify(receipt));
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 1, again.text);
      assert.match(again.text, /does not record whether its run created repository 000000000042/);
      assert.equal(cleanupCalls(mcp)[0].drop, false);
      assert.equal(mcp.sys.repos.length, 1);
    });

    it("the cleanup snippet names the key and the tool's repository, takes nothing but a key, and deletes in the step that checks", () => {
      const entries = ZIP_OBJECTS.map((item) => ({item, stamp: "CLAS:20261001120000/9"}));
      const code = cleanupAbap(PKG, entries, "000000000042", true);
      assert.match(code, /get_key\( \) <> '000000000042' OR li_repo->get_name\( \) <> 'OSDPROVE \$ZOSG_TMP_TEST'/);
      assert.doesNotMatch(code, /purge/);
      // lt_tadir is filled only where lv_same holds, and handed to abapGit after the loop, in the same snippet
      assert.match(code, /IF lv_same = abap_true\.\n\s+lv_del = lv_del \+ 1\.\n.*k = 'delete'.*\n\s+CLEAR ls_tadir\.\n\s+MOVE-CORRESPONDING ls_db TO ls_tadir\.\n\s+APPEND ls_tadir TO lt_tadir\./);
      assert.equal(code.match(/APPEND ls_tadir TO lt_tadir\./g).length, 2, "the decided objects, and the package entry");
      assert.ok(code.indexOf("zcl_abapgit_objects=>delete( it_tadir = lt_tadir ii_log") > code.indexOf("APPEND ls_tadir TO lt_tadir."));
      assert.match(code, /DATA lv_drop TYPE abap_bool VALUE abap_true\./);
      assert.match(cleanupAbap(PKG, entries, "000000000042"), /DATA lv_drop TYPE abap_bool VALUE abap_false\./, "the row is kept unless asked");
      assert.throws(() => cleanupAbap(PKG, entries, "42' OR 1 = '1"), /not a repository key/);
      assert.throws(() => cleanupAbap(PKG, [{item: "CLAS ZCL_X` TO lt_items. DELETE FROM tadir.", stamp: "CLAS:20261001120000/9"}]),
        /cannot be put into an ABAP literal/);
      assert.throws(() => cleanupAbap(PKG, [{item: "CLAS ZCL_X", stamp: "x` TO lt_stamps."}]), /not a stamp/);
      assert.throws(() => residueAbap(PKG, ZIP_OBJECTS, "1' OR '1"), /not a repository key/);
      assert.match(code, /IF lv_stamp IS INITIAL OR lv_stamp <> lv_want\./);
    });

    it("the residue read and vsp's inventory must agree; an inventory that could not check repositories fails", async () => {
      const a = await run(base(), fakeSystem({inventoryEdit: (i) => ({...i, objects: [{type: "PROG", name: "ZGHOST"}]})}), undefined, {disagree: true});
      assert.equal(a.code, 1, a.text);
      assert.match(a.text, /FAIL residue: vsp's inventory and the residue read disagree about \$ZOSG_TMP_TEST: inventory \[PROG ZGHOST\], residue \[\]/);
      const b = await run(base(), fakeSystem({inventoryEdit: (i) => ({...i, abapgit_repos: null, skipped: ["abapGit repositories: free SQL is blocked"]})}));
      assert.equal(b.code, 1, b.text);
      assert.match(b.text, /FAIL residue: inventory: the abapGit repositories were not checked \(abapGit repositories: free SQL is blocked\)/);
      const c = await run(base(), fakeSystem({inventoryEdit: (i) => ({...i, objects_truncated: true})}));
      assert.equal(c.code, 1, c.text);
      assert.match(c.text, /FAIL residue: inventory: the answer is truncated/);
    });

    it("an inventory without its objects or subpackages list is not an empty package; null is vsp's empty list", async () => {
      const bare = await run(base(), fakeSystem({inventoryEdit: () => ({abapgit_repos: []})}));
      assert.equal(bare.code, 1, bare.text);
      assert.match(bare.text, /FAIL residue: inventory: the answer has no objects or subpackages list/);
      const noSubs = await run(base(), fakeSystem({inventoryEdit: (i) => ({objects: i.objects, abapgit_repos: i.abapgit_repos})}));
      assert.equal(noSubs.code, 1, noSubs.text);
      assert.match(noSubs.text, /no objects or subpackages list/);
      const nulls = await run(base(), fakeSystem({inventoryEdit: (i) => ({...i, objects: i.objects.length ? i.objects : null, subpackages: null})}));
      assert.equal(nulls.code, 0, nulls.text);
    });

    it("a deleted object whose source or dictionary rows survived is residue", async () => {
      const mcp = fakeSystem();
      const call = mcp.call.bind(mcp);
      mcp.call = async (action, target, params) => {
        const r = await call(action, target, params);
        // the TADIR row went, the REPOSRC rows stayed
        if (params?.type === "execute_abap" && /^" osdprove:cleanup$/m.test(params.code)) mcp.sys.stamps.set("CLAS ZCL_OSD_PROVE_DEMO", "CLAS:20261001120000/9");
        return r;
      };
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup incomplete: CLAS ZCL_OSD_PROVE_DEMO has no TADIR row but its source or dictionary rows are still there/);
    });
  });

  describe("P2: missing or unreadable evidence is never green", () => {
    it("an import answer without a status fails", async () => {
      const {code, text} = await run(base(), fakeSystem({editImport: (a) => ({...a, status: undefined})}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: status missing/);
    });

    it("W lines in the log of an import pass and are shown", async () => {
      const {code, text} = await run(base(), fakeSystem({importWarnings: ["object already exists"]}));
      assert.equal(code, 0, text);
      assert.match(text, /import: status imported; .*\[W\] CLAS ZCL_OSD_PROVE_DEMO: object already exists/);
    });

    it("an E line in the log fails even under status imported", async () => {
      const {code, text} = await run(base(), fakeSystem({editImport: (a) => ({...a, log: [{type: "E", text: "boom"}]})}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import log \[E\] boom/);
    });

    it("refused, failed and imported_with_errors each fail the run with the log; an unknown status too", async () => {
      for (const [status, extra] of [["refused", "refused"], ["failed", "failed: deserialize"], ["imported_with_errors", "imported_with_errors"], ["Q", "status Q"]]) {
        const {code, text} = await run(base(), fakeSystem({editImport: (a) => ({...a, status, message: "deserialize", log: [{type: "E", text: `the ${status} log`}]})}));
        assert.equal(code, 1, `${status}: ${text}`);
        assert.match(text, new RegExp(`FAIL import:? ${extra}`), status);
        assert.match(text, new RegExp(`the ${status} log`), status);
      }
    });

    it("a refused import gets no receipt even when its answer names a repository: nothing is deleted", async () => {
      // vsp removes the repository a refused import created; its key may still be in the answer
      const mcp = fakeSystem({editImport: (a) => ({...a, status: "refused", message: "a conflict", log: [{type: "E", text: "conflict"}]})});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.ok(!kinds(mcp).includes("receipt"), "no receipt step");
      assert.ok(!existsSync(receiptIn(receiptDir)));
      assert.deepEqual(mcp.sys.deleted, []);
      assert.deepEqual(cleanupCalls(mcp)[0].items, []);
    });

    it("a failed import (stopped partway) gets a receipt, so what it did write is cleaned up", async () => {
      const mcp = fakeSystem({failedImport: true});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import failed: deserialize stopped partway/);
      assert.match(text, /FAIL receipt: CLAS ZCL_OSD_PROVE_PLAIN is not on the system after the import/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      clean(mcp);
    });

    it("an import job still running is asked about through git_import_status; one that never ends deletes nothing", async () => {
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const osg = {mode: "count", methods: async () => ({methods: 2, names: ["LTCL_DOUBLE->TWO_IS_FOUR", "LTCL_DOUBLE->ZERO_IS_ZERO"], failing: []})};
      const done = fakeSystem({pendingPolls: 2});
      const r1 = await prove({folder: "x", unit: "u", pkg: PKG, receiptFile: receiptIn(mkdtempSync(join(tmpdir(), "osd-prove-runs-"))), mcp: done,
        osg, zipper: () => ({...real, classes: ["ZCL_OSD_PROVE_DEMO"]}), importPoll: {tries: 5, delayMs: 0}});
      assert.equal(r1.ok, true, r1.problems.join("\n"));
      assert.equal(kinds(done).filter((k) => k === "status").length, 2);
      clean(done);
      const never = fakeSystem({pendingPolls: 99});
      const r2 = await prove({folder: "x", unit: "u", pkg: PKG, receiptFile: receiptIn(mkdtempSync(join(tmpdir(), "osd-prove-runs-"))), mcp: never,
        osg, zipper: () => real, importPoll: {tries: 3, delayMs: 0}});
      assert.equal(r2.ok, false);
      assert.match(r2.problems.join("\n"), /import: status pending/);
      assert.match(r2.problems.join("\n"), /cleanup skipped: the import job may still be running/);
      assert.ok(!kinds(never).includes("cleanup"), "nothing is decided or deleted");
    });

    it("an import call that breaks (no answer) is treated as a job that may be running: nothing is deleted", async () => {
      const mcp = fakeSystem();
      const call = mcp.call.bind(mcp);
      mcp.call = async (action, target, params) => {
        if (params?.type === "git_import_zip") throw new Error("MCP tools/call timed out after 900000 ms");
        return call(action, target, params);
      };
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup skipped/);
      assert.ok(!kinds(mcp).includes("cleanup"));
    });

    it("a snippet result that is not JSON, cut, or without its end row fails closed", async () => {
      const cut = await run(base(), fakeSystem({execAnswer: {receipt: (rows) => answer(rows, {edit: (t) => t.slice(0, Math.floor(t.length / 2))})}}));
      assert.equal(cut.code, 1, cut.text);
      assert.match(cut.text, /FAIL receipt not written, so no object will be deleted: receipt: result_text is not JSON, so it may be cut/);
      const noEnd = await run(base(), fakeSystem({execAnswer: {receipt: (rows) => answer(rows, {end: false})}}));
      assert.equal(noEnd.code, 1, noEnd.text);
      assert.match(noEnd.text, /receipt: the result has no end row, so it may be cut/);
      const old = await run(base(), fakeSystem({execAnswer: {preflight: () => "Program: ZTEMP_EXEC_1\nSuccess: false\nMessage: Critical Assertion Error: 'x'"}}));
      assert.equal(old.code, 2, old.text);
      assert.match(old.text, /refused: preflight: the answer is not JSON \(vsp v2\.58\.0-54/);
      const died = await run(base(), fakeSystem({execAnswer: {check: () => JSON.stringify({success: false, programName: "Z", output: [], cleanedUp: true,
        message: "The code did not finish", failure: {kind: "exception", severity: "critical", title: "Exception Error <CX_SY_OPEN_SQL_DB>", line: 12}})}}));
      assert.equal(died.code, 1, died.text);
      assert.match(died.text, /FAIL class check: the snippet did not finish: Exception Error <CX_SY_OPEN_SQL_DB> \(line 12 of the snippet\)/);
      const two = await run(base(), fakeSystem({execAnswer: {check: () => JSON.stringify({success: true, output: ["a", "b"], result_text: ["a", "b"]})}}));
      assert.match(two.text, /FAIL class check: more than one value came back/);
    });

    it("rowsOf: the end row must be the last and the only one, every row a {K, V} of strings", () => {
      const ok = rowsOf(answer([["a", "1"]]), "t");
      assert.deepEqual(ok, [{k: "a", v: "1"}]);
      const wrap = (arr) => JSON.stringify({success: true, result_text: JSON.stringify(arr)});
      assert.throws(() => rowsOf(wrap([{K: "end", V: "OSDPROVE"}, {K: "a", V: "1"}]), "t"), /no end row/);
      assert.throws(() => rowsOf(wrap([{K: "a", V: 1}, {K: "end", V: "OSDPROVE"}]), "t"), /not \{K, V\}/);
      assert.throws(() => rowsOf(wrap({K: "end", V: "OSDPROVE"}), "t"), /not the snippet's table/);
      assert.throws(() => rowsOf("ERROR: execute_abap is blocked", "t"), /vsp refused the call/);
      assert.throws(() => rowsOf(JSON.stringify({success: true}), "t"), /no value came back/);
      // lower-case keys (another JSON writer) are read the same
      assert.deepEqual(rowsOf(wrap([{k: "a", v: "1"}, {k: "end", v: "OSDPROVE"}]), "t"), [{k: "a", v: "1"}]);
    });

    it("a class without a class-check entry fails", async () => {
      const {code, text} = await run(base(), fakeSystem({dropCheck: new Set(["ZCL_OSD_PROVE_PLAIN"])}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL class check: no entry for ZCL_OSD_PROVE_PLAIN/);
    });

    it("unparseable unit JSON fails, also for a class counted at 0 on OSG", async () => {
      const {code, text} = await run(base(), fakeSystem({
        checkOverride: {ZCL_OSD_PROVE_PLAIN: "0|X|5"},
        unitText: {ZCL_OSD_PROVE_PLAIN: "Error: context canceled"},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_PLAIN: unit result is not JSON: Error: context canceled/);
    });

    it("a unit answer in the old shape (no ok, no counts) fails: it is not the report the comparison reads", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}]}]})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: the unit result is not vsp's ABAP Unit report \(ok, counts/);
    });

    it("counts that do not match the methods listed fail; so does a failures-only answer", async () => {
      const listed = [{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}]}];
      const a = await run(base(), fakeSystem({unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({ok: true, counts: {methods: 3}, classes: listed})}}));
      assert.equal(a.code, 1, a.text);
      assert.match(a.text, /the unit result counts 3 test method\(s\) and lists 2/);
      const b = await run(base(), fakeSystem({unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({ok: true, counts: {methods: 2}, onlyFailures: true, classes: []})}}));
      assert.equal(b.code, 1, b.text);
      assert.match(b.text, /lists failures only/);
    });

    it("a run vsp calls not ok, with no failure behind it, fails", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}]},
          {name: "LTCL_SLOW", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [], alerts: []}], {ok: false, notRunClasses: ["LTCL_SLOW"]})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: fails on the system: LTCL_SLOW \(class\): not run/);
    });

    it("ok false with every listed method passing and nothing named is still a failure", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}]}],
          {ok: false, note: "a class was refused for its risk level"})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: fails on the system: ZCL_OSD_PROVE_DEMO \(run\): vsp reports the run not ok: a class was refused for its risk level/);
    });

    it("unit JSON that does not name the class fails", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_X", parentName: "ZCL_OTHER", testMethods: [{name: "A"}, {name: "B"}]}])},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: the unit result names no test class of ZCL_OSD_PROVE_DEMO/);
    });

    it("nameless method entries do not count: two empty objects for the expected class fail", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{}, {}]}])},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: test methods differ: 2 test method\(s\) on OSG, 0 on the system; on OSG, not on the system: LTCL_DOUBLE->TWO_IS_FOUR, LTCL_DOUBLE->ZERO_IS_ZERO/);
      assert.match(text, /2 test method entr\(ies\) without a name, not counted/);
    });

    it("the same count with different names fails, naming the missing and the extra", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO",
          testMethods: [{name: "two_is_four"}, {name: "SOMETHING_ELSE"}]}])},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /test methods differ: 2 test method\(s\) on OSG, 2 on the system; on OSG, not on the system: LTCL_DOUBLE->ZERO_IS_ZERO; on the system, not on OSG: LTCL_DOUBLE->SOMETHING_ELSE/);
    });

    it("--osg run compares against the methods OSG ran", async () => {
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const ran = {ZCL_OSD_PROVE_DEMO: ["LTCL_DOUBLE->TWO_IS_FOUR", "LTCL_DOUBLE->ONLY_ON_OSG"], ZCL_OSD_PROVE_PLAIN: []};
      const r = await prove({folder: "x", unit: "u", pkg: PKG, receiptFile: receiptIn(mkdtempSync(join(tmpdir(), "osd-prove-runs-"))), mcp: fakeSystem(),
        osg: {mode: "run", methods: async (cls) => ({methods: ran[cls].length, names: ran[cls], failing: []})},
        zipper: () => real});
      assert.equal(r.ok, false);
      assert.match(r.problems.join("\n"), /on OSG, not on the system: LTCL_DOUBLE->ONLY_ON_OSG; on the system, not on OSG: LTCL_DOUBLE->ZERO_IS_ZERO/);
    });

    it("a zip without classes fails with nothing to prove, before any call", async () => {
      const mcp = fakeSystem();
      const r = await prove({folder: "x", unit: "u", pkg: PKG, receiptFile: receiptIn(mkdtempSync(join(tmpdir(), "osd-prove-runs-"))), mcp, osg: {mode: "count", methods: async () => ({methods: 0, names: [], failing: []})},
        zipper: () => ({bytes: Buffer.alloc(0), objects: ["TABL ZX"], classes: [], unit: "u"})});
      assert.equal(r.ok, false);
      assert.match(r.problems.join("\n"), /nothing to prove: unit "u" puts no class in the zip/);
      assert.equal(mcp.sys.calls.length, 0);
    });

    it("no test method run on the system fails with nothing to prove", async () => {
      const mcp = fakeSystem();
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const r = await prove({folder: "x", unit: "u", pkg: PKG, receiptFile: receiptIn(mkdtempSync(join(tmpdir(), "osd-prove-runs-"))), mcp, osg: {mode: "count", methods: async () => ({methods: 0, names: [], failing: []})},
        zipper: () => ({...real, classes: ["ZCL_OSD_PROVE_PLAIN"]})});
      assert.equal(r.ok, false, r.problems.join("\n"));
      assert.match(r.problems.join("\n"), /nothing to prove: no test method ran on the system/);
    });

    it("a nameless test method entry that carries an alert fails the run", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: unitReport([{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO",
          testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}, {alerts: [{title: "Critical Assertion Error: 'boom'"}]}]}])},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: fails on the system: LTCL_DOUBLE-><unnamed>: an unnamed test method failed: .*boom/);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 1/);
    });
  });

  describe("the verdict says what was established", () => {
    it("count mode: the system ran, OSG was counted and not run", async () => {
      const {code, text} = await run(base(), fakeSystem());
      assert.equal(code, 0, text);
      assert.equal(text.trimEnd().split("\n").at(-1), "system: 2 tests pass; OSG: 2 test methods counted from source, not run");
      assert.doesNotMatch(text, /same tests pass|pass on OSG/);
    });

    it("only run mode may claim the same tests pass on both", () => {
      const r = {ok: true, problems: [], osgMode: "run", systemMethods: 2, osgMethods: 2};
      assert.equal(verdict(r), "proved: the same 2 tests pass on OSG and on the system");
      assert.equal(verdict({...r, osgMode: "count"}), "system: 2 tests pass; OSG: 2 test methods counted from source, not run");
      assert.equal(verdict({...r, ok: false, problems: ["x"]}), "NOT proved: 1 problem(s)");
    });
  });

  it("--osg run: a class-level alert (class_teardown) or a not-ok run is a failure even when every method passed", async () => {
    const fakeUnit = (result) => async () => ({UnitRun: class { async run() { return result; } }});
    const passing = {testClasses: [{name: "LTCL_X", alerts: [], testMethods: [{name: "A", alerts: []}]}], ok: true};
    assert.deepEqual((await osgRunner(fakeUnit(passing)).methods("ZCL_X")).failing, []);
    const teardown = {testClasses: [{name: "LTCL_X", alerts: [{title: "class_teardown failed"}], testMethods: [{name: "A", alerts: []}]}], ok: false};
    const r1 = await osgRunner(fakeUnit(teardown)).methods("ZCL_X");
    assert.equal(r1.failing.length, 1);
    assert.match(r1.failing[0], /LTCL_X \(class\): class_teardown failed/);
    const notOk = {testClasses: [{name: "LTCL_X", alerts: [], testMethods: [{name: "A", alerts: []}]}], ok: false};
    assert.match((await osgRunner(fakeUnit(notOk)).methods("ZCL_X")).failing[0], /reported not ok/);
  });

  const allSnippets = () => {
    const e = [{item: "CLAS ZCL_A", stamp: "CLAS:20261001120000/9", files: [{name: "zcl_a.clas.abap", sha256: "a".repeat(64)}]}];
    return {
      preflight: preflightAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"]), receipt: receiptAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"]),
      cleanup: cleanupAbap("$ZOSG_TMP_X", e, "000000000042", true), residue: residueAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"], "000000000042"),
      residueNoKey: residueAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"]), check: classCheckAbap(["ZCL_A"]), list: listAbap("$ZOSG_TMP_X"),
      hash: hashAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"]), chunk: chunkAbap("$ZOSG_TMP_X", "CLAS ZCL_A", "zcl_a.clas.abap", 0, 10),
      deploy: deployAbap(Buffer.from("PK"), "$ZOSG_TMP_X", [{item: "CLAS ZCL_A", files: e[0].files}]), drop: dropRepoAbap("$ZOSG_TMP_X", "000000000042"),
    };
  };

  it("snippets are ASCII, named, and each ends with its one RETURN_VALUE( lt_out ) after the end row", () => {
    for (const [name, code] of Object.entries(allSnippets())) {
      assert.ok(/^[\x00-\x7f]*$/.test(code), name);
      assert.match(code, /^" osdprove:\w+\n/, name);
      const tail = code.trimEnd().split("\n").slice(-2);
      assert.deepEqual(tail, ["APPEND VALUE #( k = 'end' v = 'OSDPROVE' ) TO lt_out.", "RETURN_VALUE( lt_out )."], name);
      assert.equal(code.match(/RETURN_VALUE\(/g).length, 1, name);
      assert.doesNotMatch(code, /cl_abap_unit_assert|lv_out/, name);
    }
  });

  it("every snippet parses as ABAP inside vsp's execute_abap wrapper (abaplint, v757)", () => {
    // the wrapper's shape (vsp pkg/adt/workflows_execute.go): the snippet is the
    // body of a test method, RETURN_VALUE( ) a method of the same class
    const wrap = (code) => ["REPORT ztemp_exec_1.", "CLASS ltc_executor DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.",
      "  PUBLIC SECTION.", "    METHODS execute_payload FOR TESTING.", "  PRIVATE SECTION.", "    METHODS return_value IMPORTING value TYPE any.",
      "ENDCLASS.", "CLASS ltc_executor IMPLEMENTATION.", "  METHOD execute_payload.", "    DATA lv_result TYPE string.", code,
      "  ENDMETHOD.", "  METHOD return_value.", "  ENDMETHOD.", "ENDCLASS.", ""].join("\n");
    for (const [name, code] of Object.entries(allSnippets())) {
      const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify({global: {files: "/**/*.*"},
        syntax: {version: "v757", errorNamespace: "."}, rules: {parser_error: true}})));
      reg.addFile(new abaplint.MemoryFile("ztemp_exec_1.prog.abap", wrap(code)));
      reg.parse();
      const issues = reg.findIssues().filter((i) => i.getKey() === "parser_error");
      assert.deepEqual(issues.map((i) => `${i.getStart().getRow()}: ${i.getMessage()}`), [], name);
    }
  });

  describe("the receipt's content hashes: a moved stamp is not an edit", () => {
    const PLAIN_ITEM = "CLAS ZCL_OSD_PROVE_PLAIN";
    const PLAIN_ABAP = "zcl_osd_prove_plain.clas.abap";
    const PLAIN_XML = "zcl_osd_prove_plain.clas.xml";
    const keptRun = async (opts) => {
      const mcp = fakeSystem(opts);
      const r = await run([...base(), "--keep"], mcp);
      assert.equal(r.code, 0, r.text);
      return {mcp, ...r};
    };

    it("the receipt records each object's content hash, per file, and a canonical digest for XML", async () => {
      const {mcp, receiptDir} = await keptRun();
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      for (const e of receipt.stamped) {
        const files = mcp.sys.files.get(e.item);
        assert.deepEqual(e.files.map((f) => f.name).sort(), [...files.keys()].sort());
        for (const f of e.files) assert.equal(f.sha256.toUpperCase(), sha(files.get(f.name)));
        assert.match(e.hash, /^[0-9a-f]{64}$/);
        for (const f of e.files) assert.equal(f.cx !== undefined, f.name.endsWith(".xml"), f.name);
      }
      // taken in the step that reads the stamp, by the in-place mode's serialisation
      const code = mcp.sys.calls.find((c) => c.kind === "receipt").params.code;
      assert.match(code, /zcl_abapgit_objects=>serialize\(/);
      assert.match(code, /cl_abap_message_digest=>calculate_hash_for_raw\(/);
      assert.match(code, /k = 'h_file'/);
    });

    it("stamp moved, content equal to the receipt's hash: the object is deleted as ours (re-activation)", async () => {
      const mcp = fakeSystem({touchAfterReceipt: new Set([PLAIN_ITEM, "CLAS ZCL_OSD_PROVE_DEMO"])});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /CLAS ZCL_OSD_PROVE_PLAIN: stamp moved to "CLAS:20261001130000\/9" but the content equals the receipt's hash/);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      assert.ok(!existsSync(receiptIn(receiptDir)));
      clean(mcp);
    });

    it("stamp moved, content differs from the hash: kept, the run fails, the receipt stays, and a later --cleanup keeps it too", async () => {
      const mcp = fakeSystem({touchAfterReceipt: new Set([PLAIN_ITEM]),
        afterReceipt: (sys) => sys.files.get(PLAIN_ITEM).set(PLAIN_ABAP, "CLASS zcl_osd_prove_plain DEFINITION PUBLIC.\nENDCLASS. \" edited\n")});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* and its content differs from the receipt's hash: a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(existsSync(receiptIn(receiptDir)));
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 1, again.text);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(mcp.sys.tadir.some((r) => r.item === PLAIN_ITEM));
    });

    it("a stamp that did not move deletes the object as before, whatever its hash says", async () => {
      // the stamp limit (same second) stays what it was: the hash only adds a reason to delete
      const mcp = fakeSystem({afterReceipt: (sys) => sys.files.get(PLAIN_ITEM).set(PLAIN_ABAP, "edited in the same second\n")});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
    });

    it("an old receipt (no hashes) behaves as before and says so: a moved stamp is kept even when the content is unchanged", async () => {
      const {mcp, receiptDir} = await keptRun({touchAfterReceipt: new Set([PLAIN_ITEM])});
      const file = receiptIn(receiptDir);
      const receipt = JSON.parse(readFileSync(file, "utf8"));
      for (const e of receipt.stamped) { delete e.files; delete e.hash; }
      writeFileSync(file, JSON.stringify(receipt));
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 1, again.text);
      assert.match(again.text, /cleanup: the receipt carries no content hashes .*decided by the version stamp alone, as before/);
      assert.match(again.text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import \(stamp now "CLAS:20261001130000\/9"\); kept/);
      assert.doesNotMatch(again.text, /foreign edit/, "no hash was compared");
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      const code = mcp.sys.calls.filter((c) => c.kind === "cleanup").at(-1).params.code;
      assert.doesNotMatch(code, /TO lt_exp\./, "the snippet carries no hash of an old receipt");
    });

    it("an object abapGit could not hash is decided by its stamp alone; the others keep their hashes", async () => {
      const {mcp, receiptDir, text} = await keptRun({hashFail: new Set([PLAIN_ITEM])});
      assert.match(text, /receipt: no content hash for CLAS ZCL_OSD_PROVE_PLAIN \(serialisation failed\)/);
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      const byItem = new Map(receipt.stamped.map((e) => [e.item, e]));
      assert.ok(byItem.get("CLAS ZCL_OSD_PROVE_DEMO").files.length > 0);
      assert.equal(byItem.get(PLAIN_ITEM).files, undefined);
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 0, again.text);
      assert.match(again.text, /1 receipt entr\(ies\) carry no content hashes/);
    });

    it("the cleanup snippet: the hash is compared only where the stamp moved, with the in-place serialisation, and a file that is not there is a difference", async () => {
      const {receiptDir} = await keptRun();
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      const code = cleanupAbap(PKG, receipt.stamped.map((e) => ({item: e.item, stamp: e.stamp, files: e.files})), "000000000042");
      assert.match(code, /IF lv_stamp IS INITIAL OR lv_stamp <> lv_want\.[\s\S]*zcl_abapgit_objects=>serialize\([\s\S]*IF lt_a = lt_b\.\s+lv_same = abap_true\./);
      assert.match(code, /k = 'rehashed'/);
      // what the hash check decides: only an equal set of files keeps the object ours, and a stamp that did not move needs no hash
      assert.match(code, /lv_same = abap_true\.\n\s+IF lv_stamp IS INITIAL OR lv_stamp <> lv_want\.\n\s+" the stamp moved/);
      assert.match(code, /lv_same = abap_false\./);
      assert.match(code, /IF lv_same = abap_true\.\n\s+lv_del = lv_del \+ 1\.\n\s+APPEND VALUE #\( k = 'delete' v = \|\{ lv_type \}:\{ lv_name \}\| \) TO lt_out\./);
      assert.match(code, /IF lt_a IS NOT INITIAL\./);
      assert.match(code, /APPEND `CLAS ZCL_OSD_PROVE_PLAIN@zcl_osd_prove_plain\.clas\.abap=[0-9A-F]{64}` TO lt_exp\./);
      assert.throws(() => cleanupAbap(PKG, [{item: PLAIN_ITEM, stamp: "CLAS:20261001120000/9", files: [{name: "x y", sha256: "00"}]}]), /not a file entry/);
      assert.ok(STAMPED_KINDS.includes("DDLS"));
      assert.ok(!STAMPED_KINDS.includes("DCLS"), "no stamp table for DCLS is known");
    });

    describe("XML that abapGit rewrote is not an edit, if it is the same element tree", () => {
      const crlf = (sys) => sys.files.get(PLAIN_ITEM).set(PLAIN_XML, sys.files.get(PLAIN_ITEM).get(PLAIN_XML).replace(/\n/g, "\r\n"));
      const moved = new Set([PLAIN_ITEM]);

      it("only XML bytes differ and the canonical tree equals the receipt's: deleted, through a second cleanup call that re-checks the hashes in its step", async () => {
        let rewritten;
        const mcp = fakeSystem({touchAfterReceipt: moved, beforeCheck: (sys) => {
          crlf(sys);
          rewritten = sha(sys.files.get(PLAIN_ITEM).get(PLAIN_XML));
        }});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 0, text);
        assert.match(text, /CLAS ZCL_OSD_PROVE_PLAIN: zcl_osd_prove_plain\.clas\.xml differs in bytes from the receipt's but is the same XML element tree; accepted as unchanged/);
        assert.deepEqual(kinds(mcp).filter((k) => k === "cleanup" || k === "hash"), ["cleanup", "hash", "cleanup"]);
        assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
        // the second call expects the CURRENT bytes (the snippet checks them in its own step)
        const second = mcp.sys.calls.filter((c) => c.kind === "cleanup")[1].params.code;
        assert.ok(second.includes(`zcl_osd_prove_plain.clas.xml=${rewritten}`), "the accepted hash is the current one");
        assert.ok(!mcp.sys.calls.filter((c) => c.kind === "cleanup")[0].params.code.includes(rewritten));
        clean(mcp);
      });

      it("the XML's text changed (same shape, other value): kept, no second call", async () => {
        const mcp = fakeSystem({touchAfterReceipt: moved, beforeCheck: (sys) => sys.files.get(PLAIN_ITEM).set(PLAIN_XML,
          sys.files.get(PLAIN_ITEM).get(PLAIN_XML).replace("prove-on-system fixture", "somebody's description"))});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* a foreign edit; kept/);
        assert.equal(kinds(mcp).filter((k) => k === "cleanup").length, 1);
        assert.ok(mcp.sys.tadir.some((t) => t.item === PLAIN_ITEM));
      });

      it("an XML leaf that was empty and now holds only whitespace is a foreign edit: kept, no second call", async () => {
        const mcp = fakeSystem({touchAfterReceipt: moved,
          afterImport: (sys) => { const f = sys.files.get(PLAIN_ITEM); f.set(PLAIN_XML, f.get(PLAIN_XML).replace("<UNICODE>X</UNICODE>", "<UNICODE/>")); },
          beforeCheck: (sys) => { const f = sys.files.get(PLAIN_ITEM); f.set(PLAIN_XML, f.get(PLAIN_XML).replace("<UNICODE/>", "<UNICODE> </UNICODE>")); }});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /a foreign edit; kept/);
        assert.equal(kinds(mcp).filter((k) => k === "cleanup").length, 1);
        assert.ok(mcp.sys.tadir.some((t) => t.item === PLAIN_ITEM));
      });

      it("an XML file that is no longer one well-formed tree is kept", async () => {
        const mcp = fakeSystem({touchAfterReceipt: moved, beforeCheck: (sys) => sys.files.get(PLAIN_ITEM).set(PLAIN_XML,
          sys.files.get(PLAIN_ITEM).get(PLAIN_XML).replace("</abapGit>", ""))});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.ok(mcp.sys.tadir.some((t) => t.item === PLAIN_ITEM));
      });

      it("a source file that differs is never accepted by the XML rule, even beside an XML that only moved", async () => {
        const mcp = fakeSystem({touchAfterReceipt: moved, beforeCheck: (sys) => {
          crlf(sys);
          sys.files.get(PLAIN_ITEM).set(PLAIN_ABAP, sys.files.get(PLAIN_ITEM).get(PLAIN_ABAP) + "\n");
        }});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /a foreign edit; kept/);
        assert.equal(kinds(mcp).filter((k) => k === "cleanup").length, 1);
        assert.ok(mcp.sys.tadir.some((t) => t.item === PLAIN_ITEM));
      });

      it("a receipt whose XML has no canonical digest decides by bytes only", async () => {
        const {mcp, receiptDir} = await keptRun({touchAfterReceipt: moved, beforeCheck: crlf});
        const file = receiptIn(receiptDir);
        const receipt = JSON.parse(readFileSync(file, "utf8"));
        for (const e of receipt.stamped) for (const f of e.files) delete f.cx;
        writeFileSync(file, JSON.stringify(receipt));
        const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
        assert.equal(again.code, 1, again.text);
        assert.match(again.text, /a foreign edit; kept/);
        assert.ok(mcp.sys.tadir.some((t) => t.item === PLAIN_ITEM));
      });
    });

    describe("DDLS (CDS views)", () => {
      const DDLS = "DDLS ZOSD_PROVE_CDS";
      const withDdls = async (fn) => {
        const dir = mkdtempSync(join(tmpdir(), "osd-prove-ddls-"));
        try {
          const src = join(dir, "src");
          cpSync(join(FIXTURE, "src"), src, {recursive: true});
          writeFileSync(join(src, "zosd_prove_cds.ddls.asddls"),
            "@AbapCatalog.sqlViewName: 'ZVOSDPROVECDS'\n@EndUserText.label: 'prove fixture'\ndefine view ZOSD_PROVE_CDS\n  as select from tadir\n{\n  key obj_name as ObjName\n}\n");
          writeFileSync(join(src, "zosd_prove_cds.ddls.xml"), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DDLS>
    <DDLNAME>ZOSD_PROVE_CDS</DDLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>prove fixture</DDTEXT>
   </DDLS>
  </asx:values>
 </asx:abap>
</abapGit>
`);
          const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
          manifest.units["prove-demo"].objects.push(DDLS);
          const mfile = join(dir, "manifest.json");
          writeFileSync(mfile, JSON.stringify(manifest));
          return await fn([src, "--unit", "prove-demo", "--manifest", mfile, "--package", PKG]);
        } finally {
          rmSync(dir, {recursive: true, force: true});
        }
      };

      it("the zip carries abapGit's file names for it, and the receipt snippet reads its stamp from DDDDLSRC", async () => {
        await withDdls(async (args) => {
          const z = buildZip(args[0], {unit: "prove-demo", manifest: args[4]});
          assert.ok(z.objects.includes(DDLS));
          const files = unzip(z.bytes);
          assert.ok(files.has("src/zosd_prove_cds.ddls.asddls") && files.has("src/zosd_prove_cds.ddls.xml"));
          const code = receiptAbap(PKG, [DDLS]);
          assert.match(code, /WHEN 'DDLS'\.\s+SELECT SINGLE as4date, as4time FROM ddddlsrc WHERE ddlname = @lv_name AND as4local = 'A' INTO/);
        });
      });

      it("a CDS view in the zip is stamped, hashed and deleted like the others, and its stamp moving alone does not keep it", async () => {
        await withDdls(async (args) => {
          const mcp = fakeSystem({touchAfterReceipt: new Set([DDLS])});
          const {code, text, receiptDir} = await run(args, mcp);
          assert.equal(code, 0, text);
          assert.match(text, /receipt: 3 object\(s\) stamped/);
          assert.match(text, /DDLS ZOSD_PROVE_CDS: stamp moved .* the content equals the receipt's hash/);
          assert.deepEqual(mcp.sys.deleted.sort(), [...ZIP_OBJECTS, DDLS]);
          assert.ok(!existsSync(receiptIn(receiptDir)));
          clean(mcp);
        });
      });

      it("an edit of the CDS source (the .asddls file) is a foreign edit: kept", async () => {
        await withDdls(async (args) => {
          const mcp = fakeSystem({touchAfterReceipt: new Set([DDLS]),
            afterReceipt: (sys) => sys.files.get(DDLS).set("zosd_prove_cds.ddls.asddls", "define view ZOSD_PROVE_CDS as select from t000 { key mandt }\n")});
          const {code, text} = await run(args, mcp);
          assert.equal(code, 1, text);
          assert.match(text, /FAIL cleanup: DDLS ZOSD_PROVE_CDS changed since the import .* a foreign edit; kept/);
          assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
        });
      });
    });
  });
});
