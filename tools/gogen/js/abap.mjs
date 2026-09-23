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
// FIND [REGEX] p IN s: [found, offset, length, submatches]. A JS RegExp is
// leftmost-first where ABAP's POSIX is leftmost-longest: an alternation whose
// shorter branch matches first (a|ab) differs; the Go runtime is the exact one.
export function FindStmt(s, p, regex, icase, n) {
  const subs = new Array(n).fill("");
  if (!regex) {
    if (p === "") return [false, 0, 0, subs];
    const i = (icase ? s.toUpperCase() : s).indexOf(icase ? p.toUpperCase() : p);
    return i < 0 ? [false, 0, 0, subs] : [true, [...s.slice(0, i)].length, [...p].length, subs];
  }
  // non-greedy is invalid on A4H; (?:...) and lookahead are valid there and here
  if (/\*\?|\+\?|\?\?/.test(p)) throw new AbapError("CX_SY_INVALID_REGEX", p);
  const m = new RegExp(p, icase ? "iu" : "u").exec(s);
  if (!m) return [false, 0, 0, subs];
  for (let i = 0; i < n; i++) subs[i] = m[i + 1] ?? "";
  return [true, [...s.slice(0, m.index)].length, [...m[0]].length, subs];
}

// CREATE OBJECT ... TYPE (name): every compiled class registers what it is
// (its own name and its interfaces) and a constructor without arguments. The
// fit is checked before the constructor runs, as in the kernel.
const classes = new Map();
export function registerClass(name, is, make) { classes.set(name, {is: new Set(is), make}); }
export function createAs(s, name, target) {
  const c = classes.get(String(name).replace(/ +$/, ""))  // as written: lower case is unknown (A4H);
  if (c === undefined) throw new AbapError("CX_SY_CREATE_OBJECT_ERROR", `CREATE OBJECT TYPE (${name})`);
  if (!c.is.has(target)) throw new AbapError("CX_SY_MOVE_CAST_ERROR", `CREATE OBJECT TYPE (${name})`);
  return c.make(s);
}

// ?= and CAST: an initial reference casts to initial; anything else must be
// the target class or interface (the class's $is), or CX_SY_MOVE_CAST_ERROR
export function cast(x, target) {
  if (x === null || x === undefined) return null;
  if (!x.constructor?.$is?.has(target)) throw new AbapError("CX_SY_MOVE_CAST_ERROR", "?=");
  return x;
}

// RAISE name, taken only by the caller's EXCEPTIONS list (see the Go runtime)
export class ClassicException extends Error {
  constructor(name, method) { super(`RAISE_EXCEPTION ${name} in ${method}`); this.exName = name; this.method = method; }
}
export function classic(s, e, method, map, others) {
  if (e instanceof ClassicException && e.method === method) {
    if (map[e.exName] !== undefined) { s.sy.subrc = map[e.exName]; return; }
    if (others !== 0) { s.sy.subrc = others; return; }
  }
  throw e;
}

// CP and CA: see the Go runtime (conv.go), measured on A4H
export function CP(a, p, cpat) {
  if (cpat && p === "") p = " ";
  const ps = [];
  const pr = [...p];
  for (let i = 0; i < pr.length; i++) {
    if (pr[i] === "#" && i + 1 < pr.length) ps.push({r: pr[++i], k: "e"});
    else if (pr[i] === "*") ps.push({k: "*"});
    else if (pr[i] === "+") ps.push({k: "+"});
    else ps.push({r: pr[i], k: "l"});
  }
  const ar = [...a];
  const eq = (t, c) => (t.k === "+" ? true : t.k === "e" ? t.r === c : t.r.toUpperCase() === c.toUpperCase());
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < ar.length) {
    if (j < ps.length && ps[j].k !== "*" && eq(ps[j], ar[i])) { i++; j++; }
    else if (j < ps.length && ps[j].k === "*") { star = j; mark = i; j++; }
    else if (star >= 0) { j = star + 1; mark++; i = mark; }
    else return false;
  }
  while (j < ps.length && ps[j].k === "*") j++;
  return j === ps.length;
}
export function CA(a, b) { return b !== "" && [...a].some((c) => b.includes(c)); }

export function notCompiled(why) { throw new AbapError("NOT_COMPILED", why); }
export function Condense(s, noGaps) { return noGaps ? s.replaceAll(" ", "") : s.split(" ").filter((x) => x !== "").join(" "); }

