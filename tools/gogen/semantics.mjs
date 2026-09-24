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
  // SHIFT s RIGHT DELETING TRAILING mask on a string: the length stays, the
  // masked tail goes and blanks come in on the left; a blank stops it
  // (A4H 2026-09-23, $batch parts end their body this way)
  // a generic EXPORTING (TYPE any) is the caller's variable, by reference:
  // not cleared on entry, written in place; MOVE-CORRESPONDING into it
  // converts component by component; CLEAR clears the caller's structure
  // (A4H 2026-09-23; the entry provider's read_entry_data does all three)
  ZCL_GOGEN_T_GENEXP: "set:5/x/keep corr:42/hel/keep clear:42/hel/[]",
  // not A4H values: standard ABAP the Travels path needed (review of
  // ultra/travels). Two flat structures of one technical type move by
  // position, names aside; DEFAULT names a constant of the class, bare or
  // as cls=>c. The conversions are open-abap's kernel code as Go host
  // functions: UTF-8 and 4103 (UTF-16LE) there and back, N cuts the text
  // before it is encoded; the JS emitter has no host function for them and
  // refuses
  ZCL_GOGEN_T_TRAVMISC: "move:pq/42/rst back:pq/5/rst dflt:dx/7 v/7 dx/1",
  ZCL_GOGEN_T_TRAVCONV: {Go: "u8:61C3A4E282AC>same u16:6100E400AC20>same cut8:6162 cut16:610062006300",
    JS: "ERROR NOT_COMPILED in Native_CONV_OUT_CONVERT: a host function of the Go runtime"},
  ZCL_GOGEN_T_SHIFT: "1:4[__ab] 2:4[_ab_] 3:2[ab] 4:0[] 5:4[_aNb] 6:1[_] 7:4[abN_] 8:5[___ab]",
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
  // database writes through the write nodes of the relational IR
  // (tools/ir-writes.mjs, go/abap/dbwrite.go). A4H answered, as
  // "sy-subrc/sy-dbcnt" after each statement (i -> string, hence the blank
  // after each number):
  //   ins:0 /1  dup:4 /0  tabcx:0 /0  rows3  acc:4 /2  rows5  updmiss:4 /0
  //   upd:0 /1  set2:0 /2  set0:4 /0  updtab:4 /1  modins:0 /1  modupd:0 /1
  //   modtab:0 /2  delmiss:4 /0  del:0 /1  delw0:4 /0  delw2:0 /2
  //   deltab:4 /1  insm:0 /1  mandt001 insempty:0 /0  rows4  rb:0 /4  after0
  // A second run with sy-subrc = sy-dbcnt = 7 before INSERT FROM TABLE of
  // A(dup) B C A(dup) D gave "tabcx:7 /7": CX_SY_OPEN_SQL_DB, sy untouched,
  // B, C and D written all the same. Go answers every statement the same;
  // the string differs in two places, neither a database rule:
  //   - mandt123: the logon client, which is 001 on A4H and 123 here (the
  //     transpiler runtime's constant, abap.Mandt); the work area said 999;
  //   - tabcx:4: the INSERT leaves sy as it was (the rule above), and what
  //     it was differs: on A4H the call note( ) before it set sy-subrc to 0
  //     (ZCL_GOGEN_T_CNT, $ZOSG_TMP_0220, 2026-09-23: "call:0" after a READ
  //     that missed), and a method call in the subset leaves sy-subrc alone
  //     (ZCL_GOGEN_T_CALLSUBRC below pins that gap on its own).
  // The JS backend has no database and refuses (ANORMALIES dbwrite-* are
  // the transpiler runtime's answers, not these)
  ZCL_GOGEN_T_DBW: {
    Go: "ins:0 /1  dup:4 /0  tabcx:4 /0  rows3  acc:4 /2  rows5  updmiss:4 /0  upd:0 /1  set2:0 /2  set0:4 /0  updtab:4 /1  modins:0 /1  modupd:0 /1  modtab:0 /2  delmiss:4 /0  del:0 /1  delw0:4 /0  delw2:0 /2  deltab:4 /1  insm:0 /1  mandt123 insempty:0 /0  rows4  rb:0 /4  after0 ",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // sy after SELECT (A4H, ZCL_GOGEN_T_CNT, the same statements over a
  // system table of two rows: "app:4 ... cnt0:4/0/0 cnt:0/2/2 tab:0/2/2
  // tab0:4/0/0 single:0/1 single0:4/0"); here three rows, and two ranges:
  // I CP 'A*' without E EQ 'AB', and a LOW longer than the column, which is
  // CX_SY_OPEN_SQL_DATA_ERROR under CX_SY_OPEN_SQL_ERROR
  ZCL_GOGEN_T_SELCNT: {Go: "app:4 cnt0:4/0/0 cnt:0/3/3 tab:0/3/3 tab0:4/0/0 single:0/1 single0:4/0 rng:1,A long:caught",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // a string or a c longer than the column, compared in WHERE and written
  // by SET: when it fits after its trailing blanks it is the c value (not
  // an A4H value, the Go port's rule); when it does not, NOT_COMPILED at
  // the statement rather than a value cut to the column, which would have
  // deleted the row 'ABCDEFGHIJ' here (review of ultra/dbport)
  ZCL_GOGEN_T_HOSTFIT: {Go: "str:1 c20:1 set:0/1 ten:1 del:0/1",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  ZCL_GOGEN_T_HOSTLONG: {Go: "ERROR NOT_COMPILED in Open SQL host value: \"ABCDEFGHIJK\" is longer than the column's 10 characters (CX_SY_OPEN_SQL_DATA_ERROR for a range on A4H; a plain comparison or SET is not measured) at zcl_gogen_t_hostlong.clas.abap:19",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // sy-subrc after a method call without EXCEPTIONS: A4H "call:0"
  // (ZCL_GOGEN_T_CNT, $ZOSG_TMP_0220), the subset leaves it as the READ
  // before set it, in both emitters. Pinned to the wrong value on purpose,
  // a known gap of call emission (README, "What this does not show"); it
  // is also why ZCL_GOGEN_T_DBW answers tabcx:4 where A4H answered tabcx:0
  ZCL_GOGEN_T_CALLSUBRC: {Go: "read:4 call:4", JS: "read:4 call:4"},
  // an OPTION in lower case: a dump CATCH cx_root does not take (A4H,
  // a4h-ranges.json), never "no restriction"
  ZCL_GOGEN_T_SELDUMP: {Go: "ERROR SAPSQL_IN_ITAB_ILLEGAL_OPTION in range OPTION \"cp\": SAPSQL_IN_ITAB_ILLEGAL_OPTION, an uncatchable dump on A4H at zcl_gogen_t_seldump.clas.abap:23",
    JS: "ERROR NOT_COMPILED in SELECT ... FROM ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // d and t (A4H 2026-09-23, two probes joined into one class): c -> d keeps
  // 'ABC'; d - d counts days in calculation type i (( d / 7 ) * 7 rounds in
  // between); an i template expression overflows at 20713 * 86400 * 1000,
  // which OSG's ZCL_STG_JSON=>EPOCH_MS computes (ANORMALIES); a t read by
  // offset; d -> i is days since 00010101, Julian before 15821015, 0 for a
  // date that is not one
  ZCL_GOGEN_T_RQDATE: "a[ABC];b20713,-719164;c739879;dOVF;k12,34;00000000=0;00010101=0;00010102=1;15821004=577736;15821015=577737;19700101=719164;20000229=730180;20260917=739877;99991231=3652060;20260230=0;ABC=0;1900022=0;",
  // SPLIT ... INTO fields (A4H 2026-09-23): the last field takes the rest,
  // a field without a piece is cleared, a piece cut to fit a c sets sy-subrc 4
  ZCL_GOGEN_T_RQSPLIT: "e[Seats][desc]0;f[a][ b]0;g[a][]0;h[a][b c]0;i[abc][gh]4;j[x][yyy]4",
  // not an A4H value (the probe could not be created on A4H in this
  // session): the language rule that a d, t or n field is initial at its
  // typed zero, and a structure when every component is. Go gave
  // a---X- c---X dX- e-- before (a structure field starts as ""), JS
  // aXXX-X cXXX- dX- e-- (a structure compared with a fresh one by ===)
  ZCL_GOGEN_T_RQINIT: "aXXXXX b-- cXXXX dXX eX- fX",
  // x / xstring into a string or a c, and i into x(1), A4H 2026-09-23
  // ($ZOSG_TMP_0022; the copy leaves out the probe's TRY around hex1( -1 ),
  // which raised nothing there, and sets x'0A0B' as 2571 and x'DEADBEEF' as a
  // constant: c -> x is not in the subset): the demo's outro stopped on INT_TO_HEX
  // FIND IN SECTION [OFFSET] [LENGTH] OF a string and FIND [REGEX] IN TABLE
  // of strings (A4H 2026-09-24, $ZOSG_TMP_0041, the same code with CATCH
  // cx_root printing the class): MATCH OFFSET counts from the start of the
  // string; an offset at the end is an empty section; offset < 0, offset past
  // the end, a section past the end and LENGTH < -1 raise; LENGTH -1 is the
  // rest; an empty substring is found at the start (x1, x2: plain FIND too);
  // IN TABLE goes row by row, first row with a match, MATCH LINE from 1
  ZCL_GOGEN_T_FINDSEC: "a:0/5/1 b:0/2/1 c:4/99/98 d:4/99/98 e:\\CLASS=CX_SY_RANGE_OUT_OF_BOUNDS f:\\CLASS=CX_SY_RANGE_OUT_OF_BOUNDS g:4/99/98 h:0/5/1 i:4/99/98 j:0/2/1 k:\\CLASS=CX_SY_RANGE_OUT_OF_BOUNDS l:0/2/1 m:4/99/98 n:4/99/98 p:0/1/0 p2:4/99/98 p3:0/6/1 q:0/SUM/2/2 r:0/max/3/1 s:4/keep/99 s2:0/a/ u:4/keep/99 v:4/99 w:0/2/1 w2:0/2/1"
    + " x1:0/0/0 x2:0/0/0 l3:\\CLASS=CX_SY_RANGE_OUT_OF_BOUNDS l4:0/5/1 l5:0/7/0 l6:0/7/0",
  // a c literal of digits into p DECIMALS 0 (CONSTANTS ... TYPE timestamp
  // VALUE '...', leading zeros dropped) and p compared with p and with i
  // (A4H 2026-09-24, $ZOSG_TMP_0041, the same code): the SADL MPCs' dates
  ZCL_GOGEN_T_PCMP: "c:20260912010000 z:12 v:20260912010001 gt lt eq ne zi ilt neg init",
  // CREATE DATA ... TYPE <static type> / TYPE STANDARD TABLE OF <ddic
  // table>: a new initial value each time, a reference kept apart from the
  // next CREATE (A4H 2026-09-24, $ZOSG_TMP_0041, the same code)
  ZCL_GOGEN_T_CRDATA: "t000:0 tt:1 fresh:0 kept:1 n0:0 n1:42 n2:0",
  // DELETE / READ TABLE ... INDEX on a generic STANDARD TABLE (A4H
  // 2026-09-24, $ZOSG_TMP_0041, the same code): as for a typed table, and a
  // move into the generic table copies (orig keeps its four rows)
  ZCL_GOGEN_T_GENIDX: "d1:0/3 d9:4/3 r2:0/2/3 r7:4 kept:30 2 30 orig:4",
  // SELECT from a DDIC view with MANDT: read as a client-dependent table (not
  // an A4H value: the Open SQL rule, pinned so the view path stays compiled);
  // a view over a client-dependent table without MANDT is refused
  ZCL_GOGEN_T_SELVIEW: {Go: "0/1 B:2", JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // dynamic Open SQL (go/abap selectdyn.go): a static table and one named
  // at run time, a CDS name through its SQL view, GROUP BY with SUM, an
  // empty condition, no row. The rows are ordinary Open SQL, not measured;
  // '1 = 1' raising CX_SY_DYNAMIC_OSQL_SEMANTICS and an operator without
  // blanks CX_SY_DYNAMIC_OSQL_SYNTAX are A4H's (docs/osql-where.md, #47)
  ZCL_GOGEN_T_DSEL: {Go: "static:0/2/CB byname:0/2/AC cds:0/2,B2,C3 empty:0/3 none:4/0/0 sum:0/2,C3,A1 one:semantics syntax:caught",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // a view hiding the client, read by name: refused at run time as the
  // static read is refused at build time
  ZCL_GOGEN_T_DSELX: {
    Go: "ERROR NOT_COMPILED in SELECT ... FROM (ZGOGEN_T_DBWN): ZGOGEN_T_DBWN is a view over the client-dependent ZGOGEN_T_DBW without MANDT: a system reads the logon client's rows, this one would read every client's at zcl_gogen_t_dselx.clas.abap:18",
    JS: "ERROR NOT_COMPILED in CREATE DATA TYPE (name): the JS backend has no table registry (the Go host has)"},
  // UNASSIGN of a generic and a typed field symbol (the language rule, not
  // measured): not assigned after, the variable and the row untouched; SE16's
  // ROWS_OF needs it
  ZCL_GOGEN_T_UNASSIGN: "XX/  /7/1",
  // a string into an n through generic data: digits that fit, zero-padded
  // (the NUMC rule A4H showed for a WHERE literal, docs/osql-where.md); a
  // letter is not measured and refused. The SADL DPC's synthetic keys do the
  // first (the aggregated flight cube's FACTID)
  ZCL_GOGEN_T_MOVEN: "004711/012345",
  ZCL_GOGEN_T_MOVENX: {Go: "ERROR NOT_COMPILED in move: a value of type kind g into generic data of type kind N at zcl_gogen_t_movenx.clas.abap:22",
    JS: "ERROR NOT_COMPILED in move: a value of type kind g into generic data of type kind N"},
  ZCL_GOGEN_T_SELVIEWN: {
    Go: "ERROR NOT_COMPILED in ZCL_GOGEN_T_SELVIEWN=>RUN (zcl_gogen_t_selviewn.clas.abap:11): SELECT FROM ZGOGEN_T_DBWN: a view over the client-dependent ZGOGEN_T_DBW without MANDT at zcl_gogen_t_selviewn.clas.abap:11",
    JS: "ERROR NOT_COMPILED in ZCL_GOGEN_T_SELVIEWN=>RUN (zcl_gogen_t_selviewn.clas.abap:11): SELECT FROM ZGOGEN_T_DBWN: a view over the client-dependent ZGOGEN_T_DBW without MANDT"},
  ZCL_GOGEN_T_X2S: "a:AB b:00 c:2C d:FF e:[0A0B] f:[DEADBEEF] g:[] h:[0A0] i:FF",
  // SMW0 through the host: WWWDATA_IMPORT and SCMS_BINARY_TO_XSTRING, A4H
  // 2026-09-23 ($ZOSG_TMP_0230) answered this string over an object of its
  // own; the copy reads testdata/media (the Go host's media directory). The
  // JS emitter has no host function modules and refuses the call
  ZCL_GOGEN_T_W3MI: {Go: "miss:2/1 rel:1/0 hit:0 rowsdiff:0 pad:00/255 exact:0/X five:5/X zero:0 over:0/0 neg:0/0 empty:0/0",
    JS: "ERROR NOT_COMPILED in CALL FUNCTION 'WWWDATA_IMPORT': the JS emitter has no host function modules"},
  // p DECIMALS 0: calculation type p (OSG's EPOCH_MS, A4H 2026-09-23 in
  // ANORMALIES epoch-ms-overflow: the i operands do not overflow when the
  // target is p); a move that does not fit is a conversion overflow (ABAP
  // documentation)
  ZCL_GOGEN_T_PACKED: "ms:1728003600000 neg:-16400 small:conv max:999 lit:20260912000000",
  // SELECT ... ENDSELECT (A4H 2026-09-24, this class over ZGOGEN_T_DBW in
  // $ZOSG_TMP_0195): sy-dbcnt counts the passes, sy-subrc 0 at each pass and
  // after the loop (EXIT too) when a row was read, 4/0 and the work area
  // kept when none was. The transpiler reads the rows and loops without
  // touching sy (ANORMALIES select-loop-sy)
  // sorted secondary keys (ultra/json, /UI2/CL_JSON's parser): A4H
  // 2026-09-24, ZCL_GOGEN_T_SECKEY in $ZOSG_TMP_0420. Equal keys come
  // newest first, a key changed through a field symbol keeps the row's
  // place, sy-tabix is the key's position; a READ that misses leaves the
  // target alone, sy-tabix where the value would go, sy-subrc 4 inside and
  // 8 past the end (ANORMALIES secondary-key-duplicates: the transpiler
  // runtime answers otherwise)
  ZCL_GOGEN_T_SECKEY: "w:5/3,3/4,1/5, after:5 app:0/3,5/4,3/5,1/6, mod:4/1,3/2,2/3, all:0/1,5/2,4/3,3/4,2/5,1/6, ru:0/3/4 rp:0/0/4 rmiss:8/0/7 rlow:4/0/1 rfs:0/4/3",
  // the generic statements of /UI2/CL_JSON's deserializer (ultra/json), A4H
  // 2026-09-24 (the same code in ZCL_GOGEN_T_SECKEY's probe include): INSERT
  // INTO TABLE of a generic standard table appends and leaves sy-tabix alone,
  // CREATE DATA LIKE LINE OF <any table> is a new initial row, CREATE DATA
  // of a typed reference a new empty table; a variable may be called value;
  // two references are equal when they point at one object
  ZCL_GOGEN_T_JSONGEN: "ins:0/1/2 new:0 value:3 lt:2 row2:7/x cd:0 ins:0/2/1 new:0 after:1 eq ne",
  // LOOP AT ref->* ASSIGNING <typed>: A4H the same day; the JS emitter binds
  // no typed field symbol over generic rows (as ASSIGN ref->* TO <typed>)
  ZCL_GOGEN_T_DREFLOOP: {Go: "1:1/a,2:2/b,10,20,",
    JS: "ERROR NOT_COMPILED in LOOP AT lr->* ASSIGNING <ls>.: a typed field symbol over generic rows is Go-only"},
  // cl_abap_typedescr=>describe_by_data (ultra/json, a host function in Go,
  // emit-go nativeRttiData): A4H 2026-09-24 ran this class under the name
  // ZCL_GOGEN_T_SECKEY (the name in the absolute names replaced). What the
  // Go host leaves out is not printed: the technical names of unnamed c, n,
  // x, p (\TYPE=%_T...), a structure's length. The JS emitter has no RTTI
  ZCL_GOGEN_T_RTTI: {Go: "c3:E/C/0/6/3 n4:E/N/0/8/4 x2:E/X/0/2/4 d:E/D/0/16/\\TYPE=D/D//8 t:E/T/0/12/\\TYPE=T/T//6 f:E/F/0/8/\\TYPE=F/F//24 i:E/I/0/4/\\TYPE=I/I//11 i8:E/8/0/8/\\TYPE=INT8/INT8//20 p:E/P/2/8/17 b:E/C/0/2/\\TYPE-POOL=ABAP\\TYPE=ABAP_BOOL/ABAP_BOOL//1 s:E/g/0/8/\\TYPE=STRING/STRING//0 xs:E/y/0/8/\\TYPE=XSTRING/XSTRING//0 flat:S/u/0/\\CLASS=ZCL_GOGEN_T_RTTI\\TYPE=TY_FLAT/TY_FLAT/ deep:S/v/0/\\CLASS=ZCL_GOGEN_T_RTTI\\TYPE=TY_DEEP/TY_DEEP/ comps:S=E,XS=E,FL=S,TB=T, line:\\CLASS=ZCL_GOGEN_T_RTTI\\TYPE=TY_FLAT tk:S uk: same",
    JS: "ERROR NOT_COMPILED in Native_DESCRIBE_BY_DATA: a host function of the Go runtime"},
  // open-abap-core's /UI2/CL_JSON=>DESERIALIZE end to end (ultra/json): not
  // an A4H value, a system has its own /UI2/CL_JSON. What the pieces give
  // that were measured there (the parser's members through a non-unique
  // sorted key come newest first, so an array fills its table in reverse;
  // ZCL_GOGEN_T_SECKEY), where the Node host answers
  // "osg/42/X//3:1X,2,3, bad:caught" (ANORMALIES secondary-key-duplicates).
  // A missing member is cleared, an unknown one ignored. The JS emitter
  // has neither JSON.parse nor RTTI as host functions
  ZCL_GOGEN_T_JSONDES: {Go: "osg/42/X//3:3,2,1X, bad:caught",
    JS: "ERROR NOT_COMPILED in Native_CONV_OUT_CONVERT: a host function of the Go runtime"},
  ZCL_GOGEN_T_SELLOOP: {Go: "n:2 in:1/0,2/0, after:0/2 exit:0/1/A exitmiss:0/1 none:4/0/QQQ cont:0/2/2 corr:5/A elem:A/2 exit2:0/2",
    JS: "ERROR NOT_COMPILED in DELETE ZGOGEN_T_DBW: the JS backend has no database (the Go host has SQLite)"},
  // not an A4H value (A4H has no destination AMDP and says HDB / 758): parity
  // with OSG on Node without HANA, CX_SY_DYN_CALL_ILLEGAL_FUNC raised before
  // any parameter is passed; sy-dbsys the database client's name, sy-saprl
  // the transpiler runtime's constant (ultra/gaps, the AMDP sandbox page)
  ZCL_GOGEN_T_AMDPDEST: "illegal_func out:[] db:[sqlite] rel:[OPEN]",
  // MODIFY itab FROM wa INDEX n = MODIFY itab INDEX n FROM wa (A4H
  // 2026-09-24, $ZOSG_TMP_0195): sy-subrc 0 / 4, sy-tabix untouched (both
  // emitters set it to n before)
  ZCL_GOGEN_T_MODFROM: "a:0/2 b:0/2 c:4 A1 B20 X30",
  // packed numbers with decimals (A4H 2026-09-24, $ZOSG_TMP_0270, each
  // class the same source; go/abap packed.go has the rules). Conversions:
  // c/string -> p (a sign behind or in front, '- 1', '.5', blanks only 0;
  // exponent, comma, inner blank NN; commercial rounding; a move that does
  // not fit CO), f -> p through its seventeen significant digits (2.345 ->
  // 2.35 but 2.675 -> 2.67), i/int8 -> p, p -> p rounded, p -> i/int8
  // rounded, p -> f, p -> c right aligned with a sign place and '*' when
  // short, p -> string with a sign place, p -> n rounded and unsigned
  ZCL_GOGEN_T_PDCONV: "c:1.24,-1.24,1.23,12.50,-12.50,3.00,0.00,0.50,5.00,0.00,NN,NN,NN,999.99,CO,CO,NN,-1.00,0.00,-0.01 s:1.24,-7.50,0.00,NN,2.50,NN f:2.35,2.36,-2.35,0.13,-0.13,1.00,CO,CO,0.00,0.00,CO,2.67 i:7.00,-7.00,CO,5000000000.00 pp:1.26,-1.26,1.25,3,-3,2,CO,999.99 pi:3,-3,2,CO,-3 pf:0.10000000000000001,-2.6749999999999998 pc:[   1.50][   1.50-][   0.00][*67] ps:[1.50 ][1.50-][42 ][42-] pn:0013",
  // calculation type p: the target counts (7 / 2 into p is 4, -7 / 2 is
  // -4), a c or string operand makes it p ('7' / 2 * 2 into i is 7), p
  // ahead of int8; / keeps 31 significant digits, + - * are exact; DIV/MOD
  // as for i; an arithmetic result that does not fit is AO, 63 integer
  // digits in between are allowed; a string compared with an i is an i
  // ('-0.4' < 0 is false)
  ZCL_GOGEN_T_PDCALC: "mul:1.56,1.82,-1.95 div:0.33,0.67,-0.67,4,-4,3,2,1.00,3.50 prec:0.33333333333333,0.66666666666667,1.00000000000000,33333333333333333333333333333,66666666666666666666666666667,142857142857142857143,23333333333333333333333333 dm:3.00,1.50,-3.00,1.50,-4.00,0.50,4.00,0.50,0.30,-3,1,648398213,999999901 z:ZD,0.00,ZD,ZD ov:AO,9999999999999999999999999999999,AO,AO,AO,AO ch:7,20000,0,-2,3.75,4,8,ge,eq f:0.30,2.67 i8:15000000000,1666666666.67 neg:-1.25 sum:1.00",
  // templates (the field's decimals, DECIMALS = rounds, NUMBER = RAW is
  // plain), comparisons of p with p, i, c, string and f, abs( ) frac( )
  // keep the type, ceil( ) floor( ) trunc( ) have no decimals, p through
  // generic data (DESCRIBE FIELD P, move into a string, template, IS
  // INITIAL, a c and a p written through a field symbol)
  ZCL_GOGEN_T_PDFMT: "t:0.00,0,0.00000000000000,1.50,-1.50,0.005,-0.05,-42,0.33333333333333 d:1.3,1.250,1,-1.3,3,42.00 n:1.50,[    1.50],-1.50 c:abcdefghij fn:1.50,-1,-2,-1,-0.50,-1,1.5,-0.5 g:P/-1.50/[1.50-],P/0.00/[0.00 ]/ini,P/42/[42 ],3.14,3.140",
  // p -> c too short, and the precision of intermediate results: 31
  // significant digits after a division (0.667 at 28 integer digits), exact
  // products (1e-14 cubed), 63 integer digits and not 64. A4H ran this
  // class with a last line of p arithmetic in a template, now
  // ZCL_GOGEN_T_PDTPL / _PDTPLM
  ZCL_GOGEN_T_PDPREC: "c:[1.50][1.50][1.50-][*50-][*0-][12345.67][12345.67][*7-][*345.67-] d:0.66700000000000,0.66700000000000,0.66666666666667,0.66666666666667,0.00000000000001,0.00000000000001,1234567890.12345678901000,0.33333333333333 g:9999999999999999999999999999999,9999999999999999999999999999999,AO",
  // a comparison with arithmetic takes the calculation type of both sides
  // (a string inside arithmetic: p, so i * 86400 * 1000 does not
  // overflow); a string alone against an i is an i; p -> n; ceil( ) and
  // floor( ) into p(8,1). A4H refuses `arithmetic > string` itself ("An
  // arithmetic expression cannot be compared with the non-numeric
  // operand"), and so does the front end
  ZCL_GOGEN_T_PDCMP: "a:gt b:ne c:eq d:gt e:eq n:0013,2346 f:-1.0,-2.0",
  // p arithmetic in a template: + - print the most decimals of their
  // operands. A4H answered "t:2.25,0.75,-1.25,2.500" for both classes in
  // one: 1.25 * 2 prints 2.500 and 1.25 * 1.25 printed 1.56250, a rule
  // not pinned down by two points, so * and / in a template are refused
  ZCL_GOGEN_T_PDTPL: "t:2.25,0.75,-1.25",
  ZCL_GOGEN_T_PDTPLM: {Go: "ERROR NOT_COMPILED in ZCL_GOGEN_T_PDTPLM=>RUN (zcl_gogen_t_pdtplm.clas.abap:10): an arithmetic expression of type p with * or / in a string template: its decimals are not measured at zcl_gogen_t_pdtplm.clas.abap:10",
    JS: "ERROR NOT_COMPILED in ZCL_GOGEN_T_PDTPLM=>RUN (zcl_gogen_t_pdtplm.clas.abap:10): an arithmetic expression of type p with * or / in a string template: its decimals are not measured"},
  // CREATE DATA ... TYPE [STANDARD TABLE OF] (name) through the table
  // registry (A4H 2026-09-24, $ZOSG_TMP_0270, the same code): a new initial
  // table / row, APPEND of a generic row to it, the name in any case, an
  // unknown name CX_SY_CREATE_DATA_ERROR with the reference kept. The JS
  // emitter has no registry and refuses
  ZCL_GOGEN_T_CRDYN: {Go: "a:0/h b:u/0[] c:2 lower:ok unknown:err kept:0",
    JS: "ERROR NOT_COMPILED in CREATE DATA TYPE (name): the JS backend has no table registry (the Go host has)"},
  ZCL_GOGEN_T_BOOM: {Go: "ERROR CX_SY_ZERODIVIDE in / at zcl_gogen_t_boom.clas.abap:9", JS: "ERROR CX_SY_ZERODIVIDE in /"},
};
const core = `${home}/.local/lars/open-abap-core/src`;
// sorted: zcl_gogen_t_uncaught_read reads what zcl_gogen_t_uncaught left
const objects = readdirSync(join(here, "testdata")).filter((f) => f.endsWith(".clas.abap")).map((f) => f.split(".")[0]).sort();
// the roots of the exception classes, and get_text( )'s helper, compiled
// out of open-abap-core as the gateway compiles them
// and RTTI (ultra/json: describe_by_data, ZCL_GOGEN_T_RTTI)
const CORE = ["CX_ROOT", "CX_STATIC_CHECK", "CX_DYNAMIC_CHECK", "CX_NO_CHECK", "CL_MESSAGE_HELPER", "CL_ABAP_CONV_OUT_CE", "CL_ABAP_CONV_IN_CE",
  "CL_ABAP_TYPEDESCR", "CL_ABAP_DATADESCR", "CL_ABAP_ELEMDESCR", "CL_ABAP_COMPLEXDESCR", "CL_ABAP_STRUCTDESCR", "CL_ABAP_TABLEDESCR", "CL_ABAP_REFDESCR", "CL_ABAP_OBJECTDESCR", "CL_ABAP_CLASSDESCR", "CL_ABAP_INTFDESCR",
  // and open-abap-core's JSON reader (ZCL_GOGEN_T_JSONDES)
  "/UI2/CL_JSON", "CL_SXML_STRING_READER", "CX_SXML_PARSE_ERROR", "CX_SXML_ERROR", "CL_ABAP_CODEPAGE"];
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
// the database of the Go harness: the transpiler's CREATE TABLEs for this
// registry (zgogen_t_dbw among them), no rows; each RUN is one dialog step
// the same entry gateway.mjs builds its database script from: a module the
// transpiler does not export, path read off @abaplint/transpiler 2.13.89;
// a layout change there breaks both, loudly (the import fails)
const {DatabaseSetup} = await import(`${home}/node_modules/@abaplint/transpiler/build/src/db/index.js`);
writeFileSync(join(dir, "zz_db.json"), JSON.stringify(new DatabaseSetup(program.reg).run().schemas.sqlite));
writeFileSync(join(dir, "main.go"), `package main\n\nimport (\n\t_ "embed"\n\t"fmt"\n\t"runtime/debug"\n\t"strings"\n\n\t"osg/gogen/abap"\n)\n\n//go:embed zz_db.json\nvar dbScript []byte\n\n// abapLine is the first frame of the stack that is ABAP source: the stack\n// of the first panic when a TRY passed it on\nfunc abapLine(r any) string {\n\tst := string(debug.Stack())\n\tif w, ok := r.(*abap.Rethrown); ok {\n\t\tst = w.Stack\n\t}\n\tfor _, l := range strings.Split(st, "\\n") {\n\t\tl = strings.TrimSpace(l)\n\t\tif i := strings.Index(l, ".abap:"); i > 0 {\n\t\t\tif j := strings.IndexAny(l[i:], " +"); j > 0 {\n\t\t\t\tl = l[:i+j]\n\t\t\t}\n\t\t\treturn l[strings.LastIndex(l, "/")+1:]\n\t\t}\n\t}\n\treturn "?"\n}\n\nfunc main() {\n\tif err := abap.OpenDB(dbScript); err != nil {\n\t\tpanic(err)\n\t}\n\tif err := abap.SetMediaDir(${JSON.stringify(join(here, "testdata", "media"))}); err != nil {\n\t\tpanic(err)\n\t}\n${objects.map((o) => `\tfunc() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tfmt.Printf("${o.toUpperCase()}\\tERROR %v at %s\\n", r, abapLine(r))\n\t\t\t}\n\t\t}()\n\t\tvar out string\n\t\tabap.DialogStep(func() { out = ${funcName(o.toUpperCase(), "RUN")}(&abap.Session{}) })\n\t\tfmt.Printf("${o.toUpperCase()}\\t%s\\n", out)\n\t}()`).join("\n")}\n}\n`);
execFileSync("gofmt", ["-w", dir]);
const goOut = execFileSync("go", ["run", "./cmd/semantics"], {cwd: join(here, "go")}).toString();
writeFileSync(join(out, "t.mjs"), emitJs(program));
copyFileSync(join(here, "js", "abap.mjs"), join(out, "abap.mjs"));
const m = await import(pathToFileURL(join(out, "t.mjs")).href);
let bad = 0;
for (const line of goOut.trim().split("\n")) {
  const [cls, go] = line.split("\t");
  let js;
  try { js = m[cls].RUN({sy: {index: 0, tabix: 0, subrc: 0, dbcnt: 0}}); } catch (e) { js = `ERROR ${e.message}`; }
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
