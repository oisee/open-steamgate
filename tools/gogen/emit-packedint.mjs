// Keep the measured checksum optimization in classes with owned memory.
// Packed fields and method signatures retain their ordinary string ABI.
export function packedChecksum(e, ctx, {ownership, expr, helper}) {
  if (!ctx.cls.attributes?.some((a) => a.type.k === "xstring" && ownership.has({e: "attr", name: a.name}, ctx))) return null;
  if (e.e !== "conv" || e.kind !== "p2p" || !e.arith || e.to.dec || e.x?.e !== "bin" || e.x.op !== "+") return null;
  const {l, r} = e.x;
  if (l.e !== "var" || l.ref || l.type.k !== "p" || l.type.dec || r.e !== "conv" || r.kind !== "i2pc") return null;
  // A call may inspect escaped locals. Only an unescaped local/RETURNING sum
  // qualifies; parameters and reference actuals keep the original path.
  const mentions = (n) => n && typeof n === "object" &&
    ((n.e === "var" && n.name === l.name) || Object.entries(n).some(([k, v]) => k !== "type" && mentions(v)));
  if (!ownership.unescaped(l, ctx) || mentions(r.x)) return null;
  const a = expr(l, ctx), b = expr(r.x, ctx);
  return `func(a string, b int64) string { if v, ok := ${helper("packedint.Add")}(a, b, ${2 * e.to.len - 1}); ok { return v }; return abap.PFit(abap.AddP(a, abap.IToP(b)), ${e.to.len}, 0, true) }(${a}, int64(${b}))`;
}
