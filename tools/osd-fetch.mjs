// A pack's sources: the folders it fetches rather than carries.
//
// A pack manifest may say
//
//   "sources": [{"folder": "upstream", "repo": "https://github.com/x/y",
//                "ref": "<commit>", "path": "src", "exclude": ["\\.prog\\."]}]
//
// and this copies /src of that repository at that commit into
// <pack>/upstream, minus what exclude names. The pack's own folders layer
// over it (tools/osd-inputs.mjs: later wins), so the files a repository
// needs changed to run here are the pack's overlay and nothing else, and
// the diff against upstream is the overlay's file list.
//
// Pinned to a commit rather than a branch on purpose: a generation is the
// hash of its inputs, and an input that moves under a branch name is a
// generation that changes without anybody changing anything. A branch name
// is accepted for a pack somebody is actively working on; the marker file
// records the commit it resolved to, so what was built is still known.
//
// The fetch is git's, by commit: init, fetch --depth 1 <ref>, checkout.
// GitHub answers a fetch of any reachable commit; a server that does not
// gets a full clone and a checkout instead, which is slower and the same.
import {execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, relative, resolve} from "node:path";
import {packsOf} from "./osd-packs.mjs";
import {runsAs} from "./osd-main.mjs";

// one marker per pack, beside its manifest: which commit each fetched
// folder holds, so a second run at the same ref is a no-op and a build log
// can say what a pack's upstream was
export const MARKER = ".osd-fetched.json";

const slash = (p) => p.split("\\").join("/");

function git(args, cwd) {
  return execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

export function markerOf(packDir) {
  try {
    return JSON.parse(readFileSync(join(packDir, MARKER), "utf8"));
  } catch {
    return {};
  }
}

/** the repository at the ref, in a temporary directory: [dir, commit] */
function checkout(repo, ref) {
  const tmp = mkdtempSync(join(tmpdir(), "osd-fetch-"));
  try {
    git(["init", "-q"], tmp);
    git(["remote", "add", "origin", repo], tmp);
    try {
      git(["fetch", "-q", "--depth", "1", "origin", ref], tmp);
    } catch (shallow) {
      // a server that will not hand out a commit by name: take the history
      // and find it there
      git(["fetch", "-q", "origin"], tmp);
      try {
        git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], tmp);
      } catch {
        try {
          git(["rev-parse", "--verify", "-q", `origin/${ref}^{commit}`], tmp);
        } catch {
          throw new FetchFailed(repo, ref, shallow.stderr?.toString() ?? shallow.message);
        }
      }
    }
    let commit;
    try {
      commit = git(["rev-parse", "FETCH_HEAD"], tmp);
    } catch {
      commit = git(["rev-parse", `origin/${ref}`], tmp);
    }
    git(["checkout", "-q", commit], tmp);
    return {dir: tmp, commit};
  } catch (error) {
    rmSync(tmp, {recursive: true, force: true});
    throw error;
  }
}

/** copy `from` into `to`, minus the excluded paths; returns the files copied */
function copyTree(from, to, exclude) {
  const patterns = exclude.map((e) => new RegExp(e, "i"));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(from, dir)).sort()) {
      if (entry === ".git") {
        continue;
      }
      const rel = dir === "" ? entry : `${dir}/${entry}`;
      if (patterns.some((p) => p.test(rel))) {
        continue;
      }
      const source = join(from, rel);
      if (statSync(source).isDirectory()) {
        walk(rel);
      } else {
        mkdirSync(join(to, dir), {recursive: true});
        cpSync(source, join(to, rel));
        files.push(rel);
      }
    }
  };
  walk("");
  return files;
}

/** fetch one source of one pack; a no-op when the marker already says this ref */
export function fetchSource(pack, source, options = {}) {
  const log = options.log ?? (() => {});
  const marker = markerOf(pack.dir);
  const before = marker[source.folder];
  if (options.force !== true && existsSync(source.dir) && before?.ref === source.ref && before?.path === source.path
      && JSON.stringify(before?.exclude ?? []) === JSON.stringify(source.exclude)) {
    log(`${pack.name}/${source.folder}: already at ${before.commit.slice(0, 12)}`);
    return {pack: pack.name, folder: source.folder, commit: before.commit, files: before.files, fetched: false};
  }
  log(`${pack.name}/${source.folder}: fetching ${source.repo} at ${source.ref}`);
  const {dir, commit} = checkout(source.repo, source.ref);
  try {
    const from = join(dir, source.path);
    if (existsSync(from) === false) {
      throw new FetchFailed(source.repo, source.ref, `no /${source.path} in it`);
    }
    // the folder is replaced whole: what was there is what the last fetch
    // wrote, and a file the repository dropped must not stay behind
    rmSync(source.dir, {recursive: true, force: true});
    mkdirSync(source.dir, {recursive: true});
    const files = copyTree(from, source.dir, source.exclude);
    marker[source.folder] = {
      repo: source.repo, ref: source.ref, commit, path: source.path, exclude: source.exclude,
      files: files.length, at: new Date().toISOString(),
    };
    writeFileSync(join(pack.dir, MARKER), JSON.stringify(marker, null, 2) + "\n");
    log(`${pack.name}/${source.folder}: ${files.length} files from ${commit.slice(0, 12)}`);
    return {pack: pack.name, folder: source.folder, commit, files: files.length, fetched: true};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

/** every source of every pack the root sees */
export function fetchAll(root, options = {}) {
  const out = [];
  for (const pack of packsOf(root, options.env ?? process.env)) {
    for (const source of pack.sources) {
      out.push(fetchSource(pack, source, options));
    }
  }
  return out;
}

/** what is declared and not there, without touching the network */
export function unfetched(root, env = process.env) {
  return packsOf(root, env).flatMap((pack) => pack.missing.map((s) => ({pack: pack.name, folder: s.folder, repo: s.repo, ref: s.ref})));
}

/** one line per missing source, for a build that refuses */
export function describeUnfetched(list) {
  return list.map((m) => `pack ${m.pack} fetches ${m.folder} from ${m.repo} at ${m.ref.slice(0, 12)} and it is not there`).join("; ")
    + " — run: node tools/osd-fetch.mjs";
}

export class FetchFailed extends Error {
  constructor(repo, ref, why) {
    super(`${repo} at ${ref}: ${why}`);
    this.code = "FETCH_FAILED";
  }
}

export async function main(args) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  if (args.includes("--check")) {
    const missing = unfetched(root);
    for (const m of missing) {
      console.log(`${m.pack}/${m.folder}: not fetched (${m.repo} at ${m.ref.slice(0, 12)})`);
    }
    console.log(missing.length === 0 ? "every declared source is there" : `${missing.length} to fetch`);
    return missing.length === 0 ? 0 : 1;
  }
  const only = args.filter((a) => a.startsWith("--") === false);
  let n = 0;
  for (const pack of packsOf(root)) {
    if (only.length > 0 && only.includes(pack.name) === false) {
      continue;
    }
    for (const source of pack.sources) {
      fetchSource(pack, source, {force: args.includes("--force"), log: (line) => console.log(`osd-fetch: ${line}`)});
      n += 1;
    }
  }
  if (n === 0) {
    console.log(`osd-fetch: no pack declares a source${only.length > 0 ? ` (asked for ${only.join(", ")})` : ""}`);
  }
  return 0;
}

if (runsAs("osd-fetch.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`osd-fetch: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  });
}
