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
  // DATA of an interface is one field of the object: written through an
  // interface reference and read through the class reference and back,
  // through a reference to an included interface (zif_ia2, measured with
  // local interfaces in a test include), in the class as zif~attr and
  // me->zif~attr, in a subclass too; READ-ONLY written inside the class
  // through me and through a reference of the class's type, and in the
  // subclass. The A4H probe also showed what does not activate, which the
  // front end refuses rather than compiles: VALUE on an interface DATA (so
  // init:0), a write to READ-ONLY through an interface reference (inside
  // the class too) or from outside the class, and lo_i->zif_ia~attr on a
  // reference to zif_ia itself
  ZCL_GOGEN_T_IA: "init:0 o:7 i:8 bump:9,90,90,9 pair:3p inner:in,in,two alias:shared other:0, first:9,shared sub:42,1049,43,7 ro:2",
  // a subclass implementing an interface (zif_iadb) that includes one its
  // superclass already implements (zif_iadc, through zif_iada): A4H
  // activates it and keeps one field, which set( ) of the superclass writes
  // and every reference reads ($ZOSG_TMP_0121, 2026-09-23). Go gave the
  // subclass a second field until then: get:0 ... get:7
  ZCL_GOGEN_T_IADUP: "get:5 a:6 c:6 s:6 b:7 get:5",
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

// What A4H does not activate and abaplint does not report, so the front end
// refuses it (a statement stub): testdata-refused/ holds one statement per
// refusal, each answered by its message at its line, and the neighbours that
// must still compile (an attribute named VALUE, a read of a READ-ONLY
// attribute); MV_X is READ-ONLY and shares its name with a component of a
// structure declared before it, which is not an attribute and must not hide
// the READ-ONLY. lo_i->zif~attr on a reference to zif itself is a
// syntax error abaplint does report, so that object is left out whole.
const REFUSED = {
  12: "ZIF_GOGEN_T_RF~MV_V: VALUE on an interface DATA does not activate on A4H",
  13: "ZIF_GOGEN_T_RF->MV_RO: a write to a READ-ONLY attribute through an interface reference (a syntax error on A4H)",
  14: "ZCL_GOGEN_T_RF_OBJ->ZIF_GOGEN_T_RF~MV_RO: a write to a READ-ONLY attribute outside ZCL_GOGEN_T_RF_OBJ (a syntax error on A4H)",
  15: "ZIF_GOGEN_T_RF->CO_K: a constant through an interface reference is not in the subset",
  17: "ZIF_GOGEN_T_RF->MV_X: a write to a READ-ONLY attribute through an interface reference (a syntax error on A4H)",
};
const refused = compileProgram({folders: [join(here, "testdata-refused"), core], objects: ["zcl_gogen_t_rf", "zcl_gogen_t_rf_obj", "zcl_gogen_t_rf_own"], tolerant: true});
const got = new Map(refused.partial.map((x) => [Number(/zcl_gogen_t_rf\.clas\.abap:(\d+)\)/.exec(x)?.[1]), x.slice(x.indexOf("): ") + 3)]));
for (const [line, want] of Object.entries(REFUSED)) {
  const ok = got.get(Number(line)) === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} refused :${line}: ${got.get(Number(line)) ?? "(compiled)"}${ok ? "" : `\n     want: ${want}`}`);
}
for (const [line, msg] of got) {
  if (REFUSED[line] === undefined) { bad += 1; console.log(`FAIL refused :${line}: must compile, got ${msg}`); }
}
const own = refused.broken.includes("zcl_gogen_t_rf_own");
if (!own) bad += 1;
console.log(`${own ? "ok  " : "FAIL"} refused ZCL_GOGEN_T_RF_OWN left out by abaplint's syntax check`);
process.exit(bad ? 1 : 0);
