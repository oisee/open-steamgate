// What a failed build tells a client, and what it must not.
//
// A cold build that the transpiler refuses throws one line per issue,
// "<rule>, <message>, <file>:<row>" (@abaplint/transpiler, Transpiler#validate),
// and the file is the abapGit file name the registry holds, never a path.
// Those lines are what an activation answers with: one message per object
// and line, the way a system's activation log reads. What the build printed
// around them -- the generators, the lock, the folders -- carries absolute
// paths of the machine that built it and stays in the host's console
// (vsp-i7's abapGit spike, 2026-10-02: the first 2 KB of that log was the
// whole answer, and it named the cause nowhere).
import {homedir, tmpdir} from "node:os";
import {objectOf} from "./osd-inputs.mjs";

const LINE = /^(\S+), (.*), ([^\s,:/\\]+\.[a-z0-9]+):(\d+)$/i;

/** the transpiler's refusal as [{type, name, issues: [{severity, rule, message, file, line, column}]}],
 *  grouped by object in the order the lines came; [] when the text is not one */
export function transpileIssues(text) {
  const byObject = new Map();
  for (const raw of String(text ?? "").split("\n")) {
    const match = LINE.exec(raw.trim());
    if (match === null) continue;
    const [, rule, message, file, row] = match;
    const key = objectOf(file);
    if (key === undefined) continue;
    const [type, ...rest] = key.split(" ");
    const name = rest.join(" ");
    if (!byObject.has(key)) byObject.set(key, {type, name, issues: []});
    byObject.get(key).issues.push({severity: "E", rule, message, file, line: Number(row), column: 1});
  }
  return [...byObject.values()];
}

/** text with no absolute path of a machine in it. Known roots first, as
 *  literals (so a space in them is no boundary): the tree's root and the
 *  working directory become relative, the home folder `~`, the temp folder
 *  `<tmp>`, the folders node_modules lives in `node_modules`. Any absolute
 *  path left is not guessed at: everything from its start to the last
 *  separator on that line becomes `<path>`, so a folder name with a space in
 *  it is cut with the rest and only the file's own name stays. Over-cutting
 *  a sentence that names two paths is the side to err on. */
export function withoutHostPaths(text, root = undefined) {
  let out = String(text ?? "");
  const known = [
    [root, ""], [process.cwd(), ""], [homedir(), "~/"], [tmpdir(), "<tmp>/"],
  ].filter(([p]) => typeof p === "string" && p.length > 1)
    .map(([p, as]) => [p.replace(/[\\/]+$/, ""), as])
    .sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, as] of known) {
    for (const spelled of new Set([prefix, prefix.split("\\").join("/"), prefix.split("/").join("\\")])) {
      out = out.split(spelled + "/").join(as).split(spelled + "\\").join(as.replace("/", "\\"));
      out = out.split(spelled).join(as === "" ? "." : as.slice(0, -1));
    }
  }
  // wherever node_modules is, what is inside it is the package's own path
  out = out.replace(/(^|[\s"'(=,;[]|file:\/\/)(?:[A-Za-z]:)?[\\/][^\n"'<>]*?[\\/]node_modules[\\/]/g, (m, lead) => `${lead}node_modules/`);
  // anything absolute that is left, up to its last separator on the line
  out = out.replace(/(^|[\s"'(=:,;[])(?:[A-Za-z]:[\\/]|[\\/])[^\n"'<>]*[\\/]/g, (m, lead) => `${lead}<path>/`);
  // and a path of one segment (`/secret`) is a path too
  out = out.replace(/(^|[\s"'(=:,;[])(?:[A-Za-z]:)?[\\/](?=[^\s\\/])/g, (m, lead) => `${lead}<path>/`);
  return out;
}
