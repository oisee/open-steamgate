// Preserve the complete INTERFACES region: cold generators read its spelling.
// Mask comments and literals without moving offsets, then find ABAP periods.
export function interfacesOf(text) {
  let code = "", literal;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (literal) {
      code += ch === "\n" ? "\n" : " ";
      if (literal === "|" && ch === "\\" && i + 1 < text.length) { code += " "; i++; }
      else if (ch === literal) {
        if (text[i + 1] === literal) { code += " "; i++; }
        else literal = undefined;
      }
    } else if (ch === '"' || (ch === "*" && (i === 0 || text[i - 1] === "\n"))) {
      while (i < text.length && text[i] !== "\n") { code += " "; i++; }
      if (i < text.length) code += "\n";
    } else if (["'", "`", "|"].includes(ch)) {
      literal = ch; code += " ";
    } else code += ch;
  }
  return [...code.matchAll(/(?:^|(?<=\.))\s*(INTERFACES\b[^.]*\.)/gim)]
    .map(m => text.slice(m.index + m[0].length - m[1].length, m.index + m[0].length)).join("\n");
}
