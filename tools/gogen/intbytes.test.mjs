import {test} from "node:test";
import assert from "node:assert/strict";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {emitJs} from "./emit-js.mjs";
import {IToX, XToI, XToI8, XToHex} from "./js/abap.mjs";

const here = dirname(fileURLToPath(import.meta.url));
test("A4H int8 byte rows in the JS runtime", () => {
  for (const [v, n, want] of [
    [-2n, 8, "FFFFFFFFFFFFFFFE"],
    [72623859790382856n, 8, "0102030405060708"],
    [72623859790382856n, 4, "05060708"],
    [72623859790382856n, 16, "00000000000000000102030405060708"],
    [-2n, 16, "0000000000000000FFFFFFFFFFFFFFFE"],
  ]) {
    assert.equal(XToHex(IToX(v, n, 8)), want);
    if (n >= 8) assert.equal(XToI8(IToX(v, n, 8)), v);
  }
});

test("integer widths, extrema and zero padding", () => {
  for (const width of [4, 8]) {
    const values = width === 4 ? [-2147483648n, -1n, 0n, 2147483647n]
      : [-9223372036854775808n, -1n, 0n, 9223372036854775807n];
    for (const v of values) for (const n of [...Array.from({length: 16}, (_, i) => i + 1), 32, 1024]) {
      const full = BigInt.asUintN(8 * width, v).toString(16).toUpperCase().padStart(width * 2, "0");
      assert.equal(XToHex(IToX(v, n, width)), n < width ? full.slice(-n * 2) : full.padStart(n * 2, "0"));
      if (n >= width) assert.equal(XToI8(IToX(v, n, width), width), v);
    }
  }
});

test("short sources are unsigned; long sources discard leading bytes", () => {
  assert.equal(XToI8("\xff"), 255n);
  assert.equal(XToI8("\xff\xff"), 65535n);
  assert.equal(XToI8("\x01\x80" + "\0".repeat(7)), -9223372036854775808n);
  assert.equal(XToI8(""), 0n);
  assert.equal(XToI("\xff\xff"), 65535);
  assert.equal(XToI("\x01\0\0\0\x02"), 2);
});

test("supplied oracle and documentation: xstring integer lengths", () => {
  for (const width of [4, 8]) {
    assert.equal(XToHex(IToX(-2n, undefined, width)), "FF".repeat(width - 1) + "FE");
    assert.equal(XToHex(IToX(255n, undefined, width)), "FF");
    assert.equal(XToHex(IToX(0n, undefined, width)), "00");
    assert.equal(XToHex(IToX(-1n, undefined, width)), "FF".repeat(width));
  }
  for (const [v, want] of [[1n << 32n, "0100000000"], [1n << 40n, "010000000000"], [1n << 48n, "01000000000000"]])
    assert.equal(XToHex(IToX(v, undefined, 8)), want);
  assert.equal(XToHex(IToX(9223372036854775807n, undefined, 8)), "7FFFFFFFFFFFFFFF");
});

test("A4H ABAPiti 008: top-bit xstrings use minimal positive bytes", () => {
  for (const [v, width, want] of [
    [128n, 4, "80"], [32768n, 4, "8000"],
    [1n << 31n, 8, "80000000"], [1n << 56n, 8, "0100000000000000"],
    [-128n, 4, "FFFFFF80"],
  ]) assert.equal(XToHex(IToX(v, undefined, width)), want);
});

test("both emitters lower byte conversions and isolate helper imports", async () => {
  const program = compileProgram({folders: [join(here, "testdata")], objects: ["ZCL_GOGEN_T_INT8X"]});
  assert.deepEqual(program.partial, []);
  const go = emitGo(program);
  assert.match(go, /hIntbytes "osg\/gogen\/intbytes"/);
  assert.match(go, /hIntbytes\.ToX\(int64\(/);
  assert.match(go, /hIntbytes\.FromX\(/);
  assert.match(go, /hIntbytes\.ToString\(/);
  const js = emitJs(program, new URL("./js/abap.mjs", import.meta.url).href);
  const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  assert.equal(m.ZCL_GOGEN_T_INT8X.RUN({sy: {index: 0, tabix: 0, subrc: 0, dbcnt: 0}}),
    "0000000000000000FFFFFFFFFFFFFFFE/-2/0708/65535/-9223372036854775808/8000000000000000/0/00000000FFFFFFFE/-2/FFFFFFFE/documented");
});