// Generic data: TYPE any, TYPE data, ANY TABLE and REF TO data, as in
// go/abap/data.go. A generic value is a binding to the slot it stands for,
// {get, set, t}: get reads the slot, set writes it, t is the descriptor of
// the slot's ABAP type. Never a copy, so a write through a field symbol or a
// data reference reaches the original. An unassigned field symbol and an
// initial reference are null. Descriptors of structures and tables are
// generated with the program ({kind, comps: [{name, key, t}], row, zero});
// elementary ones are here.
const sizedTypes = new Map();
const sizedType = (kind, len, dec = 0) => {
  const key = `${kind}:${len}:${dec}`;
  if (!sizedTypes.has(key)) sizedTypes.set(key, {kind, len, dec});
  return sizedTypes.get(key);
};
export const TI = {kind: "I", len: 4};
export const TInt8 = {kind: "8", len: 8};
export const TF = {kind: "F", len: 8};
export const TString = {kind: "g"};
export const TXString = {kind: "y"};
export const TD = {kind: "D", len: 8};
export const TT = {kind: "T", len: 6};
export const TRef = {kind: "l"};
export const TObj = {kind: "r"};
export const TC = (n) => sizedType("C", n);
export const TX = (n) => sizedType("X", n);
export const TP = (n, dec) => sizedType("P", n, dec);

// a value that is no place of its own, seen as generic data: a slot of its own
export function cell(v, t) {
  const c = {v};
  return {get: () => c.v, set: (x) => { c.v = x; }, t};
}

const notAssigned = (op) => new AbapError("GETWA_NOT_ASSIGNED", op);

// ASSIGN COMPONENT name OF STRUCTURE d: null (sy-subrc 4) when d is not a
// structure or has no component of that name; the name in any case (A4H).
// The component is reached through d each time, so it stays the field of
// whatever structure d's slot holds.
export function Component(d, name) {
  if (d === null || (d.t.kind !== "u" && d.t.kind !== "v")) return null;
  const n = String(name).replace(/ +$/, "").toUpperCase();
  const c = d.t.comps.find((x) => x.name === n);
  if (c === undefined) return null;
  return {get: () => d.get()[c.key], set: (v) => { d.get()[c.key] = v; }, t: c.t};
}

// lines( ) of a generic table
export function Lines(d) {
  if (d === null || d.t.kind !== "h") throw new AbapError("NOT_COMPILED", "lines( ): of a generic value that is not a table");
  return d.get().length;
}

// row i (from 0) of a generic table, bound to the row itself
export function Row(d, i) {
  const a = d.get();
  return {get: () => a[i], set: (v) => { a[i] = v; }, t: d.t.row};
}

// a generic elementary value moved into a string
export function DataString(d) {
  if (d === null) throw notAssigned("move");
  switch (d.t.kind) {
    case "g": case "C": case "D": case "T": case "N": return d.get();
    case "I": return IToString(d.get());
    default: throw new AbapError("NOT_COMPILED", `move: a generic value of type kind ${d.t.kind} into a string`);
  }
}

// a generic value moved into an i
export function DataI(d) {
  if (d === null) throw notAssigned("move");
  if (d.t.kind === "I") return d.get();
  throw new AbapError("NOT_COMPILED", `move: a generic value of type kind ${d.t.kind} into an i`);
}

// a generic value in a string template
export function FmtData(d) {
  if (d === null) throw notAssigned("string template");
  switch (d.t.kind) {
    case "I": return FmtI(d.get());
    case "8": return String(d.get());
    case "F": return FmtF(d.get());
    case "g": case "C": case "D": case "T": case "N": return d.get();
    case "X": case "y": return XToHex(d.get());
    default: throw new AbapError("NOT_COMPILED", `string template: a generic value of type kind ${d.t.kind}`);
  }
}

// IS INITIAL of a generic value
export function IsInitialData(d) {
  if (d === null) return true;
  const v = d.get();
  switch (d.t.kind) {
    case "I": case "F": return v === 0;
    case "8": return v === 0n;
    case "g": case "y": case "C": return v === "";
    case "D": return v === "" || v === "00000000";
    case "T": return v === "" || v === "000000";
    case "X": return /^\u0000*$/.test(v);
    case "P": return v.replaceAll(".", "").replace(/^[0-]+/, "") === "";
    case "h": return v.length === 0;
    case "u": case "v": return d.t.comps.every((c) => IsInitialData({get: () => v[c.key], t: c.t}));
    case "l": case "r": return v === null;
    default: throw new AbapError("NOT_COMPILED", `IS INITIAL: a generic value of type kind ${d.t.kind}`);
  }
}

