// The entity a DDL source defines. A DDLS object's name (its file) need not
// be the entity: `cds_tf_x.ddls.asddls` may define `CdsFrwk_tf_x`, and an
// AMDP names the entity in FOR TABLE FUNCTION, never the DDL source. Both
// the folder dictionary and the object store look a DDLS up by this name
// when the file name does not match, so the coverage count and the runtime
// agree (foreman-dell, 2026-09-23).

/** the name after `define [root] table function|view [entity]|... entity`, comments skipped */
export function entityOf(source) {
  const text = String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?:\/\/|--).*$/gm, " ");
  const m = /\bdefine\s+(?:root\s+)?(?:table\s+function|view\s+entity|view|abstract\s+entity|custom\s+entity|transient\s+view\s+entity)\s+([\w/]+)/i.exec(text);
  return m === null ? undefined : m[1].toUpperCase();
}
