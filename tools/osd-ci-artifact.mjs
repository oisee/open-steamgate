// Archive the output of this run for the suite and browser jobs.
import {readFileSync, readdirSync, existsSync, readlinkSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertPublicSystem} from "./osd-system.mjs";
import {generationProvenance, verifyPublicArtefact, writeArtefactProvenance} from "./osd-provenance.mjs";

if (process.argv[2] === "verify") {
  const {generationStateSnapshot} = await import("./osd-build.mjs");
  const state = generationStateSnapshot();
  console.log(`osd-ci-artifact: generation: ${JSON.stringify(state)}`);
  process.exit(state.live !== null && state.live === state.tree ? 0 : 1);
}

const archive = process.argv[2] === "pack" ? process.argv[3] : undefined;
if (!archive) {
  console.error("usage: node tools/osd-ci-artifact.mjs pack <tar-file> | verify");
  process.exit(2);
}
assertPublicSystem(process.cwd());
const provenance = generationProvenance(process.cwd());
if (provenance.systemPrivate || provenance.inputs.some(input => input.private)) {
  const error = new Error("private generation cannot be archived"); error.code = "PRIVATE_LAYER"; throw error;
}
const live = readlinkSync("build/live");
if (!/^by-input\/[0-9a-f]{16}$/.test(live)) throw new Error("invalid live generation link");
const generation = JSON.parse(readFileSync(`build/${live}/manifest.json`, "utf8"));
const {genHash} = await import("./osd-build.mjs");
if (typeof generation.gen !== "string" || generation.gen !== genHash(process.cwd()))
  throw new Error("generated sources differ from the public live generation");
const paths = ["gen", "output", "build/live", `build/${live}`, ".local/ci-artifact/transpiler"];
for (const lib of generation.inputs?.libs ?? []) {
  if (!/^\.local\/lars\/[a-zA-Z0-9._-]+$/.test(lib)) throw new Error(`library path is outside the public archive closure: ${lib}`);
  paths.push(lib);
}
for (const pack of readdirSync("packs")) {
  const manifest = `packs/${pack}/osd-pack.json`;
  if (!existsSync(manifest)) continue;
  const marker = `packs/${pack}/.osd-fetched.json`;
  if (existsSync(marker)) paths.push(marker);
  for (const source of JSON.parse(readFileSync(manifest, "utf8")).sources ?? []) {
    if (typeof source.folder !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source.folder)
        || source.folder === "." || source.folder === "..") throw new Error(`unsafe fetched source folder in ${manifest}`);
    const folder = `packs/${pack}/${source.folder}`;
    const identity = `${folder}/.osd-source.json`;
    if (!existsSync(identity)) throw new Error(`missing fetched identity: ${identity}`);
    const entry = JSON.parse(readFileSync(identity, "utf8"));
    if (typeof entry.private !== "boolean" || entry.private) throw new Error(`private or unrecorded fetched source: ${folder}`);
    paths.push(folder);
  }
}
for (const path of paths) {
  if (!existsSync(path)) {
    console.error(`osd-ci-artifact: missing ${path}`);
    process.exit(2);
  }
}
const result = spawnSync("tar", ["-cf", archive, ...paths], {stdio: "inherit"});
if (result.status !== 0) process.exit(result.status ?? 1);
writeArtefactProvenance(archive, provenance);
verifyPublicArtefact(archive);
