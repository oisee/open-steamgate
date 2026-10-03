// DSL L2: the DDIC semantics of a typed value, which the interpreter
// (tools/dsl-l2-eval.mjs) and the compiler share: how a type compares, how a
// value prints and is held, its initial value, and one day's step on a DATS.
export const INTEGERS = new Set(["INT1", "INT2", "INT4", "INT8"]);
export const PACKED = new Set(["DEC", "CURR", "QUAN"]);
export const INT_RANGE = {INT1: [0n, 255n], INT2: [-32768n, 32767n], INT4: [-2147483648n, 2147483647n],
  INT8: [-9223372036854775808n, 9223372036854775807n]};

// the way a type compares: char (blank-insensitive text), digits (DATS, TIMS,
// NUMC), int, dec
export function kindOf(type) {
  const b = type.built_in;
  if (INTEGERS.has(b)) return "int";
  if (PACKED.has(b)) return "dec";
  if (b === "DATS" || b === "TIMS" || b === "NUMC") return "digits";
  return "char";
}

// the text of a value as the field would hold it: 12.5 in a DEC 5,2 is 12.50,
// 007 in an INT is 7
export function canonical(type, text) {
  const kind = kindOf(type);
  if (kind === "int") return String(BigInt(text));
  if (kind === "dec") return formatDecimal(scaled(text, type.decimals ?? 0), type.decimals ?? 0);
  if (type.built_in === "NUMC" && /^[0-9]*$/.test(text)) return text.padStart(type.length ?? 1, "0");
  return text;
}

export const isOrdered = (type) => kindOf(type) !== "char";

export function initialValue(type) {
  const b = type.built_in;
  if (b === "DATS") return "00000000";
  if (b === "TIMS") return "000000";
  if (b === "NUMC") return "0".repeat(type.length ?? 1);
  if (INTEGERS.has(b)) return "0";
  if (PACKED.has(b)) return (type.decimals ?? 0) > 0 ? `0.${"0".repeat(type.decimals)}` : "0";
  return "";
}

export function scaled(text, decimals) {
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const n = BigInt(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
  return negative ? -n : n;
}

export function sign(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// -1, 0, 1: a compared with b under the DDIC rules of their types
export function compareValues(typeA, a, typeB, b) {
  const kind = kindOf(typeA);
  if (kind === "int") return sign(BigInt(a), BigInt(b));
  if (kind === "dec") {
    const decimals = Math.max(typeA.decimals ?? 0, typeB.decimals ?? 0);
    return sign(scaled(a, decimals), scaled(b, decimals));
  }
  if (kind === "digits" && typeA.built_in === "NUMC") {
    const length = Math.max(typeA.length ?? 0, typeB.length ?? 0);
    return sign(a.padStart(length, "0"), b.padStart(length, "0"));
  }
  return sign(a.replace(/ +$/, ""), b.replace(/ +$/, ""));
}

// how a value prints in an alert (what `&&` makes of the field)
export function render(type, value) {
  const kind = kindOf(type);
  if (kind === "char") return value.replace(/ +$/, "");
  if (kind === "int") return String(BigInt(value));
  if (kind === "dec") return formatDecimal(scaled(value, type.decimals ?? 0), type.decimals ?? 0);
  return value;
}

export function formatDecimal(n, decimals) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(decimals + 1, "0");
  const text = decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return negative ? `-${text}` : text;
}

// ---------------------------------------------------------------------------
// calendar arithmetic (proleptic Gregorian; days since 1970-01-01)

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}

