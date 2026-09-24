// The Go host's DESTINATION 'STORE' against the Node host's, answer by
// answer, over the same files (go/abap/store.go, tools/osd-store-destination.mjs).
//
//   node tools/gogen/storecmp.mjs [--root <tree>]
//
// Reads are compared on the tree as it is. Writes are compared on two
// scratch copies of it (src/ copied, everything else linked), one per host,
// with the same calls in the same order; the files the writes leave behind
// are compared too. EV_MS is a stopwatch and is left out; so is the time of
// a file one of the writes touched, since the two hosts wrote it at two
// different moments.
import {execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {home} from "./home.mjs";
import {storeConfig} from "./store.mjs";

const here = import.meta.dirname;
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const root = resolve(arg("--root") ?? home);
const out = join(here, ".out", "storecmp");
mkdirSync(out, {recursive: true});

const {StoreDestination} = await import(`${root}/tools/osd-store-destination.mjs`);
const {ObjectStore} = await import(`${root}/tools/osd-store.mjs`);

// a signature as the transpiled runtime hands one over: typed boxes the
// destination sets, tables it clears and appends to
const box = (v = "") => ({v, get() { return this.v; }, set(x) { this.v = x; }});
const FIELDS = {
  ET_OBJECT: ["type", "name", "package", "file", "writable", "version", "changed_at"],
  ET_ISSUE: ["obj_type", "obj_name", "line", "col", "rule", "message"],
  ET_TYPE: ["type", "count"],
  ET_TOKEN: ["line", "col", "len", "kind"],
};
const table = (fields) => {
  const t = {rows: [], array() { return this.rows; }, clear() { this.rows = []; }, append(r) { this.rows.push(r); },
    getRowType() { return {clone() { const inner = Object.fromEntries(fields.map((f) => [f, box()])); return {get: () => inner}; }}; }};
  return t;
};
const SCALARS = ["EV_SOURCE", "EV_FILE", "EV_PACKAGE", "EV_VERSION", "EV_WRITABLE", "EV_ACTIVE", "EV_LIVE", "EV_NOTE", "EV_COUNT", "EV_MS", "EV_ERROR"];

async function nodeCall(destination, call) {
  const signature = {
    exporting: Object.fromEntries(Object.entries(call).map(([k, v]) => [k.toLowerCase(), box(v)])),
    importing: Object.fromEntries(SCALARS.map((k) => [k.toLowerCase(), box()])),
    tables: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k.toLowerCase(), table(f)])),
  };
  await destination.call("ZOSD_STORE", signature);
  const scalars = Object.fromEntries(SCALARS.map((k) => [k, String(signature.importing[k.toLowerCase()].get())]));
  const rows = (k) => signature.tables[k.toLowerCase()].rows.map((r) => Object.fromEntries(Object.entries(r.get()).map(([f, b]) => [f.toUpperCase(), b.get()])));
  return {scalars, objects: rows("ET_OBJECT"), issues: rows("ET_ISSUE"), types: rows("ET_TYPE")};
}

function goCalls(tree, config, calls) {
  const configFile = join(out, `config-${Date.now()}.json`);
  writeFileSync(configFile, JSON.stringify(config));
  const raw = execFileSync("go", ["run", "./cmd/storecmp", "-root", tree, "-config", configFile],
    {cwd: join(here, "go"), input: JSON.stringify(calls), maxBuffer: 1 << 30}).toString();
  return JSON.parse(raw).map((a) => ({scalars: a.Scalars, objects: a.Objects ?? [], issues: a.Issues ?? [],
    types: (a.Types ?? []).map((t) => ({TYPE: t.TYPE, COUNT: t.COUNT}))}));
}

// what the two must agree on
function comparable(answer, touched = new Set()) {
  const scalars = Object.fromEntries(Object.entries(answer.scalars).filter(([k]) => k !== "EV_MS").sort(([a], [b]) => a.localeCompare(b)));
  const objects = answer.objects.map((o) => ({...o, CHANGED_AT: touched.has(o.FILE) ? "(written)" : o.CHANGED_AT}));
  const issues = answer.issues.map((i) => ({...i, LINE: Number(i.LINE), COL: Number(i.COL)}));
  const types = answer.types.map((t) => ({TYPE: t.TYPE, COUNT: Number(t.COUNT)}));
  return JSON.stringify({scalars, objects, issues, types});
}

let bad = 0;
function compare(label, node, go, touched) {
  const n = comparable(node, touched);
  const g = comparable(go, touched);
  if (n === g) return true;
  bad += 1;
  let at = 0;
  while (at < n.length && n[at] === g[at]) at += 1;
  console.log(`FAIL ${label}\n     node: ...${n.slice(Math.max(0, at - 120), at + 200)}\n     go:   ...${g.slice(Math.max(0, at - 120), at + 200)}`);
  return false;
}

