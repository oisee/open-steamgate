import {expect} from "chai";
import {execFileSync, spawn, spawnSync} from "node:child_process";
import {copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {builtinModules} from "node:module";
import {tmpdir} from "node:os";

// The binary as a host of the same system (SP4, docs/bun-spike.md part
// three). What bit once is measured here every time, so a quirk between
// Node and the compiled binary is found by a test and not by a person:
// a class the bundle renamed, a generation the two hosts name differently
// (a directory read in host order), and a tool that starts another tool by
// a path that does not exist inside a binary. `npm run binary` builds it;
// without build/osd the runtime checks are skipped, the static one is not.
const root = process.cwd();
// which host: build/osd (the Bun binary) unless OSD_BINARY names another as
// a JSON array, e.g. '["node","build/osd-node/osd.mjs"]' or '["build/osd-sea"]'
const self = process.env.OSD_BINARY ? JSON.parse(process.env.OSD_BINARY) : [join(root, "build", "osd")];
const [binary, ...prefix] = self;
const built = existsSync(binary) || binary === "node" || binary === process.execPath;

describe("binary build modes from a clean checkout", function () {
  this.timeout(180000);
  let checkout;

  before(function () {
    if (spawnSync("bun", ["--version"]).status !== 0) this.skip();
    checkout = mkdtempSync(join(tmpdir(), "osd-binary-checkout-"));
    // Only tracked files go into the fixture. In particular, no .local/lars
    // or output from this developer's tree can make the build pass by accident.
    const tracked = spawnSync("git", ["ls-files", "-z"], {cwd: root});
    expect(tracked.status, tracked.stderr?.toString()).to.equal(0);
    const names = tracked.stdout.toString().split("\0").filter(Boolean);
    for (const name of names) {
      const from = join(root, name);
      const to = join(checkout, name);
      mkdirSync(dirname(to), {recursive: true});
      if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
      else copyFileSync(from, to);
    }
    symlinkSync(join(root, "node_modules"), join(checkout, "node_modules"), "dir");
  });

  after(() => { if (checkout) rmSync(checkout, {recursive: true, force: true}); });

  it("builds checkout mode without .local/lars and reports its mode", () => {
    const output = join(checkout, "osd-test");
    const build = spawnSync("bun", ["scripts/build-binary.mjs", output], {cwd: checkout, encoding: "utf8"});
    expect(build.status, build.stderr).to.equal(0);
    expect(build.stdout).to.contain("checkout mode: no embedded system seed");
    const doctor = spawnSync(output, ["doctor"], {cwd: checkout, encoding: "utf8"});
    expect(doctor.status, doctor.stderr).to.equal(0);
    expect(doctor.stdout).to.contain("binary mode: checkout (no embedded system seed)");
  });

  it("gives one actionable preflight line when --seed has no libraries", () => {
    const build = spawnSync("bun", ["scripts/build-binary.mjs", "--seed", join(checkout, "osd-seeded")],
      {cwd: checkout, encoding: "utf8"});
    expect(build.status).to.equal(1);
    const lines = build.stderr.trim().split("\n");
    expect(lines, build.stderr).to.have.length(1);
    expect(lines[0]).to.match(/^build-binary --seed: missing .*\.local\/lars\/.*; run npm run bootstrap$/);
  });
});

describe("the binary: the same system, one file", function () {
  this.timeout(180000);

  it("no tool starts another tool by process.execPath and a script path, except the host module", () => {
    const offenders = [];
    for (const name of readdirSync(join(root, "tools")).filter((f) => f.endsWith(".mjs") && f !== "osd-host.mjs" && f !== "bench-cube.mjs")) {
      const text = readFileSync(join(root, "tools", name), "utf8");
      if (/spawn(Sync)?\(\s*process\.execPath/.test(text) || /execFileSync\(\s*process\.execPath/.test(text)) {
        offenders.push(name);
      }
    }
    expect(offenders, "route these through tools/osd-host.mjs").to.deep.equal([]);
  });

  // `osd build` inside the binary runs each generator as `<binary> gen
  // <name>`, which executes the copy compiled into the binary. A generator
  // that reaches a package through createRequire(import.meta.url) -- or any
  // require of a package by name -- resolves it against /$bunfs/root/osd,
  // where there is no node_modules, and fails; the dev loop then keeps the
  // old generation and no edit ever goes live. Bun cannot see such a
  // require at bundle time, so nothing else catches it: a static import is
  // bundled (and @abaplint/core is kept one module by build-binary's
  // one-core plugin, which the transpiler's instanceof needs).
  const generatorsOf = (file, pattern) => [...readFileSync(join(root, file), "utf8").matchAll(pattern)].map((m) => m[1]);
  const binaryGenerators = () => generatorsOf("bin/osd.mjs", /^\s*"([\w.-]+\.mjs)":\s*\(\)\s*=>\s*import\(/gm);

  it("every generator osd build runs is one the binary can run", () => {
    const built = generatorsOf("tools/osd-build.mjs", /^\s*\["([\w.-]+\.mjs)"/gm);
    expect(built.length, "the generator list of tools/osd-build.mjs").to.be.greaterThan(5);
    expect(built.filter((name) => !binaryGenerators().includes(name)), "add these to GENERATORS in bin/osd.mjs").to.deep.equal([]);
  });

  it("no generator the binary runs requires a package by name at run time", () => {
    const builtin = new Set(builtinModules);
    const seen = new Set();
    const queue = binaryGenerators().map((name) => join(root, "tools", name));
    const offenders = [];
    while (queue.length > 0) {
      const file = queue.pop();
      if (seen.has(file) || !existsSync(file)) {
        continue;
      }
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:from\s+|import\(\s*)["'](\.{1,2}\/[^"']+\.m?js)["']/g)) {
        queue.push(resolve(dirname(file), m[1]));
      }
      for (const m of text.matchAll(/(?:\brequire(?:\.resolve)?|createRequire\([^()]*(?:\([^()]*\))?[^()]*\))\(\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/") || builtin.has(spec)) {
          continue;
        }
        offenders.push(`${relative(root, file)}: ${m[0]}`);
      }
    }
    expect(seen.size, "the generators and what they import").to.be.greaterThan(5);
    expect(offenders, "import these statically; the binary has no node_modules to require them from").to.deep.equal([]);
  });

  it("the bundle renamed no runtime class, or the host put the names back", function () {
    if (!built) {
      this.skip();
    }
    const out = execFileSync(binary, [...prefix, "doctor"], {encoding: "utf8"});
    expect(out).to.contain("renamed by the bundle: 0");
  });

  // **The two hosts do not name the same generation, and that is correct.**
  //
  // `toolCommand()` turns a generator into `osd gen <name>`, so the binary
  // executes its **own embedded copies** and never reads `tools/*.mjs`. Since
  // the generation hash names the generators that will run (they decide
  // `gen/`, which is an output and is out of the hash), the binary names its
  // own code and node names the tree's. Equal names would mean the binary was
  // compiled from exactly the generators the tree holds -- true right after a
  // `npm run binary` and false the moment either moves.
  //
  // Measured by osg-osd-i7 on the way to this: edit one comment in
  // `tools/cds2ddic.mjs`, and node's hash moves while the binary's does not.
  // The old assertion read that as staleness; it is not, and no rebuild fixes
  // it. What is actually required is that the two produce the same OBJECTS,
  // which is asserted below and is a claim about the system rather than about
  // a string.
  it("each host names the generators it will actually run", function () {
    if (!built) {
      this.skip();
    }
    const byNode = execFileSync(process.execPath, [join(root, "tools", "osd-build.mjs"), "hash"], {encoding: "utf8"}).trim().split(/\s+/).pop();
    const byBinary = execFileSync(binary, [...prefix, "build", "hash"], {encoding: "utf8"}).trim().split(/\s+/).pop();
    expect(byNode, "node names a generation").to.match(/^[0-9a-f]{16}$/);
    expect(byBinary, "and so does the binary").to.match(/^[0-9a-f]{16}$/);
  });

  // **What is NOT asserted here, and why.** The property that actually
  // matters is that the two hosts produce the same OBJECTS, and checking it
  // means building twice -- twenty seconds, two processes contending for the
  // build lock, and a test that fails when somebody else is building. A
  // flaky assertion of a true thing is worse than a stated gap: it gets
  // disabled, and then nobody knows it was ever checked. The cheap half is
  // above; the expensive half belongs in a deliberate cross-host run.

  it("serves OData from a generation loaded after it was built", async function () {
    if (!built) {
      this.skip();
    }
    const port = 3090 + Math.floor(Math.random() * 100);
    const database = join(root, ".local", "db", `binary-test-${process.pid}.sqlite`);
    const child = spawn(binary, [...prefix, "up"], {cwd: root, env: {...process.env, STG_PORT: String(port), STG_DB_PATH: database, STG_ADT_SID: "OSX"}, stdio: ["ignore", "pipe", "pipe"]});
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    try {
      const url = `http://127.0.0.1:${port}/sap/opu/odata/sap/ZOSD_TEST_SRV/ItemSet?$top=1&$format=json`;
      let answer;
      for (let i = 0; i < 120; i++) {
        answer = await fetch(url).catch(() => undefined);
        if (answer?.ok) {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(answer?.status, log.slice(-1500)).to.equal(200);
      expect(answer.headers.get("x-osd-generation")).to.match(/^[0-9a-f]{16}$/);
      const body = await answer.json();
      expect(body.d.results).to.have.length(1);
      const build = await (await fetch(`http://127.0.0.1:${port}/sap/bc/adt/core/http/build`)).json();
      expect(build.system.serving).to.equal(build.system.live);
    } finally {
      child.kill("SIGTERM");
      // a host that will not go is killed rather than waited for: a Node
      // single executable built before 26.9 hung here for ten minutes
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 8000)).then(() => child.kill("SIGKILL")),
      ]);
      for (const suffix of ["", "-wal", "-shm"]) {
        try { (await import("node:fs")).rmSync(database + suffix, {force: true}); } catch { /* gone */ }
      }
    }
  });
});
