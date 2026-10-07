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
    } else if (ch === "#" && text[i + 1] === "#") {
      // a pragma is one token, ##NAME or ##NAME[arg]: its brackets may hold a
      // quote or backtick that opens no literal
      code += "  "; i += 2;
      while (i < text.length && /\w/.test(text[i])) { code += " "; i++; }
      if (text[i] === "[") {
        while (i < text.length && text[i] !== "]" && text[i] !== "\n") { code += " "; i++; }
        if (text[i] === "]") code += " "; else i--;
      } else i--;
    } else if (["'", "`", "|"].includes(ch)) {
      literal = ch; code += " ";
    } else code += ch;
  }
  return [...code.matchAll(/(?:^|(?<=\.))\s*(INTERFACES\b[^.]*\.)/gim)]
    .map(m => text.slice(m.index + m[0].length - m[1].length, m.index + m[0].length)).join("\n");
}

// Every raw line that names INTERFACES, comments and literals included. The
// cold transaction generator (osd-tran-registry.mjs) matches the raw text, so
// a change there must not pass warm even where no statement changed.
export function interfacesLines(text) {
  return text.split("\n").filter((line) => /INTERFACES/i.test(line)).map((line) => line.trimEnd()).join("\n");
}
