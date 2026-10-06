import {expect} from "chai";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "../tools/osd-build.mjs";
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
      await sleep(650);
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

  it("queues every generation instead of replacing pending verification with the latest save", async () => {
    const seen = [];
    const state = {next: new Set(["g1", "g2", "g3"]), compiler: {verify: async hash => {seen.push(hash); return {verdict: "same", files: 1, ms: 1};}}};
    const store = {warm: () => state};
    verifyNext(store);
    while (state.verifying) await state.verifying;
    expect(seen).to.deep.equal(["g1", "g2", "g3"]);
    expect(state.next.size).to.equal(0);
  });
});
