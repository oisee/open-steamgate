// Common ADT documents, shared with the ABAP helper fixture generator.
const xmlEscape = (s) => String(s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function namedItemsDocument(items = []) {
  return `<?xml version="1.0" encoding="utf-8"?>
<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
  <nameditem:totalItemCount>${items.length}</nameditem:totalItemCount>
${items.map((item) => `  <nameditem:namedItem><nameditem:name>${xmlEscape(item.name)}</nameditem:name><nameditem:description>${xmlEscape(item.description ?? "")}</nameditem:description>${item.data === undefined ? "" : `<nameditem:data>${xmlEscape(item.data)}</nameditem:data>`}</nameditem:namedItem>`).join("\n")}
</nameditem:namedItemList>
`;
}

export function objectReferencesDocument(objects) {
  const reference = (o) => {
    const attributes = [
      o.uri === undefined ? undefined : `adtcore:uri="${xmlEscape(o.uri)}"`,
      `adtcore:type="${xmlEscape(o.type)}"`,
      `adtcore:name="${xmlEscape(o.name)}"`,
      o.packageName === undefined ? undefined : `adtcore:packageName="${xmlEscape(o.packageName)}"`,
      o.description === undefined ? undefined : `adtcore:description="${xmlEscape(o.description)}"`,
    ].filter((a) => a !== undefined).join(" ");
    return `  <adtcore:objectReference ${attributes}/>`;
  };

  return `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
${objects.map(reference).join("\n")}
</adtcore:objectReferences>
`;
}

export function emptyFeedDocument({userFullName, systemID, title, self, updated}) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">' +
    `<atom:author><atom:name>${userFullName}</atom:name></atom:author>` +
    `<atom:contributor><atom:name>${systemID}</atom:name></atom:contributor>` +
    `<atom:link href="${self}" rel="self" type="application/atom+xml;type=feed"/>` +
    `<atom:title type="text">${title}</atom:title>` +
    `<atom:updated>${updated}</atom:updated>` +
    "</atom:feed>";
}
