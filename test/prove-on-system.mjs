// tools/osd-prove-on-system.mjs against a fake system. Nothing here talks
// to SAP: the MCP transport is a model of what vsp answered on A4H
// (2026-10-01), driven by the zip the tool really builds. The model reads
// the zip -- the class XML, the test include -- so the WITH_UNIT_TESTS case
// is the system's behaviour following from the file, not a canned answer.
// No child process is spawned: the tool writes its zip in process and the
// fake reads it in process (a sandbox may refuse to spawn `zip`/`unzip`).
import assert from "node:assert/strict";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {inflateRawSync} from "node:zlib";
import {
  MARK_CLOSE, MARK_OPEN, buildZip, checkPackage, cleanupAbap, classCheckAbap, countTestMethods, importAbap,
  inventoryAbap, main, prove, verdict,
} from "../tools/osd-prove-on-system.mjs";

const FIXTURE = resolve("test/fixtures/prove-on-system");
const MANIFEST = join(FIXTURE, "manifest.json");
const PKG = "$ZOSG_TMP_TEST";
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

/** A sandbox system as far as this tool can see it. Knobs inject the
 *  failures and the missing evidence each test is about. */
function fakeSystem({
  importErrors = [], importWarnings = [], status, failing = new Set(), stickyTadir = 0,
  before = {}, intruder, editImport = (m) => m, dropCheck = new Set(), checkOverride = {}, unitText = {},
} = {}) {
  const sys = {
    packages: new Set(before.packages ?? []), repo: before.repo, tadir: [...(before.tadir ?? [])],
    classes: new Map(), calls: [],
  };
  const pkgOf = (code) => /devclass = '([^']+)'/.exec(code)?.[1] ?? /iv_package = '([^']+)'/.exec(code)?.[1];
  return {
    sys,
    async call(action, target, params) {
      sys.calls.push({action, target, params});
      if (action === "create") {
        if (sys.packages.has(params.name)) return `ERROR: package ${params.name} already exists`;
        sys.packages.add(params.name);
        return `Created package ${params.name}`;
      }
      if (action === "analyze" && params.type === "execute_abap") {
        const code = params.code;
        assert.match(code, /cl_abap_unit_assert=>fail\( msg = /, "every snippet reports through fail( )");
        assert.ok(/^[\x00-\x7f]*$/.test(code), "snippet is ASCII");
        const pkg = pkgOf(code);
        if (code.includes("obj={ ls_t-object }")) {
          sys.calls.at(-1).kind = "inventory";
          const objs = sys.tadir.map((t) => ` obj=${t.replace(" ", ":")};`).join("");
          return framed(`repo=${sys.repo ?? "none"}; tdevc=${sys.packages.has(pkg) ? 1 : 0}; `
            + `tadir=${sys.tadir.length};${objs}`);
        }
        if (code.includes("zcl_abapgit_zip=>load")) {
          sys.calls.at(-1).kind = "import";
          const b64 = [...code.matchAll(/APPEND `([A-Za-z0-9+/=]*)` TO lt_b64\./g)].map((m) => m[1]).join("");
          const files = unzip(Buffer.from(b64, "base64"));
          sys.repo = "000000000042";
          const objects = new Set(sys.tadir);
          objects.add(`DEVC ${pkg}`);
          for (const [f, text] of files) {
            const m = /^src\/(zcl_[a-z0-9_]+)\.clas\.xml$/.exec(f);
            if (m === null) continue;
            const name = m[1].toUpperCase();
            const tests = files.get(`src/${m[1]}.clas.testclasses.abap`) ?? "";
            const wut = /<WITH_UNIT_TESTS>X</.test(text);
            // what A4H did (#354): without WITH_UNIT_TESTS no CCAU include is created
            const methods = wut ? [...tests.matchAll(/METHODS (\w+) FOR TESTING/g)].map((x) => x[1].toUpperCase()) : [];
            sys.classes.set(name, {wut, methods});
            objects.add(`CLAS ${name}`);
          }
          if (intruder) objects.add(intruder);
          sys.tadir = [...objects];
          const logs = [...importErrors.map((e) => ` [E] ${e};`), ...importWarnings.map((e) => ` [W] ${e};`)].join("");
          const st = status ?? (importErrors.length ? "E" : importWarnings.length ? "W" : "S");
          return alert(editImport(`${MARK_OPEN}files=${files.size}; repo=${sys.repo}; status=${st};${logs} `
            + `logs=${importErrors.length + importWarnings.length}; tadir=${sys.tadir.length};${MARK_CLOSE}`));
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
        if (code.includes("->purge(")) {
          sys.calls.at(-1).kind = "purge";
          let out = sys.repo ? "purged status=S;" : "no repo;";
          sys.tadir = sys.tadir.slice(0, stickyTadir);
          if (stickyTadir === 0) sys.packages.delete(pkg);
          const left = sys.repo && stickyTadir ? 1 : 0;
          if (!left) sys.repo = undefined;
          out += ` repo_left=${left}; tadir_left=${sys.tadir.length};`;
          for (const t of sys.tadir) out += ` ${t};`;
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

describe("osd-prove-on-system", () => {
  it("counts FOR TESTING methods from the parse (helpers are not tests)", () => {
    const counts = countTestMethods(join(FIXTURE, "src"));
    assert.equal(counts.get("ZCL_OSD_PROVE_DEMO"), 2);
    assert.equal(counts.get("ZCL_OSD_PROVE_PLAIN"), 0);
  });

  it("builds the zip in process, with the unit's objects", () => {
    const z = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
    assert.deepEqual(z.objects, ZIP_OBJECTS);
    const files = unzip(z.bytes);
    assert.ok(files.has(".abapgit.xml") && files.has("src/zcl_osd_prove_demo.clas.testclasses.abap"));
  });

  describe("happy path and the failures it must not hide", () => {
    it("happy path: inventories, imports, runs, compares, cleans up, exits 0", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 0, text);
      assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
      assert.match(text, /ZCL_OSD_PROVE_PLAIN\s+\| 0\s+\| 0\s+\| 0/);
      assert.deepEqual(kinds(mcp), ["inventory", "create", "import", "check", "test", "inventory", "purge"]);
      assert.equal(mcp.sys.packages.size, 0);
      assert.equal(mcp.sys.repo, undefined);
    });

    it("a deserialize error fails the run and shows its message, and still cleans up", async () => {
      const mcp = fakeSystem({importErrors: ["TABL ZOSD_BROKEN: XML parser error, unexpected end of document"]});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL import log \[E\] TABL ZOSD_BROKEN: XML parser error, unexpected end of document/);
      assert.ok(!kinds(mcp).includes("test"), "no unit run over a broken import");
      assert.equal(kinds(mcp).at(-1), "purge");
    });

    it("a class XML without WITH_UNIT_TESTS: no CCAU on the system, counts differ, the run fails and says why", async () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-prove-nowut-"));
      try {
        const src = join(dir, "src");
        cpSync(join(FIXTURE, "src"), src, {recursive: true});
        const xml = join(src, "zcl_osd_prove_demo.clas.xml");
        writeFileSync(xml, readFileSync(xml, "utf8").replace("<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>", ""));
        const {code, text} = await run([src, "--unit", "prove-demo", "--manifest", MANIFEST, "--package", PKG], fakeSystem());
        assert.equal(code, 1, text);
        assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 0\s+\| 0/);
        assert.match(text, /FAIL ZCL_OSD_PROVE_DEMO: 2 test method\(s\) on OSG, 0 on the system/);
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

    it("an incomplete cleanup fails an otherwise green run", async () => {
      const {code, text} = await run(base(), fakeSystem({stickyTadir: 2}));
      assert.equal(code, 1, text);
      assert.match(text, /FAIL cleanup incomplete: 2 TADIR object\(s\) left/);
      assert.match(text, /FAIL cleanup incomplete: 1 package\(s\) left/);
      assert.match(text, /FAIL cleanup incomplete: 1 repo\(s\) left/);
      assert.match(text, /^NOT proved/m);
    });

    it("--keep skips the cleanup and says how to do it", async () => {
      const mcp = fakeSystem();
      const {code, text} = await run([...base(), "--keep"], mcp);
      assert.equal(code, 0, text);
      assert.ok(!kinds(mcp).includes("purge"));
      assert.match(text, /--unit prove-demo --manifest \S+ --cleanup --package '\$ZOSG_TMP_TEST'/);
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

  describe("P1: the cleanup never deletes what the run did not bring", () => {
    it("a package that already holds objects is refused before the import (no create, no import, no purge)", async () => {
      const mcp = fakeSystem({before: {packages: [PKG], tadir: ["PROG ZSOMEBODY_ELSES"]}});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 2, text);
      assert.match(text, /refused: \$ZOSG_TMP_TEST is not new: it holds 1 object\(s\):\n\s+PROG ZSOMEBODY_ELSES/);
      assert.deepEqual(kinds(mcp), ["inventory"]);
      assert.deepEqual(mcp.sys.tadir, ["PROG ZSOMEBODY_ELSES"]);
    });

    it("a package with a registered repository is refused without --reuse", async () => {
      const mcp = fakeSystem({before: {packages: [PKG], repo: "000000000007"}});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 2, text);
      assert.match(text, /abapGit repository 000000000007 is registered for it/);
      assert.deepEqual(kinds(mcp), ["inventory"]);
    });

    it("an existing empty package is refused without --reuse (a purge would delete it)", async () => {
      const mcp = fakeSystem({before: {packages: [PKG]}});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 2, text);
      assert.match(text, /the package already exists/);
    });

    it("--reuse admits a package whose objects are exactly the zip's", async () => {
      const mcp = fakeSystem({before: {packages: [PKG], repo: "000000000042",
        tadir: [`DEVC ${PKG}`, ...ZIP_OBJECTS]}});
      const {code, text} = await run([...base(), "--reuse"], mcp);
      assert.equal(code, 0, text);
      assert.match(text, /exists, reused \(--reuse\)/);
      assert.deepEqual(kinds(mcp), ["inventory", "import", "check", "test", "inventory", "purge"]);
    });

    it("--reuse refuses a package whose objects differ from the zip's", async () => {
      const mcp = fakeSystem({before: {packages: [PKG], tadir: [...ZIP_OBJECTS, "TABL ZSOMEBODY_ELSES"]}});
      const {code, text} = await run([...base(), "--reuse"], mcp);
      assert.equal(code, 2, text);
      assert.match(text, /--reuse takes a package whose objects are exactly the zip's.*\n  not in the zip:\n\s+TABL ZSOMEBODY_ELSES/);
      assert.deepEqual(kinds(mcp), ["inventory"]);
    });

    it("before the purge: an object that is not the zip's refuses the purge and is named", async () => {
      const mcp = fakeSystem({intruder: "PROG ZARRIVED_MEANWHILE"});
      const {code, text} = await run(base(), mcp);
      assert.equal(code, 1, text);
      assert.match(text, /FAIL purge refused: \$ZOSG_TMP_TEST holds 1 object\(s\) that are not the zip's.*\n\s+PROG ZARRIVED_MEANWHILE/);
      assert.ok(!kinds(mcp).includes("purge"));
      assert.ok(mcp.sys.tadir.includes("PROG ZARRIVED_MEANWHILE"));
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

    it("a zip without classes fails with nothing to prove, before any call", async () => {
      const mcp = fakeSystem();
      const r = await prove({folder: "x", unit: "u", pkg: PKG, mcp, osg: {mode: "count", methods: async () => ({methods: 0, failing: []})},
        zipper: () => ({bytes: Buffer.alloc(0), objects: ["TABL ZX"], classes: [], unit: "u"})});
      assert.equal(r.ok, false);
      assert.match(r.problems.join("\n"), /nothing to prove: unit "u" puts no class in the zip/);
      assert.equal(mcp.sys.calls.length, 0);
    });

    it("no test method run on the system fails with nothing to prove", async () => {
      const mcp = fakeSystem();
      const real = buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST});
      const r = await prove({folder: "x", unit: "u", pkg: PKG, mcp, osg: {mode: "count", methods: async () => ({methods: 0, failing: []})},
        zipper: () => ({...real, classes: ["ZCL_OSD_PROVE_PLAIN"]})});
      assert.equal(r.ok, false, r.problems.join("\n"));
      assert.match(r.problems.join("\n"), /nothing to prove: no test method ran on the system/);
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

  it("snippets are ASCII and each ends with the fail( msg ) report", () => {
    for (const code of [importAbap(Buffer.from("PK"), "$ZOSG_TMP_X"), classCheckAbap(["ZCL_A"]), cleanupAbap("$ZOSG_TMP_X"),
      inventoryAbap("$ZOSG_TMP_X")]) {
      assert.ok(/^[\x00-\x7f]*$/.test(code));
      assert.match(code.trimEnd().split("\n").at(-1), /^cl_abap_unit_assert=>fail\( msg = \|OSDPROVE<<\{ lv_out \}>>OSDPROVE\| \)\.$/);
    }
  });
});
