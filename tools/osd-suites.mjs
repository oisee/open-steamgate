// Run the integration suites listed in test/suites.json.
//
// The list lives in a file with one entry per line rather than on one line of
// package.json, because two people adding a suite conflicted on that line
// twice in one hour and will again -- there are more suites coming.
//
// It is a script rather than an inline `node -e` for a reason worth stating:
// the exit code has to be the runner's. A one-liner that spawns mocha and
// forgets to pass its status back reports success for a failing suite, which
// is the false green this project keeps paying for.
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../test/suites.json", import.meta.url)), "utf8"));
const files = listed.files ?? [];
if (files.length === 0) {
  console.error("test/suites.json lists no suites -- that is not a pass, it is an empty run");
  process.exit(2);
}

const extra = process.argv.slice(2);
const result = spawnSync("npx", ["mocha", ...files, ...extra], {stdio: "inherit"});
process.exit(result.status === null ? 1 : result.status);
