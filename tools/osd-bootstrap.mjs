#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {join, resolve} from "node:path";
import {librariesFromLock} from "./osd-lock.mjs";
import {requireSupportedNode} from "./osd-node-version.mjs";
import {materialise} from "./osd-libs.mjs";
import {runsAs} from "./osd-main.mjs";

function run(root, command, args, label) {
  const result = spawnSync(command, args, {cwd: root, stdio: "inherit", env: process.env});
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? "unknown"})`);
}

export function bootstrap(root = process.cwd(), say = (line) => console.log(line)) {
  requireSupportedNode(process.versions.node, "bootstrap: ");
  const at = resolve(root);
  if (!existsSync(join(at, "node_modules"))) {
    throw new Error("bootstrap: node_modules/ is missing; run npm install, then npm run bootstrap");
  }
  const {libraries} = librariesFromLock(at);
  const cloned = materialise(at, say);
  say(cloned.length === 0
    ? "bootstrap: every library clone is already at its locked ref"
    : `bootstrap: cloned ${cloned.length} ${cloned.length === 1 ? "library" : "libraries"}`);
  run(at, process.execPath, [join(at, "tools", "osd-fetch.mjs")], "bootstrap: pack fetch");
  run(at, "npm", ["run", "transpile"], "bootstrap: transpile");
  return {libraries: libraries.length, cloned: cloned.length};
}

if (runsAs("osd-bootstrap.mjs")) {
  try {
    bootstrap();
  } catch (error) {
    const message = String(error.message ?? error).split(/\r?\n/)[0];
    console.error(message.startsWith("bootstrap:") ? message : `bootstrap: ${message}`);
    process.exitCode = 1;
  }
}
