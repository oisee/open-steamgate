// Which transpiler built this.
//
// We sometimes run a locally built transpiler rather than the published one,
// because a fix we need is not released yet. That is a reasonable thing to
// do and a terrible thing to forget: a tree that quietly differs from a
// clean clone is how "it works here and not in CI" happens, and we have paid
// for that once already.
//
// So every transpile says which one it used, and it says it in the build log
// rather than in somebody's memory. A green run here and a red run in CI is
// then one line apart from being explained.
import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readFileSync, realpathSync} from "node:fs";
import {dirname, join} from "node:path";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);

export function transpilerInUse(root = process.cwd()) {
  const at = join(root, "node_modules", "@abaplint", "transpiler-cli");
  if (existsSync(at) === false) {
    return {kind: "missing", where: at};
  }

  const linked = lstatSync(at).isSymbolicLink();
  const real = realpathSync(at);
  const version = JSON.parse(readFileSync(join(real, "package.json"), "utf8")).version;

  if (linked === false) {
    return {kind: "published", version, where: real};
  }

  // a linked build is a working tree, so the interesting part is which
  // commit of it, not which version it calls itself
  let branch;
  let commit;
  let dirty;
  try {
    const git = (...args) => execFileSync("git", args, {cwd: real, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    branch = git("rev-parse", "--abbrev-ref", "HEAD");
    commit = git("rev-parse", "--short", "HEAD");
    // only tracked changes count: an untracked note beside the checkout
    // does not change what the build does, and saying it does would train
    // everyone to ignore the warning
    dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
  } catch {
    // not a git tree, or git is not there: the path is still the answer
  }
  return {kind: "linked", version, where: real, branch, commit, dirty};
}

export function describeTranspiler(root = process.cwd()) {
  const found = transpilerInUse(root);
  switch (found.kind) {
    case "missing":
      return `transpiler: none installed at ${found.where}`;
    case "published":
      return `transpiler: @abaplint/transpiler-cli ${found.version}, published`;
    default:
      return `transpiler: a LOCAL BUILD, ${found.where}`
        + (found.branch ? ` (${found.branch} ${found.commit}${found.dirty ? ", uncommitted changes" : ""})` : "")
        + `, calling itself ${found.version}. A clean clone will not build this way.`;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  console.log(describeTranspiler());
  process.exit(0);
}
