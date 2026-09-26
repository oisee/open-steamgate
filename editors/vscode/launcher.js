// B0 "Pocket SAP" (docs/vscode-extension.md, "B0 spike"): the extension
// starts and stops the system itself, so a user opens a folder and clicks
// Start, with no terminal. This module is the pure half -- plain Node, no
// `vscode` import, unit-testable on its own (test/vscode-launcher.mjs) --
// the way lib.js is the pure half of the rest of the extension.
//
// What it spawns is exactly what `npm start` spawns: `tools/osd-build.mjs`
// (what `npm run transpile` runs), then `node test/run.mjs`, with
// `process.execPath` rather than a `node` on some PATH, because VS Code's
// extension host already IS a Node and does not need to find another one.
//
// Every byte this writes lives under the caller's `storageDir`, never under
// `osdHome` and never under a workspace folder: the database
// (`STG_DB_PATH`), the TLS directory (`OSD_TLS_DIR`, new below) and the
// generated pack manifests that add a workspace's ABAP as a layer (see
// `ensureWorkspacePacks`). Nothing here ever writes into a tracked file of
// the system it starts.
"use strict";

const {spawn} = require("node:child_process");
const {createServer} = require("node:net");
const {EventEmitter} = require("node:events");
const {createHash} = require("node:crypto");
const {request} = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Ports 3531-3539 only (the budget this spike was given); nothing here ever
// asks for a port outside it, and a caller that wants a different range
// still has to say so explicitly.
const PORT_RANGE = {from: 3531, to: 3539};

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---- ports ---------------------------------------------------------------

/** Whether a TCP port on 127.0.0.1 is free right now. Best-effort: a port
 *  free at the check can still be taken between the check and the spawn --
 *  the caller (start(), below) treats "the server never answered" as the
 *  failure that covers that race, rather than pretending this can rule it
 *  out. */
function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/** The first free port in `range` (default 3531-3539), or throws when none
 *  of them is. */
async function pickPort(range = PORT_RANGE) {
  for (let port = range.from; port <= range.to; port++) {
    if (await isFree(port)) {
      return port;
    }
  }
  throw new Error(`no free port in ${range.from}-${range.to}`);
}

// ---- workspace layers -----------------------------------------------------

/** Whether `dir` looks like an abapGit folder: a `.abapgit.xml` at its root,
 *  or a `*.clas.abap` / `*.prog.abap` under `src/` (the shapes the task
 *  names -- not every abapGit layout, just the two cheap-to-check signs of
 *  one). */
function looksLikeAbapGitFolder(dir) {
  if (isFile(path.join(dir, ".abapgit.xml"))) {
    return true;
  }
  const src = path.join(dir, "src");
  if (isDir(src) === false) {
    return false;
  }
  let entries;
  try {
    entries = fs.readdirSync(src);
  } catch {
    return false;
  }
  return entries.some((name) => /\.(clas|prog)\.abap$/i.test(name));
}

/** `{folder, srcDir}` for every workspace folder that looks like an abapGit
 *  repository, `srcDir` being the folder actually handed to the transpiler
 *  as an input (its own `src/` when there is one, else the folder itself --
 *  a repository whose ABAP sits at its own root rather than under `src/`).
 *  Pure: `folders` is a plain array of absolute paths, no `vscode.Uri`. */
function detectWorkspaceLayers(folders) {
  const out = [];
  for (const folder of folders ?? []) {
    if (typeof folder !== "string" || isDir(folder) === false) {
      continue;
    }
    if (looksLikeAbapGitFolder(folder) === false) {
      continue;
    }
    const src = path.join(folder, "src");
    out.push({folder, srcDir: isDir(src) ? src : folder});
  }
  return out;
}

/** A short, stable, filesystem-safe name for a workspace layer's pack
 *  directory: the folder's own base name plus a hash of its full path, so
 *  two folders named `src` in different places never collide and a rerun
 *  names the same folder the same thing. */
function packNameOf(folder) {
  const base = path.basename(folder).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ws";
  const hash = createHash("sha1").update(folder).digest("hex").slice(0, 10);
  return `ws-${base}-${hash}`;
}

