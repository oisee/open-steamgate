// Sequential cold workbench starts. Use the same harness as the regression.
// OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh node tools/bench-adt-unit-object.mjs --samples 20 --out .local/unit-before.json
import {mkdirSync, writeFileSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {coldUnitObject} from "../test/helpers/adt-unit-object-cold.mjs";

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const samples = Number(option("--samples", "20"));
const modes = option("--modes", "0,1").split(",");
const out = resolve(option("--out", ".local/adt-unit-object.json"));
mkdirSync(dirname(out), {recursive: true});
const rows = [];
const summarize = values => {
  const sorted = [...values].sort((a,b) => a-b), n = sorted.length;
  return {median: n % 2 ? sorted[(n-1)/2] : (sorted[n/2-1] + sorted[n/2])/2, max: sorted.at(-1)};
};
for (const mode of modes) {
  for (let i = 0; i < samples; i++) {
    const row = await coldUnitObject({mode, name: option("--name", "ZCL_STG_SEGW_TEST"),
      profile: args.includes("--profile") && i === 0 ? `${out}.${mode}.cpuprofile` : undefined});
    rows.push(row);
    writeFileSync(out, JSON.stringify({rows}, null, 2));
    console.log(`mode=${mode} sample=${i+1}/${samples} ready=${row.readyMs.toFixed(1)} first=${row.firstMs.toFixed(1)} warm=${row.warmMs.toFixed(1)} ms`);
  }
  const selected = rows.filter(row => row.mode === mode);
  console.log(JSON.stringify({mode, samples: selected.length, readyMs: summarize(selected.map(r => r.readyMs)),
    firstMs: summarize(selected.map(r => r.firstMs)), warmMs: summarize(selected.map(r => r.warmMs))}));
}
