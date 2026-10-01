// tools/osd-prove-inplace.mjs (osd-prove-on-system --in-place / --rollback)
// against a fake system. Nothing here talks to SAP. The fake keeps what the
// mode must see to be right: objects with their files (the system's bytes),
// the abapGit repository row, and it answers the snippets the way the
// snippets ask abapGit: hash = SHA-256 of each serialised file, a deploy that
// guards on the expected hashes and writes the zip's files over the objects
// it was told it may overwrite. The fake does not execute ABAP, so snippet
// properties are also checked on their text.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {inflateRawSync} from "node:zlib";
import {MARK_CLOSE, MARK_OPEN, buildZip, main} from "../tools/osd-prove-on-system.mjs";
import {
  chunkAbap, dropRepoAbap, deployAbap, hashAbap, listAbap, canonicalXml, objectHash, readState, snapshotDir, writeState,
} from "../tools/osd-prove-inplace.mjs";

const FIXTURE = resolve("test/fixtures/prove-on-system");
const MANIFEST = join(FIXTURE, "manifest.json");
const PKG = "$ZOSG_TMP_INPL";
const OWN = `OSDPROVE ${PKG}`;
const DEMO = "CLAS ZCL_OSD_PROVE_DEMO";
const PLAIN = "CLAS ZCL_OSD_PROVE_PLAIN";
const OTHER = "CLAS ZCL_OSD_UNTOUCHED";

const alert = (msg) => `Program: ZTEMP_EXEC_1\nSuccess: false\nMessage: The code did not finish: Critical Assertion Error: '${msg}'\n`
  + `  Title: Critical Assertion Error: '${msg}'\n`;
const framed = (body) => alert(`${MARK_OPEN}${body}${MARK_CLOSE}`);
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").toUpperCase();

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
const fixtureFiles = (name) => new Map(readdirSync(join(FIXTURE, "src")).filter((f) => f.startsWith(name.toLowerCase() + "."))
  .map((f) => [f, readFileSync(join(FIXTURE, "src", f), "utf8")]));
/** the package as it was before the rewrite: the fixture's classes with other text */
const oldFiles = (name) => new Map([...fixtureFiles(name)].map(([f, t]) => [f, t + "* the old version\n"]));

/** A sandbox system: packages, objects with files, repositories. `hooks`
 *  run before the n-th call of a kind: {kind, n, run(sys)}, or before the
 *  first call of a kind for which `when(sys)` holds: {kind, when, run(sys)}.
 *  `inStep(sys)` runs inside a deploy call, after the files are written and
 *  before the call reads its post-deploy hashes (another session writing in
 *  that moment); `stored(name, text)` is what the system keeps of a file it
 *  is given (a normalisation). */
