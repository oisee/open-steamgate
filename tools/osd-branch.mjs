// A branch of a whole system, running beside the one you have (backlog W.1).
//
// A git branch of an entire system *including its data* does not exist in the
// ABAP world: there, code is branched by transports and data is not branched
// by anything, because the database is one and shared. Here it is not about
// code at all -- the database is a **file**, the seed is a repository
// artefact, and a generation is addressed by the hash of its inputs. So a
// branch carries state as well as sources, and two branches cannot physically
// disturb each other. That fell out of decisions taken for other reasons.
//
// **The worktree half of this already existed and I nearly wrote it again.**
// `tools/osd-worktree.mjs` makes a checkout and shares `node_modules`,
// `.local/lars` and `.local/tls` by symlink; a second copy of that would have
// shared one of the three and looked right. So this file is only what W.1
// needs ON TOP of a worktree, and it is three things:
//
//   its own PORT        two systems on one port is one system answering twice
//   its own DATABASE    the branch carries state, which is the whole bet
//   a dependency CHECK  a shared node_modules is wrong the moment the ref
//                       wants a package this install does not have
//
// The sieves live beside it: tools/osd-compare.mjs (responses) and
// tools/osd-sql-trace.mjs (statements).
//
//   node tools/osd-branch.mjs add <name> [--from <ref>] [--port N]
//   node tools/osd-branch.mjs list
//   node tools/osd-branch.mjs remove <name>
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {basename, join, resolve} from "node:path";
import {create, remove, list, WORKTREES} from "./osd-worktree.mjs";

/** a name as a directory name: a ref carries slashes and a worktree is a path */
export const safeName = (name) => String(name).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";

/** its own database file, named for the branch */
export const databaseFor = (name, root = process.cwd()) =>
  resolve(root, ".local/db", `branch-${safeName(name)}.sqlite`);

/**
 * A port nobody is on, asked of the operating system rather than guessed.
 *
 * Asynchronous because `listen` is: the first version read `address()` on the
 * next line and destructured null. A port picked from a range would have
 * worked most of the time, which is the worse failure -- two branches on one
 * port do not error, they answer each other's requests.
 */
export function freePort() {
  return new Promise((resolve_, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const {port} = server.address();
      server.close(() => resolve_(port));
    });
  });
}

/** packages the ref wants that the shared install does not have */
export function missingPackages(ref = "HEAD", root = process.cwd()) {
  const shown = execFileSync("git", ["show", `${ref}:package.json`], {cwd: root, encoding: "utf8"});
  const wanted = JSON.parse(shown);
  return Object.keys({...wanted.dependencies, ...wanted.devDependencies})
    .filter((dep) => !existsSync(join(resolve(root, "node_modules"), dep)));
}

/** Has this tree been built? A worktree carries sources and not `output/`,
 *  and it must not share one: two systems running the same modules are one
 *  system answering twice, which is the exact thing W.1 exists to avoid.
 *
 *  Measured rather than assumed, because the failure is quiet: an unbuilt
 *  tree serves, answers the port, and returns **503** to every request. The
 *  first replay against it reported thirteen differences of "200 against
 *  503", which is a true statement about nothing. */
export const isBuilt = (path) => existsSync(join(path, "output", "init.mjs"));

/**
 * Build a planted tree: fetch, then transpile.
 *
 * **Fetching is not an optional first step, it is the third thing git does
 * not carry.** `node_modules` and the library clones are shared by symlink
 * (tools/osd-worktree.mjs); a pack's `upstream/` is neither shared nor
 * tracked, so a fresh worktree has no o4d and no zork sources and the build
 * refuses with UNFETCHED -- correctly, and after that the server still
 * listens and answers 503 to everything.
 *
 * It is fetched rather than symlinked on purpose: a pack pins its upstream
 * by commit in its own manifest, so a ref that moved the pin needs different
 * content, and a shared folder would quietly give it the other branch's.
 * That is the same hazard `missingPackages` reports for dependencies, and it
 * is worth paying a fetch to avoid.
 */
