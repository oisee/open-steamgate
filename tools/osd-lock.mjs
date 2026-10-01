import {readFileSync, readdirSync, realpathSync, statSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename, join} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {approvedLicenseAssumption} from "../docker/image/license-assumptions.mjs";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function readLock(root = ".") {
  const file = join(root, "libs.lock.json");
  const lock = JSON.parse(readFileSync(file, "utf8"));
  const validate = (source, label) => {
    if (!source || typeof source.repo !== "string" || !REPO.test(source.repo)
        || typeof source.ref !== "string" || !SHA.test(source.ref)) {
      throw new Error(`libs.lock.json: ${label} must have a GitHub owner/repository and a 40-character commit SHA`);
    }
  };
  validate(lock.transpiler, "transpiler");
  if (!Array.isArray(lock.libraries)) throw new Error("libs.lock.json: libraries must be an array");
  const seen = new Set();
  for (const lib of lock.libraries) {
    if (typeof lib.folder !== "string" || lib.folder === "" || seen.has(lib.folder)) {
      throw new Error("libs.lock.json: library folders must be unique non-empty names");
    }
    seen.add(lib.folder);
    validate(lib, `library ${lib.folder}`);
  }
  // Placeholder licences have an approval for a particular fork commit only.
  try {
    const sources = JSON.parse(readFileSync(join(root, "docker", "image", "sources.json"), "utf8"));
    for (const source of sources.libraries.filter((entry) => entry.licenseAssumption)) {
      const pin = lock.libraries.find((entry) => entry.folder === source.folder);
      if (!pin || !approvedLicenseAssumption({...pin, ...source})) {
        throw new Error(`libs.lock.json: ${source.folder} needs licence approval for its pinned ref`);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return lock;
}

/** The lock and transpile config must describe the same library closure. */
export function librariesFromLock(root = ".") {
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const lock = readLock(root);
  const byFolder = new Map(lock.libraries.map((lib) => [lib.folder, lib]));
  const configured = [];
  const seen = new Set();
  for (const lib of config.libs ?? []) {
    if (typeof lib.folder !== "string" || lib.folder === "") continue;
    const folder = basename(lib.folder.replaceAll("\\", "/"));
    const pin = byFolder.get(folder);
    if (pin === undefined) throw new Error(`libs.lock.json has no pin for ${lib.folder}`);
    const normalized = lib.folder.replaceAll("\\", "/").replace(/^\//, "");
    if (normalized !== `.local/lars/${folder}`) {
      throw new Error(`abap_transpile.json library ${lib.folder} is outside .local/lars/`);
    }
    configured.push({
      name: folder,
      folder: normalized,
      path: join(root, normalized),
      repo: pin.repo,
      url: `https://github.com/${pin.repo}.git`,
      ref: pin.ref,
    });
    seen.add(folder);
  }
  const extra = lock.libraries.find((lib) => !seen.has(lib.folder));
  if (extra !== undefined) throw new Error(`libs.lock.json has an unused library pin for ${extra.folder}`);
  return {libraries: configured, lock};
}

/** Resolve a library at its established path, checking the checkout itself. */
export function libraryPath(root, folder, env = process.env) {
  const pin = readLock(root).libraries.find((lib) => lib.folder === folder);
  if (!pin) throw new Error(`libs.lock.json has no pin for ${folder}`);
  const key = `OSD_LIB_${folder.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  if (env[key]) {
    console.error(`*** OSD LIBRARY OVERRIDE: ${folder} <- ${env[key]} (pin bypassed) ***`);
    return env[key];
  }
  const path = join(root, ".local", "lars", folder);
  let actual = "missing";
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {cwd: path, encoding: "utf8", stdio: "pipe"}).trim();
    if (realpathSync(top) === realpathSync(path)) {
      actual = execFileSync("git", ["rev-parse", "HEAD"], {cwd: path, encoding: "utf8", stdio: "pipe"}).trim();
    }
  } catch { /* absent or not a standalone checkout */ }
  if (actual !== pin.ref) throw new Error(`${folder} is at ${actual}, libs.lock.json says ${pin.ref}; run node tools/osd-libs.mjs --sync`);
  return path;
}

function isUsableDirectory(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

export function vsixPreflightMissing(root = ".") {
  const missing = [];
  if (!isUsableDirectory(join(root, "node_modules"))) missing.push("node_modules/");
  const {libraries} = librariesFromLock(root);
  for (const lib of libraries) {
    const key = `OSD_LIB_${lib.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    if (!isUsableDirectory(process.env[key] || lib.path)) missing.push(`${lib.folder}/`);
    else libraryPath(root, lib.name);
  }
  return missing;
}

export function describeVsixPreflight(missing) {
  if (missing.length === 0) return undefined;
  return `build-vsix: missing ${missing.join(", ")}; run npm install and node tools/osd-libs.mjs as needed`;
}

export function githubWorkflowEnv(root = ".") {
  const lock = readLock(root);
  return [
    `OSD_TRANSPILER_REPO=https://github.com/${lock.transpiler.repo}.git`,
    `OSD_TRANSPILER_REF=${lock.transpiler.ref}`,
  ].join("\n") + "\n";
}

if (runsAs("osd-lock.mjs")) {
  const mode = process.argv[2];
  if (mode === "github-env") {
    process.stdout.write(githubWorkflowEnv(process.cwd()));
  } else if (mode === "json") {
    process.stdout.write(`${JSON.stringify(readLock(process.cwd()), null, 2)}\n`);
  } else {
    console.error("usage: node tools/osd-lock.mjs <github-env|json>");
    process.exitCode = 2;
  }
}