function fakeSystem({objects, hooks = [], repos = [], restoreCorrupts = false, inStep, stored = (n, t) => t, packages = [PKG]} = {}) {
  const sys = {
    packages: new Set(packages),
    // the version stamp of an object; every write of a deploy re-activates it
    stamps: new Map(), tick: 0,
    objects: new Map(),
    repos: [...repos],
    calls: [], seen: {}, imports: 0,
    deployedZips: [],
  };
  const put = (item, files, devclass = PKG) => sys.objects.set(item, {devclass, files: new Map(files)});
  const restamp = (item) => sys.stamps.set(item, `${item.slice(0, 4)}:20261001${String(120000 + (sys.tick += 1)).padStart(6, "0")}${item.startsWith("CLAS") ? "/9" : ""}`);
  for (const [item, files, devclass] of objects ?? [
    [DEMO, oldFiles("zcl_osd_prove_demo")], [PLAIN, oldFiles("zcl_osd_prove_plain")], [OTHER, new Map([["zcl_osd_untouched.clas.abap", "CLASS zcl_osd_untouched.\n"]])],
  ]) put(item, files, devclass);
  const hashes = (item) => [...sys.objects.get(item).files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, t]) => ({n, h: sha(t), size: Buffer.byteLength(t)}));
  const guardLines = (obj) => hashes(obj).map((f) => `${f.n}=${f.h}`);
  const info = (name) => {
    const o = sys.objects.get(`CLAS ${name}`);
    if (o === undefined) return undefined;
    const xml = o.files.get(`${name.toLowerCase()}.clas.xml`) ?? "";
    const tests = o.files.get(`${name.toLowerCase()}.clas.testclasses.abap`) ?? "";
    const wut = /<WITH_UNIT_TESTS>X</.test(xml);
    return {wut, methods: wut ? [...tests.matchAll(/METHODS (\w+) FOR TESTING/g)].map((x) => x[1].toUpperCase()) : []};
  };
  return {
    sys,
    put,
    async call(action, target, params) {
      const kindOf = (code) => (code.includes("zcl_abapgit_objects=>delete") ? "cleanup"
        : code.includes("nostamp=") ? "receipt"
          : code.includes("existing={ lv_n }") ? "preflight"
            : code.includes("zcl_abapgit_zip=>load") ? (code.includes("lt_exp") ? "deploy" : "import")
              : code.includes("lv_chunk") ? "chunk"
          : code.includes("repo_deleted") ? "drop"
            : code.includes("children={ lv_kids }") ? "list"
              : code.includes("seoclassdf") ? "check"
                : code.includes("files={ lv_n }") ? "hash" : "?");
      const kind = action === "analyze" ? kindOf(params.code) : action;
      sys.seen[kind] = (sys.seen[kind] ?? 0) + 1;
      sys.calls.push({kind, params});
      for (const h of hooks) {
        if (h.kind !== kind) continue;
        const due = h.when === undefined ? h.n === sys.seen[kind] : !h.done && h.when(sys);
        if (due) { h.done = true; h.run(sys, put); }
      }
      if (action === "create") {
        sys.packages.add(params.name);
        return `Created package ${params.name}`;
      }
      if (action === "test") {
        const name = target.replace(/^CLAS /, "");
        const c = info(name);
        if (c === undefined || c.methods.length === 0) return JSON.stringify({classes: null});
        return JSON.stringify({classes: [{name: "LTCL_DOUBLE", parentName: name, testMethods: c.methods.map((m) => ({name: m}))}]});
      }
      assert.equal(action, "analyze", `unexpected call ${action}`);
      const code = params.code;
      assert.match(code, /cl_abap_unit_assert=>fail\( msg = /, "every snippet reports through fail( )");
      assert.ok(/^[\x00-\x7f]*$/.test(code), "snippet is ASCII");
      const items = itemsOf(code);
      const pkg = /'(\$[A-Z0-9_]+)'/.exec(code)?.[1];
      // ---- the fresh mode's snippets (the sequence test): preflight, import, receipt, cleanup
      if (kind === "preflight") {
        return framed(`tdevc=${sys.packages.has(pkg) ? 1 : 0}; repo=none; existing=0;`);
      }
      if (kind === "import") {
        const b64 = [...code.matchAll(/APPEND `([A-Za-z0-9+/=]*)` TO lt_b64\./g)].map((m) => m[1]).join("");
        const zip = unzip(Buffer.from(b64, "base64"));
        let repo = sys.repos.find((r) => r.pkg === pkg);
        if (!repo) { repo = {key: "000000000042", name: OWN, pkg}; sys.repos.push(repo); }
        const fresh = new Map();
        for (const [f, text] of zip) {
          const m = /^src\/([a-z0-9_]+)\.([a-z]+)\.(.+)$/.exec(f);
          if (m === null || m[2] === "devc") continue;
          const item = `${m[2].toUpperCase()} ${m[1].toUpperCase()}`;
          if (!fresh.has(item)) fresh.set(item, []);
          fresh.get(item).push([f.slice(4), text]);
        }
        for (const [item, files] of fresh) { put(item, files, pkg); restamp(item); }
        return framed(`files=${zip.size}; repo=${repo.key}; status=S; logs=0; tadir=${sys.objects.size};`);
      }
      if (kind === "receipt") {
        let out = "";
        for (const item of items) {
          out += ` stamp=${colon(item)}@${sys.stamps.get(item)};`;
          for (const f of hashes(item)) out += ` h_file=${colon(item)}|${f.n}|${f.h}|${f.size};`;
          out += ` h_obj=${colon(item)} files=${sys.objects.get(item).files.size};`;
        }
        return framed(`${out} items=${items.length};`);
      }
      if (kind === "cleanup") {
        const stamps = [...code.matchAll(/APPEND `([A-Z]{4}:[0-9/]+)` TO lt_stamps\./g)].map((m) => m[1]);
        const exp = [...code.matchAll(/APPEND `([A-Z0-9]{4} [A-Z0-9_/]+)@([^=`]+)=([0-9A-F]{64})` TO lt_exp\./g)];
        let out = "";
        const handed = [];
        items.forEach((item, i) => {
          if (sys.stamps.get(item) === stamps[i]) { handed.push(item); return; }
          const want = exp.filter((m) => m[1] === item).map((m) => `${m[2]}=${m[3]}`).sort();
          if (want.length > 0 && JSON.stringify(want) === JSON.stringify(guardLines(item).sort())) {
            out += ` rehashed=${colon(item)}@${sys.stamps.get(item)};`;
            handed.push(item);
          } else {
            out += ` changed=${colon(item)}@${sys.stamps.get(item)};`;
            if (want.length > 0) out += ` hashdiff=${colon(item)};`;
          }
        });
        for (const item of handed) sys.objects.delete(item);
        const repo = sys.repos.find((r) => r.pkg === pkg);
        if (repo) { sys.repos = sys.repos.filter((r) => r !== repo); out += ` repo_deleted=${repo.key};`; }
        const left = items.filter((i) => sys.objects.has(i));
        const rest = [...sys.objects].filter(([, o]) => o.devclass === pkg).map(([i]) => i);
        if (rest.length === 0) sys.packages.delete(pkg);
        return framed(`${out} to_delete=${handed.length}; repo_left=0;${left.map((i) => ` item_left=${colon(i)};`).join("")} items_left=${left.length}; `
          + `others=${rest.length};${rest.map((i) => ` other=${colon(i)};`).join("")} children=0; tdevc_left=${sys.packages.has(pkg) ? 1 : 0};`);
      }
      if (kind === "list") {
        const repo = sys.repos.find((r) => r.pkg === pkg);
        const mine = [...sys.objects].filter(([, o]) => o.devclass === pkg).map(([i]) => i).sort();
        return framed(`tdevc=${sys.packages.has(pkg) ? 1 : 0}; ${repo ? `repo=${repo.key}; repo_name=${repo.name};` : "repo=none;"} items=${mine.length};`
          + mine.map((i) => ` item=${colon(i)};`).join("") + " children=0;");
      }
      if (kind === "hash" || kind === "chunk") {
        let out = "";
        for (const item of items) {
          const o = sys.objects.get(item);
          if (!o) out += ` absent=${colon(item)};`;
          else if (o.devclass !== pkg) out += ` elsewhere=${colon(item)}@${o.devclass};`;
          else if (kind === "hash") {
            for (const f of hashes(item)) out += ` file=${colon(item)}|${f.n}|${f.h}|${f.size};`;
            out += ` obj=${colon(item)} files=${o.files.size};`;
          } else {
            const [, name, off, len] = /ls_file-filename = '([^']+)'[\s\S]*ls_file-data\+(\d+)\((\d+)\)/.exec(code);
            const text = o.files.get(name);
            if (text !== undefined) {
              const b = Buffer.from(text, "utf8");
              out += ` fhash=${sha(text)}; chunk=${b.subarray(Number(off), Number(off) + Number(len)).toString("hex").toUpperCase()};`;
            }
            out += ` found=${text === undefined ? "" : "X"};`;
          }
        }
        return framed(out);
      }
      if (kind === "check") {
        const names = [...code.matchAll(/APPEND `([A-Z0-9_]+)` TO lt_cls\./g)].map((m) => m[1]);
        return framed(names.map((n) => { const c = info(n); return c === undefined ? ` ${n} found=4 wut= ccau=0;`
          : ` ${n} found=0 wut=${c.wut ? "X" : ""} ccau=${c.methods.length ? 10 + c.methods.length * 3 : 0};`; }).join(""));
      }
      if (kind === "drop") {
        const key = /get_key\( \) <> '(\d+)'/.exec(code)[1];
        const repo = sys.repos.find((r) => r.pkg === pkg);
        let out = "";
        if (repo && (repo.key !== key || repo.name !== OWN)) out += ` ERR refused: repository ${repo.key} named ${repo.name} is not the one this run used;`;
        else if (repo) { sys.repos = sys.repos.filter((r) => r !== repo); out += ` repo_deleted=${key};`; }
        return framed(`${out} repo_left=${sys.repos.some((r) => r.key === key) ? 1 : 0};`);
      }
      assert.equal(kind, "deploy");
      sys.imports += 1;
      const b64 = [...code.matchAll(/APPEND `([A-Za-z0-9+/=]*)` TO lt_b64\./g)].map((m) => m[1]).join("");
      const zip = unzip(Buffer.from(b64, "base64"));
      sys.deployedZips.push(zip);
      const exp = [...code.matchAll(/APPEND `([A-Z0-9]{4} [A-Z0-9_/]+)@([^=`]+)=([0-9A-F]{64})` TO lt_exp\./g)];
      let out = `files=${zip.size};`;
      let repo = sys.repos.find((r) => r.pkg === pkg);
      if (repo && repo.name !== OWN) return framed(`${out} ERR the package has repository ${repo.key} named ${repo.name}, not this tool's; logs=0; tadir=0;`);
      let foreign = false;
      for (const item of items) {
        if (!sys.objects.has(item)) { out += ` absent=${colon(item)};`; foreign = true; continue; }
        const want = exp.filter((m) => m[1] === item).map((m) => `${m[2]}=${m[3]}`).sort();
        if (JSON.stringify(want) !== JSON.stringify(guardLines(item).sort())) { out += ` changed=${colon(item)};`; foreign = true; }
      }
      if (foreign) return framed(`${out} import refused; logs=0; tadir=${sys.objects.size};`);
      let created = false;
      if (!repo) { repo = {key: "000000000042", name: OWN, pkg}; sys.repos.push(repo); created = true; }
      out += ` repo=${repo.key};${created ? ` repo_new=${repo.key};` : ""}`;
      const byObject = new Map();
      for (const [f, text] of zip) {
        const m = /^src\/([a-z0-9_]+)\.([a-z]+)\.(.+)$/.exec(f);
        if (m === null) continue;
        const item = `${m[2].toUpperCase()} ${m[1].toUpperCase()}`;
        if (!byObject.has(item)) byObject.set(item, []);
        byObject.get(item).push([f.slice(4), text]);
      }
      for (const item of byObject.keys()) {
        if (!items.includes(item)) return framed(`${out} ERR would overwrite ${colon(item).replace(":", " ")} (action 3); import refused; logs=0; tadir=0;`);
      }
      for (const [item, files] of byObject) {
        const o = sys.objects.get(item);
        restamp(item);
        for (const [n, t] of files) o.files.set(n, stored(n, t, sys));
        if (restoreCorrupts && sys.imports > 1) o.files.set(`${item.slice(5).toLowerCase()}.clas.abap`, "CLASS broken.\n");
      }
      out += " status=S;";
      inStep?.(sys);
      // the deploy snippet's own post-deploy read, same dialog step
      for (const item of items) {
        for (const f of hashes(item)) out += ` dep_file=${colon(item)}|${f.n}|${f.h}|${f.size};`;
        out += ` dep_obj=${colon(item)} files=${sys.objects.get(item).files.size};`;
      }
      return framed(`${out} logs=0; tadir=${sys.objects.size};`);
    },
  };
}

const lines = [];
async function run(args, mcp, runs = mkdtempSync(join(tmpdir(), "osd-prove-inplace-"))) {
  lines.length = 0;
  const code = await main(args, {mcp, out: (l) => lines.push(String(l)), receiptDir: runs});
  return {code, text: lines.join("\n"), runs};
}
const inPlace = (extra = []) => [join(FIXTURE, "src"), "--in-place", "--package", PKG, "--unit", "prove-demo", "--manifest", MANIFEST, ...extra];
const snapHashes = (mcp) => Object.fromEntries([...mcp.sys.objects].map(([i, o]) => [i, objectHash([...o.files].map(([n, t]) => ({name: n, sha256: sha(t).toLowerCase()})))]));
const kinds = (mcp) => mcp.sys.calls.map((c) => c.kind);
const dirOf = (runs) => snapshotDir(PKG, runs);

describe("osd-prove-on-system --in-place", () => {
  it("the zip of an in-place run carries no package.devc.xml", () => {
    const withIt = unzip(buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST}).bytes);
    const without = unzip(buildZip(join(FIXTURE, "src"), {unit: "prove-demo", manifest: MANIFEST, withPackageXml: false}).bytes);
    assert.ok(withIt.has("src/package.devc.xml"));
    assert.ok(!without.has("src/package.devc.xml") && without.has("src/zcl_osd_prove_demo.clas.xml"));
  });

  it("happy path: snapshot, deploy, tests, rollback, every hash equals the snapshot's", async () => {
    const mcp = fakeSystem();
    const before = snapHashes(mcp);
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.match(text, /ZCL_OSD_PROVE_DEMO\s+\| 2\s+\| 2\s+\| 0/);
    assert.match(text, /rollback: 3\/3 object\(s\) equal their snapshot hash/);
    assert.match(text.trimEnd().split("\n").at(-1), /package restored: 3 object\(s\) verified$/);
    assert.deepEqual(snapHashes(mcp), before, "the system is as it was");
    assert.ok(mcp.sys.deployedZips[0].has("src/zcl_osd_prove_demo.clas.abap"));
    assert.equal(mcp.sys.imports, 2, "one deploy and one restore");
    // the AFTER zip rewrote only the zip's objects; the untouched one was never in an import
    for (const z of mcp.sys.deployedZips) assert.ok(![...z.keys()].some((f) => f.includes("untouched")));
    assert.deepEqual(mcp.sys.repos, [], "the tool's repository row is gone");
    assert.ok(!existsSync(dirOf(runs)), "the snapshot goes with a verified rollback");
    assert.ok(!kinds(mcp).includes("create"));
  });

  it("an AFTER object that is not in the snapshot is refused, nothing is deployed", async () => {
    const mcp = fakeSystem({objects: [[DEMO, oldFiles("zcl_osd_prove_demo")]]});
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 2, text);
    assert.match(text, /refused: 1 object\(s\) of the AFTER version are not in the snapshot of \$ZOSG_TMP_INPL[\s\S]*CLAS ZCL_OSD_PROVE_PLAIN/);
    assert.equal(mcp.sys.imports, 0);
    assert.ok(!kinds(mcp).includes("deploy"));
    assert.ok(!existsSync(dirOf(runs)), "a refusal before any write leaves no snapshot behind");
  });

  it("an object changed between the snapshot and the deploy is refused and not deployed", async () => {
    const mcp = fakeSystem({hooks: [{kind: "hash", n: 2, run: (sys) => sys.objects.get(PLAIN).files.set("zcl_osd_prove_plain.clas.abap", "edited by a colleague\n")}]});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 2, text);
    assert.match(text, /refused: the package is not what the snapshot says; nothing was deployed:\n\s+CLAS ZCL_OSD_PROVE_PLAIN changed since the snapshot/);
    assert.equal(mcp.sys.imports, 0);
    assert.equal(mcp.sys.objects.get(PLAIN).files.get("zcl_osd_prove_plain.clas.abap"), "edited by a colleague\n");
  });

  it("an object changed after the pre-check but before the deserialise is refused inside the deploy call, and survives", async () => {
    const mcp = fakeSystem({hooks: [{kind: "deploy", n: 1, run: (sys) => sys.objects.get(PLAIN).files.set("zcl_osd_prove_plain.clas.abap", "edited in the gap\n")}]});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL deploy: CLAS ZCL_OSD_PROVE_PLAIN changed since the snapshot; refused, nothing was deployed/);
    assert.equal(mcp.sys.objects.get(PLAIN).files.get("zcl_osd_prove_plain.clas.abap"), "edited in the gap\n", "the foreign edit is not clobbered, not even by the rollback");
    assert.equal(mcp.sys.imports, 1, "the refused deploy only; no restore over a foreign edit");
    assert.match(text, /rollback: CLAS ZCL_OSD_PROVE_PLAIN was changed by somebody else/);
    assert.match(text, /^NOT proved/m);
  });

  it("an object changed between the deploy and the rollback is not rolled back, is reported, and the run fails", async () => {
    const mcp = fakeSystem({hooks: [{kind: "test", n: 1, run: (sys) => sys.objects.get(PLAIN).files.set("zcl_osd_prove_plain.clas.abap", "edited during the tests\n")}]});
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL rollback: CLAS ZCL_OSD_PROVE_PLAIN was changed by somebody else since the deploy/);
    assert.match(text, /FAIL verification: CLAS ZCL_OSD_PROVE_PLAIN differs from its snapshot/);
    assert.equal(mcp.sys.objects.get(PLAIN).files.get("zcl_osd_prove_plain.clas.abap"), "edited during the tests\n");
    // the object we did deploy was put back
    assert.equal(mcp.sys.objects.get(DEMO).files.get("zcl_osd_prove_demo.clas.abap"), oldFiles("zcl_osd_prove_demo").get("zcl_osd_prove_demo.clas.abap"));
    assert.ok(existsSync(dirOf(runs)), "an unverified rollback keeps the snapshot");
    assert.equal(mcp.sys.repos.length, 1, "and the repository row, for the next rollback");
  });

  it("a foreign edit between the deploy and a separate hash read is not adopted as the deployed version", async () => {
    // a colleague saves DEMO the moment the deploy call returns, before any
    // later read: a post-deploy read in its own call would record that edit
    // as this run's and the rollback would overwrite it
    const edit = "edited right after the deploy\n";
    const mcp = fakeSystem({hooks: [{kind: "hash", when: (sys) => sys.imports === 1,
      run: (sys) => sys.objects.get(DEMO).files.set("zcl_osd_prove_demo.clas.abap", edit)}]});
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL rollback: CLAS ZCL_OSD_PROVE_DEMO was changed by somebody else since the deploy/);
    assert.equal(mcp.sys.objects.get(DEMO).files.get("zcl_osd_prove_demo.clas.abap"), edit, "the foreign edit survives");
    assert.equal(mcp.sys.objects.get(PLAIN).files.get("zcl_osd_prove_plain.clas.abap"), oldFiles("zcl_osd_prove_plain").get("zcl_osd_prove_plain.clas.abap"),
      "the object nobody touched is restored");
    assert.ok(existsSync(dirOf(runs)), "an unverified rollback keeps the snapshot");
  });

  it("an edit inside the deploy's own step is caught by the comparison with the AFTER zip and not adopted", async () => {
    const edit = "written by another session between the deserialise and the read\n";
    const mcp = fakeSystem({inStep: (sys) => { if (sys.imports === 1) sys.objects.get(DEMO).files.set("zcl_osd_prove_demo.clas.abap", edit); }});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL deployed version: CLAS ZCL_OSD_PROVE_DEMO is not what this run deployed \(zcl_osd_prove_demo\.clas\.abap is neither the AFTER zip's nor the snapshot's\)/);
    assert.match(text, /FAIL rollback: CLAS ZCL_OSD_PROVE_DEMO was changed by somebody else[\s\S]*the deployed version had none recorded/);
    assert.equal(mcp.sys.objects.get(DEMO).files.get("zcl_osd_prove_demo.clas.abap"), edit);
    assert.ok(kinds(mcp).filter((k) => k === "deploy").length === 2, "the deploy and the restore of PLAIN only");
  });

  it("a source the system normalises (trailing blanks, final newline) is compared normalised and adopted", async () => {
    // (the snapshot's files are what this system serialised, so the restore stores them as given)
    const mcp = fakeSystem({stored: (n, t, sys) => (sys.imports === 1 && n.endsWith(".abap") ? t.replace(/\n+$/, "").replace(/$/gm, "  ") : t)});
    const before = snapHashes(mcp);
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.deepEqual(snapHashes(mcp), before);
    assert.ok(kinds(mcp).includes("chunk") && mcp.sys.calls.filter((c) => c.kind === "chunk").length > 3, "the deployed sources were read back");
  });

  // the post-deploy check, file by file: (a) the zip's hash, (b) the zip's
  // content (normalised source, canonical XML), (c) the snapshot's hash
  const sysFile = (sys, n) => [...sys.objects.values()].find((o) => o.files.has(n))?.files.get(n);
  const DEMO_XML = "zcl_osd_prove_demo.clas.xml";
  const PLAIN_LOCALS = "zcl_osd_prove_plain.clas.locals_imp.abap";

  it("a foreign XML edit inside the deploy's step is refused, not adopted, and survives the rollback", async () => {
    const edit = "<?xml version=\"1.0\"?><abapGit><foreign/></abapGit>\n";
    const mcp = fakeSystem({inStep: (sys) => { if (sys.imports === 1) sys.objects.get(DEMO).files.set(DEMO_XML, edit); }});
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL deployed version: CLAS ZCL_OSD_PROVE_DEMO is not what this run deployed \(zcl_osd_prove_demo\.clas\.xml is neither the AFTER zip's \(as an element tree\) nor the snapshot's\)/);
    assert.match(text, /FAIL rollback: CLAS ZCL_OSD_PROVE_DEMO was changed by somebody else[\s\S]*?To restore it by hand, import the snapshot's files: \S+files\/0-0\.bin = zcl_osd_prove_demo\.clas\.abap/);
    assert.equal(mcp.sys.objects.get(DEMO).files.get(DEMO_XML), edit, "the foreign XML is not overwritten");
    assert.ok(existsSync(dirOf(runs)));
  });

  it("(b) an XML file abapGit wrote back reformatted (whitespace, attribute order) is equal as an element tree and adopted", async () => {
    const reformat = (t) => t.replace(/>\s+</g, "><").replace(/<abapGit version="([^"]*)" serializer="([^"]*)"/, "<abapGit serializer='$2'  version=\"$1\"");
    const mcp = fakeSystem({stored: (n, t, sys) => (sys.imports === 1 && n.endsWith(".xml") ? reformat(t) : t)});
    const before = snapHashes(mcp);
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.match(text, /deployed version: CLAS ZCL_OSD_PROVE_DEMO: zcl_osd_prove_demo\.clas\.xml equal to the zip's as an element tree/);
    assert.deepEqual(snapHashes(mcp), before);
  });

  it("(c) an XML file the deploy left as it was in the snapshot is adopted (nothing of ours in it)", async () => {
    const mcp = fakeSystem({stored: (n, t, sys) => (sys.imports === 1 && n.endsWith(".xml") ? sysFile(sys, n) : t)});
    const before = snapHashes(mcp);
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.match(text, /zcl_osd_prove_demo\.clas\.xml unchanged since the snapshot/);
    assert.deepEqual(snapHashes(mcp), before);
  });

  it("a source file the zip rewrites that still reads as the snapshot's is refused: the deploy did not apply it", async () => {
    const mcp = fakeSystem({stored: (n, t, sys) => (sys.imports === 1 && n === "zcl_osd_prove_plain.clas.abap" ? sysFile(sys, n) : t)});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /CLAS ZCL_OSD_PROVE_PLAIN is not what this run deployed \(zcl_osd_prove_plain\.clas\.abap is still the snapshot's, not the AFTER zip's: the deploy did not apply it\)/);
  });

  it("one-sided: a file the zip carries and the system does not show is a failed deploy of that file", async () => {
    const mcp = fakeSystem({inStep: (sys) => { if (sys.imports === 1) sys.objects.get(DEMO).files.delete("zcl_osd_prove_demo.clas.testclasses.abap"); }});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /CLAS ZCL_OSD_PROVE_DEMO is not what this run deployed \(zcl_osd_prove_demo\.clas\.testclasses\.abap is in the AFTER zip and the system does not show it: the deploy of that file failed\)/);
  });

  it("one-sided: a file the system shows and the zip lacks is adopted when it is the snapshot's", async () => {
    const plain = new Map([...oldFiles("zcl_osd_prove_plain"), [PLAIN_LOCALS, "* local helpers\n"]]);
    const mcp = fakeSystem({objects: [[DEMO, oldFiles("zcl_osd_prove_demo")], [PLAIN, plain], [OTHER, new Map([["zcl_osd_untouched.clas.abap", "CLASS zcl_osd_untouched.\n"]])]]});
    const before = snapHashes(mcp);
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.match(text, /zcl_osd_prove_plain\.clas\.locals_imp\.abap unchanged since the snapshot/);
    assert.deepEqual(snapHashes(mcp), before);
  });

  it("one-sided: a file the system shows, the zip lacks and the snapshot does not have is refused", async () => {
    const mcp = fakeSystem({inStep: (sys) => { if (sys.imports === 1) sys.objects.get(PLAIN).files.set(PLAIN_LOCALS, "* added by somebody\n"); }});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /CLAS ZCL_OSD_PROVE_PLAIN is not what this run deployed \(zcl_osd_prove_plain\.clas\.locals_imp\.abap is shown by the system, is not in the AFTER zip and is not the snapshot's\)/);
    assert.equal(mcp.sys.objects.get(PLAIN).files.get(PLAIN_LOCALS), "* added by somebody\n");
  });

  it("canonical XML: attribute order, whitespace-only text, empty-element form, CDATA and entities do not count; content does", () => {
    const a = "<?xml version=\"1.0\"?>\n<a x=\"1\" y=\"2\">\n <b>t &amp; u</b><c/>\n</a>\n";
    assert.equal(canonicalXml(a), canonicalXml("﻿<a  y='2' x=\"1\"><!-- c --><b>t &#38; u</b><c></c></a>"));
    assert.equal(canonicalXml("<a><![CDATA[x<y]]></a>"), canonicalXml("<a>x&lt;y</a>"));
    assert.notEqual(canonicalXml("<a> x </a>"), canonicalXml("<a>x</a>"));
    assert.notEqual(canonicalXml("<a x=\"1\"/>"), canonicalXml("<a x=\"2\"/>"));
    for (const bad of ["<a><b></a>", "<a/><b/>", "<a/>tail", "<a x=\"1\" x=\"2\"/>", "<!DOCTYPE a><a/>"]) assert.equal(canonicalXml(bad), undefined, bad);
  });

  it("a repository row with the tool's name that predates the run is not deleted by the rollback", async () => {
    // a fresh-mode --keep run leaves exactly such a row
    const left = {key: "000000000009", name: OWN, pkg: PKG};
    const mcp = fakeSystem({repos: [left]});
    const before = snapHashes(mcp);
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 0, text);
    assert.deepEqual(snapHashes(mcp), before);
    assert.deepEqual(mcp.sys.repos, [left], "the row is still there");
    assert.ok(!kinds(mcp).includes("drop"));
    assert.match(text, /repository 000000000009 was not created by this run \(it was there at the snapshot\); left in place/);
  });

  it("--keep with a predating row: the saved state says so and --rollback leaves the row too", async () => {
    const left = {key: "000000000009", name: OWN, pkg: PKG};
    const mcp = fakeSystem({repos: [left]});
    const first = await run(inPlace(["--keep"]), mcp);
    assert.equal(first.code, 0, first.text);
    const st = readState(dirOf(first.runs));
    assert.equal(st.repoAtSnapshot, "000000000009");
    assert.equal(st.createdRepo, null);
    const again = await run(["--rollback", "--package", PKG], mcp, first.runs);
    assert.equal(again.code, 0, again.text);
    assert.deepEqual(mcp.sys.repos, [left]);
    assert.ok(!kinds(mcp).includes("drop"));
  });

  it("a saved state that does not record who created the repository leaves the row in place", async () => {
    const mcp = fakeSystem();
    const first = await run(inPlace(["--keep"]), mcp);
    assert.equal(first.code, 0, first.text);
    const st = readState(dirOf(first.runs));
    assert.equal(st.createdRepo, "000000000042", "the run's own row is recorded as created by it");
    delete st.createdRepo; // a state written before the record existed
    writeState(dirOf(first.runs), st);
    const again = await run(["--rollback", "--package", PKG], mcp, first.runs);
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /does not record whether this run created repository 000000000042/);
    assert.equal(mcp.sys.repos.length, 1);
  });

  it("a hash that differs after the restore fails the run", async () => {
    const mcp = fakeSystem({restoreCorrupts: true});
    const {code, text, runs} = await run(inPlace(), mcp);
    assert.equal(code, 1, text);
    assert.match(text, /FAIL verification: CLAS ZCL_OSD_PROVE_(DEMO|PLAIN) differs from its snapshot/);
    assert.match(text, /rollback: NOT verified/);
    assert.ok(existsSync(dirOf(runs)));
    assert.doesNotMatch(text, /package restored/);
  });

  it("--keep leaves AFTER deployed; --rollback then restores the snapshot", async () => {
    const mcp = fakeSystem();
    const before = snapHashes(mcp);
    const first = await run(inPlace(["--keep"]), mcp);
    assert.equal(first.code, 0, first.text);
    assert.match(first.text, /--rollback --package '\$ZOSG_TMP_INPL'/);
    assert.match(first.text.trimEnd().split("\n").at(-1), /AFTER left deployed/);
    assert.notDeepEqual(snapHashes(mcp), before, "AFTER is on the system");
    assert.ok(existsSync(dirOf(first.runs)));
    const again = await run(["--rollback", "--package", PKG], mcp, first.runs);
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /rollback of \$ZOSG_TMP_INPL: complete, 3\/3/);
    assert.deepEqual(snapHashes(mcp), before);
    assert.ok(!existsSync(dirOf(first.runs)));
    assert.deepEqual(mcp.sys.repos, []);
  });

  it("--rollback without a snapshot refuses before any call", async () => {
    const mcp = fakeSystem();
    const {code, text} = await run(["--rollback", "--package", PKG], mcp);
    assert.equal(code, 2, text);
    assert.match(text, /refused: no snapshot for \$ZOSG_TMP_INPL/);
    assert.equal(mcp.sys.calls.length, 0);
  });

  it("an earlier run's snapshot is never overwritten: the next run refuses", async () => {
    const mcp = fakeSystem();
    const first = await run(inPlace(["--keep"]), mcp);
    const calls = mcp.sys.calls.length;
    const second = await run(inPlace(), mcp, first.runs);
    assert.equal(second.code, 2, second.text);
    assert.match(second.text, /snapshot, which may be the only way back/);
    assert.equal(mcp.sys.calls.length, calls);
  });

  it("a package versioned by somebody else's repository is refused; so is a missing package; a non-local name", async () => {
    const mcp = fakeSystem({repos: [{key: "000000000007", name: "TEAM_X", pkg: PKG}]});
    const a = await run(inPlace(), mcp);
    assert.equal(a.code, 2, a.text);
    assert.match(a.text, /versioned by abapGit repository 000000000007 named "TEAM_X"/);
    const none = fakeSystem();
    none.sys.packages.clear();
    const b = await run(inPlace(), none);
    assert.equal(b.code, 2, b.text);
    assert.match(b.text, /does not exist/);
    const c = await run([join(FIXTURE, "src"), "--in-place", "--package", "ZPROD", "--unit", "prove-demo", "--manifest", MANIFEST], fakeSystem());
    assert.equal(c.code, 2);
    assert.match(c.text, /not local/);
    const d = await run([join(FIXTURE, "src"), "--in-place", "--unit", "prove-demo", "--manifest", MANIFEST], fakeSystem());
    assert.equal(d.code, 2);
    assert.match(d.text, /name it with --package/);
  });

  it("a snapshot that cannot be fetched (a chunk of another version) is refused, nothing is deployed", async () => {
    const mcp = fakeSystem({hooks: [{kind: "chunk", n: 1, run: (sys) => sys.objects.get(DEMO).files.set("zcl_osd_prove_demo.clas.abap", "changed while fetching\n")}]});
    const {code, text} = await run(inPlace(), mcp);
    assert.equal(code, 2, text);
    assert.match(text, /refused: snapshot|not the version that was hashed|do not match/);
    assert.equal(mcp.sys.imports, 0);
  });

  it("snippets: ASCII, end with the fail( ) report, values validated, the deploy guards and approves only its items", () => {
    const zip = Buffer.from("PK");
    const exp = [{item: DEMO, files: [{name: "zcl_osd_prove_demo.clas.abap", sha256: "a".repeat(64)}]}];
    for (const code of [listAbap(PKG), hashAbap(PKG, [DEMO]), chunkAbap(PKG, DEMO, "zcl_osd_prove_demo.clas.abap", 0, 100),
      deployAbap(zip, PKG, exp), dropRepoAbap(PKG, "000000000042")]) {
      assert.ok(/^[\x00-\x7f]*$/.test(code));
      assert.match(code.trimEnd().split("\n").at(-1), /^cl_abap_unit_assert=>fail\( msg = \|OSDPROVE<<\{ lv_out \}>>OSDPROVE\| \)\.$/);
    }
    const d = deployAbap(zip, PKG, exp);
    assert.match(d, /IF lt_a <> lt_b\.[\s\S]*lv_foreign = abap_true\./);
    // the post-deploy hashes are read in the deploy's own step, right after
    // the deserialise, with the hash snippet's serialisation and digest
    const des = d.indexOf("li_repo->deserialize(");
    const dep = d.indexOf("dep_file=");
    assert.ok(des > 0 && dep > des, "the post-deploy read follows the deserialise in the same snippet");
    const hashLine = hashAbap(PKG, [DEMO]).split("\n").find((l) => l.includes(" file="));
    assert.ok(d.split("\n").some((l) => l.trim() === hashLine.trim().replace(" file=", " dep_file=")), "the same report line as the hash snippet");
    assert.match(d, /repo_new=\{ li_repo->get_key\( \) \}/);
    assert.ok(d.indexOf("lt_a <> lt_b") < d.indexOf("li_repo->deserialize("), "the guard runs before the deserialise");
    assert.match(d, /zif_abapgit_objects=>c_deserialize_action-update\s+OR <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-overwrite/);
    assert.match(d, /<ls_w>-decision = zif_abapgit_definitions=>c_no\./);
    // abapGit plans a delete for what the AFTER zip does not carry (the
    // package's own DEVC, measured on A4H): declined, never a refusal and
    // never approved
    assert.match(d, /ELSEIF <ls_o>-action = zif_abapgit_objects=>c_deserialize_action-delete\.[\s\S]{0,400}?<ls_o>-decision = zif_abapgit_definitions=>c_no\./);
    assert.match(d, /keep=\{ <ls_o>-obj_type \}/);
    assert.match(d, /LOOP AT ls_checks-data_loss/);
    assert.doesNotMatch(d, /purge|zcl_abapgit_objects=>delete/);
    assert.throws(() => hashAbap(PKG, ["CLAS ZCL_X` TO lt_items. DELETE"]), /cannot be put into an ABAP literal/);
    assert.throws(() => chunkAbap(PKG, DEMO, "x'.", 0, 10), /cannot be put into an ABAP literal/);
    assert.throws(() => chunkAbap(PKG, DEMO, "a.abap", 0, 10 ** 6), /not a chunk/);
    assert.throws(() => dropRepoAbap(PKG, "42' OR 1 = '1"), /not a repository key/);
    assert.throws(() => deployAbap(zip, PKG, [{item: DEMO, files: [{name: "a'b", sha256: "a".repeat(64)}]}]), /not a file entry/);
  });

  describe("a fresh --keep run, an in-place run on its package, then --cleanup (measured on A4H, 2026-10-01)", () => {
    // The in-place deploy and its restore re-activate every object they
    // write: version stamps move, content does not. The fresh run's receipt
    // used to hold the stamps alone, so its --cleanup refused those objects.
    const freshArgs = (extra = []) => [join(FIXTURE, "src"), "--unit", "prove-demo", "--manifest", MANIFEST, "--package", PKG, ...extra];
    const afterFolder = () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-prove-after-"));
      cpSync(join(FIXTURE, "src"), dir, {recursive: true});
      const f = join(dir, "zcl_osd_prove_demo.clas.abap");
      writeFileSync(f, readFileSync(f, "utf8") + "* the AFTER version\n");
      return dir;
    };
    const sequence = async () => {
      const mcp = fakeSystem({objects: [], packages: []});
      const runs = mkdtempSync(join(tmpdir(), "osd-prove-inplace-"));
      const fresh = await run(freshArgs(["--keep"]), mcp, runs);
      assert.equal(fresh.code, 0, fresh.text);
      const stampsAfterFresh = new Map(mcp.sys.stamps);
      const after = afterFolder();
      try {
        const ip = await run([after, "--in-place", "--package", PKG, "--unit", "prove-demo", "--manifest", MANIFEST], mcp, runs);
        assert.equal(ip.code, 0, ip.text);
        assert.match(ip.text, /package restored: 2 object\(s\) verified/);
      } finally {
        rmSync(after, {recursive: true, force: true});
      }
      for (const item of [DEMO, PLAIN]) assert.notEqual(mcp.sys.stamps.get(item), stampsAfterFresh.get(item), `${item} was re-activated`);
      return {mcp, runs};
    };

    it("--cleanup deletes both objects by their content hash, although the stamps moved", async () => {
      const {mcp, runs} = await sequence();
      const cl = await run(["--cleanup", "--package", PKG], mcp, runs);
      assert.equal(cl.code, 0, cl.text);
      assert.match(cl.text, /CLAS ZCL_OSD_PROVE_DEMO: stamp moved .* the content equals the receipt's hash/);
      assert.match(cl.text, /cleanup of \$ZOSG_TMP_INPL: complete/);
      assert.equal(mcp.sys.objects.size, 0);
      assert.deepEqual(mcp.sys.repos, []);
      assert.ok(!mcp.sys.packages.has(PKG));
      assert.ok(!existsSync(join(cl.runs, `${PKG}.json`)));
    });

    it("without the hashes (an old receipt) the same sequence is refused as before: the stamps moved", async () => {
      const {mcp, runs} = await sequence();
      const file = join(runs, `${PKG}.json`);
      const receipt = JSON.parse(readFileSync(file, "utf8"));
      for (const e of receipt.stamped) { delete e.files; delete e.hash; }
      writeFileSync(file, JSON.stringify(receipt));
      const cl = await run(["--cleanup", "--package", PKG], mcp, runs);
      assert.equal(cl.code, 1, cl.text);
      assert.match(cl.text, /decided by the version stamp alone, as before/);
      assert.match(cl.text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_DEMO changed since the import/);
      assert.match(cl.text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import/);
      assert.equal(mcp.sys.objects.size, 2, "nothing deleted");
    });

    it("an edit made after the in-place run is a foreign edit: that object is kept, the other is deleted", async () => {
      const {mcp, runs} = await sequence();
      mcp.sys.objects.get(PLAIN).files.set("zcl_osd_prove_plain.clas.abap", "edited by a colleague\n");
      const cl = await run(["--cleanup", "--package", PKG], mcp, runs);
      assert.equal(cl.code, 1, cl.text);
      assert.match(cl.text, /FAIL cleanup: CLAS ZCL_OSD_PROVE_PLAIN changed since the import .* a foreign edit; kept/);
      assert.deepEqual([...mcp.sys.objects.keys()], [PLAIN]);
    });
  });
});
