// An integral packed expression can use int64 without changing its IR type.
// Fractional intermediates, wide values and side effects retain the p path.
export const I8_OPS = {"+": "abap.AddI8", "-": "abap.SubI8", "*": "abap.MulI8", "/": "abap.DivI8", DIV: "abap.DivIntI8", MOD: "abap.ModI8"};
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const literal = (e) => {
  if (e.e === "neg") { const v = literal(e.x); return v === null ? null : -v; }
  return e.e === "str" && e.type?.k === "p" && e.type.calc && /^-?\d+$/.test(e.value) ? BigInt(e.value) : null;
};
const pure = (e) => {
  if (!e || e.ref || !["var", "attr", "field", "int", "conv"].includes(e.e)) return false;
  return Object.entries(e).every(([k, v]) => ["type", "from", "to", "pos"].includes(k) || !v || typeof v !== "object" || (v.e && pure(v)));
};
export function integerPackedOperand(e, render) {
  const value = literal(e);
  if (value !== null) return value >= MIN && value <= MAX ? `int64(${value})` : null;
  if (e.e === "conv" && e.kind === "i2pc" && ["i", "int8"].includes(e.from.k) && pure(e.x)) return `int64(${render(e.x)})`;
  return null;
}
export function emitPackedInt8(e, render, helper) {
  if (e.kind !== "p2i8") return null;
  const leaf = integerPackedOperand(e.x, render);
  if (leaf !== null) return leaf;
  if (!e.arith) return null;
  let operations = 0;
  const walk = (n, root = false) => {
    const operand = integerPackedOperand(n, render);
    if (operand !== null) return operand;
    if (n.e === "neg") { const x = walk(n.x); operations++; return x === null ? null : `abap.SubI8(0, ${x})`; }
    if (n.e !== "bin" || !I8_OPS[n.op] || (n.op === "/" && !root)) return null;
    const l = walk(n.l), r = walk(n.r);
    operations++;
    return l === null || r === null ? null : `${I8_OPS[n.op]}(${l}, ${r})`;
  };
  const fast = walk(e.x, true);
  if (fast === null) return null;
  // A single operator has no wider intermediate to preserve. For compound
  // trees, retry the original expression if any integral intermediate spills.
  if (operations === 1) return fast;
  // A root / over a compound tree may round twice in the packed calculation.
  if (e.x.op === "/") return null;
  return `${helper("intarith.Packed")}(func() int64 { return ${fast} }, func() int64 { return abap.PToI8(${render(e.x)}, true) })`;
}
export function emitPackedComparison(c, render) {
  if (c.c !== "cmp" || c.type?.k !== "p") return null;
  const l = integerPackedOperand(c.l, render), r = integerPackedOperand(c.r, render);
  return l === null || r === null ? null : `${l} ${c.op === "=" ? "==" : c.op === "<>" ? "!=" : c.op} ${r}`;
}