// A structure or table written through generic data is written in place, as
// Go writes through the pointer: the object in the slot stays the same
// object, so a typed field symbol holding it (LOOP ASSIGNING, READ TABLE
// ASSIGNING) and a binding that fixed it (the row, the object of a
// reference, a typed field symbol) still see it afterwards. A nested
// structure or table is written in place too. src is a fresh value.
export function Overwrite(t, dst, src) {
  if (t.kind === "h") {
    dst.length = 0;
    for (const r of src) dst.push(r);
    return;
  }
  for (const c of t.comps) {
    const k = c.t.kind;
    if ((k === "u" || k === "v" || k === "h") && dst[c.key] !== null && typeof dst[c.key] === "object") Overwrite(c.t, dst[c.key], src[c.key]);
    else dst[c.key] = src[c.key];
  }
}

// dst = src for a generic dst: converted to the type of the slot dst is bound
// to and written there, never rebound. The pairs of go/abap MoveData; any
// other dumps NOT_COMPILED rather than guess.
export function MoveData(dst, src) {
  if (dst === null) throw notAssigned("move into a field symbol");
  if (src === null) throw notAssigned("move from a field symbol");
  const dk = dst.t.kind;
  const sk = src.t.kind;
  const v = src.get();
  switch (dk) {
    case "u": case "v": case "h":
      if (dst.t === src.t) return Overwrite(dst.t, dst.get(), copy(v));
      break;
    case "I":
      if (sk === "I") return dst.set(v);
      if (sk === "F") return dst.set(F2I(v));
      if (sk === "C" || sk === "g") return dst.set(ParseI(v));
      break;
    case "F":
      if (sk === "I" || sk === "F") return dst.set(v);
      if (sk === "C" || sk === "g") return dst.set(ParseF(v));
      break;
    case "8":
      if (sk === "8") return dst.set(v);
      break;
    case "g":
      if (sk === "g" || sk === "C") return dst.set(v);
      if (sk === "I") return dst.set(IToString(v));
      break;
    case "C":
      if (sk === "g" || sk === "C") return dst.set(CFit(v, dst.t.len));
      break;
    case "X":
      if (sk === "X") return dst.set(XFit(v, dst.t.len));
      break;
    case "y": case "D": case "T": case "P":
      if (sk === dk && (dk !== "P" || dst.t === src.t)) return dst.set(v);
      break;
    case "l":
      if (sk === "l") return dst.set(v);
      break;
    default: break;
  }
  throw new AbapError("NOT_COMPILED", `move: a value of type kind ${sk} into generic data of type kind ${dk}`);
}

// CLEAR of a generic value: the slot it is bound to becomes initial
export function ClearData(d) {
  if (d === null) throw notAssigned("CLEAR of a field symbol");
  switch (d.t.kind) {
    case "I": case "F": return d.set(0);
    case "8": return d.set(0n);
    case "g": case "y": case "C": return d.set("");
    case "D": return d.set("00000000");
    case "T": return d.set("000000");
    case "P": return d.set("0");
    case "X": return d.set("\u0000".repeat(d.t.len));
    case "l": return d.set(null);
    case "u": case "v": case "h": return Overwrite(d.t, d.get(), d.t.zero());
    default: throw new AbapError("NOT_COMPILED", `CLEAR: generic data of type kind ${d.t.kind}`);
  }
}

// CALL METHOD (class)=>m, as go/abap CallStatic: the classes the program
// compiled, the ones the registry has (a class that exists but was not
// compiled dumps instead of reading as unknown), and an adapter per static
// method a dynamic call names, reading its arguments out of generic data.
const compiledClasses = new Set();
const registryClasses = new Set();
const statics = new Map();
export function knownClasses(compiled, known) {
  for (const c of compiled) compiledClasses.add(c);
  for (const c of known) registryClasses.add(c);
}
export function registerStatic(name, params, call) { statics.set(name, {params: new Set(params), call}); }
export function CallStatic(s, cls, method, args) {
  const c = String(cls).replace(/ +$/, "");
  if (!compiledClasses.has(c)) {
    if (registryClasses.has(c)) throw new AbapError("NOT_COMPILED", `CALL METHOD (${c})=>${method}: the class exists but is not compiled in this program`);
    throw new AbapError("CX_SY_DYN_CALL_ILLEGAL_CLASS", `CALL METHOD (${c})=>${method}`);
  }
  const e = statics.get(`${c}=>${method}`);
  if (e === undefined) throw new AbapError("CX_SY_DYN_CALL_ILLEGAL_METHOD", `CALL METHOD (${c})=>${method}`);
  for (const n of Object.keys(args)) if (!e.params.has(n)) throw new AbapError("CX_SY_DYN_CALL_PARAM_NOT_FOUND", `${c}=>${method} ${n}`);
  e.call(s, args);
}
export function paramMissing(op) { throw new AbapError("CX_SY_DYN_CALL_PARAM_MISSING", op); }
