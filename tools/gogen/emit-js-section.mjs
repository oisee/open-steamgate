// String storage is one JS character per byte for x/xstring; character
// sections count Unicode characters. Validate before touching the target.
export function emitSectionStatement(st, ctx, t, {expr, place}) {
  const bytes = st.s === "replace_bytes";
  const limit = ["x", "c"].includes(st.target.type.k) ? st.target.type.len : -1;
  const target = place(st.target, ctx);
  const off = st.off ? expr(st.off, ctx) : "0";
  const len = st.len ? expr(st.len, ctx) : "abap.NoLength";
  return [`${t}{ const [v, rc] = ((b, w, o, n, limit) => {
    ${!bytes && limit >= 0 ? 'b = b.padEnd(limit, " ");' : ""}
    const chars = Array.from(b), end = n === abap.NoLength ? chars.length : o + n;
    if (o < 0 || o > chars.length || end < o || end > chars.length) throw new abap.AbapError("CX_SY_RANGE_OUT_OF_BOUNDS", "section offset/length");
    let result = chars.slice(0, o).concat(Array.from(w), chars.slice(end));
    const rc = limit >= 0 && result.length > limit ? 2 : 0;
    if (limit >= 0) result = result.slice(0, limit);
    let value = result.join("");
    ${bytes ? 'if (limit >= 0) value = abap.XFit(value, limit);' : 'if (limit >= 0) value = value.replace(/ +$/, "");'}
    return [value, rc];
  })(${target}, ${expr(st.with, ctx)}, ${off}, ${len}, ${limit}); ${target} = v; s.sy.subrc = rc; }`];
}
