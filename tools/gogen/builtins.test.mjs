import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {resolve, join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {emitJs} from "./emit-js.mjs";
import {ipow, boolx} from "./ipow-js.mjs";
import {AbapError, MulP, FToP} from "./js/abap.mjs";
import {builtins702} from "./builtin-audit.mjs";

function compile(body, declarations = "") {
 mkdirSync(resolve(".local"), {recursive:true});
 const dir = mkdtempSync(resolve(".local/builtin-test-"));
 try {
  writeFileSync(join(dir,"zcl_builtin_test.clas.abap"), `CLASS zcl_builtin_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION. CLASS-METHODS run RETURNING VALUE(rv) TYPE string. ENDCLASS.
 CLASS zcl_builtin_test IMPLEMENTATION. METHOD run. ${declarations} ${body} ENDMETHOD. ENDCLASS.\n`);
  return compileProgram({folders:[dir],objects:["ZCL_BUILTIN_TEST"],tolerant:true});
 } finally {rmSync(dir,{recursive:true,force:true});}
}

test("integer power boundaries and negative exponents", () => {
 assert.equal(ipow(0,0,"i",MulP,AbapError),1);
 assert.equal(ipow(-2,31,"i",MulP,AbapError),-2147483648);
 assert.equal(ipow(2n,62,"int8",MulP,AbapError),4611686018427387904n);
 for(const [base, exp,kind] of [[2,31,"i"],[2n,63,"int8"]]) {
  assert.throws(()=>ipow(base,exp,kind,MulP,AbapError),/CX_SY_ARITHMETIC_OVERFLOW/);
 }
 assert.equal(ipow(2,-1,"i",MulP,AbapError),1);
 assert.equal(ipow(-2,-1,"int8",MulP,AbapError),-1n);
 assert.equal(ipow(2,-1,"f",MulP,AbapError),0.5);
 assert.equal(ipow("2",-1,"p",MulP,AbapError,FToP),"0.5");
 assert.throws(()=>ipow(0,-1,"i",MulP,AbapError),/CX_SY_ARITHMETIC_OVERFLOW/);
 assert.equal(ipow("1.5",3,"p",MulP,AbapError),"3.375");
});
test("assignment and enclosing arithmetic choose ipow calculation type", () => {
 const p=compile("wide = 1 + ipow( base = 2 exp = 31 ). rv = |{ wide }|.","DATA wide TYPE int8.");
 assert.deepEqual(p.partial,[]);
 assert.match(emitGo(p),/hIntpower.Integer\(int64\(int32\(2\)\), int32\(31\)\)/);
 const simple=compile("wide = ipow( base = 2 exp = 31 ). rv = |{ wide }|.","DATA wide TYPE int8.");
 assert.match(emitGo(simple),/hIntpower.Integer\(int64\(int32\(2\)\), int32\(31\)\)/);
});
test("boolx bridge respects strings, comments, nested logical expressions and source lines", () => {
 const p=compile("rv = `boolx( bool = 1 = 2 bit = 9 )`.\n bytes = boolx( bool = ( 1 = 1 AND 2 = 2 ) AND bit = 1 bit = -9 ). rv = |{ bytes }|.","DATA bytes TYPE xstring. DATA bit TYPE i VALUE 1.");
 assert.deepEqual(p.partial,[]);
 assert.equal(p.broken.length,0);
 assert.match(emitGo(p),/hIntpower.Boolx/);
 assert.match(emitJs(p),/boolx\(/);
 assert.equal(boolx("X",-9,AbapError),"\xff\x80");
 assert.equal(boolx("X",9,AbapError),"\x00\x80");
 assert.equal(boolx(" ",9,AbapError),"");
});
test("7.02 audit uses release gates", () => {
 const names=builtins702().map(([name])=>name);
 assert.ok(names.includes("BOOLX"));
 assert.ok(names.includes("BOOLC"));
 assert.ok(!names.includes("IPOW"));
 assert.ok(!names.includes("XSDBOOL"));
});
