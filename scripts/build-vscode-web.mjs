import {createRequire} from "node:module";
import {resolve, join} from "node:path";
import {cp, readFile, stat, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {gzipSync} from "node:zlib";
import {packAt, tilesOf, webappsOf} from "../tools/osd-packs.mjs";
import {describeUnfetched} from "../tools/osd-fetch.mjs";

const root = resolve(import.meta.dirname, "..");
// Trimmed like build-vsix: a whitespace-only selection means no packs, not an invalid name.
const selection = String(process.env.OSD_WEB_PACKS ?? process.env.OSD_VSIX_PACKS ?? "zork").trim();
const names = selection === "all" || selection === "" ? [] : selection.split(",").map((name) => name.trim()).filter(Boolean);
const selected = [];
for (const name of names) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`build-vscode-web: invalid pack name: ${JSON.stringify(name)}`);
  const pack = packAt(root, join(root, "packs", name));
  if (pack?.name !== name) throw new Error(`build-vscode-web: unknown pack: ${name}`);
  if (!selected.some((other) => other.name === name)) selected.push(pack);
}
const missing = selected.flatMap((pack) => pack.missing.map((source) => ({
  pack: pack.name, folder: source.folder, repo: source.repo, ref: source.ref,
})));
if (missing.length) throw new Error(describeUnfetched(missing));
const env = {...process.env, OSD_WEB_PACKS: selection};
console.log(`VS Code web packs: ${selection === "" ? "core (none)" : selection === "zork" ? "core+zork" : selection}`);
async function run(command, args) {
  const child = spawn(command, args, {cwd: root, env, stdio: "inherit"});
  const code = await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", done);
  });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${code})`);
}
await run("npm", ["run", "transpile"]);
env.OSD_PREVIEW_GENERATE_ONLY = "1";
await run("node", ["scripts/build-preview.mjs"]);
for (const file of ["output/init.mjs", "web/generated/seed.mjs", "web/generated/services.mjs"]) {
  await stat(resolve(root, file)).catch(() => {
    throw new Error(`${file} is missing; run npm run web:vscode to transpile and generate the gateway first`);
  });
}
const require = createRequire(import.meta.url);
const webpack = require("webpack");
const config = require(resolve(root, "editors/vscode/web/webpack.config.cjs"));
const result = await new Promise((resolveBuild, reject) => webpack(config, (error, stats) => {
  if (error) reject(error);
  else if (stats.hasErrors()) reject(new Error(stats.toString({colors: false, errorDetails: true})));
  else resolveBuild(stats);
}));
console.log(result.toString({colors: false, preset: "minimal"}));
const app = resolve(root, "editors/vscode/dist/web/app");
await cp(resolve(root, "webapp"), app, {recursive: true});
for (const pack of webappsOf(root, env)) {
  await cp(pack.dir, join(app, pack.name), {recursive: true});
}
await writeFile(join(app, "packs.json"), JSON.stringify({tiles: tilesOf(root, env)}, null, 2) + "\n");
const file = resolve(root, "editors/vscode/dist/web/extension.js");
const bytes = (await stat(file)).size;
const gzipBytes = gzipSync(await readFile(file)).byteLength;
console.log(`VS Code web bundle (${selection === "" ? "core" : selection === "zork" ? "core+zork" : selection}): raw ${bytes} bytes (${(bytes / 1048576).toFixed(2)} MiB), gzip ${gzipBytes} bytes (${(gzipBytes / 1048576).toFixed(2)} MiB)`);
