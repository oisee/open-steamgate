// ABAPiti r1-r6: splice bytes; f2: MATCH OFFSET includes the section base.
export function emitByteStatement(st, ctx, t, {expr, place}) {
  const val = (x, fallback) => x ? expr(x, ctx) : fallback;
  if (st.s === "replace_bytes") {
    const target = place(st.target, ctx);
    return [`${t}${target}, s.Sy.Subrc = abap.ReplaceBytes(${target}, ${expr(st.with, ctx)}, ${val(st.off, "0")}, ${val(st.len, "abap.NoLength")}, ${st.target.type.k === "x" ? st.target.type.len : -1})`];
  }
  const pattern = expr(st.pattern, ctx);
  const n = ctx.loop++, fp = `bytePattern${n}`, fb = `byteOffset${n}`, ok = `byteFound${n}`;
  const lines = [`${t}{`, `${t}${fp} := ${pattern}`, `${t}if ${fb}, ${ok} := abap.FindBytes(${expr(st.subject, ctx)}, ${fp}, ${val(st.secOff, "0")}, ${val(st.secLen, "abap.NoLength")}); ${ok} {`, `${t}\ts.Sy.Subrc = 0`];
  lines.push(`${t}\t${st.off ? place(st.off, ctx) : "_"} = ${fb}`);
  if (st.len) lines.push(`${t}\t${place(st.len, ctx)} = int32(len(${fp}))`);
  lines.push(`${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`, `${t}}`);
  return lines;
}
