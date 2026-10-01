// tools/osd-prove-on-system.mjs against a fake system. Nothing here talks
// to SAP: the MCP transport is a model of what vsp answered on A4H
// (2026-10-01), driven by the zip the tool really builds. The model reads
// the zip -- the class XML, the test include -- so the WITH_UNIT_TESTS case
// is the system's behaviour following from the file, not a canned answer.
// The cleanup model does what the snippet asks of abapGit and nothing more:
// it deletes the TADIR rows it is handed, the repository row, and the
// package only when nothing is in it -- so a test can see what survives.
// No child process is spawned: the tool writes its zip in process and the
// fake reads it in process (a sandbox may refuse to spawn `zip`/`unzip`).
import assert from "node:assert/strict";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {inflateRawSync} from "node:zlib";
import {
  MARK_CLOSE, MARK_OPEN, buildZip, checkPackage, cleanupAbap, classCheckAbap, countTestMethods, importAbap,
  main, osgRunner, preflightAbap, prove, verdict,
} from "../tools/osd-prove-on-system.mjs";

const FIXTURE = resolve("test/fixtures/prove-on-system");
const MANIFEST = join(FIXTURE, "manifest.json");
const PKG = "$ZOSG_TMP_TEST";
const OWN = `OSDPROVE ${PKG}`;
const ZIP_OBJECTS = ["CLAS ZCL_OSD_PROVE_DEMO", "CLAS ZCL_OSD_PROVE_PLAIN"];

/** what vsp prints for an execute_abap whose last line is fail( msg ) */
const alert = (msg) => `Program: ZTEMP_EXEC_1\nSuccess: false\nCleaned Up: true\n`
  + `Message: The code did not finish: Critical Assertion Error: '${msg}'\n\n`
  + `Raw Alerts (for debugging):\n  Kind: failedAssertion, Severity: critical\n`
  + `  Title: Critical Assertion Error: '${msg}'\n`;
const framed = (body) => alert(`${MARK_OPEN}${body}${MARK_CLOSE}`);

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

const itemsOf = (code) => [...code.matchAll(/APPEND `([A-Z0-9]{4} [A-Z0-9_/]+)` TO lt_items\./g)].map((m) => m[1]);
const colon = (item) => item.replace(" ", ":");

/** A sandbox system as far as this tool can see it: packages (name ->
 *  parent), TADIR rows ({item, devclass}), abapGit repositories ({key, name,
 *  pkg}). Knobs inject the failures and the missing evidence each test is
 *  about. */
