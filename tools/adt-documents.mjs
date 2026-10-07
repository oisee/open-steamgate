import {requestElements, elementsNamed, descendantsOf, attributeValue, namespaces} from "./adt-request-xml.mjs";
// The XML documents the ADT façade answers with, apart from the two that
// wave 0 already had. One file, because they share a vocabulary: every ADT
// document names things with `adtcore:name`, `adtcore:type` and a URI that
// points back into the resource tree, and getting that vocabulary wrong is
// what makes a client quietly show nothing.
//
// SHAPES PARTLY CONFIRMED. The data-preview document of wave 0 was verified
// by vsp's own reader against a running OSD. These two have not been, and
// the places where a guess is load-bearing are marked.
import {frameUri} from "./adt-unit-result.mjs";
export {frameUri, unitResultDocument} from "./adt-unit-result.mjs";
import {TYPES, NotFound} from "./osd-store.mjs";
import {localView} from "./osd-tmp-view.mjs";

export const xmlEscape = (s) => String(s)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

// ADT names an object type with a two-part code: the repository type, then
// the kind within it. A client uses these to choose an icon and an editor,
// and to decide which resource to ask for next.
export const ADT_TYPE = {
  CLAS: "CLAS/OC",
  INTF: "INTF/OI",
  PROG: "PROG/P",
  INCL: "PROG/I",
  FUGR: "FUGR/F",
  TABL: "TABL/DT",
  STRU: "TABL/DS",
  DTEL: "DTEL/DE",
  DOMA: "DOMA/DD",
  TTYP: "TTYP/DA",
  VIEW: "VIEW/DV",
  DDLS: "DDLS/DF",
  SRVD: "SRVD/SRV",
  SHLP: "SHLP/DH",
  MSAG: "MSAG/N",
  DEVC: "DEVC/K",
};

// A global class method. Local and test methods use CLAS/OLD.
const METHOD = "CLAS/OM";
// Repository tree/include documents still use this type; objectstructure does not.
const CLASS_INCLUDE = "CLAS/I";

// where an object lives in the resource tree, which is what a client follows
export function uriOf(type, name) {
  const collection = TYPES[type]?.adt;
  if (collection === undefined) {
    return undefined;
  }
  return `/sap/bc/adt/${collection}/${encodeURIComponent(String(name).toLowerCase())}`;
}

// ADT lines are 1-based, columns 0-based. Blocks end ON the period;
// identifier ends are the boundary after the name token (A4H 7.58).
const rangeUri = (at, source = "source/main") => `${source}#start=${at.row},${at.col}`
  + (at.endRow === undefined ? "" : `;end=${at.endRow},${at.endCol}`);
const span = (first, last, identifier = false) => ({
  row: first.getStart().getRow(), col: first.getStart().getCol() - 1,
  endRow: last.getEnd().getRow(), endCol: last.getEnd().getCol() - (identifier ? 1 : 2),
});
const sourceLink = (rel, first, last, source, type) => ({
  rel, href: rangeUri(span(first, last, rel.endsWith("Identifier")), source),
  ...(type === undefined ? {} : {type}),
});
const structureAttributes = (e) => [
  `adtcore:name="${xmlEscape(e.name)}"`, `adtcore:type="${xmlEscape(e.type)}"`,
  ...["visibility", "level", "clif_name", "testclass", "testmethod", "final"].flatMap((k) =>
    e[k] === undefined ? [] : [`${k}="${xmlEscape(e[k])}"`]),
  ...(e.uri === undefined ? [] : [`abapsource:sourceUri="${xmlEscape(e.uri)}"`]),
  ...Object.entries(e.extra ?? {}).map(([k, v]) => `${k}="${xmlEscape(v)}"`),
].join(" ");
const structureLinks = (e, pad) => (e.links ?? []).map((l) =>
  `${pad}<atom:link rel="http://www.sap.com/adt/relations/source/${xmlEscape(l.rel)}" href="${xmlEscape(l.href)}"${l.type === undefined ? "" : ` type="${xmlEscape(l.type)}"`}/>`);

