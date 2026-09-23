// The call closure of an entry point: every method a request starting there
// can reach, through static calls, instance calls on a class, calls through
// an interface (every implementing class counts) and NEW (the constructor).
// A reachable method that did not compile, or a class that is not in the
// program, is a stub the request can hit; the list is what a milestone must
// empty.
//
//   node tools/gogen/closure.mjs ZCL_STG_DISPATCHER=>DISPATCH
import {readdirSync, existsSync} from "node:fs";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {home} from "./home.mjs";

const entry = (process.argv[2] ?? "ZCL_STG_DISPATCHER=>DISPATCH").toUpperCase();
const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const layers = [`${home}/src`, `${home}/gen`];
const libs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/scaffold", "open-abap-odata/src", "ajson/src/core"]
  .map((d) => `${home}/.local/lars/${d}`).filter(existsSync);
const objectsOf = (dirs) => [...new Set(dirs.flatMap(walk).filter((f) => /\.(clas|intf)\.abap$/.test(f)).map((f) => f.split("/").pop().split(".")[0]))];
// OSG's own objects plus the libraries': a library class a request reaches must compile too
const objects = objectsOf([...layers, ...libs]);
const program = compileProgram({folders: [...layers, ...libs], objects, tolerant: true});

const classes = new Map(program.classes.map((c) => [c.name, c]));
const implementors = new Map();
for (const c of program.classes) for (const i of c.interfaces ?? []) (implementors.get(i) ?? implementors.set(i, []).get(i)).push(c.name);
const methodOf = (cls, name) => classes.get(cls)?.methods.find((m) => m.name === name) ?? (name === "CONSTRUCTOR" ? classes.get(cls)?.constructor : undefined);
const stubOf = (cls, name) => classes.get(cls)?.stubs?.find((m) => m.name === name);

function callsIn(node, cls, out) {
  if (Array.isArray(node)) { for (const n of node) callsIn(n, cls, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.e === "call") {
    if (node.receiver?.type?.k === "ref") {
      const t = node.receiver.type;
      if (t.intf) {
        const m = node.method.includes("~") ? node.method : `${t.name}~${node.method}`;
        const impl = implementors.get(t.name) ?? [];
        if (impl.length === 0) out.push({cls: t.name, method: m, why: "interface without an implementation in the program"});
        for (const c of impl) out.push({cls: c, method: m});
      } else out.push({cls: t.name, method: node.method});
    } else if (node.owner) out.push({cls: node.owner, method: node.method});
    else out.push({cls, method: node.method});
  }
  if (node.e === "new") out.push({cls: node.cls, method: "CONSTRUCTOR", optional: true});
  for (const k of Object.keys(node)) if (k !== "type") callsIn(node[k], cls, out);
  return out;
}

function stubsIn(node, out) {
  if (Array.isArray(node)) { for (const n of node) stubsIn(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.s === "stub") out.push(node);
  for (const k of Object.keys(node)) if (k !== "type") stubsIn(node[k], out);
  return out;
}
const inner = [];
const [ec, em] = entry.split("=>");
const seen = new Set();
const stubs = new Map();
const queue = [{cls: ec, method: em, path: [entry]}];
while (queue.length) {
  const {cls, method, path, optional, why} = queue.shift();
  const key = `${cls}=>${method}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const m = methodOf(cls, method);
  if (m) {
    for (const c of callsIn(m.body, cls, [])) queue.push({...c, path: [...path, `${c.cls}=>${c.method}`]});
    for (const st of stubsIn(m.body, [])) inner.push({key, reason: st.reason});
    continue;
  }
  if (optional && classes.has(cls)) continue; // a class without a constructor
  const s = stubOf(cls, method);
  const reason = why ?? s?.reason ?? (classes.has(cls) ? "method not found" : program.broken.includes(cls.toLowerCase()) ? "class has syntax errors here" : "class not in the program");
  stubs.set(key, {reason, path});
}
console.log(`entry ${entry}: ${seen.size} methods reachable, ${seen.size - stubs.size} compiled (${inner.length} statement stubs inside them), ${stubs.size} whole-method stubs`);
const innerBy = new Map();
for (const x of inner) { const r = x.reason.slice(0, 60); (innerBy.get(r) ?? innerBy.set(r, []).get(r)).push(x.key); }
console.log("statement stubs inside reachable methods:");
for (const [r, ks] of [...innerBy].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) console.log(`${String(ks.length).padStart(4)}  ${r}`);
console.log("whole-method stubs:");
const byReason = new Map();
for (const [k, s] of stubs) { const r = s.reason.replace(/^[^:]*: /, "").slice(0, 70); (byReason.get(r) ?? byReason.set(r, []).get(r)).push(k); }
for (const [r, ks] of [...byReason].sort((a, b) => b[1].length - a[1].length)) console.log(`${String(ks.length).padStart(4)}  ${r}\n        ${ks.slice(0, 4).join(", ")}${ks.length > 4 ? ", ..." : ""}`);
