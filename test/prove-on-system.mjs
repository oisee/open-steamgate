// tools/osd-prove-on-system.mjs against a fake system. Nothing here talks
// to SAP: the MCP transport is a model of what vsp answered on A4H
// (2026-10-01), driven by the zip the tool really builds. The model reads
// the zip -- the class XML, the test include -- so the WITH_UNIT_TESTS case
// is the system's behaviour following from the file, not a canned answer.
import assert from "node:assert/strict";
import {cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {
  MARK_CLOSE, MARK_OPEN, checkPackage, cleanupAbap, classCheckAbap, countTestMethods, importAbap, main,
} from "../tools/osd-prove-on-system.mjs";

const FIXTURE = resolve("test/fixtures/prove-on-system");
const MANIFEST = join(FIXTURE, "manifest.json");

/** what vsp prints for an execute_abap whose last line is fail( msg ) */
const alert = (msg) => `Program: ZTEMP_EXEC_1\nSuccess: false\nCleaned Up: true\n`
  + `Message: The code did not finish: Critical Assertion Error: '${msg}'\n\n`
  + `Raw Alerts (for debugging):\n  Kind: failedAssertion, Severity: critical\n`
  + `  Title: Critical Assertion Error: '${msg}'\n`;

/** A sandbox system as far as this tool can see it. */
function fakeSystem({importErrors = [], failing = new Set(), stickyTadir = 0} = {}) {
  const sys = {packages: new Set(), repo: undefined, tadir: [], classes: new Map(), calls: []};
  const unzip = (code) => {
    const b64 = [...code.matchAll(/APPEND `([A-Za-z0-9+/=]*)` TO lt_b64\./g)].map((m) => m[1]).join("");
    const dir = mkdtempSync(join(tmpdir(), "osd-prove-fake-"));
    try {
      writeFileSync(join(dir, "x.zip"), Buffer.from(b64, "base64"));
      execFileSync("unzip", ["-q", "x.zip", "-d", "out"], {cwd: dir});
      const src = join(dir, "out", "src");
      const files = new Map(readdirSync(src).map((f) => [f, readFileSync(join(src, f), "utf8")]));
      return files;
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };
  const pkgOf = (code) => /iv_package = '([^']+)'/.exec(code)[1];
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
        // ASCII only: ABAP source is 7-bit
        assert.ok(/^[\x00-\x7f]*$/.test(code), "snippet is ASCII");
        if (code.includes("zcl_abapgit_zip=>load")) {
          const files = unzip(code);
          sys.repo = "000000000042";
          const pkg = pkgOf(code);
          sys.tadir = [`DEVC ${pkg}`];
          for (const [f, text] of files) {
            const m = /^(zcl_[a-z0-9_]+)\.clas\.xml$/.exec(f);
            if (m === null) continue;
            const name = m[1].toUpperCase();
            const tests = files.get(`${m[1]}.clas.testclasses.abap`) ?? "";
            const wut = /<WITH_UNIT_TESTS>X</.test(text);
            // what A4H did (#354): without WITH_UNIT_TESTS no CCAU include is created
            const methods = wut ? [...tests.matchAll(/METHODS (\w+) FOR TESTING/g)].map((x) => x[1].toUpperCase()) : [];
            sys.classes.set(name, {wut, methods});
            sys.tadir.push(`CLAS ${name}`);
          }
          const logs = importErrors.map((e) => ` [E] ${e};`).join("");
          const status = importErrors.length ? "E" : "S";
          return alert(`${MARK_OPEN}files=${files.size + 2}; repo=${sys.repo}; status=${status};${logs} `
            + `logs=${importErrors.length}; tadir=${sys.tadir.length};${MARK_CLOSE}`);
        }
        if (code.includes("seoclassdf")) {
          const names = [...code.matchAll(/APPEND `([A-Z0-9_]+)` TO lt_cls\./g)].map((m) => m[1]);
          const parts = names.map((n) => {
            const c = sys.classes.get(n);
            return c === undefined ? ` ${n} found=4 wut= ccau=0;`
              : ` ${n} found=0 wut=${c.wut ? "X" : ""} ccau=${c.methods.length ? 10 + c.methods.length * 3 : 0};`;
          });
          return alert(`${MARK_OPEN}${parts.join("")}${MARK_CLOSE}`);
        }
        if (code.includes("->purge(")) {
          const pkg = pkgOf(code);
          let out = sys.repo ? "purged status=S;" : "no repo;";
          sys.tadir = sys.tadir.slice(0, stickyTadir === 0 ? 0 : stickyTadir);
          if (stickyTadir === 0) sys.packages.delete(pkg);
          const left = sys.repo && stickyTadir ? 1 : 0;
          if (!left) sys.repo = undefined;
          out += ` repo_left=${left}; tadir_left=${sys.tadir.length};`;
          for (const t of sys.tadir) out += ` ${t};`;
          out += ` tdevc_left=${sys.packages.has(pkg) ? 1 : 0};`;
          return alert(`${MARK_OPEN}${out}${MARK_CLOSE}`);
        }
        throw new Error("unexpected snippet");
      }
      if (action === "test") {
        const name = target.replace(/^CLAS /, "");
        assert.equal(params.object_url, `/sap/bc/adt/oo/classes/${name.toLowerCase()}`);
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

const base = (folder = join(FIXTURE, "src")) => [folder, "--unit", "prove-demo", "--manifest", MANIFEST,
  "--package", "$ZOSG_TMP_TEST"];

describe("osd-prove-on-system", () => {
  it("counts FOR TESTING methods from the parse (helpers are not tests)", () => {
    const counts = countTestMethods(join(FIXTURE, "src"));
    assert.equal(counts.get("ZCL_OSD_PROVE_DEMO"), 2);
    assert.equal(counts.get("ZCL_OSD_PROVE_PLAIN"), 0);
  });

  it("happy path: imports, runs, compares, cleans up, exits 0", async () => {
    const mcp = fakeSystem();
    const {code, text} = await run(base(), mcp);
    assert.equal(code, 0, text);
    assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
    assert.match(text, /ZCL_OSD_PROVE_PLAIN\s+\| 0\s+\| 0\s+\| 0/);
    assert.match(text, /counted from the source/);
    assert.match(text, /proved/);
    assert.deepEqual(mcp.sys.calls.map((c) => c.action),
      ["create", "analyze", "analyze", "test", "test", "analyze"]);
    assert.equal(mcp.sys.packages.size, 0);
    assert.equal(mcp.sys.repo, undefined);
  });

  it("a deserialize error fails the run and shows its message, and still cleans up", async () => {
    const mcp = fakeSystem({importErrors: ["TABL ZOSD_BROKEN: XML parser error, unexpected end of document"]});
    const {code, text} = await run(base(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL import log \[E\] TABL ZOSD_BROKEN: XML parser error, unexpected end of document/);
    assert.ok(!mcp.sys.calls.some((c) => c.action === "test"), "no unit run over a broken import");
    assert.equal(mcp.sys.calls.at(-1).action, "analyze");
    assert.match(mcp.sys.calls.at(-1).params.code, /->purge\(/);
  });

  it("a class XML without WITH_UNIT_TESTS: no CCAU on the system, counts differ, the run fails and says why", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-prove-nowut-"));
    try {
      const src = join(dir, "src");
      cpSync(join(FIXTURE, "src"), src, {recursive: true});
      const xml = join(src, "zcl_osd_prove_demo.clas.xml");
      writeFileSync(xml, readFileSync(xml, "utf8").replace("<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>", ""));
      const manifest = join(dir, "manifest.json");
      const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
      m.units["prove-demo"].sources = [src];
      writeFileSync(manifest, JSON.stringify(m));
      const {code, text} = await run([src, "--unit", "prove-demo", "--manifest", manifest, "--package", "$ZOSG_TMP_TEST"],
        fakeSystem());
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
    assert.doesNotMatch(text, /^proved/m);
  });

  it("--keep skips the cleanup and says how to do it", async () => {
    const mcp = fakeSystem();
    const {code, text} = await run([...base(), "--keep"], mcp);
    assert.equal(code, 0, text);
    assert.ok(!mcp.sys.calls.some((c) => /->purge\(/.test(c.params?.code ?? "")));
    assert.match(text, /--cleanup --package '\$ZOSG_TMP_TEST'/);
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

  it("snippets are ASCII and each ends with the fail( msg ) report", () => {
    for (const code of [importAbap(Buffer.from("PK"), "$ZOSG_TMP_X"), classCheckAbap(["ZCL_A"]), cleanupAbap("$ZOSG_TMP_X")]) {
      assert.ok(/^[\x00-\x7f]*$/.test(code));
      assert.match(code.trimEnd().split("\n").at(-1), /^cl_abap_unit_assert=>fail\( msg = \|OSDPROVE<<\{ lv_out \}>>OSDPROVE\| \)\.$/);
    }
  });
});
