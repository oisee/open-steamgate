import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readdirSync} from "node:fs";
import {join, relative, resolve, sep} from "node:path";
import {verifyPublicArtefact} from "./osd-provenance.mjs";

const fail = message => { const error = new Error(message); error.code = "BAD_PROVENANCE"; throw error; };

/** Static extension files must be in a reviewed Git closure or a verified
 * directory artefact. Generated dist/web is checked by its own sidecar. */
export function assertExtensionSources(extension, parts) {
  if (existsSync(join(extension, ".osd-provenance.json"))) {
    verifyPublicArtefact(extension);
    return;
  }
  let top, tracked;
  try {
    top = execFileSync("git", ["-C", extension, "rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
    const prefix = relative(top, extension) || ".";
    if (prefix === ".." || prefix.startsWith(`..${sep}`)) fail("extension leaves Git checkout");
    tracked = new Set(execFileSync("git", ["-C", top, "ls-files", "--cached", "--full-name", "-z", "--", prefix])
      .toString().split("\0").filter(Boolean));
  } catch { fail("extension static files need a verified directory or Git tracked closure"); }
  const visit = path => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) fail(`extension source link is unreviewed: ${path}`);
    if (entry.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (!entry.isFile() || !tracked.has(relative(top, path).split(sep).join("/")))
      fail(`extension source is untracked: ${path}`);
  };
  for (const part of parts) visit(resolve(extension, part));
}
