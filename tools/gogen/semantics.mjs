// ABAP semantics pinned against A4H: each class in testdata/ has a static
// RUN returning a string, and EXPECT below is what A4H returned for the same
// code (ABAP Unit probe, 2026-09-23). Both emitters must give it.
//
//   node tools/gogen/semantics.mjs
import {execFileSync} from "node:child_process";
import {copyFileSync, mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo, funcName} from "./emit-go.mjs";
import {emitJs} from "./emit-js.mjs";
import {home} from "./home.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXPECT = {
  // an IMPORTING by reference sees what CHANGING did to the same table,
  // APPEND included: it:3,99 on A4H
  ZCL_GOGEN_T_COPY: "copy a:2,1 b:3,50 struct a:1 b:60 alias it:3,99 after:3,99",
};
const core = `${home}/.local/lars/open-abap-core/src`;
const objects = readdirSync(join(here, "testdata")).filter((f) => f.endsWith(".clas.abap")).map((f) => f.split(".")[0]);
const program = compileProgram({folders: [join(here, "testdata"), core], objects});
if (program.skipped.length) console.log(`not compiled: ${program.skipped.join("; ")}`);
const out = join(here, ".out", "semantics");
mkdirSync(out, {recursive: true});
const dir = join(here, "go", "cmd", "semantics");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "main.go"), `package main\n\nimport (\n\t"fmt"\n\n\t"osg/gogen/abap"\n)\n\nfunc main() {\n${objects.map((o) => `\tfunc() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tfmt.Printf("${o.toUpperCase()}\\tERROR %v\\n", r)\n\t\t\t}\n\t\t}()\n\t\tfmt.Printf("${o.toUpperCase()}\\t%s\\n", ${funcName(o.toUpperCase(), "RUN")}(&abap.Session{}))\n\t}()`).join("\n")}\n}\n`);
execFileSync("gofmt", ["-w", dir]);
const goOut = execFileSync("go", ["run", "./cmd/semantics"], {cwd: join(here, "go")}).toString();
writeFileSync(join(out, "t.mjs"), emitJs(program));
copyFileSync(join(here, "js", "abap.mjs"), join(out, "abap.mjs"));
const m = await import(pathToFileURL(join(out, "t.mjs")).href);
let bad = 0;
for (const line of goOut.trim().split("\n")) {
  const [cls, go] = line.split("\t");
  let js;
  try { js = m[cls].RUN({sy: {index: 0, tabix: 0, subrc: 0}}); } catch (e) { js = `ERROR ${e.message}`; }
  for (const [who, got] of [["Go", go], ["JS", js]]) {
    const ok = got === EXPECT[cls];
    if (!ok) bad += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${who} ${cls}: ${got}${ok ? "" : `\n     A4H: ${EXPECT[cls]}`}`);
  }
}
process.exit(bad ? 1 : 0);
