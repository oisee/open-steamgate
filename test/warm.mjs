// The warm compile (tools/osd-warm.mjs) and the swap (tools/osd-hot.mjs):
// the rule that decides what may be built warm, the import rewriting a swap
// depends on, and the real path on a tree of four objects -- a cold build, a
// prime, a class edit, an interface edit, a refusal, and a cold transpile of
// the result compared byte for byte. The real path needs a transpiler that can
// build some objects of a registry it keeps (abaplint/transpiler#1899, #1900,
// #1921); without one it is skipped, and says why.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {GENERATORS, build, hashOf, inputsOf, liveHash, layout} from "../tools/osd-build.mjs";
import {GENERATORS_READ, HOST_HELD, WarmCompiler, importerRefusal, importsOf, linkOrCopy, probe, warmRule} from "../tools/osd-warm.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {statSync} from "node:fs";
import {RuntimePool} from "../tools/osd-pool.mjs";
import {devLoop} from "../tools/osd-dev.mjs";
import {existsSync} from "node:fs";
import {HotLoader, rewrite} from "../tools/osd-hot.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const REPO = resolve(".");

describe("tools/osd-warm: what a save may be built warm", () => {
  const clas = "CLASS zcl_x DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES zif_y.\nENDCLASS.\nCLASS zcl_x IMPLEMENTATION.\nENDCLASS.\n";

  it("was read against the generators the cold build runs", () => {
    // a generator added to osd-build.mjs may read a source the rule lets
    // through: this fails until somebody has read it and the rule again
    expect(GENERATORS.map((g) => g[0])).to.deep.equal(GENERATORS_READ);
  });

  it("takes a content edit of a class or an interface", () => {
    expect(warmRule({path: "src/x/zcl_x.clas.abap", before: clas, after: clas + "\n"})).to.equal(undefined);
    expect(warmRule({path: "src/x/zcl_x.clas.locals_imp.abap", before: "", after: "x"})).to.equal(undefined);
    expect(warmRule({path: "src/x/zif_y.intf.abap", before: "a", after: "b"})).to.equal(undefined);
  });

  it("refuses what a generator reads", () => {
    expect(warmRule({path: "src/x/zt.tabl.xml", before: "", after: "x"})).to.match(/not the source/);
    expect(warmRule({path: "src/cds/zc.ddls.asddls", before: "", after: "x"})).to.match(/not the source/);
    expect(warmRule({path: "gen/segw/zcl_r.clas.abap", before: "", after: "x"})).to.match(/generated/);
    expect(warmRule({path: "src/zcl_x.clas.abap", before: clas, after: clas + "METHOD m BY DATABASE PROCEDURE FOR HDB."})).to.match(/AMDP/);
    expect(warmRule({path: "src/zcl_x.clas.abap", before: clas, after: clas.replace("zif_y", "zif_z")})).to.match(/INTERFACES/);
    expect(warmRule({path: "src/zcl_x.clas.abap", before: clas, after: clas + "SUBMIT zgg_ex_012 AND RETURN."})).to.match(/SUBMIT source/);
    expect(warmRule({path: "src/zif_y.intf.abap", before: "a", after: "b", amdpText: "DATA x TYPE zif_y=>ty."})).to.match(/AMDP class/);
    const chained = clas.replace("INTERFACES zif_y.", "INTERFACES: zif_y, zif_w.");
    expect(warmRule({path: "src/zcl_x.clas.abap", before: chained, after: chained.replace(", zif_w", "")})).to.match(/INTERFACES/);
  });

  it("knows every module the serving process holds itself", () => {
    // those are recycled rather than swapped; a new one in osd-serve.mjs
    // must be named here
    const serve = readFileSync(join(REPO, "tools", "osd-serve.mjs"), "utf8");
    const held = [...serve.matchAll(/\bfrom\("([^"]+\.mjs)"\)/g)].map((m) => m[1]);
    expect([...new Set(held)].sort()).to.deep.equal([...HOST_HELD].sort());
  });
});

describe("tools/osd-warm: the import graph a swap relies on", () => {
  it("reads the specifiers the transpiler writes", () => {
    const text = `const {a} = await import("./zcl_a.clas.mjs");\nimport {b} from "./zcl_b.clas.mjs";\n` +
      `const {c} = await import("./%23ns%23cl_c.clas.mjs");\nconst zlib = await import("zlib");`;
    expect(importsOf(text).sort()).to.deep.equal(["#ns#cl_c.clas.mjs", "zcl_a.clas.mjs", "zcl_b.clas.mjs"]);
  });

  it("refuses a swap that leaves an importer of a rebuilt module in place", () => {
    // a class that imports an interface's module statically, and was not
    // among the objects the scope references reached
    const importers = new Map([["zif_s.intf.mjs", new Set(["zcl_reader.clas.mjs"])]]);
    expect(importerRefusal(importers, ["zif_s.intf.mjs"])).to.match(/zcl_reader.clas.mjs imports zif_s.intf.mjs/);
    expect(importerRefusal(importers, ["zif_s.intf.mjs", "zcl_reader.clas.mjs"])).to.equal(undefined);
    // the scripts are rewritten by every build and swapped by none: a
    // program importing _init.mjs does not hold a swap back
    expect(importerRefusal(new Map([["_init.mjs", new Set(["zprog.prog.mjs"])]]), ["_init.mjs"])).to.equal(undefined);
  });
});

describe("tools/osd-hot: a swap in a running process", () => {
  let root;
  const gen = (hash, files) => {
    const out = join(root, "build", "by-input", hash, "output");
    mkdirSync(out, {recursive: true});
    for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text);
    return out;
  };
  // two modules: b is a superclass-like import of a, and both register
  // themselves the way a transpiled class does
  const b = (v) => `globalThis.__hot ??= {}; globalThis.__hot.b = ${JSON.stringify(v)}; globalThis.__hot.bLoads = (globalThis.__hot.bLoads ?? 0) + 1; export const b = ${JSON.stringify(v)};`;
  const a = (v) => `const {b} = await import("./b.mjs");\nglobalThis.__hot.a = ${JSON.stringify(v)} + "/" + b;\nglobalThis.__hot.url = import.meta.url;\nexport const a = 1;\n//# sourceMappingURL=a.mjs.map`;

  before(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "osd-hot-")));
    gen("g1", {"a.mjs": a("a1"), "b.mjs": b("b1")});
    symlinkSync(join("build", "by-input", "g1", "output"), join(root, "output"));
    delete globalThis.__hot;
    await import(pathToFileURL(join(root, "output", "a.mjs")).href);
  });
  after(() => {
    rmSync(root, {recursive: true, force: true});
    delete globalThis.__hot;
  });

  it("binds a swapped module to the instances already loaded", async () => {
    gen("g2", {"a.mjs": a("a2"), "b.mjs": b("b1")});
    const hot = new HotLoader(root);
    await hot.swap({generation: "g2", modules: ["a.mjs"]});
    expect(globalThis.__hot.a).to.equal("a2/b1");
    // b was not swapped: a's new copy imported the instance loaded at start
    expect(globalThis.__hot.bLoads).to.equal(1);
    // a module reading beside itself reads beside the generation's copy
    expect(globalThis.__hot.url).to.equal(pathToFileURL(join(root, "build", "by-input", "g2", "output", "a.mjs")).href);
    const copy = readFileSync(join(root, "build", "hot", "g2", "a.mjs"), "utf8");
    expect(copy).to.include(pathToFileURL(join(root, "build", "by-input", "g1", "output", "b.mjs")).href);
    expect(copy).to.include(`sourceMappingURL=${pathToFileURL(join(root, "build", "by-input", "g2", "output", "a.mjs.map")).href}`);

    // both swapped: the new a binds to the new b
    gen("g3", {"a.mjs": a("a3"), "b.mjs": b("b3")});
    await hot.swap({generation: "g3", modules: ["b.mjs", "a.mjs"]});
    expect(globalThis.__hot.a).to.equal("a3/b3");
    expect(globalThis.__hot.bLoads).to.equal(2);

    // back to a generation seen before: evaluated again, not taken from the
    // module cache, or the class table would keep the last one
    await hot.swap({generation: "g2", modules: ["a.mjs", "b.mjs"]});
    expect(globalThis.__hot.a).to.equal("a2/b1");
    expect(hot.swaps).to.equal(3);
  });

  it("rewrites a relative import outside output/ to the file the first load reached", () => {
    mkdirSync(join(root, "test"), {recursive: true});
    writeFileSync(join(root, "test", "setup.mjs"), "");
    const from = join(root, "build", "by-input", "g1", "output");
    symlinkSync(join("..", "..", "..", "test"), join(root, "build", "by-input", "g1", "test"));
    const text = rewrite(`await import("../test/setup.mjs");`, {from, name: "x.mjs", urlOf: () => "u", hotUrlOf: () => undefined});
    expect(text).to.equal(`await import(${JSON.stringify(pathToFileURL(join(root, "test", "setup.mjs")).href)});`);
  });
});

