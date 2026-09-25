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
import {GENERATORS, build, liveHash, layout} from "../tools/osd-build.mjs";
import {GENERATORS_READ, HOST_HELD, WarmCompiler, importerRefusal, importsOf, probe, warmRule} from "../tools/osd-warm.mjs";
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
