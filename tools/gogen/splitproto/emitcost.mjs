// emitcost.mjs: front end + emit for a closure of 1, 10 and N classes of the
// OSGo program, against the whole program, in one Node process each time the
// way osgo.mjs runs it (the registry is loaded and parsed every time; a warm
// daemon would keep it). Phases from compileProgram's timing.
//   node tools/gogen/splitproto/emitcost.mjs [OBJECT]   (default ZIF_STG_CDS_SOURCE)
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {compileProgram} from "../frontend.mjs";
import {emitGo} from "../emit-go.mjs";
import {layers, libs, hidden} from "../osg-build.mjs";

const root = (process.argv[2] ?? "ZIF_STG_CDS_SOURCE").toUpperCase();
const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = [...layers, ...libs].flatMap((d) => { try { return walk(d); } catch { return []; } })
  .filter((f) => !hidden.has(f) && /\.(clas|intf)\.abap$/.test(f) && !f.includes("testclasses"));
const src = new Map();
for (const f of files) {
  const n = f.split("/").pop().split(".")[0].toUpperCase().replaceAll("#", "/");
  src.set(n, (src.get(n) ?? "") + readFileSync(f, "utf8").toUpperCase());
}
// readers, transitively, by the name appearing in the source (an approximation of abaplint's scopes)
const readers = [root];
const seen = new Set(readers);
for (let i = 0; i < readers.length; i++) {
  const re = new RegExp(`(^|[^A-Z0-9_/])${readers[i].replace(/\//g, "\\/")}([^A-Z0-9_]|$)`);
  for (const [n, s] of src) if (!seen.has(n) && re.test(s)) { seen.add(n); readers.push(n); }
}
console.log(`${root}: ${readers.length} objects in its reader closure (by name)`);
const all = [...new Set(files.map((f) => f.split("/").pop().split(".")[0]))];
const sets = [["1", ["ZCL_OSD_SYSINFO"]], ["10", readers.slice(0, 10)], [String(readers.length), readers], [`whole (${all.length})`, all]];
for (const [label, objects] of sets) {
  const t0 = performance.now();
  const program = compileProgram({folders: [...layers, ...libs], objects, tolerant: true, skip: (p) => hidden.has(p)});
  const t1 = performance.now();
  const go = emitGo(program);
  const t2 = performance.now();
  const t = program.timing;
  const ms = (a, b) => Math.round(b - a);
  console.log(`closure ${label}: ${program.classes.length} classes; load ${ms(t.start, t.load)} parse ${ms(t.load, t.parse)} check ${ms(t.parse, t.check)} compile ${ms(t.check, t1)} emit ${ms(t1, t2)} ms; Go ${Math.round(go.length / 1024)} KB`);
}