/** Adds the detected workspace layers as the TOP layers of the system, the
 *  way `docs/CLAUDE.md`'s "a pack is a directory" already lets any folder
 *  do it: `OSD_PACKS` names a container directory, and this writes one
 *  small pack per layer into it -- an `osd-pack.json` (order 900+, so a
 *  workspace layer always sorts after the tree's own packs) plus a `src`
 *  symlink at the workspace folder's own ABAP folder. No copy, no new
 *  mechanism: `tools/osd-packs.mjs` reads this exactly like any other pack,
 *  which is why nothing in the transpiler or the store had to change.
 *
 *  Nothing is written under `osdHome` or under a workspace folder -- the
 *  container lives entirely under `storageDir` (the extension's own
 *  storage) and is rebuilt from scratch on every call, so a workspace
 *  folder that closed does not leave a stale layer behind.
 *
 *  Returns the container directory to set `OSD_PACKS` to, or `undefined`
 *  when there are no layers (so a caller does not set `OSD_PACKS` to an
 *  empty directory for nothing). */
function ensureWorkspacePacks(storageDir, layers) {
  const packsRoot = path.join(storageDir, "packs");
  fs.rmSync(packsRoot, {recursive: true, force: true});
  if (layers.length === 0) {
    return undefined;
  }
  fs.mkdirSync(packsRoot, {recursive: true});
  layers.forEach((layer, i) => {
    const name = packNameOf(layer.folder);
    const dir = path.join(packsRoot, name);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, "osd-pack.json"), JSON.stringify({
      name,
      order: 900 + i,
      description: `workspace layer: ${layer.folder}`,
    }, undefined, 2));
    fs.symlinkSync(layer.srcDir, path.join(dir, "src"), "dir");
  });
  return packsRoot;
}

// ---- the two processes `npm start` is (tools/osd-build.mjs, test/run.mjs) -

/** Runs one Node script to completion, streaming its stdout/stderr lines to
 *  `onLine` as they arrive (so a caller can show a build's own log, not just
 *  its exit code) and resolving with `{code, output}` when it exits. Used
 *  for the build step, which is a run-to-completion command, not a server. */
function runToCompletion(cwd, script, args, env, onLine) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(process.execPath, [script, ...args], {cwd, env});
    } catch (error) {
      reject(error);
      return;
    }
    let output = "";
    const onData = (data) => {
      const text = data.toString();
      output += text;
      onLine?.(text);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => resolve({code, output}));
  });
}

/** One `GET /osd/serving` (tools/osd-serve.mjs, forwarded by test/start.mjs
 *  the way every other `/osd/*` door is), or `undefined` when nothing
 *  answers yet -- refused, reset, or the connection simply is not there.
 *  Never throws: "not up yet" is the expected answer for most of a build. */
