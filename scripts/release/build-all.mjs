// One quiet command for the four private Bun/SQLite bundles.
// Usage: node scripts/release/build-all.mjs [--no-native-smoke]
import {execFileSync} from "node:child_process";
import {join, resolve} from "node:path";

const root = resolve(import.meta.dirname, "../..");
const targets = [
  ["linux-amd64", "bun-linux-x64-baseline", "osd"],
  ["linux-arm64", "bun-linux-arm64", "osd"],
  ["windows-x64", "bun-windows-x64-baseline", "osd.exe"],
  ["macos-arm64", "bun-darwin-arm64", "osd"],
];
const options = new Set(process.argv.slice(2));
if ([...options].some((o) => o !== "--no-native-smoke")) {
  throw new Error("Only --no-native-smoke is supported");
}
function run(label, command, args, extra = {}) {
  const start = Date.now();
  try {
    const out = execFileSync(command, args, {cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...extra});
    console.log(`✓ ${label} (${Math.round((Date.now() - start) / 1000)}s)`);
    return out.trim();
  } catch (error) {
    const lines = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim().split(/\r?\n/);
    console.error(`✗ ${label}\n${lines.slice(-35).join("\n")}`);
    throw error;
  }
}
run("ABAP build + unit tests", "npm", ["run", "unit"]);
const native = process.platform === "linux" ? (process.arch === "arm64" ? "linux-arm64" : "linux-amd64")
  : process.platform === "darwin" && process.arch === "arm64" ? "macos-arm64" : undefined;
for (const [name, bunTarget, executable] of targets) {
  run(`${name} Bun`, "bun", ["scripts/build-binary.mjs", `.local/release-probe/${name}/${executable}`, bunTarget]);
  const archive = run(`${name} archive`, "node", ["scripts/make-download-bundle.mjs", name]).match(/^([^\n]+\.(?:tar\.gz|zip)) \(/)?.[1];
  if (!archive) throw new Error(`${name}: bundle builder did not report archive path`);
  console.log(`  ${archive}`);
  if (name === native && !options.has("--no-native-smoke")) {
    const stage = archive.replace(/\.(?:tar\.gz|zip)$/, "");
    run(`${name} native smoke`, "node", ["scripts/release/smoke.mjs", stage]);
  }
}
console.log("Private test bundles built. Native smoke ran only for this host; other targets need their own machines.");