// one day on a DATS text, or undefined for a text that is no calendar date
// and for a step out of 0001-01-01 .. 9999-12-31
export function shiftDate(text, dir) {
  if (!/^[0-9]{8}$/.test(text)) return undefined;
  const y = Number(text.slice(0, 4)), m = Number(text.slice(4, 6)), d = Number(text.slice(6, 8));
  if (y < 1 || m < 1 || m > 12 || d < 1) return undefined;
  const days = daysFromCivil(y, m, d);
  const [cy, cm, cd] = civilFromDays(days);
  if (cy !== y || cm !== m || cd !== d) return undefined; // e.g. 20260231
  const [ny, nm, nd] = civilFromDays(days + dir);
  if (ny < 1 || ny > 9999) return undefined;
  return `${String(ny).padStart(4, "0")}${String(nm).padStart(2, "0")}${String(nd).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// the steps of a type and the values a derived case tries

function stepTime(text, dir) {
  if (!/^[0-9]{6}$/.test(text)) return undefined;
  const h = Number(text.slice(0, 2)), m = Number(text.slice(2, 4)), s = Number(text.slice(4, 6));
  if (h > 23 || m > 59 || s > 59) return undefined;
  const total = h * 3600 + m * 60 + s + dir;
  if (total < 0 || total > 86399) return undefined;
  const two = (n) => String(n).padStart(2, "0");
  return `${two(Math.floor(total / 3600))}${two(Math.floor(total / 60) % 60)}${two(total % 60)}`;
}

// One step of a type from a value: a day, a second, 1, or 10^-decimals;
// undefined when the step leaves the type (255 + 1 for INT1, 99991231 + 1).
export function stepValue(type, text, dir) {
  const b = type.built_in;
  if (b === "DATS") return shiftDate(text, dir);
  if (b === "TIMS") return stepTime(text, dir);
  if (b === "NUMC") {
    if (!/^[0-9]+$/.test(text)) return undefined;
    const n = BigInt(text) + BigInt(dir);
    if (n < 0n || n >= 10n ** BigInt(type.length ?? 1)) return undefined;
    return n.toString().padStart(type.length ?? 1, "0");
  }
  if (INTEGERS.has(b)) {
    const n = BigInt(text) + BigInt(dir);
    const [low, high] = INT_RANGE[b];
    return n < low || n > high ? undefined : n.toString();
  }
  if (PACKED.has(b)) {
    const decimals = type.decimals ?? 0;
    const n = scaled(text, decimals) + BigInt(dir);
    if ((n < 0n ? -n : n).toString().length > (type.length ?? 0)) return undefined;
    return formatDecimal(n, decimals);
  }
  return undefined;
}

const ORDER = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// A different text of the same length: the last character one place along.
export function bump(text, dir) {
  if (text === "") return dir > 0 ? "A" : undefined;
  const last = text.at(-1);
  const at = ORDER.indexOf(last);
  let next;
  if (at >= 0) next = ORDER[at + dir];
  else {
    const c = String.fromCharCode(last.charCodeAt(0) + dir);
    next = /[ -~]/.test(c) && c !== "'" && c !== "`" ? c : undefined;
  }
  return next === undefined ? undefined : text.slice(0, -1) + next;
}

// a value that is not `text`: one step along if the type has one, else a
// different character
export function different(type, text) {
  if (isOrdered(type)) return stepValue(type, text, 1) ?? stepValue(type, text, -1);
  return bump(text, 1) ?? bump(text, -1);
}

// a type-correct value to fill a field with, `seed` making keys differ
export function defaultValue(type, seed = 1) {
  const b = type.built_in;
  if (b === "DATS") return "20260101";
  if (b === "TIMS") return "120000";
  if (b === "NUMC") return String(seed).padStart(type.length ?? 1, "0").slice(-(type.length ?? 1));
  if (INTEGERS.has(b)) return b === "INT1" ? String(seed % 256) : String(seed);
  if (PACKED.has(b)) {
    // the seed as a whole number when the integer digits hold it, else as
    // the scaled digits themselves: a DEC 3,2 takes 5.00 but not 500.00
    const decimals = type.decimals ?? 0;
    const digits = BigInt(type.length ?? decimals + 1);
    const whole = BigInt(seed) * 10n ** BigInt(decimals);
    return formatDecimal(whole < 10n ** digits ? whole : BigInt(seed) % 10n ** digits, decimals);
  }
  if (b === "RAW") return "AB";
  const length = b === "STRG" || type.length === undefined ? 8 : type.length;
  return ("A" + String(seed).padStart(Math.max(length - 1, 0), "0")).slice(0, Math.max(length, 1));
}
