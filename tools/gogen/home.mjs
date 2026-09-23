// The checkout that holds packs/, .local/lars/ and the .local/ recordings:
// OSG_HOME if set, else the main worktree of this repository (a worktree of
// the spike has neither the fetched packs nor the library clones).
import {execFileSync} from "node:child_process";
import {dirname, resolve} from "node:path";

const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {cwd: import.meta.dirname}).toString().trim();
export const home = process.env.OSG_HOME ?? dirname(resolve(import.meta.dirname, common));
