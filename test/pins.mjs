import {strict as assert} from "node:assert";
import {execFileSync, spawn} from "node:child_process";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync, realpathSync, readFileSync, readlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {materialise} from "../tools/osd-libs.mjs";
import {libraryPath} from "../tools/osd-lock.mjs";
import {generate as generateGui} from "../tools/osd-gui-convert.mjs";

const git = (dir, ...args) => execFileSync("git", args, {cwd: dir, encoding: "utf8"}).trim();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "osd-pins-"));
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "init", "-q");
  writeFileSync(join(source, "file.txt"), "one");
  git(source, "add", ".");
  git(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
  const ref = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "file.txt"), "two");
  git(source, "add", ".");
  git(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "two");
  const bare = join(root, "remote.git");
  git(root, "clone", "-q", "--bare", source, bare);
  const home = join(root, "home");
  mkdirSync(home);
  writeFileSync(join(home, "libs.lock.json"), JSON.stringify({
    transpiler: {repo: "test/transpiler", ref: "0".repeat(40)},
    libraries: [{folder: "example", repo: "test/example", ref}],
  }));
  writeFileSync(join(home, "abap_transpile.json"), JSON.stringify({libs: [{folder: "/.local/lars/example", url: bare}]}));
  return {root, source, bare, home, ref};
}
const run = (home, bare) => materialise(home, () => {}, {remote: {example: bare}});

describe("locked library paths", () => {
  it("materialises a pin, migrates a real clone, refuses drift, and sync repairs it", () => {
    const f = fixture();
    try {
      const path = join(f.home, ".local/lars/example");
      mkdirSync(join(f.home, ".local/lars"), {recursive: true});
      git(f.home, "clone", "-q", f.bare, path);
      assert.throws(() => libraryPath(f.home, "example"), /--sync/);
      run(f.home, f.bare);
      const pin = join(f.home, `.local/pins/example@${f.ref}`);
      assert(lstatSync(path).isSymbolicLink());
      assert.equal(realpathSync(path), realpathSync(pin));
      assert.equal(readFileSync(join(path, "file.txt"), "utf8"), "one");
      assert.equal(readFileSync(join(f.home, ".local/dev/example/file.txt"), "utf8"), "two");
      rmSync(path);
      symlinkSync(join(f.home, ".local/dev/example"), path, "dir");
      assert.throws(() => libraryPath(f.home, "example"), /--sync/);
      run(f.home, f.bare);
      assert.equal(realpathSync(path), realpathSync(pin));
      assert.equal(libraryPath(f.home, "example", {OSD_LIB_EXAMPLE: join(f.home, ".local/dev/example")}), join(f.home, ".local/dev/example"));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("two sessions materialise one pin without a partial checkout", async () => {
    const f = fixture();
    try {
      const code = `import {materialise} from ${JSON.stringify(new URL("../tools/osd-libs.mjs", import.meta.url).href)}; materialise(process.cwd(), () => {}, {remote: {example: process.argv[1]}});`;
      const child = () => new Promise((done) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", code, f.bare], {cwd: f.home, env: {...process.env, CI: "false"}});
        let stderr = "";
        p.stderr.on("data", (data) => { stderr += data; });
        p.on("close", (status) => done({status, stderr}));
      });
      const results = await Promise.all([child(), child()]);
      assert.deepEqual(results.map((r) => r.status), [0, 0], JSON.stringify(results));
      assert.equal(git(join(f.home, ".local/lars/example"), "rev-parse", "HEAD"), f.ref);
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("anchors pins beside a shared lars directory and uses absolute links", () => {
    const f = fixture();
    try {
      const shared = join(f.root, "shared", ".local");
      mkdirSync(join(shared, "lars"), {recursive: true});
      mkdirSync(join(f.home, ".local"), {recursive: true});
      symlinkSync(join(shared, "lars"), join(f.home, ".local/lars"), "dir");
      run(f.home, f.bare);
      const at = join(shared, "lars/example");
      const pin = join(shared, `pins/example@${f.ref}`);
      assert.equal(realpathSync(at), realpathSync(pin));
      assert.equal(readlinkSync(at), pin);
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("does not move a clone used through a shared lars directory", () => {
    const f = fixture();
    try {
      const shared = join(f.root, "shared", ".local");
      mkdirSync(join(shared, "lars"), {recursive: true});
      mkdirSync(join(f.home, ".local"), {recursive: true});
      symlinkSync(join(shared, "lars"), join(f.home, ".local/lars"), "dir");
      const at = join(shared, "lars/example");
      git(f.home, "clone", "-q", f.bare, at);
      assert.throws(() => run(f.home, f.bare), /shared by worktrees/);
      assert.equal(git(at, "rev-parse", "HEAD"), git(f.source, "rev-parse", "HEAD"));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("refuses modified and untracked files at the pinned commit", () => {
    const f = fixture();
    try {
      run(f.home, f.bare);
      const pin = join(f.home, `.local/pins/example@${f.ref}`);
      writeFileSync(join(pin, "file.txt"), "edited");
      assert.throws(() => libraryPath(f.home, "example"), /modified or untracked/);
      writeFileSync(join(pin, "file.txt"), "one");
      writeFileSync(join(pin, "new.txt"), "new");
      assert.throws(() => libraryPath(f.home, "example"), /modified or untracked/);
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("loads the GUI converter from the explicit override", async () => {
    const f = fixture();
    const old = process.env.OSD_LIB_OPEN_ABAP_GUI;
    try {
      const converter = join(f.root, "gui", "converter", "src", "api.mjs");
      mkdirSync(dirname(converter), {recursive: true});
      writeFileSync(converter, "export function convertProgram() { throw new Error('override used'); }\n");
      const lock = JSON.parse(readFileSync(join(f.home, "libs.lock.json"), "utf8"));
      lock.libraries.push({folder: "open-abap-gui", repo: "test/gui", ref: f.ref});
      writeFileSync(join(f.home, "libs.lock.json"), JSON.stringify(lock));
      process.env.OSD_LIB_OPEN_ABAP_GUI = join(f.root, "gui");
      const reports = join(f.root, "reports");
      mkdirSync(reports);
      writeFileSync(join(reports, "sample.prog.abap"), "REPORT z_sample.\n");
      await assert.rejects(generateGui([reports], join(f.root, "generated"), {root: f.home}), /override used/);
    } finally {
      if (old === undefined) delete process.env.OSD_LIB_OPEN_ABAP_GUI;
      else process.env.OSD_LIB_OPEN_ABAP_GUI = old;
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("refuses to overwrite an existing development clone", () => {
    const f = fixture();
    try {
      const path = join(f.home, ".local/lars/example");
      mkdirSync(join(f.home, ".local/lars"), {recursive: true});
      git(f.home, "clone", "-q", f.bare, path);
      mkdirSync(join(f.home, ".local/dev/example"), {recursive: true});
      writeFileSync(join(f.home, ".local/dev/example/keep.txt"), "keep");
      assert.throws(() => run(f.home, f.bare), /destination exists/);
      assert(!lstatSync(path).isSymbolicLink());
      assert.equal(readFileSync(join(f.home, ".local/dev/example/keep.txt"), "utf8"), "keep");
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("CI retains a real clone at the established path", () => {
    const f = fixture();
    try {
      materialise(f.home, () => {}, {ci: true, remote: {example: f.bare}});
      assert(!lstatSync(join(f.home, ".local/lars/example")).isSymbolicLink());
      assert.equal(libraryPath(f.home, "example"), join(f.home, ".local/lars/example"));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });
});