export function objectStructureDocument(object, options = {}) {
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

// Every node of the given structure or statement kinds, in source order.
function findNodes(node, kinds, out = [], stopAtMatch = false) {
  const kind = node?.get?.()?.constructor?.name;
  if (kinds.includes(kind)) {
    out.push(node);
    if (stopAtMatch) return out;
  }
  for (const child of node?.getChildren?.() ?? []) {
    findNodes(child, kinds, out, stopAtMatch);
  }
  return out;
}

// The parts of a program, as the workbench names them (type codes and labels
// from the system's own type registry, a4h-adt-2026-09-14T2205.jsonl:22):
// subroutines PROG/PU, events PROG/PE, local classes PROG/PL and PROG/PP.
// The text elements PROG/PX come last and always, the way a class always
// carries its CLAS/OCX: the client's outline reads result[0] without a
// length check, and a two-line report has nothing else to list.
const PROGRAM_PARTS = {
  Form: "PROG/PU",
  ClassDefinition: "PROG/PL",
  ClassImplementation: "PROG/PP",
};
const PROGRAM_EVENTS = ["Initialization", "StartOfSelection", "EndOfSelection", "AtSelectionScreen",
  "AtSelectionScreenOutput", "TopOfPage", "EndOfPage", "AtLineSelection", "AtUserCommand", "LoadOfProgram"];
function programParts(object) {
  const parts = [];
  const file = object?.getMainABAPFile?.();
  const structure = file?.getStructure?.();
  if (structure === undefined || structure === null) {
    return parts;
  }
  const span = (first, last) => {
    const start = first?.getStart?.();
    const end = last?.getEnd?.() ?? last?.getStart?.();
    return start === undefined || end === undefined ? undefined
      : {row: start.getRow(), col: start.getCol(), endRow: end.getRow(), endCol: end.getCol()};
  };
  for (const node of findNodes(structure, Object.keys(PROGRAM_PARTS))) {
    const kind = node.get().constructor.name;
    const at = span(node.getFirstToken?.(), node.getLastToken?.());
    const tokens = node.getFirstStatement?.()?.getTokens?.() ?? [];
    const name = (tokens[1]?.getStr() ?? "").toUpperCase();
    if (name !== "" && at !== undefined) {
      parts.push({name, type: PROGRAM_PARTS[kind], uri: rangeUri(at)});
    }
  }
  for (const statement of file.getStatements?.() ?? []) {
    const kind = statement.get?.()?.constructor?.name;
    if (PROGRAM_EVENTS.includes(kind)) {
      const at = span(statement.getFirstToken?.(), statement.getLastToken?.());
      if (at !== undefined) {
        parts.push({name: statement.concatTokens?.().toUpperCase().replace(/\.$/, "") ?? kind, type: "PROG/PE", uri: rangeUri(at)});
      }
    }
  }
  return parts;
}

// Preserve the owning class and physical include before collecting members.
// Method names alone are not keys: several local/test classes may use RUN.
function classParts(object, globalName, type) {
  const classes = new Map();
  for (const file of object?.getSequencedFiles?.() ?? []) {
    const filename = file.getFilename();
    const include = /\.clas\.(locals_def|locals_imp|testclasses|macros)\.abap$/i.exec(filename)?.[1];
    const source = include === undefined ? "./source/main" : `./includes/${{
      locals_def: "definitions", locals_imp: "implementations", testclasses: "testclasses", macros: "macros",
    }[include.toLowerCase()]}`;
    for (const node of findNodes(file.getStructure?.(), ["ClassDefinition", "ClassImplementation", "Interface"])) {
      if (node.getFirstStatement === undefined) continue;
      const header = node.getFirstStatement();
      const token = header.getTokens()[1];
      const name = token.getStr().toUpperCase();
      const owner = classes.get(name) ?? {name, declarations: [], bodies: new Map()};
      classes.set(name, owner);
      const part = {node, token, source};
      if (node.get().constructor.name === "ClassImplementation") {
        owner.implementation = part;
        for (const method of findNodes(node, ["Method"])) {
          const token = method.getFirstStatement().getTokens()[1];
          owner.bodies.set(token.getStr().toUpperCase(), {node: method, token, source});
        }
      } else {
        owner.definition = part;
        let visibility = "public";
        // Data/ClassData/Constants structures own all nested components.
        // Collect the outer block once and do not descend into its members.
        for (const declaration of findNodes(node, ["Public", "Protected", "Private", "MethodDef", "InterfaceDef", "Aliases", "Data", "ClassData", "Constant", "Constants"], [], true)) {
          const statement = declaration.getFirstStatement?.() ?? declaration;
          const kind = statement.get().constructor.name;
          if (["Public", "Protected", "Private"].includes(kind)) {visibility = kind.toLowerCase(); continue;}
          owner.declarations.push({node: declaration, statement, kind, visibility, source});
        }
      }
    }
  }
  const partLinks = (definition, implementation, methodType) => [
    ...(definition === undefined ? [] : [sourceLink("definitionIdentifier", definition.token, definition.token, definition.source, methodType)]),
    ...(implementation === undefined ? [] : [sourceLink("implementationIdentifier", implementation.token, implementation.token, implementation.source,
      methodType === "CLAS/OLD" ? methodType : undefined)]),
    ...(definition === undefined ? [] : [sourceLink("definitionBlock", definition.node.getFirstToken(), definition.node.getLastToken(), definition.source)]),
    ...(implementation === undefined ? [] : [sourceLink("implementationBlock", implementation.node.getFirstToken(), implementation.node.getLastToken(), implementation.source)]),
  ];
  const build = (owner, local) => {
    const methodType = local ? "CLAS/OLD" : METHOD;
    const links = partLinks(owner.definition, owner.implementation);
    const children = [], listed = new Set(), interfaces = new Map();
    for (const {node, statement, kind, visibility, source} of owner.declarations) {
      const tokens = statement.getTokens();
      const structured = ["DataBegin", "ClassDataBegin", "ConstantBegin"].includes(kind);
      const keyword = kind === "MethodDef" ? "METHODS" : kind === "ClassData" ? "DATA" : undefined;
      const token = structured ? tokens[tokens.findIndex((t) => t.getStr().toUpperCase() === "OF") + 1]
        : keyword === undefined ? tokens[1] : tokens[tokens.findIndex((t) => t.getStr().toUpperCase() === keyword) + 1];
      const name = token.getStr().toUpperCase();
      const declared = {node, token, source};
      if (kind === "InterfaceDef") {
        interfaces.set(name, declared);
        const bodies = [...owner.bodies].filter(([n]) => n.startsWith(name + "~")).map(([, b]) => b);
        children.push({name, type: "CLAS/OR", links: [
          sourceLink("definitionIdentifier", token, token, source),
          ...bodies.map((b) => sourceLink("implementationIdentifier", b.token, b.token, b.source, methodType)),
          sourceLink("definitionBlock", statement.getFirstToken(), statement.getLastToken(), source),
        ]});
      } else if (kind === "MethodDef") {
        listed.add(name);
        children.push({name, type: methodType, visibility, level: tokens[0].getStr().toUpperCase() === "CLASS" ? "static" : "instance",
          clif_name: owner.name,
          ...(statement.concatTokens().toUpperCase().includes("FOR TESTING") ? {testmethod: "true"} : {}),
          links: partLinks(declared, owner.bodies.get(name), methodType)});
      } else {
        const alias = kind === "Aliases";
        children.push({name, type: alias ? "CLAS/OB" : "CLAS/OA", visibility,
          ...(alias ? {} : {level: ["ClassData", "Constant", "ClassDataBegin", "ConstantBegin"].includes(kind) ? "static" : "instance"}),
          links: partLinks(declared)});
      }
    }
    for (const [name, body] of owner.bodies) {
      if (listed.has(name)) continue;
      const intf = interfaces.get(name.split("~")[0]);
      children.push({name, type: methodType, visibility: "public", level: "instance", clif_name: owner.name, links: [
        ...(intf === undefined ? [] : [sourceLink("definitionIdentifier", intf.token, intf.token, intf.source, "CLAS/OR")]),
        sourceLink("implementationIdentifier", body.token, body.token, body.source, methodType),
        sourceLink("implementationBlock", body.node.getFirstToken(), body.node.getLastToken(), body.source),
      ]});
    }
    const header = owner.definition?.node.getFirstStatement().concatTokens().toUpperCase() ?? "";
    return {name: owner.name, type: local ? "CLAS/OCL" : ADT_TYPE[type],
      ...(local ? {} : {visibility: "public"}),
      ...(header.includes(" FINAL") ? {final: "true"} : {}),
      ...(header.includes("FOR TESTING") ? {testclass: "true"} : {}), links, children};
  };
  const root = classes.get(globalName);
  const result = root === undefined ? {name: globalName, type: ADT_TYPE[type], children: []} : build(root, false);
  for (const owner of classes.values()) if (owner !== root) result.children.push(build(owner, true));
  return result;
}

export function structureOf(store, type, name) {
  const entry = store.find(type, name);
  if (entry === undefined) return undefined;
  const object = store.registry().getObject(type === "INCL" ? "PROG" : type, entry.name);
  const result = ["CLAS", "INTF"].includes(type) ? classParts(object, entry.name, type)
    : {name: entry.name, type: ADT_TYPE[type] ?? type, uri: "source/main", children: []};
  if (type === "CLAS") result.children.push({name: entry.name, type: "CLAS/OCX",
    extra: {isExternalRef: "true", description: "Text Elements"},
    links: [{rel: "definitionIdentifier", href: `/sap/bc/adt/textelements/classes/${entry.name.toLowerCase()}`}],
  });
  if (type === "PROG" || type === "INCL") {
    result.children.push(...programParts(object), {name: entry.name, type: "PROG/PX", uri: "source/main"});
  }
  if (["INCL", "SRVD"].includes(type)) result.version = store.stateOf(entry).version;
  return result;
}

// The base resource of a class include. A client resolves a method body by
// asking for the implementations include, and it asks for the include object
// before it asks for the include's source. SHAPE NOT CONFIRMED: this answers
// with the include as an object, carrying the link to its source, and a
// client that wanted the source itself gets that instead when it says so in
// its Accept header.
// A class as the client asks for it before it opens one.
//
// GET /oo/classes/<name> is not a request for the class's structure. A4H
// answers it with class:abapClass — properties, links and one class:include
// per source part — and this façade answered with an objectStructureElement,
// which is the answer to a different question asked at a different URL. The
// client opens a class by reading this document and following its source
// link, so the wrong root element is the difference between a class that
// opens and one that does not.
//
// The include list is what the editor's tabs are built from. Only the parts
// this façade can actually serve are listed; naming one it cannot would give
// the editor a tab that fails when clicked.
export function classDocument(object, options = {}) {
  const name = object.name;
  const when = object.changedAt ?? "1970-01-01T00:00:00Z";
  const who = object.changedBy ?? "OSD";

  // Relative, as the real system writes them, and that is the whole of why a
  // class would not open. A client resolves these against the object's own
  // address; handed an absolute path it resolves to somewhere else or to
  // nothing. A4H's captured class document has sourceUri="source/main" and
  // href="objectstructure", both relative
  // (.local/capture/oracle/a4h-adt.jsonl:108), and no plain source link on the
  // root at all — the main source is an *include*,
  // which is the part that is not obvious.
  const link = (href, rel, type, title) =>
    `  <atom:link href="${xmlEscape(href)}" rel="${xmlEscape(rel)}"` +
    (type === undefined ? "" : ` type="${xmlEscape(type)}"`) +
    (title === undefined ? "" : ` title="${xmlEscape(title)}"`) +
    ' xmlns:atom="http://www.w3.org/2005/Atom"/>';

  // An include carries both of the system's source links, and that is not
  // padding.
  //
  // abap-adt-api parses a class:include with
  //   links: e["atom:link"].map(xmlNodeAttr)
  // — `.map` straight on the property, where the class root beside it goes
  // through its xmlArray helper first. An XML-to-object parser turns a single
  // child into an object and several into a list, so exactly one link here is
  // "e.atom:link.map is not a function" and the class will not open. A4H emits
  // four per include and never meets the case.
  //
  // These are the two the system points at the same href: the plain source and
  // its HTML rendering. Only text/plain is distinguished here — that URL
  // answers with the source whichever is asked for, and the client picks the
  // text/plain one by type. The versions link is served now
  // (tools/adt-versions.mjs) and comes first, as in the recorded corpus;
  // enhancement options are still not copied: nothing here serves them, and a
  // link that 404s is the failure this round was spent removing.
  const include = (kind, sourceUri) =>
    `  <class:include class:includeType="${kind}" abapsource:sourceUri="${sourceUri}"` +
    ' adtcore:name="" adtcore:type="CLAS/I"' +
    ` adtcore:changedAt="${when}" adtcore:version="${object.version ?? "active"}"` +
    ` adtcore:createdAt="${when}" adtcore:changedBy="${xmlEscape(who)}" adtcore:createdBy="${xmlEscape(who)}">\n` +
    `    <atom:link href="includes/${kind}/versions" rel="http://www.sap.com/adt/relations/versions"` +
    ' xmlns:atom="http://www.w3.org/2005/Atom"/>\n' +
    `    <atom:link href="${sourceUri}" rel="http://www.sap.com/adt/relations/source" type="text/plain"` +
    ' xmlns:atom="http://www.w3.org/2005/Atom"/>\n' +
    `    <atom:link href="${sourceUri}" rel="http://www.sap.com/adt/relations/source" type="text/html"` +
    ' xmlns:atom="http://www.w3.org/2005/Atom"/>\n' +
    "  </class:include>";

  // main first, as the system writes it last but a client looks for it by
  // type rather than by position; the rest are whatever this class has.
  const parts = [["main", "source/main"],
    ...(options.includes ?? []).map((part) => [part, `includes/${part}`])];

  return `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"
                 xmlns:abapoo="http://www.sap.com/adt/oo"
                 xmlns:abapsource="http://www.sap.com/adt/abapsource"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 class:final="false"
                 class:abstract="false"
                 class:visibility="public"
                 class:category="generalObjectType"
                 class:sharedMemoryEnabled="false"
                 abapoo:modeled="false"
                 abapsource:fixPointArithmetic="true"
                 abapsource:activeUnicodeCheck="true"
                 adtcore:name="${xmlEscape(name)}"
                 adtcore:type="CLAS/OC"
                 adtcore:version="${object.version ?? "active"}"
                 adtcore:language="EN"
                 adtcore:masterLanguage="EN"
                 adtcore:abapLanguageVersion="standard"
                 adtcore:responsible="${xmlEscape(who)}"
                 adtcore:createdAt="${when}"
                 adtcore:createdBy="${xmlEscape(who)}"
                 adtcore:changedAt="${when}"
                 adtcore:changedBy="${xmlEscape(who)}"
                 adtcore:descriptionTextLimit="60"
                 adtcore:description="${xmlEscape(object.description ?? "")}">
${link("objectstructure", "http://www.sap.com/adt/relations/objectstructure", "application/vnd.sap.adt.objectstructure.v2+xml")}
  <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(String(object.package ?? "").toLowerCase())}" adtcore:type="DEVC/K" adtcore:name="${xmlEscape(object.package ?? "")}"/>
  <abapsource:syntaxConfiguration>
    <abapsource:language>
      <abapsource:version>X</abapsource:version>
      <abapsource:description>Standard ABAP</abapsource:description>
      <atom:link href="/sap/bc/adt/abapsource/parsers/rnd/grammar" rel="http://www.sap.com/adt/relations/abapsource/parser" type="text/plain" title="Standard ABAP" xmlns:atom="http://www.w3.org/2005/Atom"/>
    </abapsource:language>
  </abapsource:syntaxConfiguration>
${parts.map(([kind, uri]) => include(kind, uri)).join("\n")}
</class:abapClass>
`;
}

export function classIncludeDocument(className, include, sourceUri) {
  return `<?xml version="1.0" encoding="utf-8"?>
<class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes"
                        xmlns:adtcore="http://www.sap.com/adt/core"
                        xmlns:atom="http://www.w3.org/2005/Atom"
                        adtcore:name="${xmlEscape(className)}"
                        adtcore:type="${CLASS_INCLUDE}"
                        class:includeType="${xmlEscape(include)}">
  <atom:link href="${xmlEscape(sourceUri)}" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>
</class:abapClassInclude>
`;
}

// ------------------------------------------------------------ packages

// A package document: what a package is, and what is above it. The contents
// are a separate resource, because a client asks for the tree lazily, one
// level at a time, rather than pulling a whole system.
export function packageDocument(pkg, options = {}) {
  // The shape a package editor binds to, which is not the shape of a package.
  //
  // Answering with a name, a type and a description used to be enough to say
  // what a package is. It is not enough to open one: the editor builds its
  // panels from these elements and, finding nothing to bind, failed with
  // "Failed to create the part's controls" — a UI error that says nothing
  // about the document behind it. Before that it crashed on a null changedAt.
  // Both times the document was not a smaller version of the real one, it was
  // an unusable one.
  //
  // So the structure is the real structure, from a system's own answer, and
  // the values are this façade's truth: nothing here has an application
  // component, a transport layer or a software component, and saying so
  // explicitly with isVisible="false" is what turns a missing panel into a
  // hidden one.
  //
  // Nothing here has an author or an edit history either — the objects are
  // files on disk — so the audit fields name the façade and sit at the epoch
  // rather than inventing a plausible person and a plausible afternoon. Both
  // stable on purpose: a timestamp that moved per request would tell a client
  // the package had just been edited, every time it looked.
  const when = pkg.changedAt ?? "1970-01-01T00:00:00Z";
  const who = pkg.changedBy ?? "OSD";
  const uriOfPackage = (name) => `/sap/bc/adt/packages/${encodeURIComponent(String(name).toLowerCase())}`;

  const parent = pkg.parent === undefined || pkg.parent === null ? "" :
    `\n  <pak:superPackage adtcore:uri="${uriOfPackage(pkg.parent)}" adtcore:type="DEVC/K" adtcore:name="${xmlEscape(pkg.parent)}"/>`;

  // Named for what they are rather than by a lookup: the client shows the
  // description beside the name, and an empty one reads as a broken row.
  const children = (pkg.subpackages ?? []).map((child) => {
    const name = typeof child === "string" ? child : child.name;
    const description = typeof child === "string" ? (options.describe?.(name) ?? "") : (child.description ?? "");
    return `    <pak:packageRef adtcore:uri="${uriOfPackage(name)}" adtcore:type="DEVC/K" adtcore:name="${xmlEscape(name)}" adtcore:description="${xmlEscape(description)}"/>`;
  }).join("\n");

  // Only the value helps this façade serves. A link to one it does not would
  // be a 404 waiting for the first time somebody opens the dropdown.
  const valueHelp = (rel, title) =>
    `  <atom:link href="/sap/bc/adt/packages/valuehelps/${rel}" rel="${rel}"` +
    ` type="application/vnd.sap.adt.nameditems.v1+xml" title="${title}" xmlns:atom="http://www.w3.org/2005/Atom"/>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:uri="${uriOfPackage(pkg.name)}"
             adtcore:name="${xmlEscape(pkg.name)}"
             adtcore:type="DEVC/K"
             adtcore:version="active"
             adtcore:language="EN"
             adtcore:masterLanguage="EN"
             adtcore:responsible="${xmlEscape(who)}"
             adtcore:createdAt="${when}"
             adtcore:createdBy="${xmlEscape(who)}"
             adtcore:changedAt="${when}"
             adtcore:changedBy="${xmlEscape(who)}"
             adtcore:descriptionTextLimit="60"
             adtcore:description="${xmlEscape(pkg.description ?? "")}">
${valueHelp("applicationcomponents", "Application Components Value Help")}
${valueHelp("softwarecomponents", "Software Components Value Help")}
${valueHelp("transportlayers", "Transport Layers Value Help")}
${valueHelp("translationrelevances", "Transport Relevances Value Help")}
${valueHelp("abaplanguageversions", "ABAP Language Version Value Help")}
  <pak:attributes pak:packageType="development"
                  pak:isPackageTypeEditable="false"
                  pak:isAddingObjectsAllowed="${pkg.library === true ? "false" : "true"}"
                  pak:isAddingObjectsAllowedEditable="false"
                  pak:isEncapsulated="false"
                  pak:isEncapsulationEditable="false"
                  pak:isEncapsulationVisible="false"
                  pak:recordChanges="false"
                  pak:isRecordChangesEditable="false"
                  pak:isSwitchVisible="false"
                  pak:languageVersion=""
                  pak:isLanguageVersionVisible="true"
                  pak:isLanguageVersionEditable="false"/>${parent}
  <pak:applicationComponent pak:name="" pak:description="No application component assigned" pak:isVisible="true" pak:isEditable="false"/>
  <pak:transport>
    <pak:softwareComponent pak:name="LOCAL" pak:description="Local Developments (No Automatic Transport)" pak:isVisible="true" pak:isEditable="false"/>
    <pak:transportLayer pak:name="" pak:description="" pak:isVisible="false" pak:isEditable="false"/>
  </pak:transport>
  <pak:useAccesses pak:isVisible="false"/>
  <pak:packageInterfaces pak:isVisible="false"/>
  <pak:subPackages>
${children}
  </pak:subPackages>
</pak:package>
`;
}

// A value help with nothing in it, which is the true answer here.
//
// The package editor's dropdowns ask for these. Offering the links and not
// the resource would turn every dropdown into a 404; offering neither hides
// fields the editor expects to find. An empty list says "this system has no
// application components" and the editor shows an empty dropdown, which is
// exactly right.
// The contents of one node of the repository tree. A client walks this: it
// asks for a package and gets its subpackages and its objects, each with the
// URI to ask about next.
//
// This shape is preserved from an earlier working OSD response
// (.local/capture/oracle/osd-adt.jsonl:340), not measured from A4H. It
// corrects the note that used to stand here saying the shape was unconfirmed.
//
// The document has three tables, and this used to send one. TREE_CONTENT
// alone is why package contents did not appear: the objects were all there
// and the client had nowhere to put them.
//
// The grouping is the part that is not obvious. The folders a client shows —
// Classes, Interfaces, Programs — are themselves rows in TREE_CONTENT, with a
// DEVC/xx type, an empty name and a NODE_ID. OBJECT_TYPES then gives each
// folder its label and ties each real object type to a category, and
// CATEGORIES gives the categories theirs. So the tree's shape is data, not
// structure, which is why sending the objects by themselves produced a
// package that looked empty rather than one that looked wrong.
//
// The folder codes below are the ones retained in that earlier OSD response.
// A type with no evidenced code is emitted without a folder rather than under
// an invented one: an ungrouped object is visible and slightly untidy, and a
// wrong DEVC code is a folder a client may refuse to draw at all.
export const TREE_FOLDER = {
  DEVC: ["DEVC/K", "Subpackages"],
  CLAS: ["DEVC/OC", "Classes"],
  INTF: ["DEVC/OI", "Interfaces"],
  PROG: ["DEVC/P", "Programs"],
  FUGR: ["DEVC/F", "Function Groups"],
  TRAN: ["DEVC/T", "Transactions"],
};

// Which drawer of the workbench a type belongs in. The earlier OSD response
// at .local/capture/oracle/osd-adt.jsonl:340 uses source_library and other for
// this tree; it is evidence of working OSD output, not an A4H measurement.
export const TREE_CATEGORY = {
  CLAS: "source_library", INTF: "source_library", PROG: "source_library",
  FUGR: "source_library", INCL: "source_library", MSAG: "source_library",
  TABL: "dictionary", DTEL: "dictionary", DOMA: "dictionary",
  TTYP: "dictionary", DDLS: "dictionary", SRVD: "dictionary",
  VIEW: "dictionary", SHLP: "dictionary",
};

// The label of a type's drawer, for the kinds that have no folder label
// above. Read by the client from OBJECT_TYPE_LABEL on the type's own row;
// an empty one shows the bare type in angle brackets.
export const TREE_TYPE_LABEL = {
  INCL: "Includes", MSAG: "Message Classes",
  TABL: "Database Tables", DTEL: "Data Elements", DOMA: "Domains",
  TTYP: "Table Types", DDLS: "Data Definitions",
  SRVD: "Service Definitions", VIEW: "Views", SHLP: "Search Helps",
};

export const TREE_CATEGORY_LABEL = {
  source_library: "Source Code Library",
  dictionary: "Dictionary",
  other: "Others",
};

export function nodeStructureDocument(nodes, options = {}) {
  // NODE_ID is assigned per document by the system that writes it, so these
  // are ours and need only be consistent within this answer.
  let next = 1;
  const id = () => String(next++).padStart(6, "0");

  const bare = (type) => String(type ?? "").split("/")[0];
  const present = [];
  for (const n of nodes) {
    const kind = bare(n.type);
    // A subpackage is a row of the tree and not a drawer. Whenever DEVC/K
    // appeared in OBJECT_TYPES the client bound every package row to the
    // first one — a click on $STG_SEGW asked the server for $STG_APC, a
    // click on $STG for the first root — and wherever it was absent (the
    // flat root) packages opened as themselves. Three observations, one
    // rule: the package rows stay in TREE_CONTENT, and no type describes
    // them; the client handles package rows on its own
    // (removePackageNodesIfNecessary in the tree contract).
    if (kind === "DEVC") {
      continue;
    }
    if (present.includes(kind) === false) {
      present.push(kind);
    }
  }

  // The drawers are the client's to build, not ours to send.
  //
  // This used to add a row per kind to TREE_CONTENT — DEVC/OC "Classes",
  // DEVC/K "Subpackages" — with the label on that row and nothing on the
  // type's own entry in OBJECT_TYPES. The client never reads those rows as
  // drawers: it groups TREE_CONTENT by OBJECT_TYPE itself and names each
  // drawer from that type's OBJECT_TYPE_LABEL and CATEGORY
  // (.local/sessions/2026-09-15-tree-contract-from-client.md, §2-§4:
  // createUniqueCategoryNodeMap keys on the category label, the type drawer
  // falls back to the bare type when its label is empty). So the invented
  // rows appeared as what they were — a package with no name, shown as
  // "???", and a class type shown as "<CLAS/OC>" — while the labels meant
  // for them sat on rows nobody used. Now each type carries its own
  // category and label, and TREE_CONTENT holds objects and nothing else.
  const objectTypes = [];
  const categories = new Set();
  const kindByNode = new Map();
  for (const kind of present) {
    const category = TREE_CATEGORY[kind] ?? "other";
    categories.add(category);
    const typeOf = nodes.find((n) => bare(n.type) === kind)?.type ?? kind;
    const typeNode = id();
    kindByNode.set(typeNode, kind);
    objectTypes.push({type: typeOf, category,
      // a kind with no label of its own gets none: the client then shows the
      // bare type, which is at least not a code dressed up as a name
      label: TREE_FOLDER[kind]?.[1] ?? TREE_TYPE_LABEL[kind] ?? "",
      node: typeNode});
  }

  // A URI element must never be sent empty. The client's row parser does
  // `new URI(getSimpleValue())` for OBJECT_URI and OBJECT_VIT_URI with no
  // empty-string guard (RepositoryObjectListItem.accept@42-64), so an empty
  // <OBJECT_VIT_URI/> becomes URI(""), and AbapRepositoryBaseNode.
  // objectReferencesAreEqual compares nodes by URI.getPath() — "" equals ""
  // — so every row collides with the first, and TreeExpanderJob returns
  // list.get(0). That is the whole of "clicking $STG_SEGW opens $STG_APC",
  // "the neighbours get jerked", and "Loading repository tree ..." with no
  // request: the clicked node never resolves to itself. Proven by byte-code
  // (.local/scratch/answer-tree-identity.md). The other empty elements —
  // NODE_ID, PARENT_NAME — the client reads through a guard and are kept
  // self-closed, because the A4H oracle sends them that way.
  const OMIT_WHEN_EMPTY = new Set(["OBJECT_URI", "OBJECT_VIT_URI"]);
  const row = (fields) => "    <SEU_ADT_REPOSITORY_OBJ_NODE>" +
    Object.entries(fields).flatMap(([name, value]) =>
      value === ""
        ? (OMIT_WHEN_EMPTY.has(name) ? [] : [`<${name}/>`])
        : [`<${name}>${xmlEscape(String(value))}</${name}>`]).join("") +
    "</SEU_ADT_REPOSITORY_OBJ_NODE>";

  // The DEVC root is not a package and has no virtual drawers. An earlier
  // working OSD response, not an A4H measurement, lists packages directly
  // and omits CATEGORIES, OBJECT_TYPES and NODE_ID
  // (.local/capture/oracle/cloud-adt.jsonl:132). Adding a synthetic
  // "Subpackages" type node here makes Eclipse bind every displayed package
  // to the first DEVC/K object, so clicking $STG asks for another sibling.
  //
  // This is our rule, not the client's. Its RepositoryTreeService has no
  // root-versus-package branch and reads every answer through the same
  // parser (.local/sessions/2026-09-15-tree-contract-from-client.md, §5);
  // the flat answer is kept for the symptom above, not because the client
  // asks for it, and it could go if a full answer stops binding wrong.
  if (options.flat === true) {
    const flatRow = (n) => row({
      OBJECT_TYPE: n.type, OBJECT_NAME: n.name, TECH_NAME: n.name,
      OBJECT_URI: n.uri ?? "", EXPANDABLE: n.expandable === true ? "X" : "",
      DESCRIPTION: n.description ?? "",
    });
    return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><DATA><TREE_CONTENT>
${nodes.map(flatRow).join("\n")}
  </TREE_CONTENT></DATA></asx:values>
</asx:abap>
`;
  }

  // TV_NODEKEY values are the virtual type/drawer keys from the preceding
  // answer. On expansion Eclipse asks for one or several of them. Repeating
  // the complete package makes every drawer recursively contain itself and
  // leaves the UI at "Loading repository tree...". A selected drawer gets
  // only its concrete objects. An earlier OSD leaf response, not an A4H
  // measurement, still carries category and type metadata but no virtual
  // folder row; its node keys are local to this new answer
  // (.local/capture/oracle/osd-adt.jsonl:399).
  //
  // Mapping a key back to a kind is our assumption too: the client sends the
  // NODE_IDs it was given, "000000" among them, and nothing in its service
  // says what the server must do with them (same file, §1 and §4). A key we
  // cannot map yields an empty set, which is the honest answer for one we
  // never issued.
  if ((options.nodeKeys?.length ?? 0) > 0) {
    const kinds = new Set(options.nodeKeys.map((node) => kindByNode.get(node)).filter(Boolean));
    return nodeStructureDocument(nodes.filter((n) => kinds.has(bare(n.type))), {leaf: true});
  }

  const objectRow = (n) => row({
    OBJECT_TYPE: n.type, OBJECT_NAME: n.name, TECH_NAME: n.name, OBJECT_URI: n.uri ?? "",
    // No NODE_ID on an object row: the system sends none (a4h-adt.jsonl:253,
    // every row <NODE_ID/>), ids belong to the OBJECT_TYPES entries alone,
    // and giving rows their own — tried as a cure for the package binding —
    // changed nothing there.
    OBJECT_VIT_URI: "", EXPANDABLE: n.expandable === true ? "X" : "", NODE_ID: "",
    PARENT_NAME: "", DESCRIPTION: n.description ?? "", DESCRIPTION_TYPE: "",
    // One letter, not a word. The client's row parser
    // (com.sap.adt.ris.search.jar!RepositoryObjectListItem#accept@535-593)
    // sets the version only for "I" and "A" and leaves it unset for anything
    // else, so "active" was read as "no version" on every object in the tree.
    VERSION: n.version === "inactive" ? "I" : "A", INACTIVE_TYPE: "",
  });

  const typeRow = (t) => "    <SEU_ADT_OBJECT_TYPE_INFO>" +
    `<OBJECT_TYPE>${xmlEscape(t.type)}</OBJECT_TYPE>` +
    (t.category === "" ? "<CATEGORY_TAG/>" : `<CATEGORY_TAG>${xmlEscape(t.category)}</CATEGORY_TAG>`) +
    (t.label === "" ? "<OBJECT_TYPE_LABEL/>" : `<OBJECT_TYPE_LABEL>${xmlEscape(t.label)}</OBJECT_TYPE_LABEL>`) +
    `<NODE_ID>${t.node}</NODE_ID>` +
    "</SEU_ADT_OBJECT_TYPE_INFO>";

  const categoryRow = (name) => "    <SEU_ADT_OBJECT_CATEGORY_INFO>" +
    `<CATEGORY>${xmlEscape(name)}</CATEGORY>` +
    `<CATEGORY_LABEL>${xmlEscape(TREE_CATEGORY_LABEL[name] ?? name)}</CATEGORY_LABEL>` +
    "</SEU_ADT_OBJECT_CATEGORY_INFO>";

  return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <TREE_CONTENT>
${nodes.map(objectRow).join("\n")}
      </TREE_CONTENT>
      <CATEGORIES>
${[...categories].map(categoryRow).join("\n")}
      </CATEGORIES>
      <OBJECT_TYPES>
${objectTypes.map(typeRow).join("\n")}
      </OBJECT_TYPES>
    </DATA>
  </asx:values>
</asx:abap>
`;
}

// the subpackages and objects of one package, as tree nodes
// $TMP is the local package every ABAP system has: the one an object goes
// to when nobody chose a package for it. A client does not discover it, it
// assumes it, and asks for it by name before it has asked for anything else.
// The store has it (tools/osd-tmp.mjs); this names it for the documents.
export const LOCAL_PACKAGE = "$TMP";

// A data element as the client's editor reads it.
//
// The shape was read off the client's model (com.sap.adt.ddic.dataelement:
// blue:wbobj wrapping dtel:dataElement, every property a child element) and
// then measured: a4h-adt.jsonl:394 is a real answer, and it matches — type
// kinds are the lower-case enum literals ("domain"), lengths are numbers
// the system zero-pads and the client parses as int either way. The values
// come from abapGit's DD04V. How DD04V's REFKIND/REFTYPE map onto the three
// reference kinds is still this façade's reading, not a measured fact: the
// capture holds a domain-typed element only.
export function dataElementDocument(entry, options = {}) {
  const dd = (tag) => {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(String(entry.source ?? ""));
    return m === null ? "" : xmlUnescape(m[1]);
  };
  const int = (tag) => Number.parseInt(dd(tag) || "0", 10);
  const domain = dd("DOMNAME");
  const refKind = dd("REFKIND");
  const refType = dd("REFTYPE");
  const typeKind = refKind === "R" ? (refType === "C" || refType === "I" ? "refToClifType" : "refToPredefinedAbapType")
    : refKind === "D" ? "refToDictionaryType"
    : domain !== "" ? "domain" : "predefinedAbapType";
  const typeName = domain !== "" ? domain : dd("ROLLNAME");
  const who = xmlEscape(options.who ?? "OSD");
  const when = xmlEscape(options.when ?? "1970-01-01T00:00:00Z");
  const label = (name, text, length, max) =>
    `    <dtel:${name}FieldLabel>${xmlEscape(text)}</dtel:${name}FieldLabel>\n` +
    `    <dtel:${name}FieldLength>${length}</dtel:${name}FieldLength>\n` +
    `    <dtel:${name}FieldMaxLength>${max}</dtel:${name}FieldMaxLength>\n`;
  return `<?xml version="1.0" encoding="utf-8"?>
<blue:wbobj xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel"
            xmlns:adtcore="http://www.sap.com/adt/core"
            xmlns:atom="http://www.w3.org/2005/Atom"
            adtcore:name="${xmlEscape(entry.name)}" adtcore:type="DTEL/DE"
            adtcore:version="active" adtcore:masterLanguage="EN" adtcore:language="EN"
            adtcore:responsible="${who}" adtcore:changedBy="${who}" adtcore:createdBy="${who}"
            adtcore:changedAt="${when}" adtcore:createdAt="${when}"
            adtcore:description="${xmlEscape(dd("DDTEXT"))}" adtcore:abapLanguageVersion="standard">
  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>
  <adtcore:packageRef adtcore:name="${xmlEscape(entry.package ?? "")}" adtcore:type="DEVC/K"
   adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(String(entry.package ?? "").toLowerCase())}"/>
  <dtel:dataElement xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements">
    <dtel:typeKind>${typeKind}</dtel:typeKind>
    <dtel:typeName>${xmlEscape(typeName)}</dtel:typeName>
    <dtel:dataType>${xmlEscape(dd("DATATYPE"))}</dtel:dataType>
    <dtel:dataTypeLength>${int("LENG")}</dtel:dataTypeLength>
    <dtel:dataTypeDecimals>${int("DECIMALS")}</dtel:dataTypeDecimals>
${label("short", dd("SCRTEXT_S"), int("SCRLEN1") || 10, 10)}${label("medium", dd("SCRTEXT_M"), int("SCRLEN2") || 20, 20)}${label("long", dd("SCRTEXT_L"), int("SCRLEN3") || 40, 40)}${label("heading", dd("REPTEXT"), int("HEADLEN") || 55, 55)}    <dtel:searchHelp>${xmlEscape(dd("SHLPNAME"))}</dtel:searchHelp>
    <dtel:searchHelpParameter>${xmlEscape(dd("SHLPFIELD"))}</dtel:searchHelpParameter>
    <dtel:setGetParameter>${xmlEscape(dd("MEMORYID"))}</dtel:setGetParameter>
    <dtel:defaultComponentName>${xmlEscape(dd("DEFFDNAME"))}</dtel:defaultComponentName>
    <dtel:deactivateInputHistory>${dd("NOHISTORY") === "X"}</dtel:deactivateInputHistory>
    <dtel:changeDocument>${dd("LOGFLAG") === "X"}</dtel:changeDocument>
    <dtel:leftToRightDirection>${dd("LTRFLDDIS") === "X"}</dtel:leftToRightDirection>
    <dtel:deactivateBIDIFiltering>${dd("BIDICTRLC") === "X"}</dtel:deactivateBIDIFiltering>
  </dtel:dataElement>
</blue:wbobj>
`;
}
// the letter lives with the type resolver now: it is decided together with
// the type, and two tables of it would be a pair obliged to agree
import {ABAP_TYPE_LETTER, resolveType} from "./osd-type-graph.mjs";

const xmlUnescape = (t) => String(t).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

// The fields of a table, out of abapGit's DD02V/DD03P. A field names its
// type either by data element (ROLLNAME, resolved here to that element's
// DATATYPE/LENG/DECIMALS and text) or inline (DATATYPE/LENG). The ABAP type
// letter is the dictionary's own convention for its built-in types; the
// data preview shows it as dataPreview:type.
export function tableFieldsOf(store, entry) {
  const xml = String(entry.source ?? "");
  const tag = (block, name) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
    return m === null ? "" : m[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  };
  const head = xml.split("<DD03P_TABLE>")[0];
  const table = {
    name: entry.name,
    description: tag(head, "DDTEXT"),
    deliveryClass: tag(head, "CONTFLAG") || "A",
    maintenance: tag(head, "MAINFLAG") === "X" ? "#ALLOWED" : "#RESTRICTED",
    fields: [],
  };
  for (const block of xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
    const f = block[1];
    const field = {
      name: tag(f, "FIELDNAME"),
      key: tag(f, "KEYFLAG") === "X",
      notNull: tag(f, "NOTNULL") === "X",
      element: tag(f, "ROLLNAME"),
      dataType: tag(f, "DATATYPE"),
      length: Number.parseInt(tag(f, "LENG") || "0", 10),
      decimals: Number.parseInt(tag(f, "DECIMALS") || "0", 10),
      description: tag(f, "DDTEXT"),
    };
    if (field.name === "" || field.name.startsWith(".")) {
      continue;
    }
    if (field.element !== "" && field.dataType === "") {
      // **Through the resolver, which follows the element to its domain.**
      // This used to read the element's own `<DATATYPE>` and stop, and a
      // data element usually has none -- it names a domain, and the domain
      // carries the type. Measured on this tree: six table fields of 1041
      // came back with **no type and no letter at all**, among them
      // `ZOSD_TEST_ITEM-STATUS`, which is CHAR(1).
      const resolved = resolveType(store, field.element);
      if (resolved.KIND === "DTEL" && resolved.DATATYPE !== "") {
        field.dataType = resolved.DATATYPE;
        field.length = resolved.LENG;
        field.decimals = resolved.DECIMALS;
        field.description = field.description || resolved.TEXT;
      }
    }
    // an empty letter is what a consumer got before, and it is not a type;
    // `C` is the dictionary's own default for a field whose kind is unknown
    field.letter = ABAP_TYPE_LETTER[field.dataType] || tag(f, "INTTYPE") || "C";
    table.fields.push(field);
  }
  return table;
}

// A table as the client's table editor reads it: the same source-shaped
// document the system serves (a4h-adt.jsonl:403, blue:blueSource under
// http://www.sap.com/wbobj/blue, TABL/DT) pointing at a DDL source. The
// links the system carries and this façade cannot answer — versions,
// technical settings, indexes, documentation, activation log — are not
// offered; a link that 404s is worse than one absent.
export function tableDocument(entry, options = {}) {
  const who = xmlEscape(options.who ?? "OSD");
  const when = xmlEscape(entry.changedAt ?? options.when ?? "1970-01-01T00:00:00Z");
  const lower = encodeURIComponent(String(entry.name).toLowerCase());
  return `<?xml version="1.0" encoding="utf-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:abapsource="http://www.sap.com/adt/abapsource"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 xmlns:atom="http://www.w3.org/2005/Atom"
                 abapsource:sourceUri="./${lower}/source/main"
                 abapsource:fixPointArithmetic="false" abapsource:activeUnicodeCheck="false"
                 adtcore:responsible="${who}" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="standard"
                 adtcore:name="${xmlEscape(entry.name)}" adtcore:type="TABL/DT"
                 adtcore:changedAt="${when}" adtcore:version="${entry.version ?? "active"}" adtcore:createdAt="${when}"
                 adtcore:changedBy="${who}" adtcore:createdBy="${who}"
                 adtcore:description="${xmlEscape(options.description ?? "")}" adtcore:language="EN">
  <atom:link href="/sap/bc/adt/repository/informationsystem/abaplanguageversions?uri=${encodeURIComponent(`/sap/bc/adt/ddic/tables/${String(entry.name).toLowerCase()}`)}" rel="http://www.sap.com/adt/relations/informationsystem/abaplanguageversions" type="application/vnd.sap.adt.nameditems.v1+xml" title="Allowed ABAP language versions"/>
  <atom:link href="./${lower}/source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain" title="Source Content"/>
  <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(String(entry.package ?? "").toLowerCase())}" adtcore:type="DEVC/K" adtcore:name="${xmlEscape(entry.package ?? "")}"/>
</blue:blueSource>
`;
}

// The DDL of a table, the way the editor shows it (a4h-adt.jsonl:405 is one
// the system wrote): annotations, then one line per field, a data element
// by name or a built-in type with its length.
export function tableSourceDocument(table) {
  const width = Math.max(0, ...table.fields.map((f) => f.name.length));
  // the DDL names of the built-in types, which are not the DDIC codes:
  // RSTR is abap.rawstring(0) in the editor (a4h-adt.jsonl:405)
  const DDL_TYPE = {
    CHAR: "char", NUMC: "numc", RAW: "raw", LCHR: "lchr", LRAW: "lraw",
    DEC: "dec", CURR: "curr", QUAN: "quan",
    RSTR: "rawstring", STRG: "string", SSTR: "sstring",
    CLNT: "clnt", LANG: "lang", CUKY: "cuky", UNIT: "unit", ACCP: "accp",
    DATS: "dats", TIMS: "tims", FLTP: "fltp", INT1: "int1", INT2: "int2", INT4: "int4", INT8: "int8",
    DF16_DEC: "df16_dec", DF34_DEC: "df34_dec",
  };
  const typeOf = (f) => {
    if (f.element !== "") {
      return f.element.toLowerCase();
    }
    const kind = f.dataType.toUpperCase();
    const name = DDL_TYPE[kind] ?? kind.toLowerCase();
    if (["DEC", "CURR", "QUAN", "DF16_DEC", "DF34_DEC"].includes(kind)) {
      return `abap.${name}(${f.length},${f.decimals})`;
    }
    if (["CHAR", "NUMC", "RAW", "LCHR", "LRAW", "RSTR", "STRG", "SSTR"].includes(kind)) {
      return `abap.${name}(${f.length})`;
    }
    return `abap.${name}`;
  };
  const lines = table.fields.map((f) =>
    `  ${f.key ? "key " : "    "}${f.name.toLowerCase().padEnd(width)} : ${typeOf(f)}${f.notNull ? " not null" : ""};`);
  return `@EndUserText.label : '${table.description.replaceAll("'", "''")}'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #${table.deliveryClass}
@AbapCatalog.dataMaintenance : ${table.maintenance}
define table ${table.name.toLowerCase()} {

${lines.join("\n")}

}
`;
}

// A package as a tree sees it. $TMP and every package below it are the
// session user's (tools/osd-tmp-view.mjs); every other package is answered
// whole.
export function packageOf(store, name, options = {}) {
  const wanted = String(name ?? "").toUpperCase();
  return localView(store, wanted, store.package(wanted), options);
}

export function nodesOf(store, name, type, options = {}) {
  // A class is a folder, and that is not cosmetic.
  //
  // vscode-abap-fs names a file from the object it was built for, and it has
  // no name for a class: its AbapClass carries no extension of its own, so a
  // class that is not expandable falls through to the base ".abap" and the
  // tree showed ZCL_X.abap. The ".clas.abap" a person expects belongs to the
  // class's *main include*, which only exists once the class is a folder with
  // children. The interface beside it looked right the whole time because
  // AbapInterface does carry its own extension — which is what said the
  // difference was in expandability rather than in the type code.
  //
  // Eclipse expands a class node too, and asks here for the children, so a
  // class that says it is expandable has to have something to answer with.
  if (String(type ?? "").split("/")[0] === "CLAS") {
    return classNodesOf(store, name);
  }
  const pkg = packageOf(store, name, {user: options.user});
  const nodes = [];
  for (const child of pkg.subpackages ?? []) {
    nodes.push({
      type: "DEVC/K",
      name: child,
      uri: `/sap/bc/adt/packages/${encodeURIComponent(String(child).toLowerCase())}`,
      expandable: true,
    });
  }
  for (const object of pkg.objects ?? []) {
    // a subpackage is an object of the package above it, the way a system
    // holds it, and it is already a node from the list above; offering it
    // twice would give a tree view two entries for one thing
    if (object.type === "DEVC") {
      continue;
    }
    nodes.push({
      type: ADT_TYPE[object.type] ?? object.type,
      name: object.name,
      uri: uriOf(object.type, object.name),
      // Whether a class is a folder depends on who is asking, and the
      // choice is deliberate. The Project Explorer opens a class into its
      // outline, which is parked for a later wave; offering it the arrow
      // buys "Loading outline structure ..." and nothing behind it, so it
      // gets none. vscode-abap-fs builds its own tree and reads this flag to
      // name a class's files — a class that is not a folder there is
      // ZCL_X.abap — so it keeps it. The façade tells them apart by what
      // they ask for (see the nodestructure route). Every other kind is a
      // leaf for everyone: an arrow that opens nothing is worse than none.
      expandable: object.type === "CLAS" && options.classFolders === true,
      version: object.version,
      description: object.library === true ? "library object" : undefined,
    });
  }
  return nodes;
}

// The parts of a class, as the tree below it.
//
// Only the parts that are on disk are listed, the same rule the class
// document follows: naming an include this façade cannot serve would give a
// tree a node that errors when opened, which is the failure this whole round
// was about.
function classNodesOf(store, name) {
  const entry = store.find("CLAS", name);
  if (entry === undefined) {
    throw new NotFound("CLAS", name);
  }
  const path = `/sap/bc/adt/oo/classes/${encodeURIComponent(String(entry.name).toLowerCase())}`;
  const node = (include, uri) => ({
    type: CLASS_INCLUDE,
    // the client builds the file name from this, splitting on the first dot:
    // the class names the file and the include names the extension
    name: `${entry.name}.${include}`,
    uri,
    expandable: false,
  });
  return [node("main", `${path}/source/main`),
    ...store.classIncludes(entry.name).map((i) => node(i, `${path}/includes/${i}`))];
}

// ------------------------------------------------------- the dev loop

// A check run's answer: the findings of a syntax check over source the client
// is holding, which is usually source it has not written yet. Status matters
// as much as the messages: a client reads "processed" as "this ran", and a
// report that could not run must not look like a report that found nothing.
export function checkReportDocument(reports, options = {}) {
  // A4H puts the message text in shortText and the position only in the URI
  // fragment; it emits no line, column or category attributes
  // (.local/capture/oracle/a4h-adt.jsonl:154). A message whose text is a
  // child element reaches the client as a finding with no words in it.
  const message = (uri, issue) => `      <chkrun:checkMessage chkrun:uri="${xmlEscape(issue.uri ?? uri)}#start=${issue.line ?? 1},${issue.column ?? 1}" chkrun:type="${xmlEscape(issue.severity ?? "E")}" chkrun:shortText="${xmlEscape(issue.message)}"/>`;

  const report = (r) => {
    const attrs = `chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${xmlEscape(r.uri)}" chkrun:status="${xmlEscape(r.status ?? "processed")}" chkrun:statusText="${xmlEscape(r.statusText ?? (r.issues.length === 0 ? "no errors" : `${r.issues.length} error(s)`))}"`;
    // The SQL Console handler assumes that a present message list contains
    // an error at index 0. A4H omits the list entirely on a clean check.
    if (options.omitEmptyList === true && r.issues.length === 0) {
      return `  <chkrun:checkReport ${attrs}/>`;
    }
    return `  <chkrun:checkReport ${attrs}>
    <chkrun:checkMessageList>
${r.issues.map((i) => message(r.uri, i)).join("\n")}
    </chkrun:checkMessageList>
  </chkrun:checkReport>`;
  };

  return `<?xml version="1.0" encoding="utf-8"?>
<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun">
${reports.map(report).join("\n")}
</chkrun:checkRunReports>
`;
}

// The objects and the source a check run carries. A client sends the source
// inline because it is checking what a person has typed, so the content is
// the payload and the URI only says what it is.
export function checkObjectsIn(body, collections) {
  const elements = requestElements(body), out = [];
  for (const element of elementsNamed(elements,namespaces.chkrun,"checkObject")) {
    const uri = attributeValue(element,namespaces.adtcore,"uri");
    const object = uri === undefined ? undefined : objectFromUri(uri,collections);
    if (object === undefined) continue;
    const id = elements.indexOf(element)+1;
    const children = descendantsOf(elements,id);
    const content = elementsNamed(children,namespaces.chkrun,"content")[0];
    const artifact = elementsNamed(children,namespaces.chkrun,"artifact")[0];
    const includeUri = attributeValue(artifact,namespaces.chkrun,"uri") ?? "";
    out.push({...object,uri,include:includeUri.match(/\/includes\/([^/]+)\//)?.[1],
      source:content === undefined ? undefined : decodeContent(content.text)});
  }
  if (out.length === 0) return objectReferencesIn(body,collections).map(o => ({...o,uri:uriOf(o.type,o.name)}));
  return out;
}

// Real ADT base64s the content of a check artifact; the shape we were given
// carries it as text. Accept both rather than guess, since the two are easy
// to tell apart: base64 has no angle brackets, no newlines and no keywords.
function decodeContent(raw) {
  const text = String(raw).trim();
  if (text === "") {
    return "";
  }
  const plain = text;
  if (/^[A-Za-z0-9+/\s]+={0,2}$/.test(text) === false) {
    return plain;
  }
  const decoded = Buffer.from(text, "base64").toString("utf8");
  // Decode UTF-8 artifacts regardless of ABAP syntax: comment-only and
  // invalid source are both legitimate inputs to a syntax check.
  return /\uFFFD/.test(decoded) === false ? decoded : plain;
}

// The Result envelope measured 2026-10-04: empty modification support and
// eight children of DATA. A handle (empty for a read-only object) permits a write.
export function lockResultDocument(handle, options = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <LOCK_HANDLE>${xmlEscape(handle)}</LOCK_HANDLE>
      <CORRNR/>
      <CORRUSER/>
      <CORRTEXT/>
      <IS_LOCAL>${options.local === false ? "" : "X"}</IS_LOCAL>
      <IS_LINK_UP/>
      <MODIFICATION_SUPPORT/>
      <SCOPE_MESSAGES/>
    </DATA>
  </asx:values>
</asx:abap>
`;
}

// How a system refuses. A client looks for the exception marker and shows the
// type and the message, so an honest refusal reaches a person rather than
// becoming a status code they have to guess about.
//
// options.properties: [key, value] pairs for <properties>, the way a system
// carries a message's T100 key and long text.
// Generated class include source when no repository file has been written.
export const classIncludeTemplates = {
  definitions: '*"* use this source file for any type of declarations (class\r\n*"* definitions, interfaces or type declarations) you need for\r\n*"* components in the private section\r\n',
  macros: '*"* use this source file for any macro definitions you need\r\n*"* in the implementation part of the class\r\n',
  implementations: '*"* use this source file for the definition and implementation of\r\n*"* local helper classes, interface definitions and type\r\n*"* declarations\r\n',
};
export function missingTestInclude(name) {
  const pool = String(name).toUpperCase().padEnd(30, "=") + "CCAU";
  return {message: pool + " does not have any inactive version", properties: [
    ["T100KEY-ID", "ED"], ["T100KEY-NO", "170"], ["T100KEY-V1", pool],
  ]};
}

export function exceptionDocument(type, message, options = {}) {
  const properties = options.properties ?? [];
  const props = properties.length === 0 ? "  <properties/>" : "  <properties>\n" +
    properties.map(([key, value]) => `    <entry key="${xmlEscape(key)}">${xmlEscape(value)}</entry>\n`).join("") +
    "  </properties>";
  return `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="${xmlEscape(options.namespace ?? "com.sap.adt")}"/>
  <type id="${xmlEscape(type)}"/>
  <message lang="EN">${xmlEscape(message)}</message>
  <localizedMessage lang="EN">${xmlEscape(message)}</localizedMessage>
${props}
</exc:exception>
`;
}

// The refusal of a LOCK, or of a change, while another session holds the
// object. Shaped as A4H answers it (measured from two stateful sessions of
// one user): 403, ExceptionResourceNoAccess, and the holder named through
// the T100 message EU 510 with the user in V1 and the object in V2. The
// lock is the session's, not the user's, so the same user in another
// session is refused too. The long text is ours.
export function lockedByOtherDocument(user, object) {
  const message = `User ${user} is currently editing ${object}`;
  return exceptionDocument("ExceptionResourceNoAccess", message, {properties: [
    ["LONGTEXT", `${object} is locked by another editing session of user ${user}. ` +
      "It can be changed once that session saves and unlocks it, logs off, or expires."],
    ["T100KEY-ID", "EU"],
    ["T100KEY-NO", "510"],
    ["T100KEY-V1", user],
    ["T100KEY-V2", object],
  ]});
}

// A4H activation wire facts: qualified properties, unqualified messages, no
// inactive/CTS content. preauditRequested does not alter this document.
export function activationSuccessDocument({checkExecuted = true} = {}) {
  return `<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="${checkExecuted}" activationExecuted="true" generationExecuted="true"/></chkl:messages>`;
}

// Type words derived from ADT types. Program and Class are observed;
// other SAP wording is unconfirmed, so retain the previous name-only
// description for those types until measured.
const ACTIVATION_TYPE_WORD = {
  "PROG/P": "Program",
  "PROG/I": "",
  "CLAS/OC": "Class",
  "CLAS/I": "Class",
  "INTF/OI": "",
  "DDLS/DF": "",
  "FUGR/F": "",
  "TABL/DT": "",
  "TABL/DS": "",
  "DTEL/DE": "",
  "DOMA/DD": "",
  "TTYP/DA": "",
  "VIEW/DV": "",
  "SRVD/SRV": "",
  "SHLP/DH": "",
  "MSAG/N": "",
  "DEVC/K": "",
};

export function activationFailureDocument(objects, {checkExecuted = true} = {}) {
  const type = (issue) => (/^w/i.test(String(issue.severity ?? "")) ? "W" : /^i/i.test(String(issue.severity ?? "")) ? "I" : "E");
  const message = (o, issue) => {
    const word = ACTIVATION_TYPE_WORD[ADT_TYPE[o.type] ?? o.type];
    const description = word ? word + " " + o.name : o.name;
    const href = (/\.clas\./i.test(issue.file ?? "") ? frameUri(issue.file, issue.line, issue.column, {sourceMain: true}) : undefined) ??
      ((uriOf(o.type, o.name) ?? "") + "/source/main#start=" + (issue.line ?? 1) + "," + (issue.column ?? 1));
    // Observed line="1" for a diagnostic at source line 3. Its meaning
    // beyond that case is unconfirmed; source position belongs in href.
    return `<msg objDescr="${xmlEscape(description)}" type="${type(issue)}" line="1" href="${xmlEscape(href)}" forceSupported="true"><shortText><txt>${xmlEscape(issue.message)}</txt></shortText></msg>`;
  };
  return `<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="${checkExecuted}" activationExecuted="false" generationExecuted="false"/>` +
    '<msg objDescr="" type="W" line="0" href=""><shortText><txt>Activation was cancelled.</txt><txt>"Editing canceled" (EU 202)</txt></shortText></msg>' +
    objects.flatMap((o) => (o.issues ?? []).map((i) => message(o, i))).join("") +
    '</chkl:messages>';
}

// one inactive object for the inactive-objects feed
function inactiveEntry(o, user = "") {
  const uri = uriOf(o.type, o.name) ?? "";
  const parent = o.package ? ` adtcore:parentUri="/sap/bc/adt/packages/${xmlEscape(encodeURIComponent(String(o.package).toLowerCase()))}"` : "";
  return `    <ioc:entry>
      <ioc:object ioc:user="${xmlEscape(user)}" ioc:linked="" ioc:deleted="false">
        <ioc:ref adtcore:uri="${xmlEscape(uri)}" adtcore:type="${xmlEscape(ADT_TYPE[o.type] ?? o.type)}" adtcore:name="${xmlEscape(o.name)}"${parent}/>
      </ioc:object>
      <ioc:transport/>
    </ioc:entry>`;
}

// GET /sap/bc/adt/activation/inactiveobjects: what has been saved and not
// activated since
export function inactiveObjectsDocument(objects, user = "") {
  return `<?xml version="1.0" encoding="utf-8"?>
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">
${objects.map((o) => inactiveEntry(o, user)).join("\n")}
</ioc:inactiveObjects>
`;
}

// The objects a client named in an activation or a check run. The bodies are
// small documents of a known shape, so they are read with a pattern rather
// than with a parser we would otherwise not need.
export function objectReferencesIn(body, collections) {
  const out = [];
  for (const element of requestElements(body)) {
    const uri = attributeValue(element,namespaces.adtcore,"uri");
    if (uri === undefined) continue;
    const parsed = objectFromUri(uri,collections);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

// /sap/bc/adt/oo/classes/zcl_x -> {type: "CLAS", name: "ZCL_X"}
export function objectFromUri(uri, collections) {
  const path = String(uri).split("#")[0].split("?")[0].replace(/\/source\/main$/, "");
  for (const [type, collection] of collections) {
    const prefix = `/sap/bc/adt/${collection}/`;
    if (path.startsWith(prefix)) {
      return {type, name: decodeURIComponent(path.slice(prefix.length)).toUpperCase()};
    }
  }
  return undefined;
}

// What a client is told before it writes: which transport this object would
// be recorded in.
//
// It answers "none, and none is needed", and that is a fact about OSD rather
// than a convenience. A transport exists to carry a change between systems,
// and an object in a local package is one a real system also refuses to
// record — every package here is local, `$`-prefixed, derived from a folder.
// OSD has no CTS and the boundary to a real system is an abapGit archive
// from a git ref (ADR 0001, point 3), so there is nothing this could name
// without inventing it.
//
// The shape is the asXML envelope abap-adt-api reads, and the two fields
// that carry the answer are an empty RECORDING and an empty REQUESTS: that
// pair is how a client learns not to prompt for a transport. Messages stay
// empty on purpose — the client throws on a message of severity E, A or X,
// so a message here would turn "nothing to do" into a failed write.
export function transportCheckDocument(object = {}) {
  const value = (name, text) => `      <${name}>${xmlEscape(text ?? "")}</${name}>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
${value("PGMID", "R3TR")}
${value("OBJECT", ADT_TYPE[object.type] ?? object.type)}
${value("OBJECTNAME", object.name)}
${value("OPERATION", object.operation ?? "I")}
${value("DEVCLASS", object.package)}
${value("CTEXT", object.description)}
${value("KORRFLAG", "")}
${value("AS4USER", "")}
${value("PDEVCLASS", "")}
${value("DLVUNIT", "LOCAL")}
${value("NAMESPACE", "")}
${value("RESULT", "S")}
${value("RECORDING", "")}
${value("EXISTING_REQ_ONLY", "")}
${value("TADIRDEVC", object.package)}
${value("URI", object.uri)}
      <MESSAGES/>
      <REQUESTS/>
      <LOCKS/>
    </DATA>
  </asx:values>
</asx:abap>
`;
}

// the URI and package a transport check asks about, out of the asXML the
// client sends. A body we cannot read is not a reason to refuse: the answer
// is the same for every object in this system.
export function transportCheckRequest(body) {
  const elements=requestElements(body);
  const field = local => elementsNamed(elements,"",local)[0]?.text;
  return {uri:field("URI"),devclass:field("DEVCLASS"),operation:field("OPERATION")};
}

// -------------------------------------------------------------- search

// The answer to a repository search: a flat list of references into the
// resource tree. A client shows the list and follows a URI when one is
// picked, so the URI matters more than the description.
// The repository path which lets a client turn an ADT URI back into the
// corresponding object in its package tree.  Includes are deliberately not
// separate steps: abap-fs resolves the class and then selects the requested
// include from that class's structure.
export function nodePathDocument(steps) {
  const link = (step) => `    <objectLinkReference adtcore:uri="${xmlEscape(step.uri)}" adtcore:type="${xmlEscape(step.type)}" adtcore:name="${xmlEscape(step.name)}" projectexplorer:category="${xmlEscape(step.category ?? "")}"/>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<projectexplorer:nodepath xmlns:projectexplorer="http://www.sap.com/adt/projectexplorer" xmlns:adtcore="http://www.sap.com/adt/core">
  <projectexplorer:objectLinkReferences>
${steps.map(link).join("\n")}
  </projectexplorer:objectLinkReferences>
</projectexplorer:nodepath>
`;
}

// ADT's quick search takes a pattern with `*` as the wildcard, which is not
// what a substring search does: `ZCL_STG*` means "starts with", and a bare
// word means "contains" in most clients' usage. Translating here rather than
// in the store keeps the store's search a plain substring match.
export function searchObjects(store, query, options = {}) {
  const max = options.max ?? 100;
  const pattern = String(query ?? "").trim().toUpperCase();
  const anchored = pattern.includes("*");
  const regex = anchored
    ? new RegExp("^" + pattern.split("*").map((p) => p.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$")
    : undefined;

  // a package is not in the object index, because it is not a file: it comes
  // from the package layer. A client that searches for one still expects to
  // find it, which is how it discovers what to open a tree on.
  if (options.type === undefined || options.type === "DEVC") {
    const packages = store.packages()
      .filter((p) => (regex === undefined ? p.name.includes(pattern) : regex.test(p.name)))
      .slice(0, max)
      .map((p) => ({
        name: p.name,
        type: ADT_TYPE.DEVC,
        uri: `/sap/bc/adt/packages/${encodeURIComponent(p.name.toLowerCase())}`,
        description: p.description === undefined || p.description === "" ? undefined : p.description,
      }));
    if (options.type === "DEVC") {
      return packages;
    }
    if (packages.length >= max) {
      return packages.slice(0, max);
    }
    const rest = searchNonPackages(store, pattern, regex, anchored, {...options, max: max - packages.length});
    return [...packages, ...rest];
  }

  return searchNonPackages(store, pattern, regex, anchored, options);
}

function searchNonPackages(store, pattern, regex, anchored, options = {}) {
  const max = options.max ?? 100;

  // the store searches names by substring; an anchored pattern is filtered
  // afterwards, because the widest thing the store can give is the right
  // thing to narrow
  const seed = anchored ? pattern.split("*").filter((p) => p !== "")[0] ?? "" : pattern;
  const hits = store.search(seed, {type: options.type, max: max * 4});

  const out = [];
  for (const hit of hits) {
    if (regex !== undefined && regex.test(hit.name) === false) {
      continue;
    }
    out.push({
      name: hit.name,
      type: ADT_TYPE[hit.type] ?? hit.type,
      uri: uriOf(hit.type, hit.name),
      description: hit.library === true ? "library object" : undefined,
    });
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export {namedItemsDocument, objectReferencesDocument, emptyFeedDocument} from "./adt-document-common.mjs";
