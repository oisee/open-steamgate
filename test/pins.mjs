import {strict as assert} from "node:assert";
import {execFileSync, spawn} from "node:child_process";
import {copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync, realpathSync, readFileSync, readlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname, relative} from "node:path";
import {materialise} from "../tools/osd-libs.mjs";
import {libraryPath} from "../tools/osd-lib-path.mjs";
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
  // a development checkout: the pin gate applies only to one (osd-lib-path)
  git(home, "init", "-q");
  writeFileSync(join(home, "libs.lock.json"), JSON.stringify({
    transpiler: {repo: "test/transpiler", ref: "0".repeat(40)},
    libraries: [{folder: "example", repo: "test/example", ref}],
  }));
  writeFileSync(join(home, "abap_transpile.json"), JSON.stringify({libs: [{folder: "/.local/lars/example", url: bare}]}));
  return {root, source, bare, home, ref};
}
const run = (home, bare) => materialise(home, () => {}, {ci: false, remote: {example: bare}});

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
      assert.throws(() => run(f.home, f.bare), (error) =>
        error.message.includes("node tools/osd-libs.mjs --sync --shared"));
      assert.equal(git(at, "rev-parse", "HEAD"), git(f.source, "rev-parse", "HEAD"));
      assert(!lstatSync(at).isSymbolicLink());
      assert.throws(() => lstatSync(join(shared, `pins/example@${f.ref}`)), {code: "ENOENT"});
      assert.throws(() => lstatSync(join(shared, "dev/example")), {code: "ENOENT"});
      // --shared from the worktree itself (no primary-checkout script needed)
      materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}});
      assert.equal(realpathSync(at), realpathSync(join(shared, `pins/example@${f.ref}`)));
      assert.equal(readlinkSync(at), join(shared, `pins/example@${f.ref}`));
      assert.equal(readFileSync(join(shared, "dev/example/file.txt"), "utf8"), "two");
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("--sync --shared from a worktree CLI migrates, even with CI=true; refuses dirty and existing dev", () => {
    const f = fixture();
    try {
      const shared = join(f.root, "shared", ".local");
      mkdirSync(join(shared, "lars"), {recursive: true});
      mkdirSync(join(f.home, ".local"), {recursive: true});
      symlinkSync(join(shared, "lars"), join(f.home, ".local/lars"), "dir");
      const at = join(shared, "lars/example");
      git(f.home, "clone", "-q", f.bare, at);
      writeFileSync(join(at, "wip.txt"), "wip");
      assert.throws(() => materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}}), /uncommitted/);
      assert(!lstatSync(at).isSymbolicLink());
      rmSync(join(at, "wip.txt"));
      mkdirSync(join(shared, "dev/example"), {recursive: true});
      assert.throws(() => materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}}), /destination exists/);
      rmSync(join(shared, "dev/example"), {recursive: true});
      // the real CLI, from the worktree, with CI=true; the lock's github url is rewritten to the bare repo
      const cli = new URL("../tools/osd-libs.mjs", import.meta.url).pathname;
      const env = {...process.env, CI: "true", GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${f.bare}.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/test/example.git"};
      execFileSync(process.execPath, [cli, "--sync", "--shared"], {cwd: f.home, env, stdio: "pipe"});
      assert.equal(readlinkSync(at), join(shared, `pins/example@${f.ref}`));
      assert.equal(readFileSync(join(shared, "dev/example/file.txt"), "utf8"), "two");
      assert.equal(readFileSync(join(at, "file.txt"), "utf8"), "one");
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  // The real migration of 2026-10-01: pins had been made by hand as `git
  // worktree`s of the lars clones and set to 555. --shared moved the clone to
  // .local/dev, every such pin lost its gitdir, the gate said "is at missing"
  // and the sync stopped halfway.
  const sharedLayout = (f) => {
    const shared = join(f.root, "shared", ".local");
    mkdirSync(join(shared, "lars"), {recursive: true});
    mkdirSync(join(f.home, ".local"), {recursive: true});
    symlinkSync(join(shared, "lars"), join(f.home, ".local/lars"), "dir");
    return {shared, at: join(shared, "lars/example"), pin: join(shared, `pins/example@${f.ref}`), dev: join(shared, "dev/example")};
  };
  const worktreePin = (f, s) => {
    git(f.home, "clone", "-q", f.bare, s.at);
    mkdirSync(dirname(s.pin), {recursive: true});
    git(s.at, "worktree", "add", "-q", "--detach", s.pin, f.ref);
    execFileSync("chmod", ["-R", "a-w", s.pin]);
  };

  it("--shared moves a clone that has a worktree pin, and the pin follows it", () => {
    const f = fixture();
    try {
      const s = sharedLayout(f);
      worktreePin(f, s);
      materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}});
      assert.equal(readlinkSync(s.at), s.pin);
      assert.equal(readFileSync(join(s.dev, "file.txt"), "utf8"), "two");
      assert.equal(libraryPath(f.home, "example"), join(f.home, ".local/lars/example"));
      assert.equal(readFileSync(join(f.home, ".local/lars/example/file.txt"), "utf8"), "one");
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("a re-run after the clone moved without its worktree pin completes", () => {
    const f = fixture();
    try {
      const s = sharedLayout(f);
      worktreePin(f, s);
      // the state the aborted sync left: clone in dev, lars link at the pin, pin detached
      mkdirSync(dirname(s.dev), {recursive: true});
      execFileSync("mv", [s.at, s.dev]);
      symlinkSync(s.pin, s.at, "dir");
      assert.throws(() => libraryPath(f.home, "example"), /worktree of a moved clone/);
      materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}});
      assert.equal(libraryPath(f.home, "example"), join(f.home, ".local/lars/example"));
      materialise(f.home, () => {}, {ci: false, shared: true, remote: {example: f.bare}});
      assert.equal(libraryPath(f.home, "example"), join(f.home, ".local/lars/example"));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("--shared moves a folder that is not a git clone as is, without reading the enclosing repo's status", () => {
    const f = fixture();
    try {
      // inside the checkout, so `git status` there would climb to f.home
      const at = join(f.home, ".local/lars/example");
      mkdirSync(at, {recursive: true});
      symlinkSync(f.source, join(at, "src"), "dir");
      writeFileSync(join(f.home, "dirty.txt"), "an edit of the main checkout");
      const said = [];
      materialise(f.home, (line) => said.push(line), {ci: false, shared: true, remote: {example: f.bare}});
      const dev = join(f.home, ".local/dev/example");
      assert(lstatSync(join(dev, "src")).isSymbolicLink());
      assert(said.some((line) => line.includes("not a git clone") && line.includes(dev)), said.join("\n"));
      assert.equal(libraryPath(f.home, "example"), at);
    } finally { rmSync(f.root, {recursive: true, force: true}); }
  });

  it("a pin can be copied with fs.cpSync (sync leaves no read-only directories)", () => {
    const f = fixture();
    try {
      run(f.home, f.bare);
      const pin = join(f.home, `.local/pins/example@${f.ref}`);
      execFileSync("chmod", ["-R", "a-w", pin]); // as the hand-made pins were
      run(f.home, f.bare);
      const copy = join(f.root, "copy");
      cpSync(join(f.home, ".local/lars/example"), copy, {recursive: true, dereference: true});
      assert.equal(readFileSync(join(copy, "file.txt"), "utf8"), "one");
      writeFileSync(join(copy, "added.txt"), "the copy is writable");
      assert.equal(libraryPath(f.home, "example"), join(f.home, ".local/lars/example"));
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

  // **A shipped tree is not a checkout.** The VSIX seed, the binary's install
  // and the Docker image carry tools/, libs.lock.json and plain copies of the
  // libraries under .local/lars -- no .git anywhere, and no docker/ folder.
  // PR #419 broke all three: tools/osd-lock.mjs imported
  // ../docker/image/license-assumptions.mjs (ERR_MODULE_NOT_FOUND in the
  // seed stage), and libraryPath demanded a git checkout of each library
  // ("open-abap-core is at missing" on every request in the image). This
  // loads the real build module from such a tree and asks it for its inputs.
  it("a shipped tree (no .git, no docker/, copied libraries) loads the build and resolves the libraries", () => {
    const ROOT = process.cwd();
    mkdirSync(join(ROOT, "build"), {recursive: true});
    // under the checkout, so node_modules resolves the way it does in a seed
    const seed = mkdtempSync(join(ROOT, "build", "pins-shipped-"));
    try {
      cpSync(join(ROOT, "tools"), join(seed, "tools"), {recursive: true});
      for (const file of ["abap_transpile.json", "libs.lock.json", "package.json"]) cpSync(join(ROOT, file), join(seed, file));
      const config = JSON.parse(readFileSync(join(ROOT, "abap_transpile.json"), "utf8"));
      for (const lib of config.libs) {
        mkdirSync(join(seed, lib.folder, "src"), {recursive: true});
        writeFileSync(join(seed, lib.folder, "src", "copied.txt"), "a plain copy, no .git");
      }
      assert(!existsSync(join(seed, ".git")) && !existsSync(join(seed, "docker")));
      const code = `
        const {inputsOf} = await import("./tools/osd-build.mjs");
        const {libraryPath, vsixPreflightMissing} = await import("./tools/osd-lib-path.mjs");
        const {readLock} = await import("./tools/osd-lock.mjs");
        for (const lib of readLock(".").libraries) libraryPath(process.cwd(), lib.folder);
        vsixPreflightMissing(process.cwd());
        console.log(JSON.stringify(inputsOf(process.cwd()).libs));`;
      const env = {...process.env};
      for (const key of Object.keys(env)) if (key.startsWith("OSD_LIB_")) delete env[key];
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {cwd: seed, env, encoding: "utf8", stdio: "pipe"});
      const libs = JSON.parse(out.trim().split("\n").pop());
      assert.deepEqual(libs.map((dir) => relative(seed, dir)), config.libs.map((lib) => lib.folder.replace(/^\//, "")), out);
    } finally { rmSync(seed, {recursive: true, force: true}); }
  });

  // tools/osd-packs.mjs -> tools/osd-lock.mjs is in the preview's webpack
  // bundle, which has no child_process ("Can't resolve 'child_process'" broke
  // the gh-pages deploy of #419), and tools/ is copied into shipped trees
  // without docker/. So osd-lock stays free of both; the git gate lives in
  // tools/osd-lib-path.mjs.
  it("tools/osd-lock.mjs imports nothing a browser bundle or a shipped tree lacks", () => {
    const source = readFileSync(new URL("../tools/osd-lock.mjs", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.deepEqual(specifiers.filter((s) => s === "node:child_process" || s.startsWith("../")), [], specifiers.join(", "));
  });
});
