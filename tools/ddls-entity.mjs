// The entity a DDL source defines. A DDLS object's name (its file) need not
// be the entity: `cds_tf_x.ddls.asddls` may define `CdsFrwk_tf_x`, and an
// AMDP names the entity in FOR TABLE FUNCTION, never the DDL source. Both
// the folder dictionary and the object store look a DDLS up by this name
// when the file name does not match, so the coverage count and the runtime
// agree (foreman-dell, 2026-09-23).

/**
 * Comments out of DDL source, quote-aware: `'see http://x'` or `'a /* b'`
 * in an annotation is not a comment. `//`, `--` (a DDLS written on a system
 * uses both) and block comments become one blank each.
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
    } else if ((ch === "/" && text[i + 1] === "/") || (ch === "-" && text[i + 1] === "-")) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      out += " ";
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const DEFINES = new RegExp("\\bdefine\\s+(?:root\\s+)?(?:" + [
  "table\\s+function", "table\\s+entity", "hierarchy", "transient\\s+view\\s+entity",
  "view\\s+entity", "view", "abstract\\s+entity", "custom\\s+entity",
].join("|") + ")\\s+([\\w/]+)", "i");

/** the name after `define [root] table function|table entity|hierarchy|view [entity]|... entity`, comments skipped */
export function entityOf(source) {
  const m = DEFINES.exec(stripComments(String(source)));
  return m === null ? undefined : m[1].toUpperCase();
}