describe("tools/osd-warm: the supervisor and the dev loop", () => {
  it("counts a pool's swaps by its busiest work process", () => {
    const pool = new RuntimePool({size: 2});
    pool.runtimes[0].swaps = 2;
    pool.runtimes[1].swaps = 5;
    expect(pool.swaps).to.equal(5);
  });

  it("takes the warm branch for classes and interfaces only", async () => {
    const calls = [];
    const store = {
      roots: [],
      warm: () => ({compiler: {primed: true}}),
      find: () => ({}),
      activate: (type, name) => { calls.push(`check ${type} ${name}`); return {type, name, active: true, issues: []}; },
      warmActivation: (type, name) => { calls.push(`warm ${type} ${name}`); return {type, name, active: true}; },
      completeActivations: () => true,
      served: undefined,
    };
    const loop = devLoop({store, watch: false, log: () => {}, publish: async () => ({ok: true, transpile: {}})});
    await loop.touch("src/zcl_a.clas.abap");
    await loop.touch("src/ztab.tabl.xml");
    expect(calls).to.deep.equal(["warm CLAS ZCL_A", "check TABL ZTAB"]);
  });
});

// A warm build is not a warm activation: the build can be warm and the load
// a recycle -- the swap refused, or a module the serving process holds. The
// activation's X-OSD-Build said "warm" for both, while osd.log said the swap
// was refused and the runtime recycled (vsp-i7, 2026-10-02).
describe("tools/osd-warm: a refused swap is not answered as warm", () => {
  const fakeRuntime = (generation, hot) => ({
    running: true, generation, swaps: 0,
    hot, recycle: async () => ({generation: "h2", ms: 7}),
  });
  const warmBuild = {ok: true, warm: true, hash: "h2", from: "h1", modules: ["zcl_a.clas.mjs"], hostHeld: []};

  it("publish() says it recycled, and why, when the swap is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-warm-refused-"));
    try {
      const store = new ObjectStore({root: dir, libs: []});
      store.transpile = async () => warmBuild;
      store.served = fakeRuntime("h1", async () => { throw new Error("the runtime carries h0, and the swap is from h1"); });
      const result = await store.publish();
      expect(result).to.include({ok: true, recycled: true});
      expect(result.hot).to.not.equal(true);
      expect(result.why).to.match(/swap was refused: the runtime carries h0/);
      // a second caller of the same save (the dev loop beside the façade)
      // finds the generation already live: still not a swap
      store.served.generation = "h2";
      store.transpile = async () => ({...warmBuild, modules: [], cached: true});
      const again = await store.publish();
      expect(again).to.include({ok: true, recycled: false, hot: false});
      expect(again.why).to.match(/^the runtime was recycled onto it: the swap was refused/);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  const activateWith = async (publishResult) => {
    const express = (await import("express")).default;
    const {adtRouter} = await import("../tools/adt-facade.mjs");
    const store = {
      roots: [], find: () => undefined, root: REPO,
      warm: () => ({on: true, compiler: {primed: true}}),
      warmActivation: (type, name) => ({type, name, active: true, revision: "r1"}),
      completeActivations: () => true,
      publish: async () => publishResult,
    };
    const app = express();
    app.use(adtRouter({store, data: {}, logMisses: false}).router);
    const server = await new Promise((done) => { const s = app.listen(0, "127.0.0.1", () => done(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
      const login = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      const cookie = (login.headers.getSetCookie?.() ?? []).map((v) => v.split(";", 1)[0]).join("; ");
      const res = await fetch(base + "/activation?method=activate", {
        method: "POST", headers: {"x-csrf-token": login.headers.get("x-csrf-token"), cookie},
        body: `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_a" adtcore:name="ZCL_A"/>
</adtcore:objectReferences>`,
      });
      expect(res.status).to.equal(200);
      return {build: res.headers.get("x-osd-build"), swap: res.headers.get("x-osd-swap-ms")};
    } finally {
      await new Promise((done) => server.close(done));
    }
  };

  it("X-OSD-Build is warm for a swap", async () => {
    const h = await activateWith({ok: true, transpile: warmBuild, recycled: false, hot: true, ms: 12});
    expect(h).to.deep.equal({build: "warm", swap: "12"});
  });

  it("X-OSD-Build is not warm when the swap was refused and the runtime recycled", async () => {
    const h = await activateWith({ok: true, transpile: warmBuild, recycled: true, ms: 900,
      why: "the swap was refused: the runtime carries h0, and the swap is from h1"});
    expect(h.build).to.not.equal("warm");
    expect(h.build).to.match(/^cold; recycled after a warm build: the swap was refused: the runtime carries h0/);
    expect(h.swap).to.equal(null);
  });

  // Two activators per save -- the dev loop and the façade's activation --
  // call publish() side by side. They shared one build and both swapped
  // from its base; the second swap was refused ("the runtime carries h1,
  // and the swap is from h0") and recycled (vsp-i7, 2026-10-02). The real
  // transpile() runs here over a stand-in warm compiler that, like the real
  // one, moves its base to every generation it builds.
  describe("two publish() calls at once", () => {
    const setup = () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-warm-concurrent-"));
      const store = new ObjectStore({root: dir, libs: []});
      const src = {text: "rv = 1."};
      const compiler = {
        primed: true, unverified: new Set(), hash: "h0", built: src.text, n: 0, builds: 0,
        async build() {
          this.builds++;
          const text = src.text;
          await new Promise((done) => setTimeout(done, 20));
          const from = this.hash;
          if (text === this.built) {
            return {ok: true, hash: from, from, cached: true, modules: [], hostHeld: [], stale: 0};
          }
          this.built = text;
          this.hash = `h${++this.n}`;
          return {ok: true, hash: this.hash, from, modules: ["zcl_a.clas.mjs"], hostHeld: [], stale: 1};
        },
      };
      store.warmState = {on: true, compiler, reason: undefined};
      const log = [];
      store.served = {
        running: true, generation: "h0", swaps: 0, recycles: 0,
        async hot(swap) {
          if (swap.from !== this.generation) {
            throw new Error(`the runtime carries ${this.generation}, and the swap is from ${swap.from}`);
          }
          await new Promise((done) => setTimeout(done, 30));
          this.generation = swap.generation;
          log.push(`swap ${swap.from}->${swap.generation}`);
          return {ms: 30, swaps: ++this.swaps};
        },
        async recycle() {
          this.recycles++;
          log.push("recycle");
          return {generation: compiler.hash, ms: 900};
        },
      };
      const done = () => {
        clearTimeout(store.warmState.timer);
        rmSync(dir, {recursive: true, force: true});
      };
      return {store, src, compiler, log, done};
    };

    it("the same save: one swap, the second answer warm, nothing recycled", async () => {
      const {store, src, log, done} = setup();
      try {
        src.text = "rv = 2.";
        const [devLoop, facade] = await Promise.all([store.publish(), store.publish()]);
        expect(log).to.deep.equal(["swap h0->h1"]);
        expect(store.served.recycles).to.equal(0);
        expect(store.served.generation).to.equal("h1");
        for (const r of [devLoop, facade]) {
          expect(r).to.include({ok: true, recycled: false, generation: "h1"});
          expect(r.why).to.equal(undefined);
          expect(await activateWith(r)).to.have.property("build", "warm");
        }
        expect(devLoop.hot).to.equal(true);
      } finally {
        done();
      }
    });

    it("a later edit while the first is in flight gets its own build and swap", async () => {
      const {store, src, compiler, log, done} = setup();
      try {
        src.text = "rv = 2.";
        const first = store.publish();
        await new Promise((r) => setTimeout(r, 5));
        src.text = "rv = 3.";
        const second = store.publish();
        const [a, b] = await Promise.all([first, second]);
        expect(log).to.deep.equal(["swap h0->h1", "swap h1->h2"]);
        expect(store.served.recycles).to.equal(0);
        expect(a).to.include({ok: true, hot: true, generation: "h1"});
        expect(b).to.include({ok: true, hot: true, generation: "h2"});
        expect(store.served.generation).to.equal("h2");
        expect(compiler.built).to.equal("rv = 3.");
      } finally {
        done();
      }
    });

    // the first swap refused and its recycle slow: the second caller waits
    // for the recycle rather than swapping into a process changing hands,
    // and both answers say cold, with the first refusal as the reason
    it("a refused swap with a slow recycle: the second waits, both answer cold", async () => {
      const {store, src, compiler, log, done} = setup();
      try {
        const runtime = store.served;
        let finish;
        let refuse = true;
        const hot = runtime.hot;
        runtime.hot = async function (swap) {
          log.push(`hot-try ${swap.from}->${swap.generation}`);
          if (this.recycling !== undefined) throw new Error("nothing to swap into");
          if (refuse) {
            refuse = false;
            throw new Error(`the runtime carries h9, and the swap is from ${swap.from}`);
          }
          return hot.call(this, swap);
        };
        runtime.recycle = async function () {
          log.push("recycle");
          // like #stopChild: the child is gone before the shutdown is awaited
          this.recycling ??= new Promise((resolve) => { finish = resolve; }).then(() => {
            this.recycling = undefined;
            this.generation = compiler.hash;
            return {generation: compiler.hash, ms: 900};
          });
          return this.recycling;
        };
        src.text = "rv = 2.";
        const first = store.publish();
        while (finish === undefined) await new Promise((r) => setTimeout(r, 5));
        const second = store.publish();
        const tick = new Promise((r) => setTimeout(() => r("pending"), 80));
        expect(await Promise.race([second.then(() => "settled"), tick])).to.equal("pending");
        expect(log).to.deep.equal(["hot-try h0->h1", "recycle"]);
        finish();
        const [a, b] = await Promise.all([first, second]);
        expect(log).to.deep.equal(["hot-try h0->h1", "recycle"]);
        expect(runtime.generation).to.equal("h1");
        for (const r of [a, b]) {
          expect(r.hot).to.not.equal(true);
          const h = await activateWith(r);
          expect(h.build).to.match(/^cold; recycled after a warm build: .*the swap was refused: the runtime carries h9/);
          expect(h.swap).to.equal(null);
        }
      } finally {
        done();
      }
    });

    it("a publish() that throws does not stop the next one", async () => {
      const {store, src, log, done} = setup();
      try {
        const transpile = store.transpile;
        store.transpile = async () => { store.transpile = transpile; throw new Error("the disk went away"); };
        src.text = "rv = 2.";
        let thrown;
        const first = store.publish().catch((e) => { thrown = e; });
        // in its turn, not queued: a caller in the same turn as the first
        // joins it and shares its outcome, the throw included
        await new Promise((r) => setImmediate(r));
        const second = store.publish();
        await first;
        expect(thrown?.message).to.equal("the disk went away");
        expect(await second).to.include({ok: true, hot: true, generation: "h1"});
        expect(log).to.deep.equal(["swap h0->h1"]);
      } finally {
        done();
      }
    });
  });
});

// After #440 the two activators of a save ran one after the other, and the
// second built the same tree again to find it live: "warm, already live"
// with no X-OSD-Swap-Ms, and an activation queued behind whatever the dev
// loop was building (vsp-i7, 2026-10-02). Here the real ObjectStore, the
// real façade router and the real dev loop, over a stand-in warm compiler
// that names a generation after its source, as hashOf names one after the
// inputs, and a stand-in runtime whose swap takes a while.
describe("tools/osd-warm: an activation answers once its source is live", () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SWAP_MS = 150;
  const nameOf = (text) => `g${text.replace(/\D/g, "")}`;

  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-warm-live-"));
    mkdirSync(join(dir, "src"));
    const store = new ObjectStore({root: dir, roots: [{path: "src", writable: true}], libs: []});
    store.write("CLAS", "ZCL_A", "CLASS zcl_a DEFINITION PUBLIC. ENDCLASS.\nCLASS zcl_a IMPLEMENTATION. ENDCLASS.\n");
    // the object is live before the edits below: an inactive one is kept
    // out of every build (ObjectStore#overlay), and a build that must leave
    // something out is not a warm one
    store.completeActivation(store.warmActivation("CLAS", "ZCL_A"));
    const src = {text: "rv = 1."};
    store.sourceKey = async () => nameOf(src.text);
    const events = [];
    const compiler = {
      primed: true, unverified: new Set(), hash: nameOf(src.text), built: src.text, builds: 0,
      async build() {
        this.builds++;
        const text = src.text;
        await sleep(20);
        const from = this.hash;
        if (text === this.built) {
          return {ok: true, hash: from, from, cached: true, modules: [], hostHeld: [], stale: 0};
        }
        this.built = text;
        this.hash = nameOf(text);
        return {ok: true, hash: this.hash, from, modules: ["zcl_a.clas.mjs"], hostHeld: [], stale: 1};
      },
    };
    store.warmState = {on: true, compiler, reason: undefined};
    store.served = {
      running: true, epoch: 1, generation: nameOf(src.text), swaps: 0, recycling: undefined, starting: undefined,
      async hot(swap) {
        if (this.running !== true || this.recycling !== undefined) throw new Error("nothing to swap into");
        if (swap.from !== this.generation) {
          throw new Error(`the runtime carries ${this.generation}, and the swap is from ${swap.from}`);
        }
        await sleep(SWAP_MS);
        this.generation = swap.generation;
        events.push({what: `swap ${swap.from}->${swap.generation}`, at: Date.now()});
        return {ms: SWAP_MS, swaps: ++this.swaps};
      },
      async recycle() {
        events.push({what: "recycle", at: Date.now()});
        this.generation = compiler.hash;
        return {generation: compiler.hash, ms: 900};
      },
    };
    const done = () => {
      clearTimeout(store.warmState.timer);
      rmSync(dir, {recursive: true, force: true});
    };
    return {store, src, compiler, events, done};
  };

  // a save by an editor that is not the store (VS Code, vim): other bytes on
  // disk, which the dev loop takes as a change -- the store's own write it
  // leaves to the activation that owns it (ObjectStore#ownWrite)
  const editorSave = (store, text) => {
    writeFileSync(join(store.root, "src/osd/zcl_a.clas.abap"),
      `CLASS zcl_a DEFINITION PUBLIC. ENDCLASS.\nCLASS zcl_a IMPLEMENTATION. ENDCLASS.\n* ${text}\n`);
    return "src/osd/zcl_a.clas.abap";
  };

  // an ADT activation of ZCL_A through the real façade router
  const activate = async (store) => {
    const express = (await import("express")).default;
    const {adtRouter} = await import("../tools/adt-facade.mjs");
    const app = express();
    app.use(adtRouter({store, data: {}, logMisses: false}).router);
    const server = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
      const login = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      const cookie = (login.headers.getSetCookie?.() ?? []).map((v) => v.split(";", 1)[0]).join("; ");
      const res = await fetch(base + "/activation?method=activate", {
        method: "POST", headers: {"x-csrf-token": login.headers.get("x-csrf-token"), cookie},
        body: `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_a" adtcore:name="ZCL_A"/>
</adtcore:objectReferences>`,
      });
      const body = await res.text();
      return {status: res.status, at: Date.now(), body,
        build: res.headers.get("x-osd-build"), swap: res.headers.get("x-osd-swap-ms")};
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  };
  const swaps = (events) => events.filter((e) => e.what.startsWith("swap")).map((e) => e.what);

  it("waits for a runtime changing hands, then swaps, rather than answering at once", async () => {
    const {store, src, events, done} = setup();
    try {
      const runtime = store.served;
      // a catch-up recycle in flight, on the generation live before the save
      let finish;
      runtime.running = false;
      runtime.recycling = new Promise((r) => { finish = r; }).then(() => {
        runtime.recycling = undefined;
        runtime.running = true;
        events.push({what: "recycled", at: Date.now()});
        return {generation: runtime.generation, ms: 900};
      });
      src.text = "rv = 2.";
      const answer = activate(store);
      const early = await Promise.race([answer.then(() => "answered"), sleep(150).then(() => "waiting")]);
      finish();
      const a = await answer;
      expect(early, "answered while no process served the code").to.equal("waiting");
      expect(events.map((e) => e.what)).to.deep.equal(["recycled", "swap g1->g2"]);
      expect(a.at).to.be.at.least(events[1].at);
      expect(a).to.include({status: 200, build: "warm", swap: String(SWAP_MS)});
    } finally {
      done();
    }
  });

  it("the dev loop and the activation of one save: one build, one swap, and the answer waits for it", async () => {
    const {store, src, compiler, events, done} = setup();
    try {
      src.text = "rv = 2.";
      const loop = devLoop({store, watch: false, log: () => {}});
      const dev = loop.touch(editorSave(store, src.text));
      await sleep(5);
      const [d, a] = await Promise.all([dev, activate(store)]);
      expect(d).to.include({ok: true, stage: "live"});
      // in line (#440) the answer already waited for the swap; what it
      // lacked was the swap's ms, and it built the same tree a second time
      expect(swaps(events)).to.deep.equal(["swap g1->g2"]);
      expect(a.at, "answered before the swap landed").to.be.at.least(events[0].at);
      expect(compiler.builds, "builds").to.equal(1);
      expect(a).to.include({status: 200, build: "warm", swap: String(SWAP_MS)});
      expect(d.result.hot).to.equal(true);
    } finally {
      done();
    }
  });

  it("an activation after the dev loop's swap says the source went live by that swap", async () => {
    const {store, src, events, done} = setup();
    try {
      src.text = "rv = 2.";
      const loop = devLoop({store, watch: false, log: () => {}});
      await loop.touch(editorSave(store, src.text));
      const a = await activate(store);
      expect(swaps(events)).to.deep.equal(["swap g1->g2"]);
      expect(a).to.include({status: 200, build: "warm", swap: String(SWAP_MS)});
    } finally {
      done();
    }
  });

  // vsp's write test: the dev loop builds the create's skeleton, the client
  // saves the real source and activates, and the dev loop sees that save too:
  // the activation does not join the skeleton's build (another tree), and the
  // dev loop's second pass joins the activation's (the same tree) -- two
  // builds at most, one per tree
  it("an edit saved while a build is in flight is not joined to it; the next activator of the edit is", async () => {
    const {store, src, compiler, events, done} = setup();
    try {
      src.text = "rv = 2.";
      const first = store.publish();
      await sleep(5);
      src.text = "rv = 3.";
      const second = store.publish();
      await sleep(5);
      const third = store.publish();
      const [a, b, c] = await Promise.all([first, second, third]);
      expect(compiler.builds).to.equal(2);
      expect(swaps(events)).to.deep.equal(["swap g1->g2", "swap g2->g3"]);
      expect(a).to.include({hot: true, generation: "g2"});
      expect(b).to.include({hot: true, generation: "g3"});
      expect(c).to.equal(b);
    } finally {
      done();
    }
  });

  it("a swap that reaches the swap limit answers once the catch-up recycle has landed, as that load", async () => {
    const {store, src, events, done} = setup();
    try {
      store.warmSwapLimit = 1;
      const runtime = store.served;
      runtime.recycle = async function () {
        await sleep(100);
        this.epoch++;
        events.push({what: "recycle", at: Date.now()});
        return {generation: this.generation, ms: 100};
      };
      src.text = "rv = 2.";
      const a = await activate(store);
      expect(events.map((e) => e.what)).to.deep.equal(["swap g1->g2", "recycle"]);
      expect(a.at, "answered before the catch-up recycle landed").to.be.at.least(events[1].at);
      expect(a.swap).to.equal(null);
      expect(a.build).to.match(/^cold; recycled after a warm build: .*catch-up recycle after 1 swaps/);
    } finally {
      done();
    }
  });

  it("a build the serving process already runs loads nothing: no recycle of unchanged code", async () => {
    const {store, events, done} = setup();
    try {
      store.warmState.on = false;
      store.transpile = async () => ({ok: true, hash: "g1", cached: true, objects: 1});
      const r = await store.publish();
      expect(r).to.include({ok: true, recycled: false, generation: "g1"});
      expect(events, "a recycle of unchanged code").to.deep.equal([]);
      // a forced build replaces the generation's files under its name: loaded
      const forced = await store.publish({force: true, replace: true});
      expect(forced).to.include({ok: true, recycled: true});
      expect(events.map((e) => e.what)).to.deep.equal(["recycle"]);
    } finally {
      done();
    }
  });

  it("a runtime that never stops changing hands is answered, not waited for for ever", async () => {
    const {store, src, done} = setup();
    try {
      store.transitionMs = 100;
      store.served.running = false;
      store.served.recycling = new Promise(() => {});
      src.text = "rv = 2.";
      const r = await Promise.race([store.publish(), sleep(1500).then(() => "hung")]);
      expect(r, "hung").to.not.equal("hung");
      expect(r).to.include({ok: false});
      expect(r.error).to.match(/still changing hands/);
    } finally {
      done();
    }
  });

  // vsp-i7 on 0.6.1511: a boot of more than 60 s under load (the
  // cross-reference alone 21.6 s) and a fixed 60-s limit answered a slow,
  // correct recycle as a failed activation. A boot that keeps saying it is
  // booting is waited for; only silence is late.
  it("a boot that keeps talking is waited for past the limit, then loaded", async () => {
    const {store, src, events, done} = setup();
    const runtime = store.served;
    let talking;
    try {
      store.transitionMs = 100;
      runtime.running = false;
      runtime.booting = {phase: "seeding the cross-reference", since: Date.now(), heard: Date.now()};
      talking = setInterval(() => { runtime.booting.heard = Date.now(); }, 30);
      runtime.recycling = sleep(400).then(() => {
        clearInterval(talking);
        runtime.booting = undefined;
        runtime.recycling = undefined;
        runtime.running = true;
        runtime.epoch = 2;
        return {generation: runtime.generation, ms: 400};
      });
      src.text = "rv = 2.";
      const r = await Promise.race([store.publish(), sleep(3000).then(() => "hung")]);
      expect(r, "hung").to.not.equal("hung");
      expect(r.error).to.equal(undefined);
      expect(r).to.include({ok: true, hot: true, generation: "g2"});
      expect(swaps(events)).to.deep.equal(["swap g1->g2"]);
    } finally {
      clearInterval(talking);
      done();
    }
  });

  it("a boot that falls silent is late after the limit, however long it talked before", async () => {
    const {store, src, done} = setup();
    const runtime = store.served;
    let talking;
    try {
      store.transitionMs = 100;
      runtime.running = false;
      runtime.booting = {phase: "starting", since: Date.now(), heard: Date.now()};
      talking = setInterval(() => { runtime.booting.heard = Date.now(); }, 30);
      setTimeout(() => clearInterval(talking), 250);
      runtime.recycling = new Promise(() => {});
      src.text = "rv = 2.";
      const began = Date.now();
      const r = await Promise.race([store.publish(), sleep(3000).then(() => "hung")]);
      expect(r, "hung").to.not.equal("hung");
      expect(r).to.include({ok: false});
      expect(r.error).to.match(/still changing hands after \d+ ms, 100 ms of it without a word/);
      expect(Date.now() - began, "waited while it talked").to.be.at.least(300);
    } finally {
      clearInterval(talking);
      done();
    }
  });

  it("the warm registry is not primed while the runtime changes hands, and a build does not wait on that", async () => {
    const {store, done} = setup();
    const runtime = store.served;
    try {
      let primed = 0;
      store.warmState.compiler = {primed: false, async prime() { primed++; this.primed = true; return {}; }};
      let settle;
      runtime.recycling = new Promise((ok) => { settle = ok; });
      const prime = store.warmUp();
      await sleep(20);
      expect(primed, "primed during the recycle").to.equal(0);
      expect(store.warmState.priming, "a build would wait on it").to.equal(undefined);
      runtime.recycling = undefined;
      settle({generation: runtime.generation, ms: 1});
      await prime;
      expect(primed).to.equal(1);
    } finally {
      done();
    }
  });

  // the recycle a publish asks for itself (here the verifier's forced
  // rebuild) is bounded the same way, and the chain moves on: the next
  // publish meets the transition and is bounded too, and once the recycle
  // settles publishes load again
  it("a recycle that does not settle is answered, the chain moves on, and recovers once it settles", async () => {
    const {store, done} = setup();
    try {
      store.transitionMs = 50;
      const runtime = store.served;
      let finish;
      let stuck = true;
      runtime.recycle = function () {
        if (!stuck) return Promise.resolve({generation: this.generation, ms: 1});
        this.recycling ??= new Promise((ok) => { finish = ok; }).then(() => {
          stuck = false;
          this.recycling = undefined;
          return {generation: this.generation, ms: 1};
        });
        return this.recycling;
      };
      store.transpile = async () => ({ok: true, hash: "g1", cached: false, objects: 1});
      const first = await Promise.race([store.publish({force: true, replace: true}), sleep(1000).then(() => "hung")]);
      expect(first, "the forced publish hung").to.not.equal("hung");
      expect(first).to.include({ok: false});
      expect(first.error).to.match(/still changing hands .*the recycle/);
      const second = await Promise.race([store.publish(), sleep(1000).then(() => "hung")]);
      expect(second, "the next publish hung").to.not.equal("hung");
      expect(second).to.include({ok: false});
      finish();
      await sleep(10);
      expect(await store.publish({force: true, replace: true})).to.include({ok: true, recycled: true});
    } finally {
      done();
    }
  });

  it("a catch-up recycle that does not settle answers the activation as nothing loaded, not warm", async () => {
    const {store, src, done} = setup();
    try {
      store.transitionMs = 50;
      store.warmSwapLimit = 1;
      store.served.recycle = () => new Promise(() => {});
      src.text = "rv = 2.";
      const a = await Promise.race([activate(store), sleep(1500).then(() => "hung")]);
      expect(a, "the activation hung").to.not.equal("hung");
      expect(a.build).to.match(/^failed; the runtime is still changing hands .*the catch-up recycle/);
      expect(a.swap).to.equal(null);
      expect(a.body).to.match(/still changing hands/);
    } finally {
      done();
    }
  });

  // a partial recycle of a pool (one work process failed to come up on the
  // new generation) is repaired by the next publish, not reported as served
  it("a pool with one work process on the old generation is loaded, not reported as served", async () => {
    const {store, src, compiler, events, done} = setup();
    try {
      src.text = "rv = 2.";
      compiler.built = src.text;
      compiler.hash = "g2";
      const pool = new RuntimePool({size: 2, root: store.root});
      pool.runtimes.forEach((r, i) => {
        Object.defineProperty(r, "running", {get: () => true, configurable: true});
        r.generation = i === 0 ? "g2" : "g1";
        r.hot = async (swap) => {
          if (swap.from !== r.generation) throw new Error(`the runtime carries ${r.generation}, and the swap is from ${swap.from}`);
          r.generation = swap.generation;
          return {ms: 1, swaps: 1};
        };
        r.recycle = async () => {
          events.push({what: `recycle ${i}`, at: Date.now()});
          r.generation = compiler.hash;
          return {generation: compiler.hash, ms: 1, recycled: true};
        };
      });
      store.served = pool;
      const r = await store.publish();
      expect(r.ok).to.equal(true);
      expect(pool.runtimes.map((m) => m.generation)).to.deep.equal(["g2", "g2"]);
      expect(events.map((e) => e.what)).to.deep.equal(["recycle 0", "recycle 1"]);
      expect(r.recycled).to.equal(true);
    } finally {
      done();
    }
  });

  it("a load belongs to the process that made it: after a catch-up recycle the answer is not a swap", async () => {
    const {store, src, done} = setup();
    try {
      src.text = "rv = 2.";
      await devLoop({store, watch: false, log: () => {}}).touch(editorSave(store, src.text));
      // a catch-up recycle onto g2, outside any publish: a new process
      store.served.epoch = 2;
      const a = await activate(store);
      expect(a.swap, "the old process's swap").to.equal(null);
      expect(a.build).to.match(/^cold; recycled after a warm build: .*started on it/);
    } finally {
      done();
    }
  });

  it("waits for any work process of a pool changing hands", async () => {
    const {store, src, events, done} = setup();
    try {
      const pool = new RuntimePool({size: 2, root: store.root});
      let finish;
      pool.runtimes.forEach((r, i) => {
        let running = i !== 0;
        Object.defineProperty(r, "running", {get: () => running, configurable: true});
        r.generation = "g1";
        r.hot = async (swap) => {
          if (running !== true || r.recycling !== undefined) throw new Error("nothing to swap into");
          await sleep(20);
          r.generation = swap.generation;
          events.push({what: `swap ${i} ${swap.from}->${swap.generation}`, at: Date.now()});
          return {ms: 20, swaps: 1};
        };
        if (i === 0) {
          r.recycling = new Promise((ok) => { finish = ok; }).then(() => {
            r.recycling = undefined;
            running = true;
            events.push({what: "recycled", at: Date.now()});
          });
        }
      });
      store.served = pool;
      src.text = "rv = 2.";
      const answer = store.publish();
      const early = await Promise.race([answer.then(() => "answered"), sleep(150).then(() => "waiting")]);
      finish();
      const r = await answer;
      expect(early, "answered while the primary was recycling").to.equal("waiting");
      expect(events.map((e) => e.what)).to.deep.equal(["recycled", "swap 0 g1->g2", "swap 1 g1->g2"]);
      expect(r).to.include({ok: true, hot: true, generation: "g2"});
    } finally {
      done();
    }
  });

  // the same, with the real name of the tree (sourceKey(), osd-build
  // hashOf) instead of a stand-in: a compiler that names its generation by
  // it, as the warm compiler does
  it("joins by the real name of the tree: one build for the dev loop and the activation", async () => {
    const {store, events, done} = setup();
    try {
      const dir = store.root;
      writeFileSync(join(dir, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], libs: [], output_folder: "output"}));
      delete store.sourceKey;
      const name = () => hashOf(dir, inputsOf(dir));
      const compiler = store.warmState.compiler;
      compiler.hash = name();
      store.served.generation = compiler.hash;
      compiler.build = async function () {
        this.builds++;
        const hash = name();
        await sleep(20);
        const from = this.hash;
        if (hash === from) return {ok: true, hash, from, cached: true, modules: [], hostHeld: [], stale: 0};
        this.hash = hash;
        return {ok: true, hash, from, modules: ["zcl_a.clas.mjs"], hostHeld: [], stale: 1};
      };
      writeFileSync(join(dir, "src", "osd", "zcl_a.clas.abap"), "CLASS zcl_a DEFINITION PUBLIC. ENDCLASS.\n* saved in vim\n");
      const dev = devLoop({store, watch: false, log: () => {}}).touch("src/osd/zcl_a.clas.abap");
      await sleep(5);
      const [d, a] = await Promise.all([dev, activate(store)]);
      expect(d).to.include({ok: true, stage: "live"});
      expect(compiler.builds, "builds").to.equal(1);
      expect(swaps(events)).to.have.length(1);
      expect(a).to.include({status: 200, build: "warm", swap: String(SWAP_MS)});
    } finally {
      done();
    }
  });
});

