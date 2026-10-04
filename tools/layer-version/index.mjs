import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";

export const VERSION_MARKER = "osd-version.json";

export function parseVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`invalid osd version: ${JSON.stringify(value)} (expected x.y.z)`);
  }
  return value.split(".").map(BigInt);
}

export function parseMinimum(value) {
  if (typeof value !== "string" || !value.startsWith(">=")) {
    throw new Error(`invalid osd requirement: ${JSON.stringify(value)} (expected >=x.y.z)`);
  }
  parseVersion(value.slice(2));
  return value.slice(2);
}

export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** The existing VSIX version rule, also used for the binary's system seed. */
export function packagedVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "editors/vscode/package.json"), "utf8"));
  parseVersion(pkg.version);
  const count = execFileSync("git", ["rev-list", "--count", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  const version = `${pkg.version.split(".").slice(0, 2).join(".")}.${count}`;
  parseVersion(version);
  return version;
}

export function writeVersionMarker(root, version) {
  parseVersion(version);
  writeFileSync(join(root, VERSION_MARKER), `${JSON.stringify({version})}\n`);
}

/** A --layer can name the manifest root or one of its declared ABAP folders. */
function layerManifest(folder) {
  const direct = join(folder, "osd-pack.json");
  if (existsSync(direct)) return direct;
  for (let parent = dirname(folder); ; parent = dirname(parent)) {
    const file = join(parent, "osd-pack.json");
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if ([manifest.abap ?? "src"].flat().some((entry) => resolve(parent, entry) === folder)) return file;
    }
    if (dirname(parent) === parent) return undefined;
  }
}

/** Runs before any generation work. No marker means a development checkout. */
export function checkLayerVersions(root, packs, folders, log = () => {}) {
  const manifests = new Map(packs.map((pack) => [join(pack.dir, "osd-pack.json"), "pack"]));
  for (const folder of folders) {
    const file = layerManifest(resolve(root, folder));
    if (file !== undefined) manifests.set(file, "layer");
  }
  const requirements = [];
  for (const [file, kind] of manifests) {
    const declared = JSON.parse(readFileSync(file, "utf8"));
    if (declared.osd === undefined) continue;
    let minimum;
    try { minimum = parseMinimum(declared.osd); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
    requirements.push({kind, name: declared.name ?? basename(dirname(file)), minimum});
  }
  const marker = join(root, VERSION_MARKER);
  if (!existsSync(marker)) {
    log("debug: no osd-version.json; layer version check skipped in source checkout");
    return;
  }
  const {version} = JSON.parse(readFileSync(marker, "utf8"));
  parseVersion(version);
  for (const {kind, name, minimum} of requirements) {
    if (compareVersions(version, minimum) >= 0) continue;
    const error = new Error(`osd: ${kind} ${name} needs osd >= ${minimum}; this system is ${version} — update the extension (or the binary)`);
    error.code = "OSD_VERSION_MISMATCH";
    throw error;
  }
}
