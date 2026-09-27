import {createHash} from "node:crypto";
import {readFileSync, statSync} from "node:fs";
import {fileURLToPath} from "node:url";

const story = fileURLToPath(new URL("../packs/zork/src/zork1-z3.w3mi.data.z3", import.meta.url));
const build = readFileSync(new URL("../packs/zork/STORY-BUILD.md", import.meta.url), "utf8");
const expected = /Output: \*\*([\d,]+) bytes\*\*, SHA-256 \*\*`([a-f0-9]{64})`\*\*/.exec(build);
if (!expected) throw new Error("STORY-BUILD.md lacks the output size and SHA-256");
const size = Number(expected[1].replaceAll(",", ""));
const hash = createHash("sha256").update(readFileSync(story)).digest("hex");
if (statSync(story).size !== size || hash !== expected[2]) {
  throw new Error(`Zork I story mismatch: ${statSync(story).size} bytes, SHA-256 ${hash}`);
}
console.log(`Zork I story verified: ${size} bytes, SHA-256 ${hash}`);