// ------------------------------------------------------------------ reads
const store = new ObjectStore({root});
const all = store.list();
const reads = [
  {IV_COMMAND: "LIST", IV_LIMIT: "100000"},
  {IV_COMMAND: "LIST"},
  {IV_COMMAND: "list", IV_FILTER: "osd", IV_LIMIT: "300"},
  {IV_COMMAND: "LIST", IV_TYPE: "CLAS", IV_FILTER: "ZCL_OSD", IV_LIMIT: "300"},
  {IV_COMMAND: "LIST", IV_TYPE: "DEVC", IV_LIMIT: "300"},
  {IV_COMMAND: "LIST", IV_FILTER: "NO_SUCH_OBJECT_ANYWHERE"},
  {IV_COMMAND: "LIST", IV_LIMIT: "-5"},
  ...[...new Set(all.map((o) => o.type))].map((type) => ({IV_COMMAND: "LIST", IV_TYPE: type, IV_LIMIT: "100000"})),
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_NO_SUCH_CLASS"},
  {IV_COMMAND: "READ", IV_TYPE: "STRU", IV_NAME: "ZOSD_OBJECT_S"},
  {IV_COMMAND: "READ", IV_TYPE: "STRU", IV_NAME: "ZOSD_TSES"},
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_TRAN_SESSION", IV_INCLUDE: "testclasses"},
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_INCLUDE: "testclasses"},
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_INCLUDE: "nonsense"},
  {IV_COMMAND: "BOGUS"},
  {IV_COMMAND: "CHECK", IV_TYPE: "CLAS", IV_NAME: "ZCL_NO_SUCH_CLASS"},
  {IV_COMMAND: "ACTIVATE", IV_TYPE: "CLAS", IV_NAME: "ZCL_NO_SUCH_CLASS"},
  // every object of the tree, read whole
  ...all.map((o) => ({IV_COMMAND: "READ", IV_TYPE: o.type, IV_NAME: o.name})),
];
const nodeDest = new StoreDestination({store: () => new ObjectStore({root})});
const config = await storeConfig(root);
const goReads = goCalls(root, config, reads);
let same = 0;
for (let i = 0; i < reads.length; i += 1) {
  if (compare(`read #${i} ${JSON.stringify(reads[i])}`, await nodeCall(nodeDest, reads[i]), goReads[i])) same += 1;
  if (bad > 20) break;
}
console.log(`reads: ${same} of ${reads.length} answers the same (${all.length} objects in the tree)`);

// ----------------------------------------------------------------- writes
// two scratch trees: src/ copied, the rest linked, so the writes land in a
// copy and the tree itself is not touched
function scratch(name) {
  const dir = join(out, name);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  for (const entry of readdirSync(root)) {
    if (entry === "src") cpSync(join(root, "src"), join(dir, "src"), {recursive: true, dereference: true});
    else symlinkSync(join(root, entry), join(dir, entry));
  }
  return dir;
}
const writes = [
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_SOURCE: "* changed\r\nCLASS x.\rENDCLASS.\n"},
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT"},
  {IV_COMMAND: "LIST", IV_FILTER: "ZCL_OSD_EDIT"},
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_INCLUDE: "testclasses", IV_SOURCE: "* tests\n"},
  {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_INCLUDE: "testclasses"},
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_INCLUDE: "nonsense", IV_SOURCE: "x"},
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT"},
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "CL_ABAP_CHAR_UTILITIES", IV_SOURCE: "x"},
  {IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: "ZCL_STG_SEGW_REGISTRY", IV_SOURCE: "x"},
  {IV_COMMAND: "WRITE", IV_TYPE: "XYZ", IV_NAME: "ZCL_OSD_EDIT", IV_SOURCE: "x"},
  // a new object, and a name that tries to leave its folder
  {IV_COMMAND: "WRITE", IV_TYPE: "PROG", IV_NAME: "ZOSD_STORECMP_NEW", IV_SOURCE: "REPORT zosd_storecmp_new.\n"},
  {IV_COMMAND: "LIST", IV_FILTER: "ZOSD_STORECMP"},
  {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZOSD_STORECMP_NEW"},
  {IV_COMMAND: "WRITE", IV_TYPE: "PROG", IV_NAME: "../../ZOSD_ESCAPE", IV_SOURCE: "REPORT x.\n"},
  {IV_COMMAND: "CHECK", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT", IV_SOURCE: "CLASS x."},
  {IV_COMMAND: "ACTIVATE", IV_TYPE: "CLAS", IV_NAME: "ZCL_OSD_EDIT"},
];
const nodeTree = scratch("node");
const goTree = scratch("go");
const nodeWriter = new StoreDestination({store: () => new ObjectStore({root: nodeTree})});
const nodeWrites = [];
for (const call of writes) {
  // CHECK and ACTIVATE are the compiler's on Node: not compared, only run on Go
  if (call.IV_COMMAND === "CHECK" || call.IV_COMMAND === "ACTIVATE") { nodeWrites.push(undefined); continue; }
  nodeWrites.push(await nodeCall(nodeWriter, call));
}
const goWrites = goCalls(goTree, config, writes);
const touched = new Set(["src/webgui/zcl_osd_edit.clas.abap", "src/webgui/zcl_osd_edit.clas.testclasses.abap", "src/osd/zosd_storecmp_new.prog.abap"]);
let wsame = 0;
for (let i = 0; i < writes.length; i += 1) {
  if (nodeWrites[i] === undefined) {
    console.log(`go only #${i} ${writes[i].IV_COMMAND}: ${goWrites[i].scalars.EV_ERROR} | issues ${goWrites[i].issues.length}`);
    continue;
  }
  if (compare(`write #${i} ${JSON.stringify(writes[i]).slice(0, 120)}`, nodeWrites[i], goWrites[i], touched)) wsame += 1;
}
console.log(`writes: ${wsame} of ${writes.filter((w) => w.IV_COMMAND !== "CHECK" && w.IV_COMMAND !== "ACTIVATE").length} answers the same`);
// the files the writes left behind, byte for byte
for (const file of [...touched, "../ZOSD_ESCAPE", "src/osd/..#..#zosd_escape.prog.abap"]) {
  const n = existsSync(join(nodeTree, file)) ? readFileSync(join(nodeTree, file)) : undefined;
  const g = existsSync(join(goTree, file)) ? readFileSync(join(goTree, file)) : undefined;
  const ok = (n === undefined && g === undefined) || (n !== undefined && g !== undefined && Buffer.compare(n, g) === 0);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} file ${file}: ${n === undefined ? "absent" : `${n.length} bytes`} / ${g === undefined ? "absent" : `${g.length} bytes`}`);
}
process.exit(bad ? 1 : 0);
