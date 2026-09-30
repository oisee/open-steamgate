import {readFileSync} from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("docs/backlog/sections.json", root), "utf8"));
const original = readFileSync(0);
const sourceLines = original.toString("utf8").match(/[^\n]*\n|[^\n]+$/g) ?? [];
const tracks = new Map();
for (const file of new Set(manifest.sections.map(({file}) => file))) {
  tracks.set(file, readFileSync(new URL(`docs/backlog/${file}`, root), "utf8").match(/[^\n]*\n|[^\n]+$/g) ?? []);
}
const offsets = new Map([...tracks.keys()].map(name => [name, 0]));
const rebuilt = [];
let next = 1;
for (const {start, end, file} of manifest.sections) {
  if (start !== next || end < start || !tracks.has(file)) throw Error(`Invalid section ${start}-${end} in ${file}`);
  const count = end - start + 1;
  const from = offsets.get(file);
  rebuilt.push(...tracks.get(file).slice(from, from + count));
  offsets.set(file, from + count);
  next = end + 1;
}
if (next !== sourceLines.length + 1) throw Error(`Coverage ends at line ${next - 1}; source has ${sourceLines.length}`);
for (const [file, lines] of tracks) {
  if (offsets.get(file) !== lines.length) throw Error(`${file}: ${lines.length - offsets.get(file)} unclaimed lines`);
}
if (rebuilt.join("") !== original.toString("utf8")) throw Error("Reassembled backlog differs from original");
console.log(`Backlog split OK: ${sourceLines.length} lines, ${manifest.sections.length} sections, ${tracks.size} track files; byte-for-byte match`);
