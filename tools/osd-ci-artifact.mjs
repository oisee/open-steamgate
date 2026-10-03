// Archive the output of this run for the suite and browser jobs.
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {spawnSync} from "./osd-child-process.mjs";

const archive = process.argv[2] === "pack" ? process.argv[3] : undefined;
if (!archive) {
  console.error("usage: node tools/osd-ci-artifact.mjs pack <tar-file>");
  process.exit(2);
}
const paths = ["gen", "output", "build", ".local/lars", ".local/ci-artifact/transpiler"];
for (const pack of readdirSync("packs")) {
  const manifest = `packs/${pack}/osd-pack.json`;
  if (!existsSync(manifest)) continue;
  for (const source of JSON.parse(readFileSync(manifest, "utf8")).sources ?? []) {
    paths.push(`packs/${pack}/${source.folder}`);
  }
}
for (const path of paths) {
  if (!existsSync(path)) {
    console.error(`osd-ci-artifact: missing ${path}`);
    process.exit(2);
  }
}
const result = spawnSync("tar", ["-cf", archive, ...paths], {stdio: "inherit"});
process.exit(result.status ?? 1);
