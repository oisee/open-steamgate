// A CALL FUNCTION's typed values, shaped the way the RUNTIME shapes them.
//
// Written once here because the second destination's tests were about to
// invent them a second time, and the first invention was wrong in a way that
// passed: the original fixture asked for `{EXPORTING: {...}}` and the
// destination obliged, because both were mine. The real contract is
// `tools/rfc-replay.mjs` -- a destination does not return an answer, it
// FILLS the caller's typed values, the direction names are ABAP's in lower
// case, and the ABAP `EXPORTING` is the module's input. A real CALL FUNCTION
// is what said so: the ST05 screen rendered, said "off", showed no error,
// and every button did the same thing, because nothing was ever assigned.
//
// The parameter names a caller writes with these are deliberately MIXED
// case: the case a name arrives in is the runtime's business, and asking for
// `IV_COMMAND` exactly is what once made every command fall back to a
// default.

export function box(value) {
  return {
    value,
    get() { return this.value; },
    set(v) { this.value = v; return this; },
  };
}

/** a structure: `get()` gives the fields, each of them a box, and `clone()`
 *  is how `fromJson` makes a row */
export function structure(fields) {
  const boxes = Object.fromEntries(fields.map((f) => [f, box("")]));
  return {
    get() { return boxes; },
    clone() { return structure(fields); },
    plain() { return Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, v.get()])); },
  };
}

/** an internal table the way `fromJson` recognises one: `array`, `clear`,
 *  `append`, and a row type it clones. The first fixture invented for this
 *  had `append` making its own row, and `fromJson` never touched it. */
export function rows(fields) {
  const table = [];
  const rowType = structure(fields);
  return {
    array() { return table; },
    getRowType() { return rowType; },
    clear() { table.length = 0; },
    append(row) { table.push(row); return row; },
    plain() { return table.map((r) => r.plain()); },
  };
}

/** what a signature answered, as plain values */
export function answerOf(signature) {
  const out = {};
  for (const [name, value] of Object.entries(signature.importing ?? {})) {
    out[name.toUpperCase()] = value.get();
  }
  for (const [name, table] of Object.entries(signature.tables ?? {})) {
    out[name.toUpperCase()] = table.plain();
  }
  return out;
}
