import {expect} from "chai";
import {execFileSync, spawnSync} from "node:child_process";
import {closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {runGeneratorsOf} from "../tools/osd-build-generators.mjs";
import {inspectReadRecord, makeReadRecord, markIncomplete, readGeneratorLog, READS, withSeedReads} from "../tools/osd-read-record.mjs";

// A synthetic generator: one road from node:fs to the bytes of a private
// tree per run, each copying or reading into gen/ the way a real one would.
const GENERATOR = `
import fs, {readFileSync, createReadStream, openSync, readSync, closeSync, copyFileSync, cpSync, linkSync, symlinkSync, renameSync} from "node:fs";
import {readFile, open, copyFile, cp} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const [api] = process.argv.slice(2);
const one = "vault/zsentinel.txt", dir = "vault/dir", out = "gen/" + api;
const roads = {
  readFileSyncUrl: () => readFileSync(pathToFileURL(one)),
  readFileSyncBuffer: () => readFileSync(Buffer.from(one)),
  readFileCallback: () => new Promise((ok, no) => fs.readFile(one, "utf8", e => e ? no(e) : ok())),
  fsPromisesReadFile: () => fs.promises.readFile(one),
  fsPromisesModule: () => readFile(one, "utf8"),
  createReadStream: () => new Promise((ok, no) => createReadStream(one).on("data", () => {}).on("end", ok).on("error", no)),
  openSyncReadSync: () => { const fd = openSync(one, "r"); readSync(fd, Buffer.alloc(8)); closeSync(fd); },
  promisesOpen: async () => { const handle = await open(one); await handle.read(Buffer.alloc(8)); await handle.close(); },
  copyFileSync: () => copyFileSync(one, out),
  copyFileCallback: () => new Promise((ok, no) => fs.copyFile(one, out, e => e ? no(e) : ok())),
  promisesCopyFile: () => copyFile(one, out),
  cpSync: () => cpSync(dir, out, {recursive: true}),
  cpCallback: () => new Promise((ok, no) => fs.cp(dir, out, {recursive: true}, e => e ? no(e) : ok())),
  promisesCp: () => cp(dir, out, {recursive: true}),
  linkSync: () => linkSync(one, out),
  symlinkSync: () => symlinkSync(resolve(one), out),
  renameSync: () => renameSync("vault/zmove.txt", out),
};
await roads[api]();
`;
const APIS = ["readFileSyncUrl", "readFileSyncBuffer", "readFileCallback", "fsPromisesReadFile", "fsPromisesModule",
  "createReadStream", "openSyncReadSync", "promisesOpen", "copyFileSync", "copyFileCallback", "promisesCopyFile",
  "cpSync", "cpCallback", "promisesCp", "linkSync", "symlinkSync", "renameSync"];
const bun = (() => { try { execFileSync("bun", ["--version"], {stdio: "ignore"}); return true; } catch { return false; } })();

describe("tools/osd-generator-reads: a generator's reads decide the generation's privacy", function () {
  this.timeout(60000);
  let base, root, tools;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "osd-generator-reads-")));
    root = join(base, "root");
    tools = join(base, "tools");
    mkdirSync(join(root, "vault/dir"), {recursive: true});
    mkdirSync(join(root, "gen"));
    mkdirSync(tools);
    writeFileSync(join(root, "vault/.osd-source.json"), JSON.stringify({private: true}));
    writeFileSync(join(root, "vault/zsentinel.txt"), "SYNTHETIC-PRIVATE-SENTINEL\n");
    writeFileSync(join(root, "vault/zmove.txt"), "SYNTHETIC-PRIVATE-MOVED\n");
    writeFileSync(join(root, "vault/dir/zsentinel2.txt"), "SYNTHETIC-PRIVATE-SENTINEL-2\n");
    symlinkSync(resolve("tools/osd-generator-reads.mjs"), join(tools, "osd-generator-reads.mjs"));
    writeFileSync(join(tools, "zgen.mjs"), GENERATOR);
    // two stand-ins for a hosted binary's `gen` mode: one preloads the
    // recorder first, as bin/osd.mjs does; the other never does
    const host = preload => `${preload ? 'await import("./osd-generator-reads.mjs");\n' : ""}`
      + "const [, , , name, ...args] = process.argv;\nprocess.argv = [process.argv[0], name, ...args];\n"
      + "await import(new URL(name, import.meta.url).href);\n";
    writeFileSync(join(tools, "host-recorded.mjs"), host(true));
    writeFileSync(join(tools, "host-bare.mjs"), host(false));
  });
  afterEach(() => rmSync(base, {recursive: true, force: true}));

  const generate = (api, self) => {
    const log = join(base, `${api}.jsonl`);
    const saved = process.env.OSD_SELF;
    if (self) process.env.OSD_SELF = JSON.stringify(self);
    else delete process.env.OSD_SELF;
    try { runGeneratorsOf(tools, [["zgen.mjs", api]], () => undefined, root, () => {}, undefined, log, []); }
    finally { if (saved === undefined) delete process.env.OSD_SELF; else process.env.OSD_SELF = saved; }
    return readGeneratorLog(log);
  };
  // every read counts as declared, so only attribution decides
  const publish = log => {
    const record = markIncomplete(makeReadRecord(root, new Map(log.entries.map(entry => [entry.real, entry.sha256])), log.entries), log.incomplete);
    const generation = join(root, "build/by-input/0123456789abcdef");
    mkdirSync(generation, {recursive: true});
    writeFileSync(join(generation, READS), JSON.stringify(record));
    return () => inspectReadRecord(root, generation);
  };

  for (const api of APIS) {
    it(`records ${api} of private bytes and refuses the generation`, () => {
      const log = generate(api);
      expect(log.incomplete).to.deep.equal([]);
      expect(log.entries.map(entry => entry.path)).to.include(
        /^cp|Cp$/.test(api) ? "vault/dir/zsentinel2.txt" : api === "renameSync" ? "vault/zmove.txt" : "vault/zsentinel.txt");
      expect(log.entries.every(entry => entry.privacy === true)).to.equal(true);
      // a renamed source is gone from where the hash saw it: unverifiable, also refused
      expect(publish(log)).to.throw().with.property("code", api === "renameSync" ? "UNKNOWN_PRIVACY" : "PRIVATE_LAYER");
    });
  }

  // an fd the recorder never saw opened (inherited stdin) is named through /proc
  for (const [label, code] of [["readSync", "readSync(0, Buffer.alloc(8))"], ["readFileSync", "readFileSync(0)"]]) {
    it(`attributes ${label} on an inherited fd to the private file it names`, function () {
      if (process.platform !== "linux") this.skip();
      const log = join(base, "fd.jsonl");
      const input = openSync(join(root, "vault/zsentinel.txt"), "r");
      try {
        const child = spawnSync(process.execPath, ["--import", join(tools, "osd-generator-reads.mjs"), "--input-type=module", "-e",
          `import {readFileSync, readSync} from "node:fs"; ${code};`],
        {cwd: root, stdio: [input, "pipe", "pipe"], encoding: "utf8",
          env: {...process.env, OSD_ROOT: root, OSD_GENERATOR_READS: log, OSD_GENERATOR_READS_TOKEN: "fd"}});
        expect(child.status, child.stderr).to.equal(0);
      } finally { closeSync(input); }
      const read = readGeneratorLog(log);
      expect(read.entries.map(entry => entry.path)).to.deep.equal(["vault/zsentinel.txt"]);
      expect(publish(read)).to.throw().with.property("code", "PRIVATE_LAYER");
    });
  }

  it("G1: a hosted child that never loads the recorder makes the record incomplete", () => {
    const log = generate("readFileSyncBuffer", [process.execPath, join(tools, "host-bare.mjs")]);
    expect(log.entries).to.deep.equal([]);
    expect(log.incomplete).to.deep.equal(["zgen.mjs: no recorder handshake"]);
    expect(publish(log)).to.throw(/incomplete: zgen.mjs/).with.property("code", "UNKNOWN_PRIVACY");
  });

  it("G1: a hosted child that preloads the recorder, as `osd gen` does, is recorded", () => {
    const log = generate("readFileSyncBuffer", [process.execPath, join(tools, "host-recorded.mjs")]);
    expect(log.incomplete).to.deep.equal([]);
    expect(log.entries.map(entry => entry.path)).to.include("vault/zsentinel.txt");
    expect(publish(log)).to.throw().with.property("code", "PRIVATE_LAYER");
  });

  it("G1: under Bun, where the hooks are invisible to imports, the record is incomplete", function () {
    if (!bun) this.skip();
    const log = generate("readFileSyncBuffer", ["bun", join(tools, "host-recorded.mjs")]);
    expect(log.incomplete).to.include("recorder: node:fs hooks are not visible to imports");
    expect(log.incomplete).to.include("zgen.mjs: no recorder handshake");
    expect(publish(log)).to.throw().with.property("code", "UNKNOWN_PRIVACY");
  });

  it("the seed capture keeps the build's gaps and is itself incomplete when it recorded nothing", () => {
    const entry = generate("readFileSyncBuffer").entries.find(one => one.path === "vault/zsentinel.txt");
    const hashed = new Map([[entry.real, entry.sha256]]);
    const gap = {reads: [], incomplete: true, incompleteReads: ["zgen.mjs: no recorder handshake"]};
    expect(withSeedReads(root, hashed, gap, {entries: [entry], incomplete: []}))
      .to.include({incomplete: true}).and.to.have.deep.property("incompleteReads", ["zgen.mjs: no recorder handshake"]);
    expect(withSeedReads(root, hashed, {reads: [entry]}, {entries: [], incomplete: []})).to.have.property("incomplete", true);
    expect(withSeedReads(root, hashed, {reads: []}, {entries: [entry], incomplete: []})).not.to.have.property("incomplete");
  });
});