describe("tools/osd-warm: a comparison the tree has left", () => {
  // vsp's pattern: a warm edit starts a comparison (a cold transpile in a
  // child), and the next create is a cold build beside it; the comparison
  // can only end inconclusive, and the activation waiting on the build paid
  // for both transpiles
  it("is stopped by a cold build, and one of the tree as it is is kept", () => {
    const kills = [];
    const child = (hash) => ({osdHash: hash, exitCode: null, kill: (s) => kills.push(`${hash} ${s}`)});
    const compiler = {verifying: child("g2")};
    expect(WarmCompiler.prototype.cancelVerify.call(compiler, "g2"), "the tree is still g2").to.equal(false);
    expect(WarmCompiler.prototype.cancelVerify.call(compiler, "g3")).to.equal(true);
    expect(kills).to.deep.equal(["g2 SIGTERM"]);
    expect(compiler.verifying.osdCancelled).to.match(/a cold build replaced the tree/);
    expect(WarmCompiler.prototype.cancelVerify.call({verifying: undefined}, "g3")).to.equal(false);
  });
});

describe("tools/osd-warm: where the filesystem will not link", () => {
  it("copies instead, for the errors that mean 'not here', and rethrows the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-link-"));
    writeFileSync(join(dir, "a"), "bytes");
    const refuse = (code) => () => {
      throw Object.assign(new Error(code), {code});
    };
    expect(linkOrCopy(join(dir, "a"), join(dir, "b"), refuse("EXDEV"))).to.equal("copy");
    expect(readFileSync(join(dir, "b"), "utf8")).to.equal("bytes");
    expect(linkOrCopy(join(dir, "a"), join(dir, "c"), refuse("EPERM"))).to.equal("copy");
    expect(() => linkOrCopy(join(dir, "a"), join(dir, "d"), refuse("ENOENT"))).to.throw("ENOENT");
    expect(linkOrCopy(join(dir, "a"), join(dir, "e"))).to.equal("link");
    rmSync(dir, {recursive: true, force: true});
  });

  it("says the warm build is off, and why, when OSD_WARM is not set", () => {
    const before = process.env.OSD_WARM;
    delete process.env.OSD_WARM;
    const dir = mkdtempSync(join(tmpdir(), "osd-warmstate-"));
    try {
      const status = new ObjectStore({root: dir, libs: []}).warmStatus();
      expect(status.state).to.equal("off");
      expect(status.reason).to.match(/OSD_WARM/);
      expect(status.swaps).to.equal(0);
    } finally {
      if (before !== undefined) process.env.OSD_WARM = before;
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe("tools/osd-warm: the real path on a small tree", function () {
  this.timeout(180000);
  let root;
  let warm;
  let missing;
  const SOURCES = {
    "zif_ws_shape.intf.abap": "INTERFACE zif_ws_shape PUBLIC.\n  METHODS area RETURNING VALUE(rv) TYPE i.\nENDINTERFACE.\n",
    "zcl_ws_square.clas.abap": "CLASS zcl_ws_square DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES zif_ws_shape.\nENDCLASS.\nCLASS zcl_ws_square IMPLEMENTATION.\n  METHOD zif_ws_shape~area.\n    rv = 4.\n  ENDMETHOD.\nENDCLASS.\n",
    "zcl_ws_caller.clas.abap": "CLASS zcl_ws_caller DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.\nENDCLASS.\nCLASS zcl_ws_caller IMPLEMENTATION.\n  METHOD run.\n    DATA lo TYPE REF TO zif_ws_shape.\n    CREATE OBJECT lo TYPE zcl_ws_square.\n    rv = lo->area( ).\n  ENDMETHOD.\nENDCLASS.\n",
    "zcl_ws_alone.clas.abap": "CLASS zcl_ws_alone DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    CLASS-METHODS one RETURNING VALUE(rv) TYPE i.\nENDCLASS.\nCLASS zcl_ws_alone IMPLEMENTATION.\n  METHOD one.\n    rv = 1.\n  ENDMETHOD.\nENDCLASS.\n",
  };
  const edit = (file, from, to) => {
    const path = join(root, "src", file);
    writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
  };

  before(async function () {
    const {Transpiler, core, plugin} = modulesOf(REPO);
    missing = plugin !== undefined ? "a transpiler plugin is installed" : await probe(Transpiler, core);
    if (missing !== undefined) {
      console.log(`      (the real path is skipped: ${missing})`);
      this.skip();
    }
    root = realpathSync(mkdtempSync(join(tmpdir(), "osd-warm-")));
    mkdirSync(join(root, "src"));
    for (const [name, text] of Object.entries(SOURCES)) writeFileSync(join(root, "src", name), text);
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({
      input_folder: "src", input_filter: [], output_folder: "output", libs: [], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"},
    }));
    writeFileSync(join(root, "package.json"), "{}");
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    await build({root, generators: false});
    warm = new WarmCompiler({root});
  });
  after(() => {
    warm?.drop();
    if (root !== undefined) rmSync(root, {recursive: true, force: true});
  });

  it("primes on the live generation", async () => {
    const r = await warm.prime();
    expect(r.files).to.equal(4);
  });

  it("builds a class edit alone, and names the generation the way a cold build would", async () => {
    edit("zcl_ws_alone.clas.abap", "rv = 1.", "rv = 2.");
    const r = await warm.build();
    expect(r.stale).to.equal(1);
    expect(r.modules).to.deep.equal(["zcl_ws_alone.clas.mjs"]);
    expect(liveHash(root)).to.equal(r.hash);
    expect(warm.unverified.has(r.hash)).to.equal(true);
    const v = await warm.verify(r.hash);
    expect(v.verdict, JSON.stringify(v)).to.equal("same");
    expect(warm.unverified.has(r.hash)).to.equal(false);
  });

  it("builds an interface edit with its implementer and the class that calls it", async () => {
    edit("zif_ws_shape.intf.abap", "RETURNING VALUE(rv) TYPE i.", "RETURNING VALUE(rv) TYPE i.\n  \" a comment");
    const r = await warm.build();
    expect(r.modules.sort()).to.deep.equal(["zcl_ws_caller.clas.mjs", "zcl_ws_square.clas.mjs", "zif_ws_shape.intf.mjs"]);
    const v = await warm.verify(r.hash);
    expect(v.verdict, JSON.stringify(v)).to.equal("same");
  });

  it("says BUSY while a cold build holds the lock, and builds the edit afterwards", async () => {
    edit("zcl_ws_alone.clas.abap", "rv = 2.", "rv = 3.");
    const live = liveHash(root);
    writeFileSync(layout(root).lock, String(process.pid));
    let error;
    try {
      await warm.build();
    } catch (e) {
      error = e;
    }
    rmSync(layout(root).lock, {force: true});
    expect(error?.code).to.equal("BUSY");
    expect(liveHash(root)).to.equal(live);
    const r = await warm.build();
    expect(r.modules).to.deep.equal(["zcl_ws_alone.clas.mjs"]);
    expect(readFileSync(join(root, "output", "zcl_ws_alone.clas.mjs"), "utf8")).to.include("IntegerFactory.get(3)");
  });

  it("refuses a broken edit, switches nothing, and builds its readers with the fix", async () => {
    const live = liveHash(root);
    edit("zif_ws_shape.intf.abap", "METHODS area", "METHODS areaa");
    let error;
    try {
      await warm.build();
    } catch (e) {
      error = e;
    }
    expect(error?.check, String(error)).to.equal(true);
    expect(liveHash(root)).to.equal(live);
    edit("zif_ws_shape.intf.abap", "METHODS areaa", "METHODS area");
    const r = await warm.build();
    // the fix restores the text of the live generation, and the readers the
    // broken edit reached are built again with it
    expect(r.hash).to.equal(live);
    expect(r.stale).to.be.greaterThan(1);
  });

  it("makes a cold build of a generation nobody has compared yet build it again", async () => {
    edit("zcl_ws_alone.clas.abap", "rv = 3.", "rv = 4.");
    const r = await warm.build();
    const side = join(layout(root).byInput, `${r.hash}.warm.json`);
    expect(existsSync(side)).to.equal(true);
    const cold = await build({root, generators: false});
    expect(cold.cached).to.equal(false);
    expect(cold.hash).to.equal(r.hash);
    expect(existsSync(side)).to.equal(false);
    warm.drop();
    await warm.prime();
  });

  it("never takes again a generation a cold transpile was found to differ from", async () => {
    const before = liveHash(root);
    edit("zcl_ws_alone.clas.abap", "rv = 4.", "rv = 5.");
    const bad = await warm.build();
    // as the store marks it when verify() says `differs`
    const side = join(layout(root).byInput, `${bad.hash}.warm.json`);
    writeFileSync(side, JSON.stringify({...JSON.parse(readFileSync(side, "utf8")), differs: ["x"]}));
    writeFileSync(join(layout(root).byInput, bad.hash, "output", "zcl_ws_alone.clas.mjs"), "// the wrong bytes");
    edit("zcl_ws_alone.clas.abap", "rv = 5.", "rv = 4.");
    expect((await warm.build()).hash).to.equal(before);
    edit("zcl_ws_alone.clas.abap", "rv = 4.", "rv = 5.");
    const again = await warm.build();
    expect(again.hash).to.equal(bad.hash);
    expect(again.cached).to.equal(false);
    expect(readFileSync(join(root, "output", "zcl_ws_alone.clas.mjs"), "utf8")).to.include("IntegerFactory.get(5)");
  });

  it("names what an edit would reach, and which of it has tests, without building", async () => {
    const closure = warm.closureOf("INTF", "ZIF_WS_SHAPE").map((o) => o.name).sort();
    expect(closure).to.deep.equal(["ZCL_WS_CALLER", "ZCL_WS_SQUARE", "ZIF_WS_SHAPE"]);
    expect(warm.closureOf("CLAS", "ZCL_WS_ALONE").map((o) => o.name)).to.deep.equal(["ZCL_WS_ALONE"]);
    expect(warm.closureOf("CLAS", "ZCL_WS_NOPE")).to.equal(undefined);
    // the direct readers only, from the same index
    expect(warm.readersOf("INTF", "ZIF_WS_SHAPE").map((o) => o.name).sort()).to.deep.equal(["ZCL_WS_CALLER", "ZCL_WS_SQUARE"]);
    expect(warm.readersOf("CLAS", "ZCL_WS_SQUARE").map((o) => o.name)).to.deep.equal(["ZCL_WS_CALLER"]);
  });

  it("refuses a broken interface with each reader's issues at its own line and column", async () => {
    const live = liveHash(root);
    edit("zif_ws_shape.intf.abap", "METHODS area", "METHODS area2");
    let error;
    try {
      await warm.build();
    } catch (e) {
      error = e;
    }
    edit("zif_ws_shape.intf.abap", "METHODS area2", "METHODS area");
    expect(error?.check).to.equal(true);
    const caller = error.issues.find((o) => o.name === "ZCL_WS_CALLER");
    expect(caller, JSON.stringify(error.issues)).to.not.equal(undefined);
    expect(caller.issues[0].line).to.equal(9);
    expect(caller.issues[0].column).to.be.greaterThan(1);
    expect(liveHash(root)).to.equal(live);
    const fixed = await warm.build();
    expect(fixed.hash).to.equal(live);
    expect(fixed.closure.map((o) => o.name).sort()).to.include("ZCL_WS_CALLER");
  });

  it("builds a generation of copies where the filesystem refuses to link", async () => {
    warm.link = () => {
      throw Object.assign(new Error("cross-device link"), {code: "EXDEV"});
    };
    try {
      edit("zcl_ws_alone.clas.abap", /rv = \d+\./, "rv = 6.");
      const r = await warm.build();
      expect(r.cached).to.equal(false);
      expect(warm.copies).to.be.greaterThan(0);
      // an unchanged module is a file of its own, not a link to the live one's
      expect(statSync(join(root, "output", "zcl_ws_caller.clas.mjs")).nlink).to.equal(1);
      expect(readFileSync(join(root, "output", "zcl_ws_alone.clas.mjs"), "utf8")).to.include("IntegerFactory.get(6)");
    } finally {
      warm.link = undefined;
      warm.link = (await import("node:fs")).linkSync;
    }
  });

  it("refuses a new file, and leaves the live generation alone", async () => {
    const live = liveHash(root);
    writeFileSync(join(root, "src", "zcl_ws_new.clas.abap"), SOURCES["zcl_ws_alone.clas.abap"].replaceAll("zcl_ws_alone", "zcl_ws_new"));
    let error;
    try {
      await warm.build();
    } catch (e) {
      error = e;
    }
    expect(error?.code).to.equal("NOT_WARM");
    expect(error.message).to.match(/is new/);
    expect(liveHash(root)).to.equal(live);
    expect(layout(root).live).to.be.a("string");
  });
});
