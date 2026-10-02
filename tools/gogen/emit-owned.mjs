// Owned xstring emission leaves types, signatures and generic descriptors alone.
export function ownedExpression(e, ctx, h) {
  const {ownership, expr, place} = h;
  if (ownership.has(e, ctx)) return `${place(e, ctx)}.Snapshot()`;
  if (e.e === "xstrlen" && ownership.has(e.x, ctx)) return `${place(e.x, ctx)}.Len()`;
  if (e.e === "substr" && ownership.has(e.x, ctx)) return `${place(e.x, ctx)}.Sub(${e.off ? expr(e.off, ctx) : "0"}, ${e.len ? expr(e.len, ctx) : "-1"})`;
  return null;
}

const purePart = (n) => {
  if (!n || typeof n !== "object") return true;
  if (Array.isArray(n)) return n.every(purePart);
  if (n.e && !["var", "attr", "static", "const", "xbytes", "substr", "conv", "int", "zero", "temp"].includes(n.e)) return false;
  return Object.entries(n).every(([k, v]) => k === "type" || purePart(v));
};

export function ownedStatement(st, ctx, t, h) {
  const {ownership, expr, place} = h;
  if (!ownership.has(st.target, ctx)) return null;
  const target = place(st.target, ctx);
  if (st.s === "assign") return [`${t}${target}.Set(${expr(st.value, ctx)})`];
  if (st.s === "clear") return [`${t}${target}.Clear()`];
  if (st.s === "replace_bytes") return [`${t}s.Sy.Subrc = ${target}.Replace(${expr(st.with, ctx)}, ${st.off ? expr(st.off, ctx) : "0"}, ${st.len ? expr(st.len, ctx) : "abap.NoLength"})`];
  if (st.s === "concat_bytes") {
    if (!st.table && st.parts.slice(1).every(purePart) && st.parts[0] && ownership.has(st.parts[0], ctx) && place(st.parts[0], ctx) === target) {
      return [`${t}${target}.Append(${st.parts.slice(1).map((x) => expr(x, ctx)).join(", ")})`, `${t}s.Sy.Subrc = 0`];
    }
    const value = byteConcatValue(st, ctx, expr, h.rowValue);
    return [`${t}${target}.Set(${value})`, `${t}s.Sy.Subrc = 0`];
  }
  return null;
}

function byteConcatValue(st, ctx, expr, rowValue) {
  if (st.table) return `func() string { var b []string; for _, ConcatRowStored := range ${expr(st.table, ctx)} { ConcatRow := ${rowValue(st.table.type, "ConcatRowStored")}; b = append(b, ${expr(st.row, ctx)}) }; return strings.Join(b, "") }()`;
  return st.parts.map((x) => expr(x, ctx)).join(" + ");
}

// The ordinary byte concatenation path is unchanged, including fixed-x fitting.
export function emitByteConcat(st, ctx, t, {expr, place, rowValue}) {
  if (st.table) {
    return [`${t}${place(st.target, ctx)} = func() string { var b []string; for _, ConcatRowStored := range ${expr(st.table, ctx)} { ConcatRow := ${rowValue(st.table.type, "ConcatRowStored")}; b = append(b, ${expr(st.row, ctx)}) }; return strings.Join(b, "") }()`, `${t}s.Sy.Subrc = 0`];
  }
  if (st.fixed !== undefined) return [`${t}${place(st.target, ctx)}, s.Sy.Subrc = abap.CatBytesX(${st.fixed}, ${st.parts.map((x) => expr(x, ctx)).join(" + ")})`];
  // x = x + y grows x where it lies (abap.AppendBytes), not by a copy of x
  if (st.parts.length === 2 && expr(st.parts[0], ctx) === place(st.target, ctx)) {
    return [`${t}${place(st.target, ctx)} = abap.AppendBytes(${place(st.target, ctx)}, ${expr(st.parts[1], ctx)})`, `${t}s.Sy.Subrc = 0`];
  }
  return [`${t}${place(st.target, ctx)} = ${st.parts.map((x) => expr(x, ctx)).join(" + ")}`, `${t}s.Sy.Subrc = 0`];
}
