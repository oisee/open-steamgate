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

/** text with every absolute path cut to what follows the tree's root, or to
 *  its last two segments when it is not under it */
export function withoutHostPaths(text, root = undefined) {
  let out = String(text ?? "");
  if (root !== undefined && root !== "") {
    const prefix = String(root).replace(/\/+$/, "") + "/";
    out = out.split(prefix).join("");
  }
  // POSIX absolute paths (two segments or more) and Windows drive paths
  out = out.replace(/(^|[\s"'(=:])\/(?:[^\s"'()/:]+\/)+([^\s"'()/:]+)/g, (m, lead, last) => `${lead}${last}`);
  out = out.replace(/(^|[\s"'(=])[A-Za-z]:\\(?:[^\s"'()\\]+\\)+([^\s"'()\\]+)/g, (m, lead, last) => `${lead}${last}`);
  return out;
}
