#!/usr/bin/env node
// Keep a vscode-v tag tied to the version build-vsix.mjs stamps from HEAD.
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {basename} from "node:path";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();

export function expectedVersion(packageVersion, count) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(packageVersion);
  if (!match || !/^\d+$/.test(count)) throw new Error("invalid VS Code package version or commit count");
  return `${match[1]}.${match[2]}.${count}`;
}

export function suggestedTag() {
  const source = JSON.parse(readFileSync(resolve(root, "editors/vscode/package.json"), "utf8"));
  return `vscode-v${expectedVersion(source.version, git("rev-list", "--count", "HEAD"))}`;
}

export function checkReleaseVersion(tag, vsix, {requireTag = true} = {}) {
  if (!/^vscode-v\d+\.\d+\.\d+$/.test(tag ?? "")) {
    throw new Error("release tag must be vscode-v<major>.<minor>.<patch>");
  }
  const head = git("rev-parse", "HEAD");
  const tagExists = (() => {
    try { git("show-ref", "--verify", `refs/tags/${tag}`); return true; }
    catch { return false; }
  })();
  if (!tagExists && requireTag) throw new Error(`${tag} does not exist; a tag-push release requires an existing tag`);
  const tagged = tagExists ? git("rev-parse", `refs/tags/${tag}^{commit}`) : undefined;
  if (tagged && tagged !== head) throw new Error(`${tag} points to ${tagged}, but checkout HEAD is ${head}`);
  const version = suggestedTag().slice("vscode-v".length);
  if (tag !== `vscode-v${version}`) {
    throw new Error(`tag ${tag} disagrees with stamped VSIX version ${version}; tag this commit as vscode-v${version}`);
  }
  if (vsix) {
    if (basename(vsix) !== `osd-vscode-${version}.vsix`) {
      throw new Error(`VSIX filename ${basename(vsix)} disagrees with ${version}`);
    }
    const packaged = JSON.parse(execFileSync("unzip", ["-p", vsix, "extension/package.json"], {cwd: root, encoding: "utf8"}));
    if (packaged.version !== version) throw new Error(`VSIX manifest version ${packaged.version} disagrees with ${version}`);
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--suggest") console.log(suggestedTag());
    else console.log(checkReleaseVersion(process.argv[2], process.argv[3], {
      requireTag: !process.argv.includes("--allow-untagged"),
    }));
  } catch (error) {
    console.error(`release-version: ${error.message}`);
    process.exitCode = 1;
  }
}
