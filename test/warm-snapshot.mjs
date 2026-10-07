import {expect} from "chai";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {build, gc} from "../tools/osd-build.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {verifyNext} from "../tools/osd-store-verify.mjs";

const source = (name, n = 1) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.
 PUBLIC SECTION. CLASS-METHODS get RETURNING VALUE(rv) TYPE i. ENDCLASS.
 CLASS ${name} IMPLEMENTATION. METHOD get. rv = ${n}. ENDMETHOD. ENDCLASS.`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe("warm generations verified from frozen compiler inputs", function () {
  this.timeout(30000);
  let root, compiler, input, generation, nodeOptions;
  const config = () => join(root, "abap_transpile.json");
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-warm-snapshot-"));
    for (const folder of ["src", "gen", "lib/src"]) mkdirSync(join(root, folder), {recursive: true});
    input = join(root, "src", "zcl_snap.clas.abap");
    writeFileSync(input, source("zcl_snap"));
    writeFileSync(join(root, "gen", "zcl_generated.clas.abap"), source("zcl_generated"));
    writeFileSync(join(root, "lib", "src", "zif_lib.intf.abap"), "INTERFACE zif_lib PUBLIC. ENDINTERFACE.");
    writeFileSync(config(), JSON.stringify({input_folder: ["src", "gen"], output_folder: "output", libs: [{folder: "/lib"}], write_source_map: true, write_unit_tests: true,
      options: {ignoreSyntaxCheck: false, unknownTypes: "compileError"}}));
    writeFileSync(join(root, "package.json"), "{}");
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    await build({root, generators: false});
    compiler = new WarmCompiler({root});
    await compiler.prime();
    writeFileSync(input, source("zcl_snap", 2));
    generation = (await compiler.build()).hash;
    nodeOptions = process.env.NODE_OPTIONS;
  });
  afterEach(async () => {
    if (nodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = nodeOptions;
    const child = compiler?.verifying;
    if (child?.exitCode === null) {
      const exited = new Promise(r => child.once("exit", r));
      compiler.cancelVerify(undefined, "test closing");
      await exited;
    }
    compiler?.drop();
    rmSync(root, {recursive: true, force: true});
  });
  const side = hash => join(root, "build", "by-input", `${hash}.warm.json`);

  it("verifies earlier generations through a 200 ms edit storm and a later cold publication", async () => {
    writeFileSync(input, source("zcl_snap", 3));
    const later = (await compiler.build()).hash;
    // Pause the actual verification child's cold transpiler, so the storm
    // crosses its comparison rather than merely preceding or following it.
    const ready = join(root, "verify-ready"), release = join(root, "verify-release");
    const preload = join(root, "pause-verify.mjs");
    writeFileSync(preload, `import {modulesOf} from ${JSON.stringify(new URL("../tools/osd-transpile.mjs", import.meta.url).href)};
