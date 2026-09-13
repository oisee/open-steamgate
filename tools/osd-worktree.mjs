// A tree for OSD to write into that is not the one a person is working in.
//
// The ADT façade writes objects as files: a PUT lands in src/ and a new
// object lands in src/osd/, both of them tracked. That is the right design —
// ADR 0001 keeps git as the only version layer precisely so there is no
// bespoke register — but it means an IDE, or an agent holding an IDE, edits
// the working tree of whoever started the server. Point 5 of that ADR says
// OSD should run from a dedicated worktree instead. This makes one.
//
// There is no new isolation mechanism here, and that is the point. A git
// worktree is a second checkout of the same repository on its own branch,
// so an edit from VS Code dirties a branch that can be inspected, committed
// or thrown away with `git checkout .`, and the operator's own checkout
// never moves. Everything OSD needs beyond the tracked files is shared by
// symlink rather than copied, because a second node_modules and a second
// clone of open-abap-core would cost gigabytes to isolate nothing.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, symlinkSync, lstatSync} from "node:fs";
import {join, relative, resolve} from "node:path";

export const WORKTREES = ".local/worktrees";

// what a worktree needs that git does not carry: the dependencies, the
// library clones the transpiler reads, and the certificate a TLS client was
// told to trust. Shared, not duplicated.
const SHARED = ["node_modules", ".local/lars", ".local/tls"];

function git(root, args) {
  return execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

export function list(root = process.cwd()) {
  const out = [];
  let current;
  for (const line of git(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {path: line.slice(9)};
      out.push(current);
    } else if (line.startsWith("branch ") && current !== undefined) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    }
  }
  return out;
}

// symlink rather than copy, and never overwrite something already there
function share(root, path) {
  for (const entry of SHARED) {
    const source = join(root, entry);
    if (existsSync(source) === false) {
      continue;
    }
    const target = join(path, entry);
    try {
      if (lstatSync(target) !== undefined) {
        continue;
      }
    } catch {
      // not there, which is the case we are here for
    }
    mkdirSync(join(target, ".."), {recursive: true});
    symlinkSync(relative(join(target, ".."), source), target, "dir");
  }
}

// A worktree on its own branch, ready to serve. Existing ones are returned
// rather than rebuilt, so this is safe to run twice.
export function create(name, options = {}) {
  const root = options.root ?? process.cwd();
  const path = resolve(root, options.path ?? join(WORKTREES, name));
  const branch = options.branch ?? `osd/${name}`;

  const already = list(root).find((w) => resolve(w.path) === path);
  if (already !== undefined) {
    share(root, path);
    return {...already, path, created: false};
  }

  const from = options.from ?? "HEAD";
  const exists = git(root, ["branch", "--list", branch]) !== "";
  git(root, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, from]);
  share(root, path);
  return {path, branch, created: true};
}

export function remove(name, options = {}) {
  const root = options.root ?? process.cwd();
  const path = resolve(root, options.path ?? join(WORKTREES, name));
  git(root, ["worktree", "remove", "--force", path]);
  return {path, removed: true};
}

function usage() {
  console.log(`usage: osd-worktree.mjs <name> [--from <ref>] [--branch <name>] [--port <n>]
       osd-worktree.mjs --list
       osd-worktree.mjs --remove <name>

A checkout for OSD to write into, so an IDE does not edit yours (ADR 0001, point 5).`);
}

function main(argv) {
  const root = process.cwd();
  if (argv.includes("--list")) {
    for (const worktree of list(root)) {
      console.log(`${worktree.branch ?? "(detached)"}\t${worktree.path}`);
    }
    return 0;
  }
  const at = argv.indexOf("--remove");
  if (at >= 0) {
    const name = argv[at + 1];
    if (name === undefined) {
      usage();
      return 2;
    }
    console.log(`removed ${remove(name, {root}).path}`);
    return 0;
  }
  const name = argv.find((a) => a.startsWith("--") === false);
  if (name === undefined) {
    usage();
    return 2;
  }
  const option = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const made = create(name, {root, from: option("--from"), branch: option("--branch")});
  const port = option("--port") ?? "8099";
  console.log(`${made.created ? "created" : "already there"}: ${made.path}  (branch ${made.branch})`);
  console.log("");
  console.log("serve OSD from it, and your own checkout stays clean:");
  console.log(`  cd ${made.path} && npm run transpile && STG_SERVE=child STG_PORT=${port} node test/run.mjs`);
  console.log("");
  console.log("what an IDE wrote is then a diff on that branch:");
  console.log(`  git -C ${made.path} status`);
  return 0;
}

if (process.argv[1]?.endsWith("osd-worktree.mjs")) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(String(error?.stderr ?? error?.message ?? error).trim());
    process.exit(1);
  }
}
