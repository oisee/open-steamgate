// Cross-build the pinned DIAG/RFC bridge for one downloadable Bun target.
// Usage: node scripts/build-protocol-target.mjs linux-arm64 .local/release-probe/linux-arm64
import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync} from "node:fs";
import {resolve, join} from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = {
  "linux-amd64": ["linux", "amd64", "osd-up"],
  "linux-arm64": ["linux", "arm64", "osd-up"],
  "windows-x64": ["windows", "amd64", "osd-up.exe"],
  "macos-arm64": ["darwin", "arm64", "osd-up"],
};
const name = process.argv[2];
if (!(name in targets)) throw new Error(`Expected one of ${Object.keys(targets).join(", ")}`);
const dest = resolve(process.argv[3] ?? join(root, ".local", "release-probe", name));
const sources = JSON.parse(readFileSync(join(root, "docker", "image", "sources.json"), "utf8"));
const protocolRoot = join(root, ".local", "protocols");
for (const {folder, ref} of sources.protocols) {
  const checkout = join(protocolRoot, folder);
  const actual = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  if (actual !== ref) throw new Error(`${folder}: found ${actual}, expected pinned ${ref}`);
}
mkdirSync(dest, {recursive: true});
const [goos, goarch, filename] = targets[name];
execFileSync("go", ["-C", join(protocolRoot, "open-diag-go"), "build", "-trimpath", "-o", join(dest, filename), "./cmd/osd-up"], {
  env: {...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0"},
  stdio: "inherit",
});
console.log(`built ${join(dest, filename)} from pinned protocol sources`);
