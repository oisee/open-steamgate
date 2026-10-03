// Time the full, unequal sets separately: Node's ordinary Unit entry point
// and every Go binary the isolated inventory built. Invoke under flock.
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {home} from "./home.mjs";

const dir = mkdtempSync(join(tmpdir(), "gogen-unit-full-bench-"));
const plan = process.argv[2] ?? join(home, ".local", "gogen-unit-full.json");
function measure(label, command, args) {
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const file = join(dir, `${label}-${i}.time`);
    const r = spawnSync("/usr/bin/time", ["-f", "%e %M", "-o", file, command, ...args],
      {cwd: home, encoding: "utf8", maxBuffer: 20e6, timeout: 300000});
    if (r.status !== 0) throw new Error(`${label} run ${i}: ${r.stderr || r.stdout || r.error?.message}`);
    const [wallSeconds, peakRssKiB] = readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
    rows.push({wallSeconds, peakRssKiB});
  }
  const median = (field) => rows.map((x) => x[field]).sort((a, b) => a - b)[1];
  return {runs: rows, median: {wallSeconds: median("wallSeconds"), peakRssKiB: median("peakRssKiB")}};
}
try {
  const node = measure("node", "node", ["--expose-gc", "--import", "./tools/osd-unit-bootstrap.mjs", "output/index.mjs"]);
  const go = measure("go", "node", [join(home, "tools", "gogen", "unit-full-run.mjs"), plan]);
  console.log(JSON.stringify({instrument: "/usr/bin/time -f '%e %M' (seconds, KiB)", node, go}, null, 2));
} finally { rmSync(dir, {recursive: true, force: true}); }
