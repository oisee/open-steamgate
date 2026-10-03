// Decide when CI needs the expensive install/repackage VSIX tests.
// Menu and command changes in the extension manifest use the ordinary suite;
// package identity and payload changes need the full packaging check.
import {execFileSync} from "node:child_process";
import {SEED_DIRS, SEED_FILES, shipsTestPath} from "../scripts/build-vsix.mjs";

const packagingPaths = [
  /^scripts\/build-(?:vsix|binary)\.mjs$/,
  /^editors\/vscode\/(?:launcher\.js|resources\/)/,
  /^test\/vscode-vsix(?:-packaging)?\.mjs$/,
  /^test\/helpers\/vsix\.mjs$/,
  /^tools\/(?:osd-(?:build|fetch|inputs|lock|packs|xref-seed)|osd-ci-vsix-profile)\.mjs$/,
  // Any in-tree pack can be selected by OSD_VSIX_PACKS.
  /^packs\//,
  /^(?:libs\.lock\.json|package(?:-lock)?\.json)$/,
  /^\.github\/workflows\/(?:tests|release)\.yml$/,
];
const manifestFields = ["name", "version", "publisher", "main", "browser", "icon", "engines", "files", "dependencies"];

export function needsFullVsix(paths, oldManifest, newManifest) {
  if (paths.some((path) => packagingPaths.some((pattern) => pattern.test(path))
    || SEED_DIRS.some((dir) => path.startsWith(`${dir}/`))
    || SEED_FILES.includes(path)
    || (path.startsWith("test/") && shipsTestPath(path.slice("test/".length))))) return true;
  if (!paths.includes("editors/vscode/package.json")) return false;
  if (!oldManifest || !newManifest) return true;
  return manifestFields.some((field) => JSON.stringify(oldManifest[field]) !== JSON.stringify(newManifest[field]));
}

function git(...args) { return execFileSync("git", args, {encoding: "utf8"}); }
function manifestAt(ref) {
  try { return JSON.parse(git("show", `${ref}:editors/vscode/package.json`)); }
  catch { return undefined; }
}

if (process.argv[1]?.endsWith("osd-ci-vsix-profile.mjs")) {
  const [base, head] = process.argv.slice(2);
  if (!/^[0-9a-f]{40}$/.test(base ?? "") || !/^[0-9a-f]{40}$/.test(head ?? "")) {
    console.error("Usage: osd-ci-vsix-profile.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  const paths = git("diff", "--name-only", base, head).trim().split("\n").filter(Boolean);
  const full = needsFullVsix(paths, manifestAt(base), manifestAt(head));
  process.stdout.write(`OSD_CI_FULL_VSIX=${full ? "1" : "0"}\n`);
  console.error(`VSIX profile: ${full ? "full" : "fast"}; ${paths.length} changed path(s)`);
}
