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
  // DELETE <name> FROM n on an internal table named like a TABL is the
  // internal table's statement: A4H answered "lines:1  subrc:0" (over an
  // itab named T000). DELETE itab FROM idx is not in the subset yet, so both
  // emitters refuse it as an internal DELETE form; what this pins is that it
  // is not sent to the database (before the fix: "the relational IR has no
  // delete node")
  ZCL_GOGEN_T_DELNAME: {
    Go: "ERROR NOT_COMPILED in ZCL_GOGEN_T_DELNAME=>RUN (zcl_gogen_t_delname.clas.abap:19): DELETE form: DELETE zgogen_t_dbw FROM 2. at zcl_gogen_t_delname.clas.abap:19",
    JS: "ERROR NOT_COMPILED in ZCL_GOGEN_T_DELNAME=>RUN (zcl_gogen_t_delname.clas.abap:19): DELETE form: DELETE zgogen_t_dbw FROM 2."},
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
  // call chains whose head is a call on me: m( )->n( ), me->m( )->n( ),
  // zif_x~m( )->n( ), cl_x=>m( )->n( ), as statements and as operands; the
  // head runs before the argument of the tail (log ...mfnxtx...), A4H
  ZCL_GOGEN_T_CHAINS: "a0 b+0 c0 d2 d2 <d2> <d2> f.x g+0 if log:mambmb+mcmdmemfnxtxmgmg+ng+0mh",
  // strings, measured on A4H 2026-09-23 (probe classes of the same code in
  // $ZOSG_TMP_0130). SPLIT INTO fields: the last takes the rest, missing
  // pieces clear, a c field cut is sy-subrc 4, an empty string clears all
  ZCL_GOGEN_T_STRSPLIT: "more:a/b,c,d/0 fewer:a///0 trail:a/b//0 empty:a//b none://0 lead:/a resttrail:a/b,c, trunc:ab/d/4 trunc2:ab/cd/4 space:a//b str:[a]/[b]/[] self:p/q two:a/b",
  // REPLACE: POSIX leftmost-longest, empty regex matches replaced, SECTION,
  // $0 literal without REGEX, c pattern and WITH lose trailing blanks, a c
  // target cut is sy-subrc 2. The pair: a JS RegExp is leftmost-first, so
  // a|aX in aXbX takes a where A4H and Go take aX (longest:-bX); the JS
  // backend refuses nothing here and is wrong there, as FindStmt already is
  ZCL_GOGEN_T_STRREPL: {
    Go: "first:aXYcabc/0 miss:aXYcabc/4 rxall:a--a--/0 rxempty:-a-b-c-/0 rxstar:-a--c- groups:baabbaab longest:-bX rxmiss:4 sect:abca-c/0 sectoff:abca-ca-c sectlen:a-cabc dollar:a$0c cwith:ab ctrail:[a X] cten:a -/0 ctrunc:aXYZ/2 icase:---",
    JS: "first:aXYcabc/0 miss:aXYcabc/4 rxall:a--a--/0 rxempty:-a-b-c-/0 rxstar:-a--c- groups:baabbaab longest:-XbX rxmiss:4 sect:abca-c/0 sectoff:abca-ca-c sectlen:a-cabc dollar:a$0c cwith:ab ctrail:[a X] cten:a -/0 ctrunc:aXYZ/2 icase:---",
  },
  // repeat( ) replace( ): A4H's run, except its last line had sub = ' ',
  // which is empty there and raised CX_SY_STRG_PAR_VAL (see STREDGE); the
  // copy asks sub = 'b' with = '_ ' (A4H: a c WITH loses its blank too)
  ZCL_GOGEN_T_STRFN: "rep:ababab/[]/[  ]/[] r1:a-cabc r0:a-ca-c r2:abca-cabc rm1:abcabca-c r5:abcabc rq:a''b'' rx:a--a-- rxe:-a-b-c- rxg:baba rc:[a _]",
  // condense( ) shift_left( ) shift_right( ): del strips first, then runs of
  // from become the first character of to
  ZCL_GOGEN_T_STRCOND: "c:[a b] cd:[a-b-] cdel:[ a b ] cfrom:[a  b] cto:[ab] cc:[a b] cto2:[axb] cdel2:[x] sl:cde/[ab ]/x/bca sr:abc/[ ab]/x/cab slc:[ab]/[ab]//abc",
  // MOVE-CORRESPONDING: by name, converted, the rest and sy-subrc untouched.
  // A4H set sy-subrc = 7 before it and answered .../7; the subset refuses an
  // assignment to sy-subrc, so the copy sets 4 with a FIND that fails
  ZCL_GOGEN_T_STRMOVE: "[lon]/[42 ]/[AB]/keep/12/4",
  // to_mixed( ), c targets of REPLACE (searched with their blanks), regex
  // replacement text, ^ and $ per line, empty matches, SPLIT with c
  // separators (their blanks count), and what raises. A4H caught cx_root
  // and printed the class; the copy catches that class by name
  ZCL_GOGEN_T_STREDGE: "n1 m:HelloWorld/_a_b_/AbCd/abCd/ab_cdEf/a12bC lc:helloWorld cblank:[xxb]/0 cfull:[xxxb]/0 crx:[a-]/0 cdel:[a]/0 crx2:[-]/0 cfield:[ab--------]/0"
    + " n2 esc:$1[a]b amp:a..b find:0 repl:-a#-b dollar:a-#b- bb:- empty:[-]/0 firstempty:-abc/0 rxicase:a-a"
    + " n4 csep:[]/[b] c2sep:[a]/[b]/[] csrc:[a]/[b]/[] ctab:2 etab:1 stab:2 cvar:[ab x cd]/[] splitempty:abc//0"
    + " replfirstempty:-abc/0 repneg:CX_SY_STRG_PAR_VAL replfnempty:CX_SY_STRG_PAR_VAL"
    + " shiftneg:CX_SY_RANGE_OUT_OF_BOUNDS shiftbig:CX_SY_RANGE_OUT_OF_BOUNDS r:CX_SY_RANGE_OUT_OF_BOUNDS src5:CX_SY_RANGE_OUT_OF_BOUNDS slc3:abc"
    + " slc4:CX_SY_RANGE_OUT_OF_BOUNDS sectbig:CX_SY_RANGE_OUT_OF_BOUNDS sectok:a-c/0 sectlong:CX_SY_RANGE_OUT_OF_BOUNDS",
  // REPLACE ALL OCCURRENCES OF an empty pattern (' ', a c blank, is empty)
  // raises CX_SY_REPLACE_INFINITE_LOOP, which CATCH cx_dynamic_check and
  // CATCH cx_root take on A4H (probe ZCL_GOGEN_T_STRCR in $ZOSG_TMP_0131);
  // open-abap-core has no such class, so the front end holds its superclass
  // (RUNTIME_CX_SUPER). A4H ran this copy with a third TRY that caught
  // cx_sy_replace_infinite_loop by name (x3:loop); abaplint refuses a CATCH
  // naming a class it does not know, so that TRY is not in the copy
  ZCL_GOGEN_T_STRLOOP: "x1:dyn x2:root a b",
  // lines and dot, and condense( ) with c arguments, A4H 2026-09-23 (probe
  // ZCL_GOGEN_T_STRCR, $ZOSG_TMP_0131): ^ after \n, $ before \n and at the
  // end, . matches \r and \n, \f and \v end no line; a c del / from / to
  // loses its trailing blanks (space, ' ', a c(1) field of a blank are empty)
  ZCL_GOGEN_T_STRLINES: "n1:-a|-|-b n2:a-|b- n3:a-|-|b- dot:---- ff:4/0 vt:4 c1:[ xa bx ] c2:[ab] c3:[a  b] c4:[ a b ] c5:[a b] c7:[ a b ]",
  // not an A4H value: A4H answers f1:0 here ($ matches before the \r of a
  // CRLF, and not between \r and \n; a\n\rb has ^ after its \r, a\rb does
  // not). Neither Go's (?m) nor JS's m says that, so an anchored pattern on
  // a text with \r, U+2028 or U+2029 is NOT_COMPILED in both backends
  ZCL_GOGEN_T_STRCRLF: {Go: "ERROR NOT_COMPILED in FIND REGEX: ^ or $ in a text with a line end other than \\n is not measured: a$ at zcl_gogen_t_strcrlf.clas.abap:11",
    JS: "ERROR NOT_COMPILED in FIND REGEX: ^ or $ in a text with a line end other than \\n is not measured: a$"},
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
  // class-based exceptions (A4H, the exception classes local to the probe,
  // the same code otherwise): a CATCH by hierarchy with the attributes read
  // INTO, the first CATCH that fits, CLEANUP inner then outer then the
  // handler, no CLEANUP for one raised inside a CATCH of the same TRY,
  // get_text( ) of a class without a text, RAISE EXCEPTION obj hands over
  // the object itself (a handler's change stays in it), previous, cx_no_check
  // through a method without RAISING, an INTO not taken stays initial,
  // cx_root taking a raised object and a runtime one, a runtime exception
  // passing a CLEANUP. Not in the local copy: RAISE EXCEPTION of an initial
  // reference, which aborts on A4H ("Access using a 'ZERO' object reference
  // is not possible", CATCH cx_root does not take it), and a CATCH after one
  // of its superclass, which does not activate
  ZCL_GOGEN_T_RAISE: "h:7 first:sub clean:i1-ci-co-h3 incatch:ch text:[An exception was raised.] same:18 prev:18 nocheck again:19 untaken:initial root:[An exception was raised.] root:zerodivide rt:ch",
  // an exception that no TRY takes: the kernel looks for a handler before it
  // unwinds, finds none and dumps at the RAISE (UNCAUGHT_EXCEPTION, line 16),
  // and no CLEANUP on the way runs; the CLEANUP of the first part does run,
  // a handler being there. A4H 2026-09-23, $ZOSG_TMP_0118: the same code in
  // an RFC module (no handler above it) with each CLEANUP writing a committed
  // row; the rows of the handled part came, none of the other, the dump named
  // the RAISE. What the Go harness names is the stack of the first panic
  ZCL_GOGEN_T_UNCAUGHT: {Go: "ERROR UNCAUGHT_EXCEPTION ZCX_GOGEN_T_RNOCHK at zcl_gogen_t_uncaught.clas.abap:16", JS: "ERROR UNCAUGHT_EXCEPTION ZCX_GOGEN_T_RNOCHK"},
  // runs after it in the same process and reads the static its CLEANUPs
  // would have written to
  ZCL_GOGEN_T_UNCAUGHT_READ: "log:s-c-h",
  // generic data: ASSIGN COMPONENT read and written back (a lower-case name
  // is found, an unknown one is sy-subrc 4 and leaves the field symbol as it
  // was), LOOP over ANY TABLE writing through the field symbol, DESCRIBE
  // FIELD kinds (a structure with a string in it is v, a flat one u), GET
  // REFERENCE + ->* written, ASSIGN of an initial reference sy-subrc 4 with
  // the field symbol kept, IS SUPPLIED, CALL METHOD (class)=>m, a binding
  // that outlives a move into its structure, c fitting, i into a string,
  // CLEAR through generic data, a typed field symbol seen as generic data
  // (CLEAR and a whole move write the row, and the typed field symbol sees
  // it), a generic value read into a shorter c cut, CLEAR of a typed field
  // symbol clearing its row. The A4H class had the same source.
  ZCL_GOGEN_T_JSGENERIC: "comp:0/1/5/0/low/4/low lines:2 p11 q22 kinds:IFgCXDTvhl ref:0/3/42/4/asg/ini/set notini/ini sup:a-b-A+b-a-B+A+B+ dyn:<d1><7><noclass> flat:u moved:m9 m9 q22 fit:xy/5-/cleared:0 row:0 row:s3/0/s3 c2:xy clr:2/0/0",
  // COMMIT WORK / ROLLBACK WORK set sy-subrc 0 (A4H: from 7, with rows
  // written in between, sy-dbcnt left as it was). The JS emitter has no
  // database and refuses both rather than make them no-ops
  ZCL_GOGEN_T_LUW: {Go: "miss:4 rb:0 cw:0 cww:0", JS: "ERROR NOT_COMPILED in COMMIT / ROLLBACK WORK: the JS emitter has no database"},
  // database writes: both backends refuse honestly, because the relational
  // IR (tools/sqlscript-ir.mjs) has no insert / update / delete / merge node
  // yet. A4H answered, as "sy-subrc/sy-dbcnt" after each statement (i ->
  // string, hence the blank after each number):
  //   ins:0 /1  dup:4 /0  tabcx:0 /0  rows3  acc:4 /2  rows5  updmiss:4 /0
  //   upd:0 /1  set2:0 /2  set0:4 /0  updtab:4 /1  modins:0 /1  modupd:0 /1
  //   modtab:0 /2  delmiss:4 /0  del:0 /1  delw0:4 /0  delw2:0 /2
  //   deltab:4 /1  insm:0 /1  mandt001 insempty:0 /0  rows4  rb:0 /4  after0
  // (mandt001: A4H's logon client, the work area said 999). A second run
  // with sy-subrc = sy-dbcnt = 7 before INSERT FROM TABLE of A(dup) B C
  // A(dup) D gave "tabcx:7 /7": CX_SY_OPEN_SQL_DB, sy untouched, and B, C
  // and D written all the same; FROM TABLE with the same key twice wrote
  // one row and raised. That is the string this must turn into once the IR
  // has the nodes (with the local transpiler it is not: ANORMALIES
  // dbwrite-*).
  ZCL_GOGEN_T_DBW: {
    Go: "ERROR NOT_COMPILED in ZCL_GOGEN_T_DBW=>RUN (zcl_gogen_t_dbw.clas.abap:26): DELETE ZGOGEN_T_DBW: the relational IR has no delete node (relation delete not lowered) at zcl_gogen_t_dbw.clas.abap:26",
    JS: "ERROR NOT_COMPILED in ZCL_GOGEN_T_DBW=>RUN (zcl_gogen_t_dbw.clas.abap:26): DELETE ZGOGEN_T_DBW: the relational IR has no delete node (relation delete not lowered)"},
  ZCL_GOGEN_T_BOOM: {Go: "ERROR CX_SY_ZERODIVIDE in / at zcl_gogen_t_boom.clas.abap:9", JS: "ERROR CX_SY_ZERODIVIDE in /"},
};
const core = `${home}/.local/lars/open-abap-core/src`;
// sorted: zcl_gogen_t_uncaught_read reads what zcl_gogen_t_uncaught left
const objects = readdirSync(join(here, "testdata")).filter((f) => f.endsWith(".clas.abap")).map((f) => f.split(".")[0]).sort();
// the roots of the exception classes, and get_text( )'s helper, compiled
// out of open-abap-core as the gateway compiles them
const CORE = ["CX_ROOT", "CX_STATIC_CHECK", "CX_DYNAMIC_CHECK", "CX_NO_CHECK", "CL_MESSAGE_HELPER"];
const program = compileProgram({folders: [join(here, "testdata"), core], objects: [...objects, ...CORE]});
// the classes that carry a test: a static RUN of their own (the others are
// the classes those tests use)
objects.splice(0, objects.length, ...objects.filter((o) => program.classes.find((c) => c.name === o.toUpperCase())?.methods.some((m) => m.name === "RUN" && m.static)));
if (program.skipped.length) console.log(`not compiled: ${program.skipped.join("; ")}`);
const out = join(here, ".out", "semantics");
mkdirSync(out, {recursive: true});
const dir = join(here, "go", "cmd", "semantics");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "main.go"), `package main\n\nimport (\n\t"fmt"\n\t"runtime/debug"\n\t"strings"\n\n\t"osg/gogen/abap"\n)\n\n// abapLine is the first frame of the stack that is ABAP source: the stack\n// of the first panic when a TRY passed it on\nfunc abapLine(r any) string {\n\tst := string(debug.Stack())\n\tif w, ok := r.(*abap.Rethrown); ok {\n\t\tst = w.Stack\n\t}\n\tfor _, l := range strings.Split(st, "\\n") {\n\t\tl = strings.TrimSpace(l)\n\t\tif i := strings.Index(l, ".abap:"); i > 0 {\n\t\t\tif j := strings.IndexAny(l[i:], " +"); j > 0 {\n\t\t\t\tl = l[:i+j]\n\t\t\t}\n\t\t\treturn l[strings.LastIndex(l, "/")+1:]\n\t\t}\n\t}\n\treturn "?"\n}\n\nfunc main() {\n${objects.map((o) => `\tfunc() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tfmt.Printf("${o.toUpperCase()}\\tERROR %v at %s\\n", r, abapLine(r))\n\t\t\t}\n\t\t}()\n\t\tfmt.Printf("${o.toUpperCase()}\\t%s\\n", ${funcName(o.toUpperCase(), "RUN")}(&abap.Session{}))\n\t}()`).join("\n")}\n}\n`);
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
