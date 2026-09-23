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
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const k in v) o[k] = copy(v[k]);
    return o;
  }
  return v;
}