export function build(spec, {fetch = true} = {}) {
  if (fetch) {
    const got = spawnSync("node", ["tools/osd-fetch.mjs"], {cwd: spec.path, encoding: "utf8"});
    if (got.status !== 0) {
      return {ok: false, built: false, stage: "fetch", output: (got.stderr || got.stdout || "").slice(-400)};
    }
  }
  const done = spawnSync("npm", ["run", "transpile"], {cwd: spec.path, encoding: "utf8"});
  return {ok: done.status === 0 && isBuilt(spec.path), built: isBuilt(spec.path), stage: "transpile",
    output: (done.stderr || done.stdout || "").slice(-400)};
}

/** a worktree, plus the two things that make it a system of its own */
export async function plant(name, {root = process.cwd(), from = "HEAD", port, database} = {}) {
  const safe = safeName(name);
  const tree = create(safe, {root, from});
  return {
    name: safe,
    path: tree.path,
    branch: tree.branch,
    created: tree.created,
    port: port ?? await freePort(),
    database: database ?? databaseFor(safe, root),
    missing: missingPackages(from, root),
    built: isBuilt(tree.path),
  };
}

/** the environment that makes a server this branch's own, and nobody else's */
export function environmentFor(spec, {trace} = {}) {
  return {
    ...process.env,
    STG_PORT: String(spec.port),
    STG_DB: "file",
    STG_DB_PATH: spec.database,
    ...(trace === undefined ? {} : {STG_SQL_TRACE: trace}),
  };
}

export function uproot(name, {root = process.cwd()} = {}) {
  const safe = safeName(name);
  try {
    remove(safe, {root});
  } catch {
    // a worktree git will not remove is not a reason to leave the database
  }
  const database = databaseFor(safe, root);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(database + suffix, {force: true});
  return {name: safe, database};
}

export function planted(root = process.cwd()) {
  return list(root).filter((w) => resolve(w.path).includes(resolve(root, WORKTREES)))
    .map((w) => ({...w, name: basename(w.path), database: databaseFor(basename(w.path), root)}));
}

if (basename(process.argv[1] ?? "") === "osd-branch.mjs") {
  const words = process.argv.slice(2).filter((a, i, all) =>
    !a.startsWith("--") && all[i - 1] !== "--from" && all[i - 1] !== "--port");
  const [command, name] = words;
  const flag = (n) => {
    const at = process.argv.indexOf(n);
    return at < 0 ? undefined : process.argv[at + 1];
  };

  if (command === "list" || command === undefined) {
    const rows = planted();
    if (rows.length === 0) console.log("osd-branch: nothing planted");
    for (const row of rows) {
      console.log(`  ${row.name.padEnd(20)} ${(row.branch ?? "detached").padEnd(22)} ` +
        `${existsSync(row.database) ? "has a database" : "no database yet"}`);
    }
    process.exit(0);
  }
  if (name === undefined) {
    console.log("osd-branch: add <name> [--from <ref>] [--port N] | list | remove <name>");
    process.exit(2);
  }
  if (command === "remove") {
    const gone = uproot(name);
    console.log(`osd-branch: ${gone.name} removed, with its database`);
    process.exit(0);
  }
  if (command === "add") {
    const spec = await plant(name, {from: flag("--from") ?? "HEAD", port: flag("--port") && Number(flag("--port"))});
    console.log(`osd-branch: ${spec.name} on ${spec.branch ?? "a detached head"}${spec.created ? "" : " (already there)"}`);
    console.log(`  worktree  ${spec.path}`);
    console.log(`  port      ${spec.port}`);
    console.log(`  database  ${spec.database}`);
    if (!spec.built) {
      console.log("  NOT BUILT this tree has no output/ yet. An unbuilt tree still LISTENS and answers 503");
      console.log("            to everything, so a comparison against it reports differences that are not");
      console.log(`            differences. Build it first:  cd ${spec.path} && node tools/osd-fetch.mjs && npm run transpile`);
    }
    if (spec.missing.length > 0) {
      console.log(`  WARNING   this ref wants ${spec.missing.length} package(s) the shared install does not have:`);
      console.log(`            ${spec.missing.join(", ")}`);
      console.log("            npm install inside the worktree, or every measurement is about another program");
    }
    console.log(`\n  cd ${spec.path} && STG_PORT=${spec.port} STG_DB=file STG_DB_PATH=${spec.database} node test/run.mjs`);
    process.exit(0);
  }
  console.log("osd-branch: add <name> [--from <ref>] [--port N] | list | remove <name>");
  process.exit(2);
}