function servingOnce(port) {
  return new Promise((resolve) => {
    const req = request({hostname: "127.0.0.1", port, path: "/osd/serving", method: "GET", timeout: 2000}, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });
}

/** Polls `/osd/serving` until it answers `ready: true` with a generation, or
 *  the timeout passes. This is the "waits for 'serving generation'" step of
 *  the task, done by asking the server rather than by grepping its log --
 *  robust to a log line's wording changing, which the text would not be. */
async function waitForServing(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000;
  const intervalMs = options.intervalMs ?? 300;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const serving = await servingOnce(port);
    if (serving?.ready === true && serving.generation !== undefined) {
      return serving;
    }
    if (Date.now() >= deadline) {
      throw new Error(`osd never answered ready on :${port} within ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Sends `signal` to `child` and waits for it to actually exit, escalating
 *  to SIGKILL after `graceMs` -- the same shape `test/osd-child.mjs` already
 *  uses by hand for the same reason: a process that has not exited is a
 *  process that still holds the port and the database file. */
function terminate(child, {signal = "SIGTERM", graceMs = 15000} = {}) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done === false) {
        done = true;
        resolve();
      }
    };
    child.once("exit", finish);
    try {
      child.kill(signal);
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (done === false) {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    }, graceMs);
  });
}

// ---- materializing a bundled seed (packaging, docs/vscode-extension.md
// "Packaging"): a packaged .vsix carries a runnable system tree at
// `extension/osd/` (scripts/build-vsix.mjs). The install folder is
// read-only in spirit -- an update wipes it -- so this copies it once into
// the extension's own writable storage and everything the system writes
// (the database, gen/, a rebuilt output/) lands there, never in the
// extension folder and never in a workspace folder. ---------------------

/** Recursively hard-links `src` into `dest`, falling back to a plain copy
 *  when the two are not on the same filesystem (EXDEV) -- a hard link costs
 *  nothing for a tree this size and is safe here because nothing under the
 *  materialized copy is ever edited in place; a rebuild always writes a
 *  NEW file (`build/by-input/<hash>/...`, a fresh `gen/`) rather than
 *  mutating one the seed still shares an inode with. A symlink in the seed
 *  is kept as a symlink, not followed -- `scripts/build-vsix.mjs` dereferences
 *  every symlink it packages (`copyReal`), so a real `.vsix` seed carries
 *  none today, but this stays general rather than assuming that forever
 *  (test/vscode-launcher.mjs's own fixture is a symlink for exactly this
 *  reason). */
function linkOrCopyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dest, {recursive: true});
    for (const name of fs.readdirSync(src)) {
      linkOrCopyTree(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  try {
    fs.linkSync(src, dest);
  } catch (error) {
    if (error?.code === "EEXIST") return;
    fs.copyFileSync(src, dest);
  }
}

const MATERIALIZED_MARKER = ".osd-materialized";

/** Where a packaged seed for `version` lands under the extension's own
 *  `globalStorageDir` -- one directory per version, so an update (which
 *  wipes the install folder, `extension/osd/` included) gets a fresh copy
 *  rather than silently keeps serving the old one. */
function materializedHomeDir(globalStorageDir, version) {
  return path.join(globalStorageDir, `osd-home-${version}`);
}

/** Materializes `seedDir` (a packaged extension's own `extension/osd/`)
 *  into `<globalStorageDir>/osd-home-<version>/`, once: a marker file says
 *  a copy already happened, so a second start of the same version does
 *  nothing here. Every OTHER `osd-home-*` directory is removed first, so a
 *  previous version's copy does not sit there forever. Returns the
 *  materialized directory, which is what a caller uses as `osdHome` from
 *  here on -- `osdHome` itself is never written to again. */
function ensureMaterializedHome(seedDir, globalStorageDir, version) {
  const target = materializedHomeDir(globalStorageDir, version);
  if (isFile(path.join(target, MATERIALIZED_MARKER))) {
    return target;
  }
  fs.mkdirSync(globalStorageDir, {recursive: true});
  for (const name of fs.readdirSync(globalStorageDir)) {
    if (name.startsWith("osd-home-") && name !== `osd-home-${version}`) {
      fs.rmSync(path.join(globalStorageDir, name), {recursive: true, force: true});
    }
  }
  fs.rmSync(target, {recursive: true, force: true});
  linkOrCopyTree(seedDir, target);
  fs.writeFileSync(path.join(target, MATERIALIZED_MARKER), new Date().toISOString());
  return target;
}

// ---- the launcher itself --------------------------------------------------

/** One instance of the system, started and stopped by this object rather
 *  than by a terminal. States: "stopped" -> "building" -> "starting" ->
 *  "running", and back to "stopped" on stop() or on the child's own exit
 *  (a crash is not a state this pretends is still "running"). Emits "log"
 *  (a line of the build's or the server's own output), "state" (the new
 *  state) and "exit" ({code, signal}, only when the server process itself
 *  went away without stop() having been called). */
class Launcher extends EventEmitter {
  constructor(options = {}) {
    super();
    if (typeof options.osdHome !== "string" || options.osdHome === "") {
      throw new Error("osdHome is required");
    }
    if (typeof options.storageDir !== "string" || options.storageDir === "") {
      throw new Error("storageDir is required");
    }
    this.osdHome = options.osdHome;
    this.storageDir = options.storageDir;
    this.workspaceFolders = options.workspaceFolders ?? [];
    this.portRange = options.portRange ?? PORT_RANGE;
    this.timeoutMs = options.timeoutMs ?? 180000;
    this.state = "stopped";
    this.child = undefined;
    this.port = undefined;
    this.pid = undefined;
    this.generation = undefined;
    this.layers = [];
  }

  #setState(state) {
    this.state = state;
    this.emit("state", state);
  }

  #log(line) {
    this.emit("log", line);
  }

  /** Builds (tools/osd-build.mjs), spawns `node test/run.mjs`, waits for it
   *  to serve, and returns `{port, pid, generation}`. Throws, and leaves the
   *  state back at "stopped", if the build fails or the server never comes
   *  up -- there is no half-started state a caller has to notice on their
   *  own. */
  async start() {
    if (this.state !== "stopped") {
      throw new Error(`cannot start: already ${this.state}`);
    }
    fs.mkdirSync(this.storageDir, {recursive: true});
    this.#setState("building");
    this.layers = detectWorkspaceLayers(this.workspaceFolders);
    const packsDir = ensureWorkspacePacks(this.storageDir, this.layers);
    for (const layer of this.layers) {
      this.#log(`workspace layer: ${layer.folder} (${path.relative(layer.folder, layer.srcDir) === "" ? "." : "src"})\n`);
    }

    const dbDir = path.join(this.storageDir, "db");
    const tlsDir = path.join(this.storageDir, "tls");
    fs.mkdirSync(dbDir, {recursive: true});
    fs.mkdirSync(tlsDir, {recursive: true});

    const port = await pickPort(this.portRange);
    const env = {
      ...process.env,
      STG_PORT: String(port),
      STG_DB: "file",
      STG_DB_PATH: path.join(dbDir, "osd.sqlite"),
      // No cert ever lands in `storageDir`'s TLS folder (it starts empty and
      // this launcher never runs `osd:tls`), so pointing OSD_TLS_DIR at it
      // is what makes plain HTTP the default: there is nothing to find, and
      // the extra HTTPS listener (test/start.mjs) never opens. Without this
      // an osdHome that already has a shared `.local/tls` (the worktree
      // symlinks one in, docs/CLAUDE.md's own worktree note) would open one
      // more port outside 3531-3539 on every launch.
      OSD_TLS_DIR: tlsDir,
      STG_SERVE: "child",
    };
    if (packsDir !== undefined) {
      env.OSD_PACKS = packsDir;
    }
    this.env = env;

    const build = await runToCompletion(this.osdHome, "tools/osd-build.mjs", [], env, (line) => this.#log(line));
    if (build.code !== 0) {
      this.#setState("stopped");
      throw new Error(`build failed (exit ${build.code}): ${build.output.slice(-2000)}`);
    }

    this.#setState("starting");
    let child;
    try {
      child = spawn(process.execPath, ["test/run.mjs"], {cwd: this.osdHome, env});
    } catch (error) {
      this.#setState("stopped");
      throw error;
    }
    this.child = child;
    this.pid = child.pid;
    child.stdout?.on("data", (d) => this.#log(d.toString()));
    child.stderr?.on("data", (d) => this.#log(d.toString()));
    child.on("exit", (code, signal) => {
      const wasRunning = this.state !== "stopped";
      this.child = undefined;
      this.port = undefined;
      this.pid = undefined;
      this.generation = undefined;
      this.#setState("stopped");
      if (wasRunning) {
        this.emit("exit", {code, signal});
      }
    });

    let serving;
    try {
      serving = await waitForServing(port, {timeoutMs: this.timeoutMs});
    } catch (error) {
      await terminate(child);
      if (this.state !== "stopped") {
        this.#setState("stopped");
      }
      throw error;
    }
    this.port = port;
    this.generation = serving.generation;
    this.#setState("running");
    return {port: this.port, pid: this.pid, generation: this.generation};
  }

  /** Stops both processes: the child this module spawned (`node
   *  test/run.mjs`) and, through it, the grandchild it supervises
   *  (`tools/osd-serve.mjs`) -- SIGTERM to the one pid this launcher holds
   *  reaches both, because `tools/osd-runtime.mjs` installs its own
   *  SIGTERM/SIGINT/SIGHUP handler that quiesces and reaps its children
   *  before this process exits. Never sends a signal to a pid this launcher
   *  did not itself spawn. */
  async stop() {
    if (this.child === undefined) {
      this.#setState("stopped");
      return;
    }
    await terminate(this.child);
    // the "exit" handler above already reset the fields and the state
  }

  async rebuild() {
    await this.stop();
    return this.start();
  }
}

module.exports = {
  PORT_RANGE,
  isFree,
  pickPort,
  looksLikeAbapGitFolder,
  detectWorkspaceLayers,
  packNameOf,
  ensureWorkspacePacks,
  waitForServing,
  servingOnce,
  terminate,
  Launcher,
  linkOrCopyTree,
  materializedHomeDir,
  ensureMaterializedHome,
  MATERIALIZED_MARKER,
};
