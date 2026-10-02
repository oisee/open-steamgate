// tools/osd-prove-on-system.mjs against a fake system. Nothing here talks
// to SAP: the MCP transport is a model of what vsp v2.58.0-72 answers --
// execute_abap as JSON with result_text (the snippet's RETURN_VALUE( lt_out ),
// a table serialised as [{"K","V"}]), ABAP Unit as {ok, counts, classes},
// git_import_zip / git_import_status, `read DEVC` with inventory, and the
// two operations of vsp PR #320 in the shapes its source gives them:
// git_object_versions ({package, objects: [{type, name, package, inPackage,
// stamp, sha256, sha256Error, files, inactive}]}) and git_delete_objects with
// {type, name, expect: {sha256}} items and expect_repo {key, name}, whose
// answer is {package, objects: [{type, name, status, reason, observed}],
// repoDeleted, repo, repoNote, ...}, an error answer {error, result} when an
// object is changed or failed. It is driven by the zip the tool really
// builds: the model reads the zip -- the class XML, the test include -- so the
// WITH_UNIT_TESTS case is the system's behaviour following from the file,
// not a canned answer.
// The delete is modelled as vsp does it: per object, read the version (the
// sha256 of the object's files, "inactive") and compare it with the item's
// expect at the moment of the call; a mismatch is `changed`, the object stays,
// the others still go, and the repository and the package stay. An item
// without expect would be deleted unconditionally, and the tests see that.
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
  buildZip, checkPackage, classCheckAbap, countTestMethods, main, osgRunner, preflightAbap,
  cleanup, prove, residueAbap, rowsOf, verdict,
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
  dropCheck = new Set(), checkOverride = {}, unitText = {}, afterImport = () => {},
  afterReceipt = () => {}, execAnswer = {}, oldVsp = false, versionsError, inactive = new Set(),
  failedImport = false, refuseImport, pendingPolls = 0, inventoryEdit = (i) => i, deleteEdit = (r) => r,
  versionsEdit = (o) => o, beforeCall = () => {},
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
    .map(([n, t]) => ({n, h: sha(t).toLowerCase(), size: Buffer.byteLength(t)}));
  // vsp's object sha256: the "<file>=<sha256 of the file>" lines, sorted, joined by LF
  const objectSha = (item) => createHash("sha256").update(fileHashes(item).map((f) => `${f.n}=${f.h}`).join("\n"), "utf8").digest("hex");
  const stampOf = () => "20261001120000";
  const stampText = (item) => `v2:REPOSRC.REPOTEXT.SEOCLASSDF.SEOCLASSTX.SEOCOMPOTX:${sys.stamps.get(item)}:9:0123456789abcdef`;
  const repoOf = (pkg) => sys.repos.find((r) => r.pkg === pkg);
  const row = (item) => sys.tadir.find((t) => t.item === item);
  const json = (o, isError = false) => `${isError ? "ERROR: " : ""}${JSON.stringify(o, undefined, 2)}`;
  const exec = (kind, code, pkg) => {
    const out = [];
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
    if (kind === "check") {
      const names = [...code.matchAll(/APPEND `([A-Z0-9_]+)` TO lt_cls\./g)].map((m) => m[1]);
      for (const n of names.filter((x) => !dropCheck.has(x))) {
        if (checkOverride[n]) { out.push(["cls", `${n}|${checkOverride[n]}`]); continue; }
        const c = sys.classes.get(n);
        out.push(["cls", c === undefined ? `${n}|4||0` : `${n}|0|${c.wut ? "X" : ""}|${c.methods.length ? 10 + c.methods.length * 3 : 0}`]);
      }
      return out;
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
        sys.stamps.set(item, stampOf());
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
        sys.stamps.set(`CLAS ${name}`, stampOf());
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
        : action === "system" ? {git_import_zip: "import", git_import_status: "status", git_delete_objects: "delete", git_object_versions: "versions"}[params.type]
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
      if (action === "system" && params.type === "git_object_versions") {
        sys.calls.at(-1).kind = "versions";
        if (oldVsp) return `ERROR: unknown system operation "git_object_versions"`;
        assert.ok(Array.isArray(params.objects) && params.objects.every((o) => /^[A-Z0-9]{4} \S+$/.test(o)), "objects are TYPE NAME strings");
        const withSha = params.sha256 === true;
        if (withSha && versionsError) return `ERROR: ${versionsError}`;
        const pkg = params.package;
        const objects = params.objects.map((it) => {
          const r = row(it);
          const inPackage = r?.devclass === pkg;
          const [type, name] = it.split(" ");
          const o = {type, name, package: r?.devclass ?? "", inPackage};
          if (inPackage) {
            o.stamp = stampText(it);
            if (withSha) { o.sha256 = objectSha(it); o.files = sys.files.get(it)?.size ?? 0; }
            o.inactive = inactive.has(it);
          } else o.inactive = false;
          return versionsEdit(o);
        });
        // somebody edits an object after the receipt was read
        if (withSha) afterReceipt(sys);
        return json({package: pkg, objects});
      }
      if (action === "system" && params.type === "git_delete_objects") {
        sys.calls.at(-1).kind = "delete";
        const pkg = params.package;
        assert.ok(Array.isArray(params.objects), "objects is a list");
        for (const it of params.objects) {
          assert.ok(it !== null && typeof it === "object" && Object.keys(it).every((k) => ["type", "name", "expect"].includes(k)), `an object map: ${JSON.stringify(it)}`);
          assert.ok(it.type === "DEVC" || /^[0-9a-f]{64}$/.test(it.expect?.sha256 ?? ""), `${it.type} ${it.name} carries expect.sha256`);
          assert.deepEqual(Object.keys(it.expect ?? {}), it.type === "DEVC" ? [] : ["sha256"], "the expectation is the sha256 alone");
        }
        assert.ok(params.expect_repo === undefined || params.delete_repo === true, "expect_repo only with delete_repo");
        const res = {package: pkg, objects: [], repoDeleted: false, packageDeleted: false};
        let failed;
        for (const it of params.objects) {
          const item = `${it.type} ${it.name}`;
          const o = {type: it.type, name: it.name};
          if (it.type === "DEVC") Object.assign(o, {status: "skipped", reason: "a package is not deleted as an item"});
          else if (row(item)?.devclass !== pkg) Object.assign(o, {status: "skipped", reason: `not in package ${pkg} (TADIR)`});
          else if (inactive.has(item) || objectSha(item) !== it.expect.sha256) {
            // vsp reads the version under the lock and compares it: another version is `changed`, and kept
            Object.assign(o, {status: "changed", observed: {sha256: objectSha(item)},
              reason: inactive.has(item) ? "it has an inactive version, which its sha256 does not cover (unactivated work); not deleted"
                : `changed since its version was read (it is now sha256 ${objectSha(item)}); not deleted`});
            failed ??= o;
          } else if (undeletable.has(item)) { Object.assign(o, {status: "failed", reason: "Deletion of object failed"}); failed ??= o; }
          else {
            sys.tadir = sys.tadir.filter((t) => t.item !== item);
            sys.files.delete(item);
            sys.stamps.delete(item);
            sys.deleted.push(item);
            o.status = "deleted";
          }
          res.objects.push(o);
        }
        if (failed) {
          res.repoNote = "kept: not every object could be deleted";
          res.packageNote = "kept: not every object could be deleted";
          return json({error: `${failed.type} ${failed.name} ${failed.status === "changed" ? "was kept" : "could not be deleted"}: ${failed.reason}`, result: deleteEdit(res)}, true);
        }
        const rest = sys.tadir.filter((t) => t.devclass === pkg && t.item !== `DEVC ${pkg}`);
        const children = [...sys.packages].filter(([, parent]) => parent === pkg);
        const empty = rest.length === 0 && children.length === 0;
        let repo = repoOf(pkg);
        if (repo) res.repo = {key: repo.key, name: repo.name, offline: true, state: "offline"};
        if (repo && params.delete_repo && empty) {
          const want = params.expect_repo;
          if (want !== undefined && (want.key !== repo.key || want.name !== repo.name)) {
            res.repoNote = `kept: registered repository is ${repo.key} ${repo.name}`;
          } else {
            sys.repos = sys.repos.filter((r) => r !== repo);
            res.repoDeleted = true;
            repo = undefined;
          }
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
/** the git_delete_objects calls sent: the objects they name with their
 *  expectation, and whether they may drop the repository row (and which) */
const deleteCalls = (mcp) => mcp.sys.calls.filter((c) => c.kind === "delete")
  .map((c) => ({items: c.params.objects.map((o) => `${o.type} ${o.name}`), expects: c.params.objects.map((o) => o.expect?.sha256),
    drop: c.params.delete_repo === true, repo: c.params.expect_repo}));
const deletedItems = (mcp) => deleteCalls(mcp).flatMap((c) => c.items);
/** an edit of an object on the system: a file's text, and its stamp moves */
const edit = (sys, item, file, text) => { sys.files.get(item).set(file, text); sys.stamps.set(item, "20261001130000"); };
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
    it("happy path: preflight, version probe, create, git_import_zip, receipt, run, compare, one conditional delete, residue, exit 0", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
      assert.match(text, /ZCL_OSD_PROVE_PLAIN\s+\| 0\s+\| 0\s+\| 0/);
      assert.deepEqual(kinds(mcp), ["preflight", "versions", "create", "import", "versions", "check", "test",
        "delete", "residue", "inventory"]);
      // the probe reads one object without the sha256; the receipt reads them all with it
      const [probe, got] = mcp.sys.calls.filter((c) => c.kind === "versions").map((c) => c.params);
      assert.deepEqual([probe.package, probe.objects, probe.sha256], [PKG, [ZIP_OBJECTS[0]], false]);
      assert.deepEqual([got.package, got.objects, got.sha256], [PKG, ZIP_OBJECTS, true]);
      const imp = mcp.sys.calls.find((c) => c.kind === "import").params;
      assert.equal(imp.package, PKG);
      assert.equal(imp.overwrite, false);
      assert.deepEqual(unzip(Buffer.from(imp.zip_base64, "base64")), unzip(buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST}).bytes));
      // one call: every receipt object with its receipt sha256, the repository with its key and name
      const calls = deleteCalls(mcp);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].items, ZIP_OBJECTS);
      assert.ok(calls[0].expects.every((h) => /^[0-9a-f]{64}$/.test(h)));
      assert.deepEqual([calls[0].drop, calls[0].repo], [true, {key: "000000000042", name: OWN}]);
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
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN could not be deleted: Deletion of object failed/);
      assert.match(text, /FAIL cleanup incomplete: 1 object\(s\) of the zip left/);
      assert.ok(mcp.sys.packages.has(PKG));
      assert.match(text, /^NOT proved/m);
    });

    it("a run plus --keep followed by --cleanup cleans completely, by the receipt, and removes it", async () => {
      const mcp = fakeSystem();
      const {code, text, receiptDir} = await run([...base(), "--keep"], mcp);
      assert.equal(code, 0, text);
      assert.ok(!kinds(mcp).includes("delete"));
      assert.match(text, /node tools\/osd-prove-on-system\.mjs --cleanup --package '\$ZOSG_TMP_TEST'/);
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      assert.equal(receipt.package, PKG);
      assert.equal(receipt.repoKey, "000000000042");
      assert.equal(receipt.repoName, OWN);
      assert.equal(receipt.repoCreated, true);
      assert.deepEqual(receipt.objects, ZIP_OBJECTS);
      assert.equal(receipt.format, 2);
      assert.deepEqual(receipt.versions.map((e) => e.item).sort(), ZIP_OBJECTS);
      assert.ok(receipt.versions.every((e) => e.devclass === PKG && /^[0-9a-f]{64}$/.test(e.sha256) && /^v2:[A-Z.]+:\d{14}:\d+:[0-9a-f]{16}$/.test(e.stamp)));
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
      assert.match(text, /receipt: 2 object\(s\) with their sha256/);
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
      assert.deepEqual(deleteCalls(mcp)[0].items, ZIP_OBJECTS, "only the receipt's objects are in the call");
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
      assert.deepEqual(kinds(mcp).filter((k) => k === "versions").length, 1, "only the probe: no receipt read");
      assert.ok(!existsSync(receiptIn(receiptDir)));
      assert.deepEqual(mcp.sys.deleted, []);
      assert.deepEqual(deleteCalls(mcp), [{items: [`DEVC ${PKG}`], expects: [undefined], drop: false, repo: undefined}], "no receipt, no object in the cleanup");
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
      assert.deepEqual(deleteCalls(mcp), [{items: [`DEVC ${PKG}`], expects: [undefined], drop: false, repo: undefined}]);
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
      const mcp = fakeSystem({afterReceipt: (sys) => edit(sys, "CLAS ZCL_OSD_PROVE_PLAIN", "zcl_osd_prove_plain.clas.abap", "edited by somebody\n")});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import \(changed since its version was read \(it is now sha256 [0-9a-f]{64}\); not deleted\): a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"], "the other object still goes: a changed one does not stop the rest");
      assert.ok(existsSync(receiptIn(receiptDir)), "an incomplete cleanup keeps the receipt");
      assert.ok(mcp.sys.packages.has(PKG), "the package is kept");
      assert.deepEqual(mcp.sys.repos.map((r) => r.key), ["000000000042"], "and so is the repository");
      const again = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(again.code, 1, again.text);
      assert.match(again.text, /CLAS ZCL_OSD_PROVE_PLAIN changed since the import/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(mcp.sys.tadir.some((r) => r.item === "CLAS ZCL_OSD_PROVE_PLAIN"));
      assert.ok(mcp.sys.packages.has(PKG) && mcp.sys.repos.length === 1);
    });

    it("an object replaced right before the cleanup call is not deleted", async () => {
      // somebody puts another version in place after the receipt and the
      // tests: vsp reads the version under the lock of its DELETE and the
      // receipt's sha256 no longer matches
      const replaced = "CLASS zcl_osd_prove_plain DEFINITION PUBLIC. \" somebody else's version\nENDCLASS.\n";
      const mcp = fakeSystem({beforeCall: (sys, kind) => {
        if (kind !== "delete" || sys.replaced) return;
        sys.replaced = true;
        edit(sys, "CLAS ZCL_OSD_PROVE_PLAIN", "zcl_osd_prove_plain.clas.abap", replaced);
      }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.equal(mcp.sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN").get("zcl_osd_prove_plain.clas.abap"), replaced);
      assert.ok(mcp.sys.packages.has(PKG) && mcp.sys.repos.length === 1, "the repository and the package stay");
    });

    it("the version is the receipt's: it is read once, at the receipt, and never again before the delete", async () => {
      // an edit right after the receipt was read must not be taken for the
      // run's own: a tool that read the versions again at cleanup time (a
      // sha256 "after cleanup") would expect what is there and delete it
      const replaced = "CLASS zcl_osd_prove_plain DEFINITION PUBLIC. \" put in place after the receipt\nENDCLASS.\n";
      const mcp = fakeSystem({afterReceipt: (sys) => edit(sys, "CLAS ZCL_OSD_PROVE_PLAIN", "zcl_osd_prove_plain.clas.abap", replaced)});
      const {code} = await run(base(), mcp);
      assert.equal(code, 1);
      assert.deepEqual(kinds(mcp).filter((k) => k === "versions" || k === "delete"), ["versions", "versions", "delete"], "the probe, the receipt, one delete");
      assert.ok(mcp.sys.tadir.some((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN"), "the replaced class survives");
      assert.equal(mcp.sys.files.get("CLAS ZCL_OSD_PROVE_PLAIN")?.get("zcl_osd_prove_plain.clas.abap"), replaced);
    });

    it("the cleanup hands vsp only the zip's items, each with its expectation, even when the package holds more", async () => {
      const mcp = fakeSystem({intruder: "TABL ZSOMEBODY_ELSES"});
      await run(base(), mcp);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      const call = mcp.sys.calls.find((c) => c.kind === "delete").params;
      assert.deepEqual(call.objects.map((o) => `${o.type} ${o.name}`), ZIP_OBJECTS);
      for (const o of call.objects) assert.deepEqual(Object.keys(o).sort(), ["expect", "name", "type"]);
      assert.doesNotMatch(JSON.stringify(call), /ZSOMEBODY_ELSES/);
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
      assert.match(text, /FAIL cleanup incomplete: package \$ZOSG_TMP_TEST is still there \(repository 000000000007 named "TEAM_X_PROJECT" is registered for it\)/);
      assert.deepEqual(mcp.sys.deleted, []);
      assert.deepEqual(deleteCalls(mcp), [{items: [`DEVC ${PKG}`], expects: [undefined], drop: false, repo: undefined}]);
      assert.equal(mcp.sys.repos.length, 1);
    });

    it("a repository key that changed between import and cleanup is never dropped: the objects go, the row and the package stay", async () => {
      const mcp = fakeSystem({afterImport: (sys) => { sys.repos[0].key = "000000000099"; }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: repository 000000000042: kept: registered repository is 000000000099 OSDPROVE \$ZOSG_TMP_TEST/);
      assert.deepEqual(deleteCalls(mcp)[0].repo, {key: "000000000042", name: OWN}, "the row is asked for with the key of this run's import");
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS, "the objects are the receipt's, checked by their sha256");
      assert.deepEqual(mcp.sys.repos.map((r) => r.key), ["000000000099"]);
      assert.ok(mcp.sys.packages.has(PKG));
    });

    it("a renamed repository is never dropped", async () => {
      const mcp = fakeSystem({afterImport: (sys) => { sys.repos[0].name = "RENAMED"; }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: repository 000000000042: kept: registered repository is 000000000042 RENAMED/);
      assert.deepEqual(mcp.sys.repos.map((r) => r.name), ["RENAMED"]);
      assert.ok(mcp.sys.packages.has(PKG));
    });

    it("an import answer without a repository key: the row is never asked for", async () => {
      const mcp = fakeSystem({editImport: (a) => ({...a, repoKey: undefined})});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: the answer carries no repository key/);
      assert.match(text, /FAIL cleanup: package \$ZOSG_TMP_TEST kept, it holds what this run did not bring/);
      assert.deepEqual(deleteCalls(mcp), [{items: [`DEVC ${PKG}`], expects: [undefined], drop: false, repo: undefined}], "no receipt without a key: nothing to delete by");
      assert.deepEqual(mcp.sys.deleted, []);
    });

    it("the repository row goes only when this run's import created it: repoCreated false keeps it", async () => {
      const mcp = fakeSystem({editImport: (a) => ({...a, repoCreated: false})});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /import: repository 000000000042 was not created by this import/);
      const calls = deleteCalls(mcp);
      assert.deepEqual([calls[0].items, calls[0].drop, calls[0].repo], [ZIP_OBJECTS, false, undefined]);
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
      assert.deepEqual([deleteCalls(mcp)[0].drop, deleteCalls(mcp)[0].repo], [false, undefined]);
      assert.equal(mcp.sys.repos.length, 1);
    });

    it("the delete call is built from the receipt alone, and a receipt entry that is not one is refused", async () => {
      const entries = ZIP_OBJECTS.map((item) => ({item, sha256: "a".repeat(64)}));
      const sent = [];
      const mcp = {call: async (action, target, params) => { sent.push(params); return JSON.stringify({package: PKG, objects: []}); }};
      await cleanup(mcp, PKG, entries, {expectedKey: "000000000042", createdKey: "000000000042"});
      assert.deepEqual(sent[0], {type: "git_delete_objects", package: PKG, delete_repo: true, expect_repo: {key: "000000000042", name: OWN},
        objects: ZIP_OBJECTS.map((item) => ({type: "CLAS", name: item.slice(5), expect: {sha256: "a".repeat(64)}}))});
      sent.length = 0;
      await cleanup(mcp, PKG, entries, {expectedKey: "000000000042"});
      assert.equal(sent[0].delete_repo, undefined, "the row is kept unless this run created it");
      assert.equal(sent[0].expect_repo, undefined);
      for (const bad of [{item: "CLAS ZCL_X` TO lt_items.", sha256: "a".repeat(64)}, {item: "CLAS ZCL_X"}, {item: "CLAS ZCL_X", sha256: "A".repeat(64)}]) {
        sent.length = 0;
        const r = await cleanup(mcp, PKG, [bad], {});
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /not a receipt entry/);
        assert.equal(sent.length, 0, "nothing is sent for it");
      }
      assert.throws(() => residueAbap(PKG, ZIP_OBJECTS, "1' OR '1"), /not a repository key/);
    });

    it("users are deleted before what they use: code, tables, data elements, domains (A4H: a table whose data element went first came back changed)", async () => {
      const items = ["DOMA ZOSD_D", "DTEL ZOSD_E", "TABL ZOSD_T", "CLAS ZCL_A", "DDLS ZOSD_V", "PROG ZP", "TABL ZOSD_S", "INTF ZIF_A"];
      const sent = [];
      const mcp = {call: async (action, target, params) => { sent.push(params); return JSON.stringify({package: PKG, objects: []}); }};
      await cleanup(mcp, PKG, items.map((item) => ({item, sha256: "a".repeat(64)})), {});
      assert.deepEqual(sent[0].objects.map((o) => `${o.type} ${o.name}`),
        ["CLAS ZCL_A", "PROG ZP", "INTF ZIF_A", "DDLS ZOSD_V", "TABL ZOSD_T", "TABL ZOSD_S", "DTEL ZOSD_E", "DOMA ZOSD_D"]);
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
        if (params?.type === "git_delete_objects") mcp.sys.stamps.set("CLAS ZCL_OSD_PROVE_DEMO", "20261001120000");
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
      assert.deepEqual(deleteCalls(mcp)[0].items, [`DEVC ${PKG}`]);
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
      assert.ok(!kinds(never).includes("delete"), "nothing is decided or deleted");
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
      assert.ok(!kinds(mcp).includes("delete"));
    });

    it("a snippet result that is not JSON, cut, or without its end row fails closed", async () => {
      const cut = await run(base(), fakeSystem({execAnswer: {check: (rows) => answer(rows, {edit: (t) => t.slice(0, Math.floor(t.length / 2))})}}));
      assert.equal(cut.code, 1, cut.text);
      assert.match(cut.text, /FAIL class check: result_text is not JSON, so it may be cut/);
      const noEnd = await run(base(), fakeSystem({execAnswer: {check: (rows) => answer(rows, {end: false})}}));
      assert.equal(noEnd.code, 1, noEnd.text);
      assert.match(noEnd.text, /class check: the result has no end row, so it may be cut/);
      const old = await run(base(), fakeSystem({execAnswer: {preflight: () => "Program: ZTEMP_EXEC_1\nSuccess: false\nMessage: Critical Assertion Error: 'x'"}}));
      assert.equal(old.code, 2, old.text);
      assert.match(old.text, /refused: preflight: the answer is not JSON \(vsp v2\.58\.0-72/);
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
      preflight: preflightAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"]), residue: residueAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"], "000000000042"),
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

  describe("the receipt's sha256 and vsp's conditional delete", () => {
    const PLAIN = "CLAS ZCL_OSD_PROVE_PLAIN";
    const PLAIN_ABAP = "zcl_osd_prove_plain.clas.abap";
    const keptRun = async (opts) => {
      const mcp = fakeSystem(opts);
      const r = await run([...base(), "--keep"], mcp);
      assert.equal(r.code, 0, r.text);
      return {mcp, ...r};
    };
    const objectSha = (files) => createHash("sha256")
      .update([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, t]) => `${n}=${sha(t).toLowerCase()}`).join("\n"), "utf8").digest("hex");

    it("the receipt records each object's sha256 as vsp reads it at that moment, with its stamp", async () => {
      const {mcp, receiptDir} = await keptRun();
      const receipt = JSON.parse(readFileSync(receiptIn(receiptDir), "utf8"));
      assert.equal(receipt.format, 2);
      for (const e of receipt.versions) {
        assert.equal(e.sha256, objectSha(mcp.sys.files.get(e.item)), e.item);
        assert.match(e.stamp, /^v2:/);
      }
      assert.deepEqual(Object.keys(receipt.versions[0]).sort(), ["devclass", "item", "sha256", "stamp"]);
    });

    it("the stamp moved and the content is the receipt's (a re-activation): deleted, the sha256 decides", async () => {
      const mcp = fakeSystem({afterReceipt: (sys) => { for (const i of ZIP_OBJECTS) sys.stamps.set(i, "20261001130000"); }});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      assert.ok(!existsSync(receiptIn(receiptDir)));
      clean(mcp);
    });

    it("the content changed and the stamp did not (the same second): changed and kept, which the old stamp could not tell", async () => {
      const mcp = fakeSystem({afterReceipt: (sys) => sys.files.get(PLAIN).set(PLAIN_ABAP, "edited in the same second\n")});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* a foreign edit; kept/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
    });

    it("an object with an inactive version is changed and kept whatever its active sha256 says; the others still go; the repository and the package stay", async () => {
      const inactive = new Set();
      const mcp = fakeSystem({inactive, afterReceipt: () => inactive.add(PLAIN)});
      const {code, text, receiptDir} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import \(it has an inactive version, which its sha256 does not cover/);
      assert.deepEqual(mcp.sys.deleted, ["CLAS ZCL_OSD_PROVE_DEMO"]);
      assert.ok(mcp.sys.packages.has(PKG) && mcp.sys.repos.length === 1);
      assert.ok(existsSync(receiptIn(receiptDir)));
    });

    describe("at receipt time", () => {
      it("an object with an inactive version, or no sha256, or elsewhere is not in the receipt and is named", async () => {
        const mcp = fakeSystem({inactive: new Set(["CLAS ZCL_OSD_PROVE_DEMO"]), versionsEdit: (o) => (o.name === "ZCL_OSD_PROVE_PLAIN" && o.sha256 !== undefined
          ? {...o, sha256: "", sha256Error: "abapGit could not serialise it"} : o)});
        const {code, text, receiptDir} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /FAIL receipt: CLAS ZCL_OSD_PROVE_DEMO has an inactive version, which no sha256 covers; it will not be deleted/);
        assert.match(text, /FAIL receipt: no sha256 for CLAS ZCL_OSD_PROVE_PLAIN \(abapGit could not serialise it\); it will not be deleted/);
        assert.deepEqual(deleteCalls(mcp)[0].items, [`DEVC ${PKG}`], "nothing of the zip is asked for");
        assert.deepEqual(mcp.sys.deleted, []);
        assert.ok(existsSync(receiptIn(receiptDir)));
        assert.deepEqual(JSON.parse(readFileSync(receiptIn(receiptDir), "utf8")).versions, []);
      });

      it("a version answer that does not say whether an object is inactive (an older ZADT_VSP) fails closed: no receipt, no delete", async () => {
        const mcp = fakeSystem({versionsEdit: (o) => { const {inactive, ...rest} = o; return rest; }});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 2, text);
        assert.match(text, /refused: git_object_versions: it does not say whether CLAS ZCL_OSD_PROVE_DEMO has an inactive version/);
        assert.match(text, /vsp install zadt-vsp/);
        assert.deepEqual(kinds(mcp), ["preflight", "versions"], "refused before anything is written");
      });

      it("an answer for fewer objects, or for other ones, fails closed", async () => {
        const mcp = fakeSystem();
        const call = mcp.call.bind(mcp);
        mcp.call = async (action, target, params) => {
          const r = await call(action, target, params);
          if (params?.type !== "git_object_versions" || params.sha256 !== true) return r;
          const j = JSON.parse(r);
          return JSON.stringify({...j, objects: j.objects.slice(0, 1)});
        };
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /FAIL receipt not written, so no object will be deleted: git_object_versions: 1 answer\(s\) for 2 object\(s\)/);
        assert.deepEqual(mcp.sys.deleted, []);
      });

      it("an older vsp (no git_object_versions) is refused before anything is written, and there is no plain delete", async () => {
        const mcp = fakeSystem({oldVsp: true});
        const {code, text} = await run(base(), mcp);
        assert.equal(code, 2, text);
        assert.match(text, /refused: git_object_versions: .*unknown system operation/);
        assert.match(text, /needs vsp v2\.58\.0-72/);
        assert.deepEqual(kinds(mcp), ["preflight", "versions"]);
        assert.deepEqual(mcp.sys.calls.filter((c) => c.params?.type === "git_delete_objects"), []);
        assert.equal(mcp.sys.packages.size, 0);
      });

      it("vsp that fails the receipt read after the probe: no receipt, no object deleted, and no plain delete", async () => {
        const mcp = fakeSystem({versionsError: "ZADT_VSP too old"});
        const {code, text, receiptDir} = await run(base(), mcp);
        assert.equal(code, 1, text);
        assert.match(text, /FAIL receipt not written, so no object will be deleted: git_object_versions: .*ZADT_VSP too old/);
        assert.ok(!existsSync(receiptIn(receiptDir)));
        assert.deepEqual(mcp.sys.deleted, []);
        for (const c of deleteCalls(mcp)) assert.deepEqual(c.items, [`DEVC ${PKG}`], "never an object by name alone");
        assert.ok(mcp.sys.tadir.some((t) => t.item === ZIP_OBJECTS[0]), "what was imported stays for a human");
      });
    });

    describe("the delete's answer", () => {
      const entries = ZIP_OBJECTS.map((item) => ({item, sha256: "a".repeat(64)}));
      const residueless = (reply) => ({call: async (action, target, params) => {
        if (params?.type === "git_delete_objects") return typeof reply === "function" ? reply(params) : reply;
        throw new Error("the residue read is not reached");
      }});
      const ok = (o) => ({type: "CLAS", name: o, status: "deleted"});

      it("an error answer without a result, or one that is not JSON, is a failed cleanup that reads nothing more", async () => {
        for (const reply of ["ERROR: package $ZOSG_TMP_TEST does not exist", "ERROR: read-only mode", "nonsense", JSON.stringify({package: PKG})]) {
          const r = await cleanup(residueless(reply), PKG, entries, {});
          assert.equal(r.ok, false, reply);
          assert.match(r.problems[0], /^cleanup: /);
          assert.equal(r.problems.length, 1);
        }
      });

      it("an object not deleted, skipped, unknown, missing from the answer, or not asked about is a problem each", async () => {
        const reply = JSON.stringify({package: PKG, objects: [{type: "CLAS", name: "ZCL_OSD_PROVE_DEMO", status: "skipped", reason: "not in package"},
          {type: "PROG", name: "ZUNASKED", status: "deleted"}]});
        const mcp = {call: async (action, target, params) => (params?.type === "git_delete_objects" ? reply : (() => { throw new Error("stop"); })())};
        const r = await cleanup(mcp, PKG, entries, {});
        assert.match(r.problems.join("\n"), /cleanup: CLAS ZCL_OSD_PROVE_DEMO is not in \$ZOSG_TMP_TEST any more \(moved out of the package\?\): not in package; not touched/);
        assert.match(r.problems.join("\n"), /cleanup: vsp answered for PROG ZUNASKED, which was not asked about/);
        assert.match(r.problems.join("\n"), /cleanup: vsp did not answer for CLAS ZCL_OSD_PROVE_PLAIN/);
        const odd = JSON.stringify({package: PKG, objects: [{type: "CLAS", name: "ZCL_OSD_PROVE_DEMO", status: "gone"}, ok("ZCL_OSD_PROVE_PLAIN")]});
        const r2 = await cleanup({call: async (a, t, p) => (p?.type === "git_delete_objects" ? odd : (() => { throw new Error("stop"); })())}, PKG, entries, {});
        assert.match(r2.problems.join("\n"), /CLAS ZCL_OSD_PROVE_DEMO came back gone/);
      });
    });

    it("--cleanup on an older vsp (no git_object_versions) is refused: no git_delete_objects, so no unconditional delete", async () => {
      const {receiptDir} = await keptRun();
      const mcp = fakeSystem({oldVsp: true});
      const {code, text} = await run(["--cleanup", "--package", PKG], mcp, receiptDir);
      assert.equal(code, 2, text);
      assert.match(text, /refused: git_object_versions: .*needs vsp v2\.58\.0-72|needs vsp v2\.58\.0-72/);
      assert.deepEqual(mcp.sys.calls.filter((c) => c.params?.type === "git_delete_objects"), []);
      assert.ok(existsSync(receiptIn(receiptDir)));
    });

    it("--cleanup with a receipt of the older kind (stamps, no sha256) refuses and sends nothing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-prove-runs-"));
      writeFileSync(receiptIn(dir), JSON.stringify({package: PKG, repoKey: "000000000042", repoName: OWN, repoCreated: true, objects: ZIP_OBJECTS,
        stamped: ZIP_OBJECTS.map((item) => ({item, devclass: PKG, stamp: "CLAS:20261001120000/9"}))}));
      const mcp = fakeSystem();
      const {code, text} = await run(["--cleanup", "--package", PKG], mcp, dir);
      assert.equal(code, 2, text);
      assert.match(text, /written by an older version \(stamps, no sha256\)/);
      assert.equal(mcp.sys.calls.length, 0);
      assert.ok(existsSync(receiptIn(dir)), "the receipt is kept");
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

      it("the zip carries abapGit's file names for it, and vsp reads its version like any other object's", async () => {
        await withDdls(async (args) => {
          const z = buildZip(args[0], {unit: "prove-demo", manifest: args[4]});
          assert.ok(z.objects.includes(DDLS));
          const files = unzip(z.bytes);
          assert.ok(files.has("src/zosd_prove_cds.ddls.asddls") && files.has("src/zosd_prove_cds.ddls.xml"));
        });
      });

      it("a CDS view in the zip gets a sha256 and is deleted like the others, and its stamp moving alone does not keep it", async () => {
        await withDdls(async (args) => {
          const mcp = fakeSystem({afterReceipt: (sys) => sys.stamps.set(DDLS, "20261001130000")});
          const {code, text, receiptDir} = await run(args, mcp);
          assert.equal(code, 0, text);
          assert.match(text, /receipt: 3 object\(s\) with their sha256/);
          assert.deepEqual(mcp.sys.deleted.sort(), [...ZIP_OBJECTS, DDLS]);
          assert.ok(!existsSync(receiptIn(receiptDir)));
          clean(mcp);
        });
      });

      it("an edit of the CDS source (the .asddls file) is a foreign edit: kept", async () => {
        await withDdls(async (args) => {
          const mcp = fakeSystem({
            afterReceipt: (sys) => edit(sys, DDLS, "zosd_prove_cds.ddls.asddls", "define view ZOSD_PROVE_CDS as select from t000 { key mandt }\n")});
          const {code, text} = await run(args, mcp);
          assert.equal(code, 1, text);
          assert.match(text, /FAIL cleanup: DDLS ZOSD_PROVE_CDS changed since the import .* a foreign edit; kept/);
          assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
        });
      });
    });
  });
});
