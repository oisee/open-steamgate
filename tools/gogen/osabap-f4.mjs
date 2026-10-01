// Work only on statements accepted by abaplint. Source spans keep comments and
// string literals byte-for-byte intact when the converter's F4 shortcut needs
// an assignment spelled as MOVE.
export function prepareF4(source, parsed) {
  const statements = parsed.units[0].statements;
  const fields = [];
  const dialogCalls = [];
  const edits = [];
  let active;
  for (const st of statements) {
    if (st.kind === "AtSelectionScreen") {
      const words = st.text.replace(/\s+/g, " ").trim();
      if (/^AT SELECTION-SCREEN ON HELP-REQUEST\b/i.test(words)) {
        throw new Error("ON HELP-REQUEST (F1) is not supported by osabap");
      }
      active = /^AT SELECTION-SCREEN ON VALUE-REQUEST FOR ([A-Z][A-Z0-9_]*)\s*\.$/i.exec(words)?.[1]?.toUpperCase();
      if (active) fields.push(active);
      continue;
    }
    if (["StartOfSelection", "EndOfSelection", "Initialization", "TopOfPage", "AtLineSelection", "AtUserCommand"].includes(st.kind)) active = undefined;
    if (!active) continue;
    if (st.kind === "Call" && /\bCL_GUI_FRONTEND_SERVICES\s*=>\s*(FILE_OPEN_DIALOG|FILE_SAVE_DIALOG|DIRECTORY_BROWSE)\b/i.test(st.text)) {
      dialogCalls.push(st);
    }
    if (st.kind !== "Move") continue;
    const original = source.slice(st.span.startOffset, st.span.endOffset);
    // The parser has already found the statement's final period. Internal
    // periods in a quoted value are data, not another statement boundary.
    const match = new RegExp(`^(${active})\\s*=\\s*([\\s\\S]+)\\.$`, "i").exec(original.trim());
    if (match) edits.push({start: st.span.startOffset, end: st.span.endOffset, text: `MOVE ${match[2]} TO ${match[1]}.`});
  }
  let convertedSource = source;
  for (const edit of edits.reverse()) convertedSource = convertedSource.slice(0, edit.start) + edit.text + convertedSource.slice(edit.end);
  return {fields: [...new Set(fields)], dialogCalls, convertedSource};
}
