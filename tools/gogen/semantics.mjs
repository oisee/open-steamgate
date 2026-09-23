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
  // a division by zero raises; the harness reports it with the ABAP line
  // the stack names (the line directives of emit-go)
  // not an A4H value: what each emitter must report. Go names the ABAP
  // line through its line directives; the JS emitter has no source map yet
  // CREATE OBJECT TYPE (name): the name as written, so lower case is an
  // unknown class, as is a class that does not exist
  ZCL_GOGEN_T_DYN: "upper:7 lower:err unknown:err",
  // inheritance: a base method's call on me reaches the redefinition, SUPER->
  // the superclass's; a protected attribute is one field across levels; in
  // the superclass's constructor me->name( ) is the superclass's own
  // (ctor:base); ?= down, an initial reference widened stays initial, and an
  // initial reference casts without CX_SY_MOVE_CAST_ERROR
  ZCL_GOGEN_T_INH: "sub<base>/k/t1+ ctor:base down:k initial dyn:sub<base> nullcast:ok",
  // RETURN out of a TRY body and out of a CATCH, CONTINUE and EXIT of a DO
  // from inside two nested TRYs (Go runs a TRY as a closure and hands these
  // out as codes)
  ZCL_GOGEN_T_TRYFLOW: "b cd caught a1 13!",
  // CP / NP / CA / NA; A4H gave "... ca:X1---X", the 1 being sy-fdpos,
  // which the local copy does not read
  ZCL_GOGEN_T_CP: "cp:XX-X--XX-XX-XX-XX ca:X---X",
  // not an A4H value: the language rule WHEN a OR b OR c, which the front
  // end read as WHEN a alone until 2026-09-23 (the alternatives after the
  // first sit in Or nodes), and which a wrong OData type came out of
  ZCL_GOGEN_T_WHEN: "abc abc abc d -",
  ZCL_GOGEN_T_BOOM: {Go: "ERROR CX_SY_ZERODIVIDE in / at zcl_gogen_t_boom.clas.abap:9", JS: "ERROR CX_SY_ZERODIVIDE in /"},
};
const core = `${home}/.local/lars/open-abap-core/src`;
const objects = readdirSync(join(here, "testdata")).filter((f) => f.endsWith(".clas.abap")).map((f) => f.split(".")[0]);
const program = compileProgram({folders: [join(here, "testdata"), core], objects});
// the classes that carry a test: a static RUN of their own (the others are
// the classes those tests use)
objects.splice(0, objects.length, ...objects.filter((o) => program.classes.find((c) => c.name === o.toUpperCase())?.methods.some((m) => m.name === "RUN" && m.static)));
if (program.skipped.length) console.log(`not compiled: ${program.skipped.join("; ")}`);
const out = join(here, ".out", "semantics");
mkdirSync(out, {recursive: true});
const dir = join(here, "go", "cmd", "semantics");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "main.go"), `package main\n\nimport (\n\t"fmt"\n\t"runtime/debug"\n\t"strings"\n\n\t"osg/gogen/abap"\n)\n\n// abapLine is the first frame of the stack that is ABAP source\nfunc abapLine() string {\n\tfor _, l := range strings.Split(string(debug.Stack()), "\\n") {\n\t\tl = strings.TrimSpace(l)\n\t\tif i := strings.Index(l, ".abap:"); i > 0 {\n\t\t\tif j := strings.IndexAny(l[i:], " +"); j > 0 {\n\t\t\t\tl = l[:i+j]\n\t\t\t}\n\t\t\treturn l[strings.LastIndex(l, "/")+1:]\n\t\t}\n\t}\n\treturn "?"\n}\n\nfunc main() {\n${objects.map((o) => `\tfunc() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tfmt.Printf("${o.toUpperCase()}\\tERROR %v at %s\\n", r, abapLine())\n\t\t\t}\n\t\t}()\n\t\tfmt.Printf("${o.toUpperCase()}\\t%s\\n", ${funcName(o.toUpperCase(), "RUN")}(&abap.Session{}))\n\t}()`).join("\n")}\n}\n`);
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
    if (EXPECT[cls] === undefined) { console.log(`new  ${who} ${cls}: ${got}`); continue; }
    const want = typeof EXPECT[cls] === "string" ? EXPECT[cls] : EXPECT[cls][who];
    const ok = got === want;
    if (!ok) bad += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${who} ${cls}: ${got}${ok ? "" : `\n     want: ${want}`}`);
  }
}
process.exit(bad ? 1 : 0);
