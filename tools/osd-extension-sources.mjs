import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readdirSync, readFileSync} from "node:fs";
import {join, relative, resolve, sep} from "node:path";
import {verifyPublicArtefact} from "./osd-provenance.mjs";
import {readEntry} from "./osd-read-record.mjs";

const fail = message => { const error = new Error(message); error.code = "BAD_PROVENANCE"; throw error; };

export function assertPublicExtensionIdentity(extension, part) {
  const visit = path => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`extension source link is unreviewed: ${path}`);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
    else if (!stat.isFile() || readEntry(extension, path, readFileSync(path)).privacy !== false)
      fail(`extension source identity is private or unknown: ${path}`);
  };
  visit(resolve(extension, part));
}

/** Static extension files must be in a reviewed Git closure or a verified
 * directory artefact. Generated dist/web is checked by its own sidecar. */
export function assertExtensionSources(extension, parts) {
  const privacy = readEntry(extension, join(extension, "package.json"), readFileSync(join(extension, "package.json"))).privacy;
  if (privacy !== false) fail(`extension source identity is ${privacy === true ? "private" : "unknown"}`);
  if (existsSync(join(extension, ".osd-provenance.json"))) {
    verifyPublicArtefact(extension);
    assertPublicExtensionIdentity(extension, ".");
    return;
  }
  let top, tracked;
  try {
    top = execFileSync("git", ["-C", extension, "rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
    const prefix = relative(top, extension) || ".";
    if (prefix === ".." || prefix.startsWith(`..${sep}`)) fail("extension leaves Git checkout");
    tracked = new Set(execFileSync("git", ["-C", top, "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", prefix])
      .toString().split("\0").filter(Boolean));
    const paths = parts.map(part => relative(top, resolve(extension, part)).split(sep).join("/"));
    execFileSync("git", ["-C", top, "diff", "--quiet", "HEAD", "--", ...paths]);
    for (const flags of [["--others", "--exclude-standard"], ["--others", "--ignored", "--exclude-standard"]]) {
      const extra = execFileSync("git", ["-C", top, "ls-files", ...flags, "-z", "--", ...paths]);
      if (extra.length) fail("extension contains untracked or ignored files");
    }
  } catch { fail("extension static files need a verified directory or Git tracked closure"); }
  const visit = path => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) fail(`extension source link is unreviewed: ${path}`);
    if (entry.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else {
      if (!entry.isFile() || !tracked.has(relative(top, path).split(sep).join("/")))
        fail(`extension source is untracked: ${path}`);
      if (readEntry(extension, path, readFileSync(path)).privacy !== false)
        fail(`extension source identity is private or unknown: ${path}`);
    }
  };
  for (const part of parts) visit(resolve(extension, part));
}
