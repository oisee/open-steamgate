import {readFileSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
const {protocols} = JSON.parse(readFileSync("/sources.json", "utf8"));
for (const {repo, ref, folder} of protocols) {
  const cwd = `/src/${folder}`;
  mkdirSync(cwd, {recursive: true});
  const git = args => execFileSync("git", args, {cwd, stdio: "inherit"});
  git(["init", "--quiet"]);
  git(["remote", "add", "origin", `https://github.com/${repo}.git`]);
  git(["fetch", "--depth", "1", "origin", ref]);
  git(["checkout", "--detach", "FETCH_HEAD"]);
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {cwd, encoding: "utf8"}).trim();
  if (actual !== ref) throw new Error(`Source revision mismatch: ${repo}`);
}
