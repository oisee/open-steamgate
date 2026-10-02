export function ipow(base, exp, kind, multiply, ErrorType, floatToPacked) {
  if (exp < 0 || kind === "f") {
    const n = Math.pow(Number(base), exp);
    if (!Number.isFinite(n)) throw new ErrorType("CX_SY_ARITHMETIC_OVERFLOW", "ipow");
    if (kind === "f") return n;
    if (kind === "p") return floatToPacked(n);
    const rounded = BigInt(Math.sign(n) * Math.round(Math.abs(n)));
    if (BigInt.asIntN(kind === "int8" ? 64 : 32, rounded) !== rounded) throw new ErrorType("CX_SY_ARITHMETIC_OVERFLOW", "ipow");
    return kind === "int8" ? rounded : Number(rounded);
  }
  let result = kind === "p" ? "1" : kind === "int8" ? 1n : 1;
  const mul = kind === "p" ? multiply : (a, b) => {
    const n = BigInt(a) * BigInt(b);
    const bits = kind === "int8" ? 64 : 32;
    if (BigInt.asIntN(bits, n) !== n) throw new ErrorType("CX_SY_ARITHMETIC_OVERFLOW", "ipow");
    return kind === "int8" ? n : Number(n);
  };
  while (exp > 0) {
    if (exp % 2) result = mul(result, base);
    exp = Math.floor(exp / 2);
    if (exp > 0) base = mul(base, base);
  }
  return result;
}

export function boolx(value, bit, ErrorType) {
  if (value !== "X" || bit === 0) return "";
  const n = Math.abs(bit);
  if (n > 524288) throw new ErrorType("NOT_COMPILED", "boolx( ): bit beyond local allocation limit");
  const bytes = Array(Math.ceil(n / 8)).fill(bit < 0 ? 255 : 0);
  if (bit < 0) { if (n % 8) bytes[bytes.length-1] = (255 << (8-n%8)) & 255; }
  else bytes[Math.floor((n-1)/8)] = 1 << (7-(n-1)%8);
  return String.fromCharCode(...bytes);
}
