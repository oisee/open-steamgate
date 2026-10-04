// Deterministic compiler IPC races and failures, over real built generations.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {ObjectStore} from "../tools/osd-store.mjs";
import {WarmCompilerProcess} from "../tools/osd-warm-process.mjs";
import {closeWarm} from "../tools/osd-store-warm.mjs";

const source = (name, n) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS v RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS ${name} IMPLEMENTATION.
 METHOD v.
 rv = ${n}.
 ENDMETHOD.
ENDCLASS.\n`;
const repo = resolve(".");
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe("warm compiler process: source isolation and bounded cold fallback", function () {
  this.timeout(30000);
  let root, store, compiler, child, paused;
  const mode = text => writeFileSync(join(root, "control"), text);
  const out = name => readFileSync(join(root, "output", `${name}.clas.mjs`), "utf8");
  const save = (name, n) => store.write("CLAS", name.toUpperCase(), source(name, n));
  const activate = () => store.publish({activate: [{type: "CLAS", name: "ZCL_A"}]});
  const waitPaused = async () => {
    for (let i = 0; i < 200 && !paused; i++) await sleep(10);
    expect(paused, "worker reached the dispatch/hash pause").to.equal(true);
  };
  const gone = () => {
    expect(child?.exitCode !== null || child?.signalCode !== null, "compiler was reaped before fallback returned").to.equal(true);
  };
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-warm-ipc-"));
    mkdirSync(join(root, "src"));
    for (const name of ["zcl_a", "zcl_b"]) writeFileSync(join(root, "src", `${name}.clas.abap`), source(name, 1));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({
      input_folder: "src", input_filter: [], output_folder: "output", libs: [], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"},
    }));
    writeFileSync(join(root, "package.json"), "{}");
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
    mode("normal");
    const worker = join(root, "worker.mjs");
    writeFileSync(worker, `import {main} from ${JSON.stringify(pathToFileURL(join(repo, "tools/osd-warm-worker.mjs")).href)};
