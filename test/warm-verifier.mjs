import {expect} from "chai";
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {build, gc, layout, lock} from "../tools/osd-build.mjs";
import {WarmCompiler, warmRule} from "../tools/osd-warm.mjs";
import {WarmCompilerProcess} from "../tools/osd-warm-process.mjs";
import {closeWarm} from "../tools/osd-store-warm.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {pinVerification, verificationPins} from "../tools/osd-verify-pin.mjs";
import {registryClass, transactions} from "../tools/osd-tran-registry.mjs";

const source = n => `CLASS zcl_guard DEFINITION PUBLIC CREATE PUBLIC. PUBLIC SECTION.
CLASS-METHODS get RETURNING VALUE(rv) TYPE i. ENDCLASS.
CLASS zcl_guard IMPLEMENTATION. METHOD get. rv = ${n}. ENDMETHOD. ENDCLASS.`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (work, ms = 4000) => {
  let timer;
  return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("test deadline exceeded")), ms); })])
    .finally(() => clearTimeout(timer));
};

describe("warm verifier lifetime and retained history (#625 round 6)", function () {
  this.timeout(15000);
  let root, compiler, store, hung;
  const input = () => join(root, "src", "zcl_guard.clas.abap");
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-verifier-"));
    mkdirSync(join(root, "src"));
    writeFileSync(input(), source(1));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", output_folder: "output", libs: [],
      write_source_map: true, options: {ignoreSyntaxCheck: false, unknownTypes: "compileError"}}));
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    await build({root, generators: false});
  });
  afterEach(async () => {
    if (hung?.exitCode === null && hung?.signalCode === null) {
      const exited = new Promise(resolve => hung.once("exit", resolve));
      hung.kill("SIGKILL"); await exited;
    }
    if (store) await closeWarm(store);
    await compiler?.shutdown?.();
    await compiler?.drop();
    rmSync(root, {recursive: true, force: true});
  });

  it("reaps a verifier that really never exits before priming and cold publication", async () => {
    store = new ObjectStore({root, roots: [{path: "src", writable: true}], libs: [], build: {generators: false}});
    store.warmState = {on: true}; store.warmVerifyDeadlineMs = 80; store.warmDeadlineMs = 10000;
    compiler = new WarmCompilerProcess({root}); store.warmState.compiler = compiler;
    hung = spawn(process.execPath, ["-e", "process.stdout.write('ready'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {stdio: ["ignore", "pipe", "pipe"]});
    await new Promise(resolve => hung.stdout.once("data", resolve));
    compiler.verifying = hung;
    const priming = store.warmUp();
    const publication = store.publish({force: true});
    await bounded(new Promise(resolve => hung.once("exit", resolve)), 1000);
    const result = await bounded(publication, 12000);
    await priming;
    expect(result.ok, JSON.stringify(result)).to.equal(true);
    expect(hung.signalCode).to.equal("SIGKILL");
    expect(store.warmState.priming).to.equal(undefined);
  });

  it("bounds pin acquisition while a real build lock remains busy", async () => {
    const hash = JSON.parse(readFileSync(join(root, "build", "live", "manifest.json"))).hash;
    const unlock = lock(layout(root));
    try {
      const error = await bounded(pinVerification(root, hash, "scratch", {deadlineMs: 60}).then(() => undefined, e => e), 1000);
      expect(error?.code).to.equal("VERIFY_TIMEOUT");
    } finally { unlock(); }
  });

  it("rejects adjacent INTERFACES edits that independently change the cold transaction registry", () => {
    const tran = join(root, "src", "zguard.tran.xml");
    writeFileSync(tran, `<abapGit><TSTC><TCODE>ZGUARD</TCODE></TSTC><TSTCP><PARAM>\\CLASS=ZCL_GUARD\\METHOD=GET</PARAM></TSTCP></abapGit>`);
    const before = source(1).replace("PUBLIC SECTION.", "PUBLIC SECTION. INTERFACES zif_marker.");
    const after = before.replace("INTERFACES zif_marker.", "INTERFACES zif_marker. INTERFACES zif_osd_transaction.");
    writeFileSync(input(), before);
    const coldBefore = registryClass(transactions([join(root, "src")]));
    writeFileSync(input(), after);
    const coldAfter = registryClass(transactions([join(root, "src")]));
    expect(coldAfter).to.not.equal(coldBefore);
    expect(warmRule({path: input(), before, after})).to.match(/INTERFACES/);
    expect(warmRule({path: input(), before: after, after: before})).to.match(/INTERFACES/);
  });

  it("acknowledges verification in the real worker and prunes GC history and drops", async () => {
    const states = [];
    compiler = new WarmCompilerProcess({root, onMessage: message => { if (message.state) states.push(message.state); }});
    await compiler.prime();
    for (let n = 2; n < 7; n++) {
      writeFileSync(input(), source(n));
      const result = await compiler.build();
      expect((await compiler.verify(result.hash)).verdict).to.equal("same");
      // A subsequent response proves the actual worker discarded its hash.
      await compiler.check({type: "CLAS", name: "ZCL_GUARD", source: readFileSync(input(), "utf8")});
      expect(states.at(-1).unverified, `worker response after generation ${n}`).to.deep.equal([]);
      expect(compiler.unverified.size).to.equal(0);
      gc(root, {keep: 0});
    }
    writeFileSync(input(), source(7)); await compiler.build();
    writeFileSync(input(), source(8)); await compiler.build();
    gc(root, {keep: 0});
    await compiler.check({type: "CLAS", name: "ZCL_GUARD", source: readFileSync(input(), "utf8")});
    expect(states.at(-1).unverified).to.have.length(1);
    await compiler.drop();
    expect(compiler.unverified.size).to.equal(0);
  });

  it("GC removes unpinned warm sidecars along with their generations", async () => {
    compiler = new WarmCompiler({root}); await compiler.prime();
    writeFileSync(input(), source(2)); const old = (await compiler.build()).hash;
    writeFileSync(input(), source(3)); await compiler.build();
    const side = join(root, "build", "by-input", `${old}.warm.json`);
    expect(existsSync(side)).to.equal(true);
    expect(gc(root, {keep: 0})).to.include(old);
    expect(existsSync(side)).to.equal(false);
  });

  it("expires a stale pin even when its PID belongs to a live process and GC reaps scratch", async () => {
    const paths = layout(root), pins = join(paths.build, "verify-pins");
    mkdirSync(pins); mkdirSync(join(paths.tmp, "stale-scratch"), {recursive: true});
    const stale = join(pins, "stale.json");
    writeFileSync(stale, JSON.stringify({pid: process.pid, hash: "old", scratch: "stale-scratch", createdAt: Date.now() - 300001}));
    expect(verificationPins(root)).to.deep.equal([]);
    expect(existsSync(stale)).to.equal(false);
    gc(root, {keep: 0});
    expect(existsSync(join(paths.tmp, "stale-scratch"))).to.equal(false);
    const hash = JSON.parse(readFileSync(join(root, "build", "live", "manifest.json"))).hash;
    const release = await pinVerification(root, hash, "live-scratch");
    try { expect(verificationPins(root)).to.have.length(1); } finally { release(); }
  });
});
