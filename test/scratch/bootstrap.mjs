// Full fresh-clone proof, kept separate from npm test because it downloads
// every dependency, library and pack. Run after committing the changes under
// test; a local clone can only see HEAD, not uncommitted tracked files.
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const check = spawnSync("git", ["diff", "--quiet", "HEAD", "--"], {cwd: root});
if (check.error || check.status !== 0) {
  throw new Error("Commit tracked changes before running the fresh-clone proof");
}

const scratch = mkdtempSync(join(tmpdir(), "osd-bootstrap-scratch-"));
const clone = join(scratch, "checkout");

function run(command, args, cwd) {
  console.log(`fresh-clone: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {cwd, stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status})`);
}

try {
  if (relative(root, scratch).startsWith("..") === false) {
    throw new Error(`Scratch directory must be outside the checkout: ${scratch}`);
  }
  run("git", ["clone", "--quiet", "--local", "--no-hardlinks", root, clone], scratch);
  for (const path of ["node_modules", "gen", ".local/lars"]) {
    if (existsSync(join(clone, path))) throw new Error(`Fresh clone already has ${path}`);
  }
  run("npm", ["install"], clone);
  run("npm", ["run", "bootstrap"], clone);
  if (!existsSync(join(clone, "gen"))) throw new Error("bootstrap did not create gen/");
  run("npm", ["run", "vsix"], clone);
  const artifacts = readdirSync(join(clone, "build", "vsix"))
    .filter((name) => name.endsWith(".vsix") && statSync(join(clone, "build", "vsix", name)).size > 0);
  if (artifacts.length !== 1) throw new Error(`Expected one nonempty .vsix; found ${artifacts.length}`);
  console.log(`fresh-clone: PASS (${artifacts[0]})`);
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
