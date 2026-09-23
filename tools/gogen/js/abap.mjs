// The runtime of JS emitted from the gogen IR (tools/gogen/emit-js.mjs): the
// same semantics as go/abap, line for line, with plain JS values. i and f
// are numbers, c / x / string are strings, a structure is an object and a
// table an array. Nothing here tests a type at run time: the IR decided.

export class AbapError extends Error {
  constructor(cls, op) {
    super(`${cls} in ${op}`);
    this.cls = cls;
  }
}

const MAX = 2147483647;
const MIN = -2147483648;
const check = (v, op) => {
  if (v > MAX || v < MIN) throw new AbapError("CX_SY_ARITHMETIC_OVERFLOW", op);
  return v;
};

export const AddI = (a, b) => check(a + b, "+");
export const SubI = (a, b) => check(a - b, "-");
export const MulI = (a, b) => check(a * b, "*");
export const NegI = (a) => check(-a, "-");

// `/` with calculation type i: the quotient rounded half away from zero,
// and 0 / 0 = 0
export function DivI(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "/");
  }
  const r = a % b;
  let q = (a - r) / b;
  if (2 * Math.abs(r) >= Math.abs(b)) q += (a < 0) !== (b < 0) ? -1 : 1;
  return check(q, "/");
}

// DIV and MOD keep the remainder in [0, |b|)
export function DivIntI(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "DIV");
  }
  let r = a % b;
  if (r < 0) r += Math.abs(b);
  return check((a - r) / b, "DIV");
}

export function ModI(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "MOD");
  }
  let r = a % b;
  if (r < 0) r += Math.abs(b);
  return r;
}

export function DivF(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "/");
  }
  return a / b;
}

// for f, the quotient that leaves a - b * q non-negative, and MOD computed
// from it: what A4H does (abaplint/transpiler#1885)
const quotF = (a, b) => (b > 0 ? Math.floor(a / b) : -Math.floor(a / -b));
export function DivIntF(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "DIV");
  }
  return quotF(a, b);
}
export function ModF(a, b) {
  if (b === 0) {
    if (a === 0) return 0;
    throw new AbapError("CX_SY_ZERODIVIDE", "MOD");
  }
  const v = a - b * quotF(a, b);
  return v === 0 ? 0 : v;
}

// f -> i: half away from zero, and out of range is an overflow
export function F2I(f) {
  const r = f < 0 ? -Math.round(-f) : Math.round(f);
  if (Number.isNaN(r) || r > MAX || r < MIN) throw new AbapError("CX_SY_CONVERSION_OVERFLOW", "f->i");
  return r === 0 ? 0 : r;
}

export const AbsI = (a) => check(Math.abs(a), "abs");
export const SignI = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const SignF = SignI;
export const FracF = (v) => v - Math.trunc(v);
export const MaxI = Math.max;
export const MinI = Math.min;
export const MaxF = Math.max;
export const MinF = Math.min;
export function SqrtF(v) {
  if (v < 0) throw new AbapError("CX_SY_ARG_OUT_OF_DOMAIN", "sqrt");
  return Math.sqrt(v);
}
export function LogF(v) {
  if (v <= 0) throw new AbapError("CX_SY_ARG_OUT_OF_DOMAIN", "log");
  return Math.log(v);
}

// character-like values: a c field is stored without its trailing blanks
export function CFit(v, n) {
  const chars = [...v];
  return (chars.length > n ? chars.slice(0, n).join("") : v).replace(/ +$/, "");
}
export const FmtI = (v) => String(v);
export function IToX(v, n) {
  const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const out = n <= 4 ? b.slice(4 - n) : [...new Array(n - 4).fill(v < 0 ? 255 : 0), ...b];
  return String.fromCharCode(...out);
}
export const XToHex = (v) => [...v].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
export function ParseF(v) {
  let t = v.trim();
  if (t === "") return 0;
  let neg = false;
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1).trim(); }
  const f = Number(t);
  if (Number.isNaN(f)) throw new AbapError("CX_SY_CONVERSION_NO_NUMBER", "c->f");
  return neg ? -f : f;
}
export const ParseI = (v) => F2I(ParseF(v));
export const ToUpper = (v) => v.toUpperCase();
export const ToLower = (v) => v.toLowerCase();
export const Strlen = (v) => [...v].length;

// f in a string template, as measured on A4H: seventeen significant digits,
// positional, trailing zeros of the fraction dropped
export function FmtF(v) {
  if (v === 0) return "0";
  const neg = v < 0;
  const [mant, exp] = Math.abs(v).toExponential(16).split("e");
  const digits = mant.replace(".", "");
  const point = Number(exp) + 1;
  let intPart;
  let frac;
  if (point <= 0) { intPart = "0"; frac = "0".repeat(-point) + digits; }
  else if (point >= digits.length) { intPart = digits + "0".repeat(point - digits.length); frac = ""; }
  else { intPart = digits.slice(0, point); frac = digits.slice(point); }
  frac = frac.replace(/0+$/, "");
  return (neg ? "-" : "") + intPart + (frac === "" ? "" : `.${frac}`);
}

// value semantics: a structure or table moved out of a place is copied
export function copy(v) {
  if (Array.isArray(v)) return v.map(copy);
  // a structure is a plain object and is copied; an object of a class is a
  // reference and is shared, as ABAP moves a TYPE REF TO
  if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    for (const k in v) o[k] = copy(v[k]);
    return o;
  }
  return v;
}

