import {test} from "node:test";
import assert from "node:assert/strict";
import {emitPackedInt8, emitPackedComparison} from "./emit-int8.mjs";
const P = {k: "p", calc: true}, I8 = {k: "int8"};
const variable = {e: "var", name: "a", type: I8};
const operand = {e: "conv", kind: "i2pc", x: variable, from: I8, type: P};
const literal = (value) => ({e: "str", value, type: P});
const binary = (op, l = operand, r = literal("4294967296")) => ({e: "bin", op, l, r, type: P});
const convert = (x) => ({e: "conv", kind: "p2i8", x, arith: true, type: I8});
const render = (e) => e === variable ? "a" : "packedSlow";
const emit = (x) => emitPackedInt8(convert(x), render, (h) => h);

test("integral packed arithmetic lowers without formatting or math/big", () => {
 for (const [op, method] of [["+","AddI8"],["-","SubI8"],["*","MulI8"],["/","DivI8"],["DIV","DivIntI8"],["MOD","ModI8"]])
  assert.equal(emit(binary(op)), `abap.${method}(int64(a), int64(4294967296))`);
 assert.equal(emit(literal("-9223372036854775808")), "int64(-9223372036854775808)");
 assert.equal(emitPackedComparison({c:"cmp",type:P,op:">=",l:operand,r:literal("2147483648")},render), "int64(a) >= int64(2147483648)");
});
test("wider intermediates retry packed calculation, fractional intermediates retain it", () => {
 assert.match(emit(binary("-",binary("+"))), /intarith\.Packed\(func\(\) int64.*abap.PToI8\(packedSlow, true\)/);
 assert.equal(emit(binary("*",binary("/"))), null);
 assert.equal(emit(binary("/",binary("+"))), null);
 assert.equal(emit(binary("+",operand,literal("9223372036854775808"))), null);
 assert.equal(emit(binary("+",operand,literal("1.25"))), null);
});
test("calls and reference reads cannot be repeated by overflow fallback", () => {
 for (const x of [{e:"call",type:I8}, {e:"static",type:I8}, {...variable,ref:true}, {e:"field",x:{e:"call",type:I8},type:I8}])
  assert.equal(emit(binary("+",{...operand,x})), null);
});