import {existsSync, writeFileSync} from 'node:fs';
const {Transpiler} = modulesOf(${JSON.stringify(root)});
const run = Transpiler.prototype.run;
Transpiler.prototype.run = async function(...args) {
 writeFileSync(${JSON.stringify(ready)}, 'ready');
 while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20));
 return run.apply(this, args);
};`);
    process.env.NODE_OPTIONS = `${nodeOptions ?? ""} --import=${pathToFileURL(preload).href}`;
    const verifying = compiler.verify(generation);
    for (let i = 0; i < 200 && !existsSync(ready); i++) await sleep(20);
    expect(existsSync(ready), "verification reached its cold transpile").to.equal(true);
    let edits = 0;
    const storm = setInterval(() => writeFileSync(input, source("zcl_snap", 10 + ++edits)), 200);
    try {
      // Timer delivery can be delayed under the other heavy slot. Keep the
      // 200 ms edit cadence, and wait for three actual writes.
      for (let i = 0; i < 300 && edits < 3; i++) await sleep(20);
      // Source, generators and config can all leave the verified generation.
      writeFileSync(join(root, "gen", "zcl_generated.clas.abap"), source("zcl_generated", 20));
      writeFileSync(config(), readFileSync(config(), "utf8") + "\n");
      // Keep the compiler's current generation unpublished while verification
      // proceeds: the later cold build is an independent publication.
      if (nodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = nodeOptions;
      clearInterval(storm);
      await build({root, generators: false});
      const resumedStorm = setInterval(() => writeFileSync(input, source("zcl_snap", 30 + ++edits)), 200);
      writeFileSync(release, "resume");
      let result;
      try { result = await verifying; } finally { clearInterval(resumedStorm); }
      expect(edits).to.be.at.least(3);
      expect(result.verdict, JSON.stringify(result)).to.equal("same");
      expect(JSON.parse(readFileSync(side(generation), "utf8")).verified).to.equal(true);
      expect(compiler.unverified.has(generation)).to.equal(false);
      expect((await compiler.verify(later)).verdict).to.equal("same");
      expect(JSON.parse(readFileSync(side(later), "utf8")).verified).to.equal(true);
    } finally { clearInterval(storm); writeFileSync(release, "resume"); }
  });

  it("ignores live source/config/generator/library changes, and catches mismatching output", async () => {
    const target = join(root, "build", "by-input", generation, "output", "zcl_snap.clas.mjs");
    writeFileSync(target, "// deliberately mismatching warm output");
    rmSync(join(root, "src"), {recursive: true});
    rmSync(join(root, "gen"), {recursive: true});
    rmSync(join(root, "lib"), {recursive: true});
    writeFileSync(config(), "invalid live config");
    const result = await compiler.verify(generation);
    expect(result.verdict, JSON.stringify(result)).to.equal("differs");
    expect(result.differing).to.include("zcl_snap.clas.mjs");
    expect(JSON.parse(readFileSync(side(generation), "utf8")).verified).to.equal(false);
  });

  it("retains URL-cloned library bytes before the temporary clone is removed", async () => {
    const lib = join(root, "lib");
    execFileSync("git", ["init", "-q", lib]);
    execFileSync("git", ["-C", lib, "add", "src"]);
    execFileSync("git", ["-C", lib, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
    const settings = JSON.parse(readFileSync(config(), "utf8"));
    settings.libs = [{url: pathToFileURL(lib).href}];
    writeFileSync(config(), JSON.stringify(settings));
    const cold = await build({root, generators: false});
    expect((await compiler.verify(cold.hash)).verdict).to.equal("same");
    const record = JSON.parse(readFileSync(join(root, "build", "by-input", cold.hash, "source-inputs.json"), "utf8"));
    expect(Object.keys(record).some(key => key.startsWith("__external/") && key.endsWith("zif_lib.intf.abap"))).to.equal(true);
  });

  it("reports genuinely missing frozen bytes as inconclusive with the source and digest", async () => {
    const path = join(root, "build", "by-input", generation);
    const inputs = JSON.parse(readFileSync(join(path, "source-inputs.json"), "utf8"));
    const digest = inputs["src/zcl_snap.clas.abap"];
    expect(digest).to.equal(createHash("sha256").update(source("zcl_snap", 2)).digest("hex"));
    rmSync(join(root, "build", "source-by-digest", digest));
    rmSync(join(path, "source", "src", "zcl_snap.clas.abap"), {force: true});
    const result = await compiler.verify(generation);
    expect(result.verdict).to.equal("inconclusive");
    expect(result.why).to.include("src/zcl_snap.clas.abap").and.include(digest);
  });

  const pauseVerification = async () => {
    const ready = join(root, "verify-ready"), release = join(root, "verify-release");
    const preload = join(root, "pause-output-verify.mjs");
    writeFileSync(preload, `import {modulesOf} from ${JSON.stringify(new URL("../tools/osd-transpile.mjs", import.meta.url).href)};