function fakeSystem({
  importErrors = [], importWarnings = [], status, failing = new Set(),
  before = {}, intruder, childPackage, undeletable = new Set(), editImport = (m) => m,
  dropCheck = new Set(), checkOverride = {}, unitText = {}, afterImport = () => {},
} = {}) {
  const sys = {
    packages: new Map(Object.entries(before.packages ?? {})),
    tadir: [...(before.tadir ?? [])],
    repos: [...(before.repos ?? [])],
    classes: new Map(), calls: [], deleted: [],
  };
  const repoOf = (pkg) => sys.repos.find((r) => r.pkg === pkg);
  const row = (item) => sys.tadir.find((t) => t.item === item);
  return {
    sys,
    async call(action, target, params) {
      sys.calls.push({action, target, params});
      if (action === "create") {
        if (sys.packages.has(params.name)) return `ERROR: package ${params.name} already exists`;
        sys.packages.set(params.name, "");
        sys.tadir.push({item: `DEVC ${params.name}`, devclass: params.name});
        return `Created package ${params.name}`;
      }
      if (action === "analyze" && params.type === "execute_abap") {
        const code = params.code;
        assert.match(code, /cl_abap_unit_assert=>fail\( msg = /, "every snippet reports through fail( )");
        assert.ok(/^[\x00-\x7f]*$/.test(code), "snippet is ASCII");
        const pkg = /iv_package = '([^']+)'/.exec(code)?.[1];
        if (code.includes("existing={ lv_n }")) {
          sys.calls.at(-1).kind = "preflight";
          const repo = repoOf(pkg);
          const exists = itemsOf(code).map(row).filter(Boolean);
          return framed(`tdevc=${sys.packages.has(pkg) ? 1 : 0}; `
            + `${repo ? `repo=${repo.key}; repo_name=${repo.name};` : "repo=none;"}`
            + exists.map((t) => ` exists=${colon(t.item)}@${t.devclass};`).join("") + ` existing=${exists.length};`);
        }
        if (code.includes("zcl_abapgit_zip=>load")) {
          sys.calls.at(-1).kind = "import";
          const b64 = [...code.matchAll(/APPEND `([A-Za-z0-9+/=]*)` TO lt_b64\./g)].map((m) => m[1]).join("");
          const files = unzip(Buffer.from(b64, "base64"));
          const own = /iv_name = '([^']+)'/.exec(code)[1];
          let repo = repoOf(pkg);
          if (repo && repo.name !== own) {
            // the snippet's own guard: never deserialise into somebody else's repository
            return framed(`files=${files.size}; ERR the package has repository ${repo.key} named ${repo.name}, not this tool's; logs=0; tadir=0;`);
          }
          if (!repo) {
            repo = {key: "000000000042", name: own, pkg};
            sys.repos.push(repo);
          }
          const importedKey = repo.key;
          for (const [f, text] of files) {
            const m = /^src\/(zcl_[a-z0-9_]+)\.clas\.xml$/.exec(f);
            if (m === null) continue;
            const name = m[1].toUpperCase();
            const tests = files.get(`src/${m[1]}.clas.testclasses.abap`) ?? "";
            const wut = /<WITH_UNIT_TESTS>X</.test(text);
            // what A4H did (#354): without WITH_UNIT_TESTS no CCAU include is created
            const methods = wut ? [...tests.matchAll(/METHODS (\w+) FOR TESTING/g)].map((x) => x[1].toUpperCase()) : [];
            sys.classes.set(name, {wut, methods});
            if (!row(`CLAS ${name}`)) sys.tadir.push({item: `CLAS ${name}`, devclass: pkg});
          }
          if (intruder) sys.tadir.push({item: intruder, devclass: pkg});
          if (childPackage) sys.packages.set(childPackage, pkg);
          afterImport(sys);
          const logs = [...importErrors.map((e) => ` [E] ${e};`), ...importWarnings.map((e) => ` [W] ${e};`)].join("");
          const st = status ?? (importErrors.length ? "E" : importWarnings.length ? "W" : "S");
          const inPkg = sys.tadir.filter((t) => t.devclass === pkg).length;
          return alert(editImport(`${MARK_OPEN}files=${files.size}; repo=${importedKey}; status=${st};${logs} `
            + `logs=${importErrors.length + importWarnings.length}; tadir=${inPkg};${MARK_CLOSE}`));
        }
        if (code.includes("seoclassdf")) {
          sys.calls.at(-1).kind = "check";
          const names = [...code.matchAll(/APPEND `([A-Z0-9_]+)` TO lt_cls\./g)].map((m) => m[1]);
          const parts = names.filter((n) => !dropCheck.has(n)).map((n) => {
            if (checkOverride[n]) return ` ${n} ${checkOverride[n]};`;
            const c = sys.classes.get(n);
            return c === undefined ? ` ${n} found=4 wut= ccau=0;`
              : ` ${n} found=0 wut=${c.wut ? "X" : ""} ccau=${c.methods.length ? 10 + c.methods.length * 3 : 0};`;
          });
          return framed(parts.join(""));
        }
        if (code.includes("zcl_abapgit_objects=>delete")) {
          sys.calls.at(-1).kind = "cleanup";
          assert.doesNotMatch(code, /->purge\(/, "no purge");
          const want = /get_key\( \) <> '([0-9]*)'/.exec(code)?.[1];
          const ownName = /get_name\( \) <> '([^']+)'/.exec(code)[1];
          const items = itemsOf(code);
          let out = "";
          const repo = repoOf(pkg);
          const go = !(repo && ((want !== undefined && repo.key !== want) || repo.name !== ownName));
          if (!go) out += ` ERR refused: repository ${repo.key} named ${repo.name} is not the one this run imported into;`;
          let key;
          if (go) {
            const handed = [];
            for (const item of items) {
              const t = row(item);
              if (!t) out += ` absent=${colon(item)};`;
              else if (t.devclass !== pkg) out += ` elsewhere=${colon(item)}@${t.devclass};`;
              else handed.push(item);
            }
            out += ` to_delete=${handed.length};`;
            for (const item of handed) {
              if (undeletable.has(item)) {
                out += ` [E] ${item}: Deletion of object failed;`;
                continue;
              }
              sys.tadir = sys.tadir.filter((t) => t.item !== item);
              sys.deleted.push(item);
            }
            if (repo) {
              key = repo.key;
              sys.repos = sys.repos.filter((r) => r !== repo);
              out += ` repo_deleted=${key};`;
            }
          }
          out += ` repo_left=${key && sys.repos.some((r) => r.key === key) ? 1 : 0};`;
          const left = items.filter((i) => row(i)?.devclass === pkg);
          out += left.map((i) => ` item_left=${colon(i)};`).join("") + ` items_left=${left.length};`;
          const rest = sys.tadir.filter((t) => t.devclass === pkg && t.item !== `DEVC ${pkg}`);
          out += ` others=${rest.length};` + rest.map((t) => ` other=${colon(t.item)};`).join("");
          const children = [...sys.packages].filter(([, parent]) => parent === pkg).map(([n]) => n);
          out += ` children=${children.length};` + children.map((c) => ` child=${c};`).join("");
          if (go && rest.length === 0 && children.length === 0) {
            sys.packages.delete(pkg);
            sys.tadir = sys.tadir.filter((t) => t.item !== `DEVC ${pkg}`);
          }
          out += ` tdevc_left=${sys.packages.has(pkg) ? 1 : 0};`;
          return framed(out);
        }
        throw new Error("unexpected snippet");
      }
      if (action === "test") {
        const name = target.replace(/^CLAS /, "");
        assert.equal(params.object_url, `/sap/bc/adt/oo/classes/${name.toLowerCase()}`);
        if (unitText[name] !== undefined) return unitText[name];
        const c = sys.classes.get(name);
        if (c === undefined || c.methods.length === 0) return JSON.stringify({classes: null}, undefined, 2);
        return JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: name, testMethods: c.methods.map((m) => ({
          name: m,
          ...(failing.has(m) ? {alerts: [{kind: "failedAssertion", severity: "critical",
            title: `Critical Assertion Error: 'Expected 4, got 5'`}]} : {}),
        }))}]}, undefined, 2);
      }
      throw new Error(`unexpected call ${action} ${target}`);
    },
  };
}

