// Property documents observed on the program and CDS base resources.
// They are different representations from /objectstructure. Publish source
// and package links we can serve, not SAP-only history/GUI/enhancement links.
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const SOURCE_PROPERTY_MIME = {
  PROG: "application/vnd.sap.adt.programs.programs.v3+xml",
  DDLS: "application/vnd.sap.adt.ddlSource+xml",
};

export function sourcePropertiesDocument(type, object) {
  const program = type === "PROG";
  if (SOURCE_PROPERTY_MIME[type] === undefined) {
    throw new Error(`No observed property document for ${type}`);
  }
  const prefix = program ? "program" : "ddl";
  const root = program ? "abapProgram" : "ddlSource";
  const namespace = program ? "programs/programs" : "ddic/ddlsources";
  const when = escape(object.changedAt ?? "1970-01-01T00:00:00Z");
  const who = escape(object.changedBy ?? "OSD");
  const properties = program
    ? 'program:lockedByEditor="false"' + (/^\s*report\b/im.test(object.source) ? ' program:programType="executableProgram"' : "")
    : 'ddl:source_origin="0" ddl:source_origin_description="ABAP Development Tools"' +
      (/\bdefine\s+(?:root\s+)?view\s+entity\b/i.test(object.source)
        ? ' ddl:source_type="view entity" ddl:source_type_description="View Entity"' : "");
  return `<?xml version="1.0" encoding="utf-8"?>
<${prefix}:${root} xmlns:${prefix}="http://www.sap.com/adt/${namespace}"
 xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource"
 xmlns:atom="http://www.w3.org/2005/Atom" ${properties}
 adtcore:name="${escape(object.name)}" adtcore:type="${program ? "PROG/P" : "DDLS/DF"}"
 adtcore:description="${escape(object.description)}" adtcore:version="active"
 adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="standard"
 adtcore:createdAt="${when}" adtcore:changedAt="${when}"
 adtcore:createdBy="${who}" adtcore:changedBy="${who}" adtcore:responsible="${who}"
 abapsource:sourceUri="source/main" abapsource:fixPointArithmetic="${program}"
 abapsource:activeUnicodeCheck="${program}">
  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>
  <adtcore:packageRef adtcore:name="${escape(object.package)}" adtcore:type="DEVC/K"
   adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(String(object.package ?? "").toLowerCase())}"/>
${program ? `  <abapsource:syntaxConfiguration><abapsource:language>
    <abapsource:version>X</abapsource:version><abapsource:description>Standard ABAP</abapsource:description>
  </abapsource:language></abapsource:syntaxConfiguration>\n` : ""}</${prefix}:${root}>
`;
}