import {existsSync, writeFileSync} from 'node:fs';
const {Transpiler} = modulesOf(${JSON.stringify(root)}), run = Transpiler.prototype.run;
Transpiler.prototype.run = async function(...args) {
 writeFileSync(${JSON.stringify(ready)}, 'ready');
 while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20));
 return run.apply(this, args);
};`);
    process.env.NODE_OPTIONS = `${nodeOptions ?? ""} --import=${pathToFileURL(preload).href}`;
    const verifying = compiler.verify(generation);
    for (let i = 0; i < 200 && !existsSync(ready); i++) await sleep(20);
    if (!existsSync(ready)) { writeFileSync(release, "resume"); throw new Error("verifier did not reach transpile"); }
    return {verifying, resume: () => writeFileSync(release, "resume")};
  };

  it("always settles a sidecar that vanishes during the parent's read", async () => {
    const {verifying, resume} = await pauseVerification();
    const original = fs.readFileSync;
    let raced = false;
    fs.readFileSync = function(path, ...args) {
      if (String(path) === side(generation)) {
        raced = true;
        rmSync(path, {force: true});
      }
      return original.call(this, path, ...args);
    };
    syncBuiltinESMExports();
    try {
      resume();
      const result = await verifying;
      expect(raced).to.equal(true);
      expect(result.verdict, JSON.stringify(result)).to.equal("superseded");
      expect(compiler.verifying).to.equal(undefined);
    } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  });

  it("writes verified sidecars through a temporary file and rename", async () => {
    const {verifying, resume} = await pauseVerification();
    const original = fs.writeFileSync, writes = [];
    fs.writeFileSync = function(path, ...args) {
      if (String(path).startsWith(side(generation))) writes.push(String(path));
      return original.call(this, path, ...args);
    };
    syncBuiltinESMExports();
    try {
      resume();
      expect((await verifying).verdict).to.equal("same");
      expect(writes).to.have.length(1);
      expect(writes[0]).to.not.equal(side(generation));
      expect(existsSync(writes[0])).to.equal(false);
      expect(JSON.parse(readFileSync(side(generation), "utf8")).verified).to.equal(true);
    } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  });

  it("settles a vanished verification sidecar as superseded", async () => {
    const {verifying, resume} = await pauseVerification();
    rmSync(side(generation));
    resume();
    const result = await verifying;
    expect(result.verdict, JSON.stringify(result)).to.equal("superseded");
    expect(compiler.verifying).to.equal(undefined);
    expect(existsSync(side(generation))).to.equal(false);
  });

  it("never certifies a concurrent cold replacement of mismatching warm output", async () => {
    writeFileSync(join(root, "build", "by-input", generation, "output", "zcl_snap.clas.mjs"), "// deliberate mismatch");
    const {verifying, resume} = await pauseVerification();
    if (nodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = nodeOptions;
    const cold = await build({root, generators: false, force: true, replace: true});
    expect(cold.hash).to.equal(generation);
    resume();
    const result = await verifying;
    expect(result.verdict, JSON.stringify(result)).to.equal("superseded");
    expect(existsSync(side(generation))).to.equal(false);
  });

  it("never certifies output removed during its cold transpile", async () => {
    const {verifying, resume} = await pauseVerification();
    rmSync(join(root, "build", "by-input", generation, "output"), {recursive: true});
    resume();
    const result = await verifying;
    expect(result.verdict, JSON.stringify(result)).to.equal("inconclusive");
    expect(result.why).to.include("missing").and.include("output");
    expect(JSON.parse(readFileSync(side(generation), "utf8")).verified).to.equal(false);
  });

  it("reports zero compared output files as inconclusive", async () => {
    const output = join(root, "build", "by-input", generation, "output");
    rmSync(output, {recursive: true});
    mkdirSync(output);
    const result = await compiler.verify(generation);
    expect(result.verdict, JSON.stringify(result)).to.equal("inconclusive");
    expect(result.why).to.include("zero output files");
    expect(JSON.parse(readFileSync(side(generation), "utf8")).verified).to.equal(false);
  });

  it("pins a superseded generation and its verification scratch across concurrent GC", async () => {
    writeFileSync(input, source("zcl_snap", 3));
    await compiler.build();
    const {verifying, resume} = await pauseVerification();
    const scratch = join(root, "build", "tmp", `${generation}.${compiler.verifying.pid}.verify`);
    mkdirSync(scratch, {recursive: true});
    const marker = join(scratch, "gc-probe");
    writeFileSync(marker, "verification in progress");
    let removed, retainedScratch;
    try {
      removed = gc(root, {keep: 0});
      retainedScratch = existsSync(marker);
    } finally { resume(); }
    const result = await verifying;
    expect(removed).to.not.include(generation);
    expect(retainedScratch).to.equal(true);
    expect(existsSync(scratch)).to.equal(false);
    expect(result.verdict, JSON.stringify(result)).to.equal("same");
    expect(gc(root, {keep: 0})).to.include(generation);
  });

  it("bounds an activation storm and verifies the latest generation ahead of retained older work", async () => {
    const seen = [], release = [], logs = [];
    const state = {next: new Set(), compiler: {verify: hash => {
      seen.push(hash);
      return new Promise(done => release.push(() => done({verdict: "same", files: 1, ms: 1})));
    }}};
    const store = {root, warm: () => state, served: {generation: "g0"}};
    const log = console.log;
    console.log = line => logs.push(line);
    try {
      for (let i = 0; i < 20; i++) {
        const hash = `g${i}`, dir = join(root, "build", "by-input", hash);
        mkdirSync(dir, {recursive: true});
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({hash, builtAt: new Date().toISOString()}));
        store.served.generation = hash;
        state.next.add(hash);
        verifyNext(store);
        expect(state.next.size, `activation ${i}`).to.be.at.most(2);
      }
      expect(seen).to.deep.equal(["g0"]);
      release.shift()();
      await state.verifying;
      expect(seen[1]).to.equal("g19");
      release.shift()();
      await state.verifying;
      expect(state.last).to.include({hash: "g19", verdict: "same"});
      expect(logs.some(line => line.includes("superseded, not verified"))).to.equal(true);
    } finally {
      state.closed = true;
      release.forEach(done => done());
      await state.verifying;
      console.log = log;
    }
  });

  it("releases verification pins after an inconclusive comparison", async () => {
    writeFileSync(input, source("zcl_snap", 3));
    await compiler.build();
    const {verifying, resume} = await pauseVerification();
    rmSync(join(root, "build", "by-input", generation, "output"), {recursive: true});
    resume();
    expect((await verifying).verdict).to.equal("inconclusive");
    expect(gc(root, {keep: 0})).to.include(generation);
  });

  it("drops queued generations deleted by GC rather than trying to verify them", async () => {
    const seen = [], logs = [], log = console.log;
    const state = {next: new Set(["gone", generation]), compiler: {verify: async hash => {
      seen.push(hash); return {verdict: "same", files: 1, ms: 1};
    }}};
    const store = {root, warm: () => state, served: {generation}};
    console.log = line => logs.push(line);
    try {
      verifyNext(store);
      while (state.verifying) await state.verifying;
      expect(seen).to.deep.equal([generation]);
      expect(logs.some(line => line.includes("gone superseded, not verified"))).to.equal(true);
      expect(state.next.size).to.equal(0);
    } finally { console.log = log; }
  });
});
