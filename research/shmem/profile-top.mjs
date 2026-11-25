#!/usr/bin/env node
// Self time per function out of a --cpu-prof file, the heaviest first.
//   SHMEM_NOGC=1 STG_DB=duckdb STG_DATA_SCALE=100000 [OSD_LAZY_ITAB=1] \
//     node --expose-gc --cpu-prof --cpu-prof-dir=<dir> research/shmem/measure.mjs --child
//   node research/shmem/profile-top.mjs <dir> [lines]
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const dir = process.argv[2];
const file = readdirSync(dir).filter((x) => x.endsWith(".cpuprofile")).sort().pop();
const profile = JSON.parse(readFileSync(join(dir, file), "utf8"));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, i) => {
  const frame = byId.get(id).callFrame;
  const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").slice(-2).join("/")}:${frame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i]);
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [key, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3] ?? 30))) {
  console.log(`${(us / 1000).toFixed(0).padStart(7)} ms ${(100 * us / total).toFixed(1).padStart(5)}%  ${key}`);
}