import {readFileSync} from "node:fs";
main({heapLimit: ${512 * 1048576}, beforeCompile: async ({method}) => {
 const mode = readFileSync("control", "utf8");
 if (mode === "hang-" + method) { process.send({type: "paused"}); while (true) {} }
 if (mode === "exit-" + method) process.exit(23);
 if (mode === "disconnect-" + method) {
  process.removeAllListeners("disconnect"); process.disconnect();
  await new Promise(() => setInterval(() => {}, 1000));
 }
 if (mode === "pause-" + method) {
  process.send({type: "paused"});
  await new Promise(resolve => process.once("message", resolve));
 }
}, afterCompile: async ({method}) => {
 if (readFileSync("control", "utf8") === "pause-finished-" + method) {
  process.send({type: "paused"});
  await new Promise(resolve => process.once("message", resolve));
 }
}});`);
    store = new ObjectStore({root, roots: [{path: "src", writable: true}], libs: [], build: {generators: false}});
    expect((await store.publish()).ok).to.equal(true);
    paused = false; child = undefined;
    compiler = new WarmCompilerProcess({root, worker,
      overlay: s => store.overlay(s), keyOf: f => store.objectKeyOf(f), inactiveSources: s => store.inactiveSources(s),
      onMessage: (message, process) => { child = process; if (message.type === "paused") paused = true; },
    });
    store.warmState = {on: true, compiler};
    expect(await store.warmUp()).to.not.equal(undefined, store.warmState.reason);
  });
  afterEach(async () => { await closeWarm(store); rmSync(root, {recursive: true, force: true}); });

  it("saves an unrelated object within 200 ms after dispatch, before hashing; B stays inactive", async () => {
    await save("zcl_a", 2);
    const checked = store.warmActivation("CLAS", "ZCL_A");
    mode("pause-build");
    const publishing = activate();
    await waitPaused();
    let saved = false;
    const saveStarted = performance.now();
    const saving = Promise.resolve(save("zcl_b", 20)).then(() => { saved = true; });
    await sleep(20);
    const savedBeforeResume = saved;
    const saveMs = performance.now() - saveStarted;
    const beforeResume = store.read("CLAS", "ZCL_B").source;
    mode("normal");
    child.send({method: "resume"});
    const result = await publishing;
    await saving;
    expect(result).to.include({ok: true});
    expect(result.transpile.warm).to.equal(true);
    expect(store.completeActivation(checked, result.transpile.built)).to.equal(true);
    expect(out("zcl_a")).to.include("IntegerFactory.get(2)");
    expect(out("zcl_b"), "an unrelated save must never enter A's live generation").to.include("IntegerFactory.get(1)").and.not.include("get(20)");
    expect(savedBeforeResume, "save completes while compilation is paused").to.equal(true);
    expect(saveMs).to.be.lessThan(200);
    expect(beforeResume).to.include("rv = 20.");
    expect(store.stateOf(store.find("CLAS", "ZCL_B")).version).to.equal("inactive");
    // The superseded dispatch was discarded; only the current isolated view is certified.
    expect(result.transpile.superseded).to.equal(1);
    expect((await compiler.verify(result.transpile.hash)).verdict).to.equal("same");
    mode("normal");
    const b = await store.publish({activate: [{type: "CLAS", name: "ZCL_B"}]});
    expect(b.ok).to.equal(true);
    expect(out("zcl_b")).to.include("IntegerFactory.get(20)");
    expect((await compiler.verify(b.transpile.hash)).verdict).to.equal("same");
  });


  it("saves within 200 ms during priming and catches up before warm becomes available", async () => {
    await compiler.drop();
    mode("pause-prime"); paused = false;
    const priming = store.warmUp();
    await waitPaused();
    const started = performance.now();
    const saving = Promise.resolve(save("zcl_a", 7));
    await Promise.race([saving, sleep(200).then(() => { throw new Error("save blocked by prime"); })]);
    expect(performance.now() - started).to.be.lessThan(200);
    expect(out("zcl_a")).to.include("IntegerFactory.get(1)");
    mode("normal"); child.send({method: "resume"});
    expect(await priming).to.not.equal(undefined, store.warmState.reason);
    expect(compiler.primed).to.equal(true);
    const result = await activate();
    expect(result.ok).to.equal(true);
    expect(result.transpile.warm).to.equal(true);
    expect(out("zcl_a")).to.include("IntegerFactory.get(7)");
  });

  it("supersedes a changed compile input and recompiles without publishing stale bytes", async () => {
    await save("zcl_a", 2);
    mode("pause-build");
    const publishing = activate();
    await waitPaused();
    const started = performance.now();
    await Promise.race([Promise.resolve(save("zcl_a", 8)), sleep(200).then(() => { throw new Error("save blocked by build"); })]);
    expect(performance.now() - started).to.be.lessThan(200);
    expect(out("zcl_a")).to.include("IntegerFactory.get(1)");
    mode("normal"); child.send({method: "resume"});
    const result = await publishing;
    expect(result.ok, JSON.stringify(result)).to.equal(true);
    expect(result.transpile.superseded).to.equal(1);
    expect(out("zcl_a")).to.include("IntegerFactory.get(8)").and.not.include("get(2)");
  });

  it("saves within 200 ms during a cold compile, discards its result and retries", async () => {
    let release, reached;
    const pausedBuild = new Promise(r => { reached = r; });
    const gate = new Promise(r => { release = r; });
    let builds = 0;
    store.buildOptions.onStep = async () => { if (++builds === 1) { reached(); await gate; } };
    await save("zcl_a", 2);
    const publishing = store.publish({force: true, activate: [{type: "CLAS", name: "ZCL_A"}]});
    await pausedBuild;
    try {
      const started = performance.now();
      await Promise.race([Promise.resolve(save("zcl_a", 9)), sleep(200).then(() => { throw new Error("save blocked by cold compile"); })]);
      expect(performance.now() - started).to.be.lessThan(200);
      expect(out("zcl_a")).to.include("IntegerFactory.get(1)");
    } finally { release(); }
    const result = await publishing;
    expect(result.ok, JSON.stringify(result)).to.equal(true);
    expect(result.transpile.superseded).to.equal(1);
    expect(builds).to.equal(2);
    expect(out("zcl_a")).to.include("IntegerFactory.get(9)").and.not.include("get(2)");
  });

  it("rejects a completed warm generation if a save lands before publication", async () => {
    await save("zcl_a", 2);
    mode("pause-finished-build");
    const publishing = activate();
    await waitPaused();
    const started = performance.now();
    await Promise.race([Promise.resolve(save("zcl_a", 10)), sleep(200).then(() => { throw new Error("save blocked by publication"); })]);
    await save("zcl_b", 20);
    expect(performance.now() - started).to.be.lessThan(200);
    expect(out("zcl_a")).to.include("IntegerFactory.get(1)");
    let release, reached;
    const gate = new Promise(r => { release = r; });
    const retry = new Promise(r => { reached = r; });
    store.buildOptions.onStep = async () => { reached(); await gate; };
    mode("normal"); child.send({method: "resume"});
    await retry;
    expect(out("zcl_a"), "the superseded warm generation was never made live").to.include("IntegerFactory.get(1)");
    expect(out("zcl_b")).to.include("IntegerFactory.get(1)");
    release();
    const result = await publishing;
    expect(result.ok, JSON.stringify(result)).to.equal(true);
    expect(result.transpile.superseded).to.equal(1);
    expect(out("zcl_a")).to.include("IntegerFactory.get(10)").and.not.include("get(2)");
    expect(out("zcl_b")).to.include("IntegerFactory.get(1)").and.not.include("get(20)");
  });

  it("catches up a prime whose frozen inputs were already loaded when the save landed", async () => {
    await compiler.drop(); paused = false;
    mode("pause-finished-prime");
    const priming = store.warmUp();
    await waitPaused();
    const started = performance.now();
    await Promise.race([Promise.resolve(save("zcl_a", 11)), sleep(200).then(() => { throw new Error("save blocked by loaded prime"); })]);
    expect(performance.now() - started).to.be.lessThan(200);
    mode("normal"); child.send({method: "resume"});
    expect(await priming).to.not.equal(undefined, store.warmState.reason);
    expect(compiler.primed).to.equal(true);
    const result = await activate();
    expect(result.ok).to.equal(true);
    expect(result.transpile.warm).to.equal(true);
    expect(out("zcl_a")).to.include("IntegerFactory.get(11)");
  });

  it("kills and awaits a hung mid-prime child, activates cold within the deadline, and leaves subsequent publications available", async () => {
    await compiler.drop();
    await save("zcl_a", 3);
    mode("hang-prime");
    store.warmDeadlineMs = 500;
    const priming = store.warmUp();
    await waitPaused();
    const started = performance.now();
    const result = await activate();
    await priming;
    expect(performance.now() - started).to.be.lessThan(5000);
    expect(result.ok, JSON.stringify(result)).to.equal(true);
    expect(result.transpile.warm).to.not.equal(true);
    expect(store.warmState.disabled).to.equal(true);
    expect(store.warmState.reason).to.include("exceeded 500 ms");
    gone();
    await save("zcl_a", 4);
    expect((await activate()).ok).to.equal(true);
    expect(out("zcl_a")).to.include("IntegerFactory.get(4)");
    console.log(`hung prime: cold activation ${(performance.now() - started).toFixed(0)} ms including the subsequent publication`);
  });

  it("reaps a compiler that exceeds its own heap growth limit, retaining the published warm generation", async () => {
    await compiler.drop();
    const worker = join(root, "worker.mjs");
    writeFileSync(worker, readFileSync(worker, "utf8").replace("heapLimit: 536870912", "heapLimit: -1e12"));
    await store.warmUp();
    await save("zcl_a", 6);
    const result = await activate();
    expect(result.ok).to.equal(true);
    expect(result.transpile.warm).to.equal(true);
    expect(compiler.recycleDue).to.equal(true);
    expect(compiler.primed).to.equal(false);
    expect(compiler.memory.rss).to.be.greaterThan(0);
    expect(store.warmState.primeDue).to.equal(true);
    gone();
    expect(out("zcl_a")).to.include("IntegerFactory.get(6)");
  });

  for (const fault of ["exit", "disconnect"]) {
    it(`falls back cold after compiler ${fault} during a build, reaping the child first`, async () => {
      mode(`${fault}-build`);
      store.warmDeadlineMs = 2000;
      await save("zcl_a", 5);
      const started = performance.now();
      const result = await activate();
      expect(result.ok, JSON.stringify(result)).to.equal(true);
      expect(result.transpile.warm).to.not.equal(true);
      expect(store.warmState.disabled).to.equal(true);
      gone();
      expect(out("zcl_a")).to.include("IntegerFactory.get(5)");
      expect(performance.now() - started).to.be.lessThan(5000);
    });
  }
});
