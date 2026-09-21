// Read-only host-Git facts for one Object Store file. Git is deliberately a
// history layer, not a write path: Save and Activate never commit, checkout,
// reset or push. The caller resolves the object to a file before coming here,
// so an HTTP parameter can never become a pathspec on its own.
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const MAX_OUTPUT = 1024 * 1024;

function git(root, args, accepted = [0]) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (!accepted.includes(result.status)) {
    throw new Error(String(result.stderr || result.stdout || `git exited ${result.status}`).trim());
  }
  return {status: result.status, text: String(result.stdout || "").replace(/\r\n/g, "\n").trimEnd()};
}

function addedFileDiff(file, source) {
  const lines = String(source).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const body = lines.map((line) => "+" + line).join("\n");
  return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

export function gitObjectState(root, file) {
  const unavailable = (reason) => ({available: false, reason, file});
  try {
    if (git(root, ["rev-parse", "--is-inside-work-tree"]).text !== "true") {
      return unavailable("The Object Store is not inside a Git worktree.");
    }
  } catch {
    return unavailable("Git history is unavailable for this Object Store.");
  }

  let head = "";
  try {
    head = git(root, ["rev-parse", "HEAD"]).text;
  } catch {
    // An initialized repository without its first commit is still a useful
    // and honest Git surface: every object is untracked and there is no HEAD.
  }
  let branch = "";
  try {
    branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).text;
  } catch {
    branch = head === "" ? "unborn" : "detached";
  }

  let tracked = false;
  try {
    git(root, ["ls-files", "--error-unmatch", "--", file]);
    tracked = true;
  } catch {
    tracked = false;
  }

  const porcelain = git(root, ["status", "--porcelain=v1", "--untracked-files=all", "--", file]).text;
  const ignored = !tracked && porcelain === ""
    ? git(root, ["check-ignore", "--quiet", "--", file], [0, 1]).status === 0
    : false;

  let diff = "";
  if (head !== "" && tracked) {
    diff = git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", "HEAD", "--", file]).text;
  } else if (!tracked && !ignored) {
    diff = addedFileDiff(file, readFileSync(join(root, file), "utf8"));
  }

  const status = ignored ? "ignored"
    : !tracked ? "untracked"
    : porcelain === "" ? "clean"
    : "modified";
  return {
    available: true,
    branch,
    detached: branch === "detached",
    unborn: head === "",
    head,
    headShort: head === "" ? "unborn" : head.slice(0, 12),
    file,
    tracked,
    status,
    diff,
  };
}