async function run(args, mcp) {
  const lines = [];
  const code = await main(args, {mcp, out: (l) => lines.push(String(l))});
  return {code, text: lines.join("\n")};
}

const base = (folder = join(FIXTURE, "src")) => [folder, "--unit", "prove-demo", "--manifest", MANIFEST, "--package", PKG];
const kinds = (mcp) => mcp.sys.calls.map((c) => c.kind ?? c.action);
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
    it("happy path: preflight, create, import, run, compare, clean up, exit 0", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
      assert.match(text, /ZCL_OSD_PROVE_PLAIN\s+\| 0\s+\| 0\s+\| 0/);
      assert.deepEqual(kinds(mcp), ["preflight", "create", "import", "check", "test", "cleanup"]);
      assert.deepEqual(mcp.sys.deleted.sort(), ZIP_OBJECTS);
      clean(mcp);
    });

    it("a deserialize error fails the run and shows its message, and still cleans up", async () => {
      const mcp = fakeSystem({importErrors: ["TABL ZOSD_BROKEN: XML parser error, unexpected end of document"]});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import log \[E\] TABL ZOSD_BROKEN: XML parser error, unexpected end of document/);
      assert.ok(!kinds(mcp).includes("test"), "no unit run over a broken import");
      assert.equal(kinds(mcp).at(-1), "cleanup");
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
      assert.match(text, /FAIL cleanup: package \$ZOSG_TMP_TEST kept[\s\S]*CLAS ZCL_OSD_PROVE_PLAIN/);
      assert.ok(mcp.sys.packages.has(PKG));
      assert.match(text, /^NOT proved/m);
    });

    it("--keep skips the cleanup; the printed --cleanup then removes exactly what the run brought", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run([...base(), "--keep"], mcp);
      assert.equal(code, 0, text);
      assert.ok(!kinds(mcp).includes("cleanup"));
      assert.match(text, /--unit prove-demo --manifest \S+ --cleanup --package '\$ZOSG_TMP_TEST'/);
      const again = await run([...base(), "--cleanup"], mcp);
      assert.equal(again.code, 0, again.text);
      assert.match(again.text, /cleanup of \$ZOSG_TMP_TEST: complete/);
      clean(mcp);
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

    it("the import never moves an object from another package (warning_package decisions are no)", () => {
      const code = importAbap(Buffer.from("PK"), PKG);
      assert.match(code, /LOOP AT ls_checks-warning_package ASSIGNING FIELD-SYMBOL\(<ls_w>\)\.\n\s+<ls_w>-decision = zif_abapgit_definitions=>c_no\./);
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
    });

    it("an import refused for a zip-named object that appeared after the preflight deletes no object (critic round 6)", async () => {
      // the object is there (the fake wrote it into the package); the import
      // reports it would overwrite it and refuses, so it is not ours to delete
      const mcp = fakeSystem({editImport: (m) => m.replace(/status=S;/, "ERR would overwrite CLAS ZCL_OSD_PROVE_DEMO (action 3); import refused;")});
      const {code, text} = await run(base(), mcp);
      assert.notEqual(code, 0);
      assert.match(text, /would overwrite CLAS ZCL_OSD_PROVE_DEMO/);
      assert.deepEqual(mcp.sys.deleted, []);
      assert.ok(mcp.sys.tadir.some((r) => r.item === "CLAS ZCL_OSD_PROVE_DEMO"), "the foreign object stays");
    });

    it("the cleanup deletes only the zip's items, even when the package holds more", async () => {
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
      assert.match(code, /IF lv_go = abap_true AND lt_rest IS INITIAL AND lt_children IS INITIAL\./);
    });

    it("a zip item found in another package is not touched and is reported", async () => {
      const mcp = fakeSystem({afterImport: (sys) => {
        sys.tadir.find((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN").devclass = "ZOTHER";
      }});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN is in package ZOTHER, not \$ZOSG_TMP_TEST; not touched/);
      assert.ok(mcp.sys.tadir.some((t) => t.item === "CLAS ZCL_OSD_PROVE_PLAIN" && t.devclass === "ZOTHER"));
    });

    it("a foreign repository that appears after the preflight is not imported into, and nothing is deleted", async () => {
      const mcp = fakeSystem();
      const call = mcp.call.bind(mcp);
      mcp.call = async (action, target, params) => {
        const r = await call(action, target, params);
        if (action === "create") mcp.sys.repos.push({key: "000000000007", name: "TEAM_X_PROJECT", pkg: PKG});
        return r;
      };
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import failed: the package has repository 000000000007 named TEAM_X_PROJECT, not this tool's/);
      assert.match(text, /FAIL cleanup: refused: repository 000000000007 named TEAM_X_PROJECT/);
      assert.deepEqual(mcp.sys.deleted, []);
      assert.equal(mcp.sys.repos.length, 1);
      assert.match(importAbap(Buffer.from("PK"), PKG),
        /IF li_repo IS BOUND AND li_repo->get_name\( \) <> 'OSDPROVE \$ZOSG_TMP_TEST'\.[\s\S]*iv_name = 'OSDPROVE \$ZOSG_TMP_TEST'/);
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

    it("an import report without a repository key: the cleanup refuses any repository", async () => {
      const mcp = fakeSystem({editImport: (m) => m.replace(/ repo=\d+;/, "")});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: the report carries no repository key/);
      assert.match(text, /FAIL cleanup: refused: repository 000000000042/);
      assert.deepEqual(mcp.sys.deleted, []);
    });

    it("the cleanup snippet names the key and the tool's repository, and takes nothing but a key", () => {
      const code = cleanupAbap(PKG, ZIP_OBJECTS, "000000000042");
      assert.match(code, /get_key\( \) <> '000000000042' OR li_repo->get_name\( \) <> 'OSDPROVE \$ZOSG_TMP_TEST'/);
      assert.doesNotMatch(code, /purge/);
      assert.throws(() => cleanupAbap(PKG, ZIP_OBJECTS, "42' OR 1 = '1"), /not a repository key/);
      assert.throws(() => cleanupAbap(PKG, ["CLAS ZCL_X` TO lt_items. DELETE FROM tadir."]), /cannot be put into an ABAP literal/);
      assert.doesNotMatch(cleanupAbap(PKG, ZIP_OBJECTS), /get_key\( \) <>/);
    });
  });

  describe("P2: missing or unreadable evidence is never green", () => {
    it("an import report without a status fails", async () => {
      const {code, text} = await run(base(), fakeSystem({editImport: (m) => m.replace(/ status=S;/, "")}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: the report carries no abapGit status/);
    });

    it("status W passes when its W messages are carried back and shown", async () => {
      const {code, text} = await run(base(), fakeSystem({importWarnings: ["CLAS ZCL_OSD_PROVE_DEMO: object already exists"]}));
      assert.equal(code, 0, text);
      assert.match(text, /status=W; \[W\] CLAS ZCL_OSD_PROVE_DEMO: object already exists;/);
    });

    it("status W with no W message carried back fails", async () => {
      const {code, text} = await run(base(), fakeSystem({status: "W"}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import status W with no W message carried back/);
    });

    it("status E with no message carried back still fails, and so does an unknown status", async () => {
      const e = await run(base(), fakeSystem({status: "E"}));
      assert.equal(e.code, 1, e.text);
      assert.match(e.text, /FAIL import status E/);
      const q = await run(base(), fakeSystem({status: "Q"}));
      assert.equal(q.code, 1, q.text);
      assert.match(q.text, /FAIL import status Q/);
    });

    it("a missing end marker fails (the report may be cut)", async () => {
      const {code, text} = await run(base(), fakeSystem({editImport: (m) => m.replace(MARK_CLOSE, "")}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import: the report has no end marker/);
    });

    it("a class without a class-check entry fails", async () => {
      const {code, text} = await run(base(), fakeSystem({dropCheck: new Set(["ZCL_OSD_PROVE_PLAIN"])}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL class check: no entry for ZCL_OSD_PROVE_PLAIN/);
    });

    it("unparseable unit JSON fails, also for a class counted at 0 on OSG", async () => {
      const {code, text} = await run(base(), fakeSystem({
        checkOverride: {ZCL_OSD_PROVE_PLAIN: "found=0 wut=X ccau=5"},
        unitText: {ZCL_OSD_PROVE_PLAIN: "Error: context canceled"},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_PLAIN: unit result is not JSON: Error: context canceled/);
    });

    it("unit JSON that does not name the class fails", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({classes: [{name: "LTCL_X", parentName: "ZCL_OTHER", testMethods: [{name: "A"}, {name: "B"}]}]})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: the unit result names no test class of ZCL_OSD_PROVE_DEMO/);
    });

    it("nameless method entries do not count: two empty objects for the expected class fail", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO", testMethods: [{}, {}]}]})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: test methods differ: 2 test method\(s\) on OSG, 0 on the system; on OSG, not on the system: LTCL_DOUBLE->TWO_IS_FOUR, LTCL_DOUBLE->ZERO_IS_ZERO/);
      assert.match(text, /2 test method entr\(ies\) without a name, not counted/);
    });

    it("the same count with different names fails, naming the missing and the extra", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO",
          testMethods: [{name: "two_is_four"}, {name: "SOMETHING_ELSE"}]}]})},
      }));
      assert.equal(code, 1, text);
      assert.match(text, /test methods differ: 2 test method\(s\) on OSG, 2 on the system; on OSG, not on the system: LTCL_DOUBLE->ZERO_IS_ZERO; on the system, not on OSG: LTCL_DOUBLE->SOMETHING_ELSE/);
    });

    it("--osg run compares against the methods OSG ran", async () => {
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const ran = {ZCL_OSD_PROVE_DEMO: ["LTCL_DOUBLE->TWO_IS_FOUR", "LTCL_DOUBLE->ONLY_ON_OSG"], ZCL_OSD_PROVE_PLAIN: []};
      const r = await prove({folder: "x", unit: "u", pkg: PKG, mcp: fakeSystem(),
        osg: {mode: "run", methods: async (cls) => ({methods: ran[cls].length, names: ran[cls], failing: []})},
        zipper: () => real});
      assert.equal(r.ok, false);
      assert.match(r.problems.join("\n"), /on OSG, not on the system: LTCL_DOUBLE->ONLY_ON_OSG; on the system, not on OSG: LTCL_DOUBLE->ZERO_IS_ZERO/);
    });

    it("a zip without classes fails with nothing to prove, before any call", async () => {
      const mcp = fakeSystem();
      const r = await prove({folder: "x", unit: "u", pkg: PKG, mcp, osg: {mode: "count", methods: async () => ({methods: 0, names: [], failing: []})},
        zipper: () => ({bytes: Buffer.alloc(0), objects: ["TABL ZX"], classes: [], unit: "u"})});
      assert.equal(r.ok, false);
      assert.match(r.problems.join("\n"), /nothing to prove: unit "u" puts no class in the zip/);
      assert.equal(mcp.sys.calls.length, 0);
    });

    it("no test method run on the system fails with nothing to prove", async () => {
      const mcp = fakeSystem();
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const r = await prove({folder: "x", unit: "u", pkg: PKG, mcp, osg: {mode: "count", methods: async () => ({methods: 0, names: [], failing: []})},
        zipper: () => ({...real, classes: ["ZCL_OSD_PROVE_PLAIN"]})});
      assert.equal(r.ok, false, r.problems.join("\n"));
      assert.match(r.problems.join("\n"), /nothing to prove: no test method ran on the system/);
    });

    it("a nameless test method entry that carries an alert fails the run", async () => {
      const {code, text} = await run(base(), fakeSystem({
        unitText: {ZCL_OSD_PROVE_DEMO: JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: "ZCL_OSD_PROVE_DEMO",
          testMethods: [{name: "TWO_IS_FOUR"}, {name: "ZERO_IS_ZERO"}, {alerts: [{title: "Critical Assertion Error: 'boom'"}]}]}]})},
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

  it("the import never approves an overwrite: a zip-named object that appeared since the preflight stops it", () => {
    const code = importAbap("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", PKG);
    // only an "add" (a new object) is approved; any other action refuses the import
    assert.match(code, /IF <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-add OR \( <ls_o>-obj_type = 'DEVC' AND <ls_o>-obj_name = '\$ZOSG_TMP_TEST' \)\.\s+<ls_o>-decision = zif_abapgit_definitions=>c_yes\./);
    assert.match(code, /ERR would overwrite/);
    const guard = code.indexOf("IF lv_foreign = abap_true.");
    assert.ok(guard > 0 && code.indexOf("li_repo->deserialize(") > code.indexOf("ELSE.", guard));
  });

  it("snippets are ASCII and each ends with the fail( msg ) report", () => {
    for (const code of [importAbap(Buffer.from("PK"), "$ZOSG_TMP_X"), classCheckAbap(["ZCL_A"]),
      cleanupAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"], "000000000042"), preflightAbap("$ZOSG_TMP_X", ["CLAS ZCL_A"])]) {
      assert.ok(/^[\x00-\x7f]*$/.test(code));
      assert.match(code.trimEnd().split("\n").at(-1), /^cl_abap_unit_assert=>fail\( msg = \|OSDPROVE<<\{ lv_out \}>>OSDPROVE\| \)\.$/);
    }
  });
});