export function Idx(n, i) {
  if (i < 1 || i > n) throw new AbapError("CX_SY_ITAB_LINE_NOT_FOUND", "table expression");
  return i - 1;
}

export function PowF(a, b) {
  if (a < 0 && b !== Math.trunc(b)) throw new AbapError("CX_SY_ARG_OUT_OF_DOMAIN", "**");
  if (a === 0 && b < 0) throw new AbapError("CX_SY_ZERODIVIDE", "**");
  return a ** b;
}

// WIDTH / ALIGN / PAD, as measured on A4H: padded, never cut
export function Pad(v, width, align, pad) {
  const n = [...v].length;
  if (n >= width) return v;
  const fill = width - n;
  if (align === "RIGHT") return pad.repeat(fill) + v;
  if (align === "CENTER") return pad.repeat(fill >> 1) + v + pad.repeat(fill - (fill >> 1));
  return v + pad.repeat(fill);
}

// DECIMALS = n of an f, as measured on A4H (see go/abap FmtFDec)
export function FmtFDec(v, n) {
  const neg = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  let intPart;
  let frac;
  if (a >= 1e21) { intPart = FmtF(a); frac = "0".repeat(100); }
  else { [intPart, frac] = a.toFixed(100).split("."); }
  const digits = intPart.replace(/^0+/, "").length;
  if (digits > 0 && n > 17 - digits) n = Math.max(0, 17 - digits);
  const b = (intPart + frac.slice(0, n)).split("");
  if (frac[n] >= "5") {
    let i = b.length - 1;
    for (; i >= 0; i--) {
      if (b[i] === "9") { b[i] = "0"; continue; }
      b[i] = String(Number(b[i]) + 1);
      break;
    }
    if (i < 0) b.unshift("1");
  }
  const s = b.join("");
  const ip = s.slice(0, s.length - n).replace(/^0+/, "") || "0";
  return (neg ? "-" : "") + ip + (n > 0 ? `.${s.slice(s.length - n)}` : "");
}

export function ReplaceAll(v, of, wth) {
  if (of === "" || !v.includes(of)) return [v, 4];
  return [v.split(of).join(wth), 0];
}

// BIT-AND / BIT-OR / BIT-XOR of two x fields of one length
export function BitX(op, a, b) {
  let out = "";
  for (let i = 0; i < a.length; i++) {
    const x = a.charCodeAt(i); const y = b.charCodeAt(i);
    out += String.fromCharCode(op === "BIT-AND" ? x & y : op === "BIT-OR" ? x | y : x ^ y);
  }
  return out;
}
// an x of fewer than four bytes into an i: 00 on the left, read unsigned
export function XToI(v) {
  let r = 0;
  for (let i = 0; i < v.length; i++) r = r * 256 + v.charCodeAt(i);
  return r;
}

const rangeError = () => { throw new AbapError("CX_SY_RANGE_OUT_OF_BOUNDS", "offset/length"); };
// v+off(len) of a string in characters; len -1 is the rest; out of range raises
export function SubS(v, off, len) {
  const r = [...v];
  if (off < 0 || off > r.length) rangeError();
  if (len < 0) return r.slice(off).join("");
  if (off + len > r.length) rangeError();
  return r.slice(off, off + len).join("");
}
// v+off(len) of a c field of length n: read padded, stored trimmed
export const SubC = (v, n, off, len) => SubS(v.padEnd(n, " ").slice(0, n), off, len).replace(/ +$/, "");
// bytes of an x or xstring (one char per byte)
export function SubX(v, off, len) {
  if (off < 0 || off > v.length) rangeError();
  if (len < 0) return v.slice(off);
  if (off + len > v.length) rangeError();
  return v.slice(off, off + len);
}
export const XFit = (v, n) => (v.length >= n ? v.slice(0, n) : v + "\u0000".repeat(n - v.length));
export const Uccpi = (v) => String.fromCodePoint(v).replace(/ +$/, "");
// find( val sub off ), as measured on A4H: offset or -1, empty sub raises
export function Find(v, sub, off) {
  if (sub === "") throw new AbapError("CX_SY_STRG_PAR_VAL", "find");
  const r = [...v];
  if (off < 0 || off > r.length) rangeError();
  const rest = r.slice(off).join("");
  const i = rest.indexOf(sub);
  return i < 0 ? -1 : off + [...rest.slice(0, i)].length;
}
export const CO = (a, b) => [...a].every((c) => b.includes(c));
export const CS = (a, b) => b === "" || a.toUpperCase().includes(b.toUpperCase());
// i into a string, as A4H moves it: 42 is "42 ", -5 is "5-"
export const IToString = (v) => (v < 0 ? `${-v}-` : `${v} `);
// code point of a character; the blank c, stored empty, is 32
export const Uccp = (v) => (v.length === 0 ? 32 : v.codePointAt(0));
// SPLIT ... INTO TABLE as A4H does it
export function Split(v, sep) {
  if (v === "") return [];
  const parts = v.split(sep);
  if (v.endsWith(sep)) parts.pop();
  return parts;
}
// an unseeded cl_abap_random_int: any number in [min, max]
let seeded = false;
let state = 0;
// harnesses only: the same xorshift32 as the Go runtime
export function SeedRandom(seed) { seeded = true; state = seed >>> 0; }
export function RandomInt(min, max) {
  if (!seeded) return min + Math.floor(Math.random() * (max - min + 1));
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return min + (state % (max - min + 1));
}
