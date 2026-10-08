// Deterministic rendering of hand-entered #642 facts; no server imports or SAP payloads.
const xmlEscape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const structureAttributes = (e) => [
  `adtcore:name="${xmlEscape(e.name)}"`, `adtcore:type="${xmlEscape(e.type)}"`,
  ...["visibility", "level", "clif_name", "testclass", "testmethod", "final"].flatMap((k) =>
    e[k] === undefined ? [] : [`${k}="${xmlEscape(e[k])}"`]),
  ...(e.uri === undefined ? [] : [`abapsource:sourceUri="${xmlEscape(e.uri)}"`]),
  ...Object.entries(e.extra ?? {}).map(([k, v]) => `${k}="${xmlEscape(v)}"`),
].join(" ");
const structureLinks = (e, pad) => (e.links ?? []).map((l) =>
  `${pad}<atom:link rel="http://www.sap.com/adt/relations/source/${xmlEscape(l.rel)}" href="${xmlEscape(l.href)}"${l.type === undefined ? "" : ` type="${xmlEscape(l.type)}"`}/>`);

export function outlineBytes(object, options = {}) {
  const element = (e, indent) => {
    const pad = " ".repeat(indent);
    const inner = [...structureLinks(e, pad + "  "), ...(e.children ?? []).map((c) => element(c, indent + 2))];
    return inner.length === 0 ? `${pad}<abapsource:objectStructureElement ${structureAttributes(e)}/>`
      : `${pad}<abapsource:objectStructureElement ${structureAttributes(e)}>\n${inner.join("\n")}\n${pad}</abapsource:objectStructureElement>`;
  };
  const inner = [...structureLinks(object, "  "), ...(object.children ?? []).map((c) => element(c, 2))];
  return `<?xml version="1.0" encoding="utf-8"?>
<abapsource:objectStructureElement xmlns:abapsource="http://www.sap.com/adt/abapsource"
                                   xmlns:adtcore="http://www.sap.com/adt/core"
                                   xmlns:atom="http://www.w3.org/2005/Atom"${options.base === undefined ? "" : `
                                   xml:base="${xmlEscape(options.base)}"`}
                                   ${structureAttributes(object)}${object.version === undefined ? "" : ` adtcore:version="${xmlEscape(object.version)}"`}>
${inner.join("\n")}
</abapsource:objectStructureElement>
`;
}

