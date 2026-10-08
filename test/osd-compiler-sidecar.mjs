import {expect} from "chai";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createInterface} from "node:readline";
import {once} from "node:events";
import {checkSnapshot} from "../tools/osd-compiler-sidecar.mjs";
import {compilerCommand} from "../tools/osd-host.mjs";

describe("osd compiler --stdio", function () {
  this.timeout(15000);
  let child, root, stderr = "", nextId = 0;
  let outside;
  const pending = [];
  const replies = [];
  function send(request) {
    const result = new Promise((resolveReply, reject) => pending.push({resolveReply, reject}));
    child.stdin.write(typeof request === "string" ? request + "\n" : JSON.stringify(request) + "\n");
    return result;
  }
  function snapshot(name, source) {
    const path = `src/${name.toLowerCase()}.clas.abap`;
    writeFileSync(join(root, path), source);
    return {root, generation: "fixture-generation", objects: [{type: "CLAS", name, version: "inactive",
      files: [{path, sha256: createHash("sha256").update(source).digest("hex")}]}]};
  }
  async function check(snapshot) {
    const id = ++nextId;
    const response = await send({id, op: "check", snapshot});
    expect(response.id).to.equal(id);
    expect(response.error, JSON.stringify(response)).to.equal(undefined);
    return response.diagnostics;
  }
  const source = (name, method = "run", statement = "") => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS ${method}.\nENDCLASS.\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\n  METHOD ${method}.\n    ${statement}\n  ENDMETHOD.\nENDCLASS.\n`;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "osd-sidecar-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], libs: []}));
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}}));
    const [command, ...args] = compilerCommand(resolve("tools/osd-compiler-sidecar.mjs"));
    child = spawn(command, args, {stdio: ["pipe", "pipe", "pipe"]});
    child.stderr.on("data", bytes => { stderr += bytes; });
    createInterface({input: child.stdout}).on("line", line => {
      const waiter = pending.shift();
      try {
        const reply = JSON.parse(line);
        replies.push(reply);
        if (!waiter) throw new Error(`unsolicited stdout: ${line}`);
        waiter.resolveReply(reply);
      } catch (error) { waiter?.reject(error); }
    });
    child.on("error", error => pending.splice(0).forEach(waiter => waiter.reject(error)));
    child.on("exit", code => pending.splice(0).forEach(waiter => waiter.reject(new Error(`sidecar exit ${code}: ${stderr}`))));
  });
  after(async () => {
    if (child?.exitCode === null) {
      const ended = once(child, "exit");
      child.stdin.end();
      const [code, signal] = await ended;
      expect(signal).to.equal(null);
      expect(code, stderr).to.equal(0);
    }
    rmSync(root, {recursive: true, force: true});
    if (outside) rmSync(outside, {recursive: true, force: true});
  });

  it("advertises contract, version, pin, check and limits", async () => {
    const hello = await send({id: 0, op: "hello", contract: 1, osgo: "fixture", root});
    let version = "source";
    try { version = JSON.parse(readFileSync("osd-version.json", "utf8")).version; } catch (error) { if (error.code !== "ENOENT") throw error; }
    expect(hello).to.include({id: 0, contract: 1, osd: version,
      transpiler: JSON.parse(readFileSync("libs.lock.json", "utf8")).transpiler.ref});
    expect(hello.capabilities).to.deep.equal(["check"]);
    expect(hello.limits.maxConcurrentRequests).to.equal(1);
    expect(hello.limits.maxSnapshotBytes).to.be.greaterThan(0);
  });
  it("checks a clean class without diagnostics", async () => {
    const response = await send({id: ++nextId, op: "check", snapshot: snapshot("ZCL_SC_CLEAN", source("ZCL_SC_CLEAN"))});
    expect(response.id).to.equal(nextId);
    expect(response.diagnostics).to.deep.equal([]);
    expect(response.registryHash).to.match(/^[0-9a-f]{64}$/);
    expect(response.configSha).to.equal(createHash("sha256").update(readFileSync(join(root, "abaplint.jsonc"))).digest("hex"));
    expect(response.inputCount).to.equal(1);
    expect(response.virtualFiles).to.deep.equal([]);
    expect(response).not.to.have.property("inputsHash");
    expect(response).not.to.have.property("inputs");
  });
  it("refuses a non-listed input that moves during check", async () => {
    const snap = snapshot("ZCL_SC_FROZEN", source("ZCL_SC_FROZEN"));
    const other = join(root, "src/zcl_sc_unlisted.clas.abap");
    writeFileSync(other, source("ZCL_SC_UNLISTED"));
    let reachedHook = false, error;
    try {
      await checkSnapshot(snap, {beforeAnswer() {
        reachedHook = true;
        writeFileSync(other, source("ZCL_SC_UNLISTED", "renamed"));
      }});
    } catch (caught) { error = caught; }
    finally { rmSync(other, {force: true}); }
    expect(reachedHook).to.equal(true);
    expect(error).to.include({protocolCode: "SNAPSHOT_MISMATCH", message: "inputs moved during check"});
  });
  it("identifies the same registry twice", async () => {
    const snap = snapshot("ZCL_SC_REPEAT", source("ZCL_SC_REPEAT"));
    const first = await checkSnapshot(snap), second = await checkSnapshot(snap);
    expect(first.registryHash).to.match(/^[0-9a-f]{64}$/);
    expect(second.registryHash).to.equal(first.registryHash);
    expect(second.configSha).to.equal(first.configSha);
    expect(second.inputCount).to.equal(first.inputCount);
  });
  for (const target of ["generated", "overlay", "config", "vanished"]) {
    it(`freezes ${target} inputs from the validation registry`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), "osd-sidecar-freeze-"));
      const sha = text => createHash("sha256").update(text).digest("hex");
      const path = "src/zcl_sc_candidate.clas.abap", other = "src/zcl_sc_other.clas.abap";
      const config = JSON.stringify({syntax: {version: "v702"}});
      mkdirSync(join(fixture, "src"));
      mkdirSync(join(fixture, "gen"));
      writeFileSync(join(fixture, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen"], libs: []}));
      writeFileSync(join(fixture, "abaplint.jsonc"), config);
      writeFileSync(join(fixture, path), source("ZCL_SC_CANDIDATE"));
      writeFileSync(join(fixture, other), source("ZCL_SC_OTHER", "inactive"));
      writeFileSync(join(fixture, "gen/zcl_sc_generated.clas.abap"), source("ZCL_SC_GENERATED"));
      const copy = join(fixture, "build/inactive/active", other);
      mkdirSync(join(fixture, "build/inactive/active/src"), {recursive: true});
      // The copy intentionally differs from the working source. The hash
      // and freeze must describe the active bytes used by the validator.
      writeFileSync(copy, source("ZCL_SC_OTHER", "active"));
      const inactiveDigest = createHash("sha256").update(other).update("\0").update(source("ZCL_SC_OTHER", "inactive")).update("\0").digest("hex");
      writeFileSync(join(fixture, "build/inactive/inactive.json"), JSON.stringify({inactive: {
        "CLAS ZCL_SC_OTHER": {files: [other], digest: inactiveDigest},
      }}));
      const snap = {root: fixture, generation: "fixture", objects: [{type: "CLAS", name: "ZCL_SC_CANDIDATE", version: "inactive",
        files: [{path, sha256: sha(source("ZCL_SC_CANDIDATE"))}]}]};
      let error, baseline, expectedHash, reachedHook = false;
      try {
        baseline = await checkSnapshot(snap);
        const pairs = [["/" + path, sha(source("ZCL_SC_CANDIDATE"))],
          ["/" + other, sha(source("ZCL_SC_OTHER", "active"))],
          ["/gen/zcl_sc_generated.clas.abap", sha(source("ZCL_SC_GENERATED"))]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        expectedHash = sha(JSON.stringify(pairs));
        await checkSnapshot(snap, {beforeAnswer() {
          reachedHook = true;
          const changed = target === "overlay" ? copy : target === "config" ? join(fixture, "abaplint.jsonc")
            : join(fixture, "gen/zcl_sc_generated.clas.abap");
          if (target === "vanished") rmSync(changed);
          else writeFileSync(changed, target === "config" ? config + "\n" : "changed");
        }});
      } catch (caught) { error = caught; }
      finally { rmSync(fixture, {recursive: true, force: true}); }
      expect(reachedHook).to.equal(true);
      expect(error).to.include({protocolCode: "SNAPSHOT_MISMATCH", message: "inputs moved during check"});
      expect(baseline.registryHash).to.equal(expectedHash);
    });
  }
  it("covers library sources in the registry identity and verdict", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "osd-sidecar-library-"));
    try {
      mkdirSync(join(fixture, "src"));
      writeFileSync(join(fixture, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}}));
      writeFileSync(join(fixture, "abap_transpile.json"), JSON.stringify({input_folder: ["src"],
        libs: [{folder: "/.local/lars/sidecar-fixture", files: "/src/**"}]}));
      const text = source("ZCL_SC_LIB_READER", "run", "DATA ref TYPE REF TO zcl_sc_library. CREATE OBJECT ref. ref->run( ).");
      const path = "src/zcl_sc_lib_reader.clas.abap";
      writeFileSync(join(fixture, path), text);
      const snap = {root: fixture, generation: "fixture", objects: [{type: "CLAS", name: "ZCL_SC_LIB_READER", version: "inactive",
        files: [{path, sha256: createHash("sha256").update(text).digest("hex")}]}]};
      const lib = join(fixture, ".local/lars/sidecar-fixture/src");
      mkdirSync(lib, {recursive: true});
      const results = [];
      for (const method of ["run", "renamed"]) {
        writeFileSync(join(lib, "zcl_sc_library.clas.abap"), source("ZCL_SC_LIBRARY", method));
        results.push(await checkSnapshot(snap));
      }
      expect(results[0].diagnostics).to.deep.equal([]);
      expect(results[1].diagnostics.length).to.be.greaterThan(0);
      expect(results[1].registryHash).not.to.equal(results[0].registryHash);
    } finally {
      rmSync(fixture, {recursive: true, force: true});
    }
  });
  it("rejects a 31-character method name with A4H coordinates", async () => {
    const method = "a".repeat(31);
    const diagnostics = await check(snapshot("ZCL_SC_LONG", source("ZCL_SC_LONG", method)));
    const issue = diagnostics.find(d => d.line === 3);
    expect(issue, JSON.stringify(diagnostics)).to.include({severity: "E", code: "ABAP_SYNTAX",
      include: "src/zcl_sc_long.clas.abap", line: 3, col: 12, endLine: 3, endCol: 42});
    expect(issue.object).to.deep.equal({type: "CLAS", name: "ZCL_SC_LONG"});
    expect(issue.text).to.be.a("string").and.not.equal("");
  });
  it("reports an unknown constant with A4H coordinates", async () => {
    const diagnostics = await check(snapshot("ZCL_SC_UNKNOWN", source("ZCL_SC_UNKNOWN", "run", "WRITE unknown_constant.")));
    const issue = diagnostics.find(d => d.line === 7);
    expect(issue, JSON.stringify(diagnostics)).to.include({severity: "E", code: "ABAP_SYNTAX",
      include: "src/zcl_sc_unknown.clas.abap", line: 7, col: 10, endLine: 7, endCol: 25});
    expect(issue.object).to.deep.equal({type: "CLAS", name: "ZCL_SC_UNKNOWN"});
  });
  it("refuses changed and missing snapshot files", async () => {
    const snap = snapshot("ZCL_SC_HASH", source("ZCL_SC_HASH"));
    writeFileSync(join(root, snap.objects[0].files[0].path), "changed");
    expect((await send({id: "hash", op: "check", snapshot: snap}))).to.include({id: "hash"}).and.have.nested.property("error.code", "SNAPSHOT_MISMATCH");
    rmSync(join(root, snap.objects[0].files[0].path));
    expect((await send({id: "missing", op: "check", snapshot: snap})).error.code).to.equal("SNAPSHOT_MISMATCH");
  });
  it("refuses a snapshot file symlink outside the root", async () => {
    outside = mkdtempSync(join(tmpdir(), "osd-sidecar-outside-"));
    const text = source("ZCL_SC_LINK");
    writeFileSync(join(outside, "zcl_sc_link.clas.abap"), text);
    symlinkSync(join(outside, "zcl_sc_link.clas.abap"), join(root, "src/zcl_sc_link.clas.abap"));
    const response = await send({id: "file-link", op: "check", snapshot: {
      root, generation: "fixture-generation", objects: [{type: "CLAS", name: "ZCL_SC_LINK", version: "inactive",
        files: [{path: "src/zcl_sc_link.clas.abap", sha256: createHash("sha256").update(text).digest("hex")}]}],
    }});
    expect(response.error).to.include({code: "BAD_REQUEST", text: "file resolves outside snapshot root: src/zcl_sc_link.clas.abap"});
    rmSync(join(root, "src/zcl_sc_link.clas.abap"));
    rmSync(outside, {recursive: true, force: true});
    outside = undefined;
  });
  it("refuses a snapshot directory symlink outside the root", async () => {
    outside = mkdtempSync(join(tmpdir(), "osd-sidecar-outside-"));
    mkdirSync(join(outside, "src"), {recursive: true});
    const text = source("ZCL_SC_DIR");
    writeFileSync(join(outside, "src/zcl_sc_dir.clas.abap"), text);
    symlinkSync(join(outside, "src"), join(root, "linked"));
    const response = await send({id: "dir-link", op: "check", snapshot: {
      root, generation: "fixture-generation", objects: [{type: "CLAS", name: "ZCL_SC_DIR", version: "inactive",
        files: [{path: "linked/zcl_sc_dir.clas.abap", sha256: createHash("sha256").update(text).digest("hex")}]}],
    }});
    expect(response.error).to.include({code: "BAD_REQUEST", text: "file resolves outside snapshot root: linked/zcl_sc_dir.clas.abap"});
    rmSync(join(root, "linked"));
    rmSync(outside, {recursive: true, force: true});
    outside = undefined;
  });
  it("checks transitive readers using the publication validator", async () => {
    const snap = snapshot("ZCL_SC_BASE", source("ZCL_SC_BASE"));
    const middle = "CLASS zcl_sc_middle DEFINITION PUBLIC INHERITING FROM zcl_sc_base.\nENDCLASS.\nCLASS zcl_sc_middle IMPLEMENTATION.\nENDCLASS.\n";
    writeFileSync(join(root, "src/zcl_sc_middle.clas.abap"), middle);
    writeFileSync(join(root, "src/zcl_sc_reader.clas.abap"), source("ZCL_SC_READER", "run", "DATA ref TYPE REF TO zcl_sc_middle. CREATE OBJECT ref. ref->run( )."));
    expect(await check(snap)).to.deep.equal([]);
    const changed = snapshot("ZCL_SC_BASE", source("ZCL_SC_BASE", "renamed"));
    const diagnostics = await check(changed);
    expect(diagnostics.some(d => d.object.name === "ZCL_SC_READER" && d.code === "ABAP_SYNTAX"), JSON.stringify(diagnostics)).to.equal(true);
    // A later request observes an external edit rather than a stale registry.
    expect(await check(snapshot("ZCL_SC_BASE", source("ZCL_SC_BASE")))).to.deep.equal([]);
  });
  it("verifies every file of a multi-file snapshot", async () => {
    const snap = snapshot("ZCL_SC_FILES", source("ZCL_SC_FILES"));
    const path = "src/zcl_sc_files.clas.locals_def.abap";
    writeFileSync(join(root, path), "");
    snap.objects[0].files.push({path, sha256: createHash("sha256").update("").digest("hex")});
    expect(await check(snap)).to.deep.equal([]);
    writeFileSync(join(root, path), "changed");
    expect((await send({id: "include", op: "check", snapshot: snap})).error.code).to.equal("SNAPSHOT_MISMATCH");
    rmSync(join(root, path));
  });
  it("refuses unsupported operations", async () => {
    const response = await send({id: "outline", op: "outline"});
    expect(response.id).to.equal("outline");
    expect(response.error.code).to.equal("UNSUPPORTED_OP");
  });
  it("refuses other contract versions", async () => {
    expect((await send({id: "contract", op: "hello", contract: 2})).error.code).to.equal("CONTRACT_MISMATCH");
  });
  it("continues after malformed JSON and malformed requests", async () => {
    expect((await send("{broken")).error.code).to.equal("BAD_REQUEST");
    expect((await send({id: "bad"}))).to.include({id: "bad"}).and.have.nested.property("error.code", "BAD_REQUEST");
    expect((await send("null")).error.code).to.equal("BAD_REQUEST");
    expect(await check(snapshot("ZCL_SC_FINAL", source("ZCL_SC_FINAL")))).to.deep.equal([]);
  });
  it("answers every queued line once and in order", async () => {
    const before = replies.length;
    const answers = await Promise.all([send({id: "first", op: "hello", contract: 1}), send({id: "second", op: "hello", contract: 1})]);
    expect(answers.map(reply => reply.id)).to.deep.equal(["first", "second"]);
    expect(replies.length - before).to.equal(2);
  });
});
