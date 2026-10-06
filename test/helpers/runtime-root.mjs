import {cpSync, existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {rm} from "node:fs/promises";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// A source host may rebuild even when a test only reads. Give it private
// inputs, generation links and journals; dependencies are shared read-only.
export function copyRuntimeRoot() {
  const root = mkdtempSync(join(tmpdir(), "osd-runtime-root-"));
  try {
    for (const dir of ["src", "gen", "packs", "data", "webapp", "test"]) {
      if (existsSync(join(checkout, dir))) cpSync(join(checkout, dir), join(root, dir), {recursive: true});
    }
    for (const file of ["package.json", "abap_transpile.json", "abaplint.jsonc", "libs.lock.json"]) {
      cpSync(join(checkout, file), join(root, file));
    }
    for (const dir of ["node_modules", "tools", "bin", "editors"]) symlinkSync(join(checkout, dir), join(root, dir), "dir");
    mkdirSync(join(root, ".local"));
    if (existsSync(join(checkout, ".local/lars"))) symlinkSync(join(checkout, ".local/lars"), join(root, ".local/lars"), "dir");
    // Reuse the artifact's bytes, but never its mutable build/live link.
    if (existsSync(join(checkout, "build/live"))) {
      const live = readlinkSync(join(checkout, "build/live"));
      cpSync(resolve(checkout, "build", live), resolve(root, "build", live), {recursive: true, verbatimSymlinks: true});
      symlinkSync(live, join(root, "build/live"), "dir");
      symlinkSync("build/live/output", join(root, "output"), "dir");
    }
    return root;
  } catch (error) {
    rmSync(root, {recursive: true, force: true});
    throw error;
  }
}

// Register cleanup while the file is being loaded; allocate only if used.
export function runtimeRootFixture() {
  let root;
  after(async function () {
    // A cold activation can leave several complete generations (tens of
    // thousands of files). Their removal is housekeeping, with its own
    // budget, before the unchanged process/resource invariant is checked.
    this.timeout(30000);
    if (root) await rm(root, {recursive: true, force: true});
  });
  return {get root() { return root ??= copyRuntimeRoot(); }};
}
