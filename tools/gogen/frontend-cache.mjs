// Whole-unit frontend snapshot. Hash every file the registry can see, plus
// generators, seed inputs, configuration and the Go runtime copied to a run.
// The conservative whole-folder key also covers newly added closure members.
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";

const version = 1;
const walk = (dir) => !existsSync(dir) ? [] : readdirSync(dir, {withFileTypes: true})
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((entry) => entry.isDirectory() ? ([".out", ".git", "node_modules"].includes(entry.name) ? [] : walk(join(dir, entry.name))) : entry.isFile() ? [join(dir, entry.name)] : []);

export function frontendInputs({home, folders, owners, fixture, unlayered}) {
  const seedRoot = process.env.OSD_ROOT ?? home;
  const selected = new Set([
    join(home, "abap_transpile.json"), join(home, "package-lock.json"), join(home, "libs.lock.json"),
    ...walk(join(home, "tools", "gogen")).filter((file) => file.endsWith(".mjs") || file.endsWith(".go") || file.endsWith("go.mod") || file.endsWith("go.sum")),
    ...walk(join(home, "tools")).filter((file) => file.endsWith(".mjs")),
    ...walk(join(home, "test")).filter((file) => file.endsWith("seed.mjs")),
    ...walk(join(seedRoot, "data")),
    ...walk(join(seedRoot, "packs")),
    ...folders.flatMap(walk),
  ]);
  const files = [...selected].filter(existsSync).sort();
  const hash = createHash("sha256");
  hash.update(JSON.stringify({version, home, seedRoot, folders, owners, fixture, unlayered, node: process.version}));
  for (const file of files) {
    hash.update(relative(home, file)); hash.update("\0");
    hash.update(readFileSync(file)); hash.update("\0");
  }
  return {key: hash.digest("hex"), files};
}

export function cacheLocation(home, env = process.env) {
  return env.GOGEN_FRONTEND_CACHE ?? join(home, ".local", "gogen-frontend-cache");
}

export function readFrontendCache(root, key, goDir) {
  const entry = join(root, key);
  if (!existsSync(join(entry, "complete.json"))) return null;
  try {
    const meta = JSON.parse(readFileSync(join(entry, "complete.json"), "utf8"));
    mkdirSync(join(goDir, "cmd"), {recursive: true});
    if (existsSync(join(entry, "generated"))) cpSync(join(entry, "generated"), join(goDir, "generated"), {recursive: true});
    cpSync(join(entry, "unit"), join(goDir, "cmd", "unit"), {recursive: true});
    return meta;
  } catch {
    rmSync(join(goDir, "generated"), {recursive: true, force: true});
    rmSync(join(goDir, "cmd", "unit"), {recursive: true, force: true});
    return null;
  }
}

export function writeFrontendCache(root, key, goDir, meta) {
  mkdirSync(root, {recursive: true});
  const entry = join(root, key);
  if (existsSync(join(entry, "complete.json"))) return;
  const temp = mkdtempSync(join(root, ".pending-"));
  try {
    if (existsSync(join(goDir, "generated"))) cpSync(join(goDir, "generated"), join(temp, "generated"), {recursive: true});
    cpSync(join(goDir, "cmd", "unit"), join(temp, "unit"), {recursive: true});
    writeFileSync(join(temp, "complete.json"), JSON.stringify(meta));
    try { renameSync(temp, entry); }
    catch (error) { if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error; }
  } finally { rmSync(temp, {recursive: true, force: true}); }
}
