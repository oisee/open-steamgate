// The IR's JSON round trip, checked on the whole OSGo program:
//   compile -> documents -> text -> documents -> program -> emit
// gives the same Go and the same JS byte for byte as emitting the program
// the front end built. The documents' hash is printed: two runs in two
// processes must print the same one (a second compile in one process does
// not count -- the front end keeps counters across compiles).
//
//   node tools/gogen/ir-json-check.mjs [--out <dir>]   (--out keeps the documents)
import {mkdirSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {compileOsg} from "./osg-build.mjs";
import {emitGo} from "./emit-go.mjs";
import {emitJs} from "./emit-js.mjs";
import {toDocuments, fromDocuments, text} from "./ir-json.mjs";

const at = process.argv.indexOf("--out");
const out = at < 0 ? undefined : process.argv[at + 1];

const t0 = performance.now();
const {program} = compileOsg();
const t1 = performance.now();
const docs = toDocuments(program);
const texts = {program: text(docs.program), objects: docs.objects.map(text)};
const t2 = performance.now();
const back = fromDocuments({program: JSON.parse(texts.program), objects: texts.objects.map((t) => JSON.parse(t))});
const t3 = performance.now();

const goA = emitGo(program);
const goB = emitGo(back);
const jsA = emitJs(program);
const jsB = emitJs(back);
const hash = createHash("sha256").update(texts.program).update(texts.objects.join("")).digest("hex").slice(0, 16);

const bytes = texts.program.length + texts.objects.reduce((n, t) => n + t.length, 0);
console.log(`front end ${Math.round(t1 - t0)} ms; ${docs.objects.length} objects; to JSON ${Math.round(t2 - t1)} ms, ${(bytes / 1e6).toFixed(1)} MB; back ${Math.round(t3 - t2)} ms`);
console.log(`Go from JSON ${goA === goB ? "identical" : "DIFFERS"} (${goA.length} bytes); JS from JSON ${jsA === jsB ? "identical" : "DIFFERS"} (${jsA.length} bytes); documents ${hash}`);
if (out !== undefined) {
  mkdirSync(join(out, "objects"), {recursive: true});
  writeFileSync(join(out, "program.json"), texts.program);
  docs.objects.forEach((d, i) => writeFileSync(join(out, "objects", `${d.object.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase()}.json`), texts.objects[i]));
}
if (goA !== goB || jsA !== jsB) process.exit(1);
