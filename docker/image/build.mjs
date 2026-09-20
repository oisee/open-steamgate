import {execFileSync} from "node:child_process";
import {readFileSync, mkdirSync, existsSync, chmodSync} from "node:fs";
import {resolve} from "node:path";

const sources = JSON.parse(readFileSync("docker/image/sources.json", "utf8"));
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, {cwd, stdio: "inherit"});
function checkout(source, folder) {
  if (existsSync(folder)) throw new Error(`Build requires a fresh source folder: ${folder}`);
  mkdirSync(folder, {recursive: true});
  run("git", ["init", "--quiet", folder]);
  run("git", ["-C", folder, "remote", "add", "origin", `https://github.com/${source.repo}.git`]);
  run("git", ["-C", folder, "fetch", "--depth", "1", "origin", source.ref]);
  run("git", ["-C", folder, "checkout", "--detach", "FETCH_HEAD"]);
  const actual = execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  if (actual !== source.ref) throw new Error(`Source revision mismatch: ${source.repo}`);
}
checkout(sources.transpiler, "../transpiler");
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], resolve("../transpiler"));
for (const name of ["runtime", "transpiler", "extras", "cli"]) {
  run("npm", ["install", "--no-audit", "--no-fund"], resolve(`../transpiler/packages/${name}`));
}
for (const name of ["runtime", "transpiler", "extras", "cli"]) {
  run("npm", ["run", "compile"], resolve(`../transpiler/packages/${name}`));
}
chmodSync("../transpiler/packages/cli/abap_transpile", 0o755);
for (const [name, folder] of [["runtime", "runtime"], ["transpiler", "transpiler"], ["transpiler-cli", "cli"]]) {
  run("node", ["tools/osd-link.mjs", name, `packages/${folder}`]);
}
for (const source of sources.libraries) checkout(source, `.local/lars/${source.folder}`);
// No downloaded entertainment packs or captured media in the base image.
run("npm", ["run", "transpile"]);
run("node", ["docker/image/assemble.mjs", "/image"]);
