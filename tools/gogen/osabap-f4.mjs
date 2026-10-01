// Work only on statements accepted by abaplint. Source spans keep comments and
// string literals byte-for-byte intact when the converter's F4 shortcut needs
// assignments spelled as MOVE.
export function prepareF4(source, parsed) {
  const statements = parsed.units[0].statements;
  const fields = [];
  const events = [];
  const dialogCalls = [];
  const edits = [];
  let active;
  for (const st of statements) {
    if (st.kind === "AtSelectionScreen") {
      const words = st.text.replace(/\s+/g, " ").trim();
      if (/^AT SELECTION-SCREEN ON HELP-REQUEST\b/i.test(words)) {
        throw new Error("ON HELP-REQUEST (F1) is not supported by osabap");
      }
      const request = /^AT SELECTION-SCREEN ON VALUE-REQUEST FOR ([A-Z][A-Z0-9_]*(?:-(?:LOW|HIGH))?)\s*\.$/i.exec(words);
      if (/^AT SELECTION-SCREEN ON VALUE-REQUEST\b/i.test(words) && !request) {
        throw new Error(`unsupported ON VALUE-REQUEST target: ${words}`);
      }
      active = request?.[1]?.toUpperCase();
      if (active) {
        fields.push(active);
        events.push(active);
      }
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
    // The converter searches for the first simple assignment anywhere in the
    // event and replaces the whole body with its value. Rewriting just the F4
    // field still loses the body if a helper assignment comes first (or later).
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*([\s\S]+)\.$/i.exec(original.trim());
    if (match) edits.push({start: st.span.startOffset, end: st.span.endOffset, text: `MOVE ${match[2]} TO ${match[1]}.`});
  }
  let convertedSource = source;
  for (const edit of edits.reverse()) convertedSource = convertedSource.slice(0, edit.start) + edit.text + convertedSource.slice(edit.end);
  return {fields: [...new Set(fields)], events, dialogCalls, convertedSource};
}
