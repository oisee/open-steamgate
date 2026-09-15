// The XML documents the ADT façade answers with, apart from the two that
// wave 0 already had. One file, because they share a vocabulary: every ADT
// document names things with `adtcore:name`, `adtcore:type` and a URI that
// points back into the resource tree, and getting that vocabulary wrong is
// what makes a client quietly show nothing.
//
// SHAPES PARTLY CONFIRMED. The data-preview document of wave 0 was verified
// by vsp's own reader against a running OSD. These two have not been, and
// the places where a guess is load-bearing are marked.
import {Visibility} from "@abaplint/core";
import {TYPES, NotFound} from "./osd-store.mjs";

const xmlEscape = (s) => String(s)
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

// a method of a class, an include of one, and an interface's methods
const METHOD = "CLAS/OM";
const CLASS_INCLUDE = "CLAS/I";

// where an object lives in the resource tree, which is what a client follows
export function uriOf(type, name) {
  const collection = TYPES[type]?.adt;
  if (collection === undefined) {
    return undefined;
  }
  return `/sap/bc/adt/${collection}/${encodeURIComponent(String(name).toLowerCase())}`;
}

// a range in the main source, the way ADT writes one
const rangeUri = (at) => `source/main#start=${at.row},${at.col}` + (at.endRow === undefined ? "" : `;end=${at.endRow},${at.endCol}`);

const VISIBILITY = {
  [Visibility.Public]: "public",
  [Visibility.Protected]: "protected",
  [Visibility.Private]: "private",
};

// ------------------------------------------------- the object structure

// What a client reads before it asks for one method rather than a whole
// class: the elements of an object and, for each, the fragment of the source
// URI that selects it. A plain full-source read never comes through here,
// which is why wave 0 did without it.
//
// The source URI fragment is the load-bearing part. ADT writes the position
// as `#start=row,col`, and a client that wants one method asks for
// `source/main#start=…`. We answer the whole source and let the client cut,
// which is what it does anyway: the fragment never reaches a server.
export function objectStructureDocument(object) {
  const element = (e, indent) => {
    const pad = " ".repeat(indent);
    const attributes = [
      `adtcore:name="${xmlEscape(e.name)}"`,
      `adtcore:type="${xmlEscape(e.type)}"`,
      e.visibility === undefined ? undefined : `abapsource:visibility="${e.visibility}"`,
      e.modifiers === undefined ? undefined : `abapsource:modifiers="${e.modifiers}"`,
      e.uri === undefined ? undefined : `abapsource:sourceUri="${xmlEscape(e.uri)}"`,
    ].filter((a) => a !== undefined).join(" ");
    const links = (e.links ?? []).map((l) => `${pad}  <atom:link rel="http://www.sap.com/adt/relations/source/${xmlEscape(l.rel)}" href="${xmlEscape(l.href)}"/>`);
    const inner = [...links, ...(e.children ?? []).map((c) => element(c, indent + 2))];
    if (inner.length === 0) {
      return `${pad}<abapsource:objectStructureElement ${attributes}/>`;
    }
    return `${pad}<abapsource:objectStructureElement ${attributes}>
${inner.join("\n")}
${pad}</abapsource:objectStructureElement>`;
  };

  return `<?xml version="1.0" encoding="utf-8"?>
<abapsource:objectStructureElement xmlns:abapsource="http://www.sap.com/adt/abapsource"
                                   xmlns:adtcore="http://www.sap.com/adt/core"
                                   xmlns:atom="http://www.w3.org/2005/Atom"
                                   adtcore:name="${xmlEscape(object.name)}"
                                   adtcore:type="${xmlEscape(object.type)}"
                                   abapsource:sourceUri="source/main">
${(object.children ?? []).map((c) => element(c, 2)).join("\n")}
</abapsource:objectStructureElement>
`;
}

// Where every method body begins and ends, from the parse. A client asks for
// one method by a range and slices the main source between the two, so half
// a range is no range: without the end it reads nothing at all.
function implementationRows(object) {
  const rows = new Map();
  for (const file of object.getSequencedFiles?.() ?? []) {
    const structure = file.getStructure?.();
    if (structure === null || structure === undefined) {
      continue;
    }
    for (const node of findMethods(structure)) {
      // METHOD <name> ... ENDMETHOD: the name is the token after METHOD, and
      // the last token of the node is the end of ENDMETHOD
      const tokens = [node.getFirstToken?.(), node.getLastToken?.()];
      const name = nameAfterMethod(node);
      const start = tokens[0]?.getStart?.();
      const end = tokens[1]?.getEnd?.() ?? tokens[1]?.getStart?.();
      if (name === undefined || start === undefined || end === undefined) {
        continue;
      }
      rows.set(String(name).toUpperCase(), {
        row: start.getRow(),
        col: start.getCol(),
        endRow: end.getRow(),
        endCol: end.getCol(),
      });
    }
  }
  return rows;
}

// Where each method is declared, as the whole statement rather than the name
// alone: a client uses this range for a signature, and a declaration with
// parameters runs over several lines.
function declarationRows(object) {
  const rows = new Map();
  for (const file of object.getSequencedFiles?.() ?? []) {
    for (const statement of file.getStatements?.() ?? []) {
      if (statement.get?.()?.constructor?.name !== "MethodDef") {
        continue;
      }
      const tokens = statement.getTokens?.() ?? [];
      // CLASS-METHODS name ... or METHODS name ...: the name is the first
      // token that is not part of the keyword
      const name = tokens.find((t) => ["CLASS", "-", "METHODS"].includes(t.getStr().toUpperCase()) === false);
      const start = tokens[0]?.getStart?.();
      const end = tokens[tokens.length - 1]?.getEnd?.();
      if (name === undefined || start === undefined || end === undefined) {
        continue;
      }
      rows.set(name.getStr().toUpperCase(), {
        row: start.getRow(),
        col: start.getCol(),
        endRow: end.getRow(),
        endCol: end.getCol(),
      });
    }
  }
  return rows;
}

// Every node of the given structure or statement kinds, in source order.
function findNodes(node, kinds, out = []) {
  const kind = node.get?.()?.constructor?.name;
  if (kinds.includes(kind)) {
    out.push(node);
  }
  for (const child of node.getChildren?.() ?? []) {
    findNodes(child, kinds, out);
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

function findMethods(node, out = []) {
  if (node.get?.()?.constructor?.name === "Method") {
    out.push(node);
  }
  for (const child of node.getChildren?.() ?? []) {
    findMethods(child, out);
  }
  return out;
}

// the name of the method a node implements: the token after METHOD
function nameAfterMethod(node) {
  const statement = node.getFirstStatement?.();
  const tokens = statement?.getTokens?.() ?? [];
  return tokens.length > 1 ? tokens[1].getStr() : undefined;
}

// The elements of a class or an interface, out of the parsed system. The
// parse is the same one the syntax check runs on, so what a client is told
// exists is what would compile.
export function structureOf(store, type, name) {
  const entry = store.find(type, name);
  if (entry === undefined) {
    return undefined;
  }
  const object = store.registry().getObject(type === "INCL" ? "PROG" : type, entry.name);
  const children = [];

  const definition = object?.getDefinition?.();
  if (definition !== undefined) {
    // where each method's body is, which is not where its declaration is. A
    // client that wants one method slices the source at this position, so
    // pointing at the declaration gives it the signature and no body. The
    // declaration is the fallback for a method that has no implementation:
    // abstract, or inherited and not redefined here.
    const bodies = implementationRows(object);
    const declarations = declarationRows(object);
    for (const method of definition.getMethodDefinitions?.()?.getAll?.() ?? []) {
      const name = method.getName().toUpperCase();
      const declared = method.getStart?.();
      const body = bodies.get(name);
      const declaration = declarations.get(name) ?? (declared === undefined ? undefined : {
        row: declared.getRow?.() ?? declared.row,
        col: declared.getCol?.() ?? declared.col,
        endRow: declared.getRow?.() ?? declared.row,
        endCol: declared.getCol?.() ?? declared.col,
      });
      const at = body ?? declaration;
      children.push({
        name,
        type: METHOD,
        visibility: VISIBILITY[method.getVisibility?.()] ?? "public",
        modifiers: method.isStatic?.() === true ? "static" : undefined,
        uri: at === undefined ? "source/main" : rangeUri(at),
        // the two links a client actually reads: where the method is declared
        // and where its body is. The attribute above says the same thing and
        // is kept because a real system carries both, but a client that wants
        // one method reads these.
        links: [
          declaration === undefined ? undefined : {rel: "definitionBlock", href: rangeUri(declaration)},
          body === undefined ? undefined : {rel: "implementationBlock", href: rangeUri(body)},
        ].filter((l) => l !== undefined),
      });
    }
  }

  // A method the class implements without declaring: one it takes from an
  // interface. abaplint lists a class's own METHODS and not those, so a
  // class that is nothing but an interface implementation — an APC handler,
  // a BAdI — had no children here at all. That is not a cosmetic gap: the
  // client's class outline reads result[0] without checking the length
  // (oo.ui!AbapClassOutlineExplorerTreeContentProvider#getChildren@14-16),
  // so an empty structure is an exception rather than an empty tree.
  //
  // Read from the parsed file, not from the definition: a class whose
  // superclass is not in this tree has no definition at all, and its
  // bodies are still right there in the source.
  if (object !== undefined) {
    const listed = new Set(children.map((c) => c.name));
    for (const [name, body] of implementationRows(object)) {
      if (listed.has(name) === false) {
        children.push({name, type: METHOD, visibility: "public", uri: rangeUri(body),
          links: [{rel: "implementationBlock", href: rangeUri(body)}]});
      }
    }
  }
  if (definition !== undefined) {
    // the attributes, which a real structure lists beside the methods
    // (a4h-adt-2026-09-14T2205.jsonl:112 has seven CLAS/OA to five CLAS/OM)
    for (const attribute of definition.getAttributes?.()?.getAll?.() ?? []) {
      const at = attribute.getStart?.();
      children.push({
        name: attribute.getName().toUpperCase(),
        type: "CLAS/OA",
        visibility: VISIBILITY[attribute.getVisibility?.()] ?? "public",
        uri: at === undefined ? "source/main" : rangeUri({row: at.getRow(), col: at.getCol(), endRow: at.getRow(), endCol: at.getCol()}),
      });
    }
  }

  // a class carries more than one file, and ADT calls them includes; a client
  // reads one through the includes resource rather than through source/main
  if (type === "CLAS") {
    for (const include of ["definitions", "implementations", "macros", "testclasses"]) {
      const part = store.read(type, entry.name, include);
      if (part.empty === true || part.source === "") {
        continue;
      }
      children.push({
        name: include.toUpperCase(),
        type: CLASS_INCLUDE,
        uri: `includes/${include}/source/main`,
      });
    }
  }

  // The class itself, as one more child, which a real structure always
  // carries (the same capture: one CLAS/OCX named after the class). It is
  // also what keeps the structure of an empty class from being empty, and
  // the outline provider above from throwing on it.
  if (type === "CLAS") {
    children.push({name: entry.name, type: "CLAS/OCX", uri: "source/main"});
  }
  if (type === "PROG" || type === "INCL") {
    children.push(...programParts(object));
    children.push({name: entry.name, type: "PROG/PX", uri: "source/main"});
  }

  return {name: entry.name, type: ADT_TYPE[type] ?? type, children};
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
  // text/plain one by type. The other two A4H links, versions and enhancement
  // options, are deliberately not copied: nothing here serves them, and a link
  // that 404s is the failure this round was spent removing.
  const include = (kind, sourceUri) =>
    `  <class:include class:includeType="${kind}" abapsource:sourceUri="${sourceUri}"` +
    ' adtcore:name="" adtcore:type="CLAS/I"' +
    ` adtcore:changedAt="${when}" adtcore:version="active"` +
    ` adtcore:createdAt="${when}" adtcore:changedBy="${xmlEscape(who)}" adtcore:createdBy="${xmlEscape(who)}">\n` +
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
                 adtcore:version="active"
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
export function namedItemsDocument(items = []) {
  return `<?xml version="1.0" encoding="utf-8"?>
<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
  <nameditem:totalItemCount>${items.length}</nameditem:totalItemCount>
${items.map((item) => `  <nameditem:namedItem><nameditem:name>${xmlEscape(item.name)}</nameditem:name><nameditem:description>${xmlEscape(item.description ?? "")}</nameditem:description>${item.data === undefined ? "" : `<nameditem:data>${xmlEscape(item.data)}</nameditem:data>`}</nameditem:namedItem>`).join("\n")}
</nameditem:namedItemList>
`;
}

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

  const row = (fields) => "    <SEU_ADT_REPOSITORY_OBJ_NODE>" +
    Object.entries(fields).map(([name, value]) =>
      value === "" ? `<${name}/>` : `<${name}>${xmlEscape(String(value))}</${name}>`).join("") +
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
    OBJECT_VIT_URI: "", EXPANDABLE: n.expandable === true ? "X" : "", NODE_ID: "",
    PARENT_NAME: "", DESCRIPTION: n.description ?? "", DESCRIPTION_TYPE: "",
    // One letter, not a word. The client's row parser
    // (com.sap.adt.ris.search.jar!RepositoryObjectListItem#accept@535-593)
    // sets the version only for "I" and "A" and leaves it unset for anything
    // else, so "active" was read as "no version" on every object in the tree.
    VERSION: "A", INACTIVE_TYPE: "",
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
//
// Our packages are folders, so the store has no $TMP and honestly cannot
// invent one: it reports what this tree holds. The protocol guarantee is a
// different statement from the tree's contents, so it is answered here, at
// the façade, where the other client-shaped compatibility lives. Simulated
// and empty is the whole of it — the package resolves, and it holds nothing
// because nothing in this tree was created without a package.
export const LOCAL_PACKAGE = "$TMP";

export function packageOf(store, name) {
  const wanted = String(name ?? "").toUpperCase();
  try {
    return store.package(wanted);
  } catch (error) {
    // only this one name, and only when the store's answer was that it is
    // missing: any other failure is the store's to report, not ours to hide
    if (wanted !== LOCAL_PACKAGE || error?.code !== "NOT_FOUND") {
      throw error;
    }
    return {name: LOCAL_PACKAGE, parent: undefined, description: "Local objects", objects: [], subpackages: [], library: false, simulated: true};
  }
}

export function nodesOf(store, name, type) {
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
  const pkg = packageOf(store, name);
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
      // only a class: the parts of one are objects in their own right and
      // both clients go looking for them. Everything else here is a leaf,
      // and saying otherwise buys an expansion arrow that opens nothing.
      expandable: object.type === "CLAS",
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
export function checkReportDocument(reports) {
  // A4H puts the message text in shortText and the position only in the URI
  // fragment; it emits no line, column or category attributes
  // (.local/capture/oracle/a4h-adt.jsonl:154). A message whose text is a
  // child element reaches the client as a finding with no words in it.
  const message = (uri, issue) => `      <chkrun:checkMessage chkrun:uri="${xmlEscape(uri)}#start=${issue.line ?? 1},${issue.column ?? 1}" chkrun:type="${xmlEscape(issue.severity ?? "E")}" chkrun:shortText="${xmlEscape(issue.message)}"/>`;

  const report = (r) => `  <chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${xmlEscape(r.uri)}" chkrun:status="${xmlEscape(r.status ?? "processed")}" chkrun:statusText="${xmlEscape(r.statusText ?? (r.issues.length === 0 ? "no errors" : `${r.issues.length} error(s)`))}">
    <chkrun:checkMessageList>
${r.issues.map((i) => message(r.uri, i)).join("\n")}
    </chkrun:checkMessageList>
  </chkrun:checkReport>`;

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
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  const out = [];
  for (const block of text.matchAll(/<chkrun:checkObject\b([^>]*)>([\s\S]*?)<\/chkrun:checkObject>/g)) {
    const uri = block[1].match(/adtcore:uri="([^"]+)"/)?.[1];
    const object = uri === undefined ? undefined : objectFromUri(uri, collections);
    if (object === undefined) {
      continue;
    }
    const artifact = block[2].match(/<chkrun:content>([\s\S]*?)<\/chkrun:content>/);
    const includeUri = block[2].match(/chkrun:uri="([^"]+)"/)?.[1] ?? "";
    out.push({
      ...object,
      uri,
      include: includeUri.match(/\/includes\/([^/]+)\//)?.[1],
      source: artifact === undefined ? undefined : decodeContent(artifact[1]),
    });
  }
  // a client that sends no check object at all still names the object the
  // old way, as a plain object reference
  if (out.length === 0) {
    return objectReferencesIn(body, collections).map((o) => ({...o, uri: uriOf(o.type, o.name)}));
  }
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
  const plain = text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
  if (/^[A-Za-z0-9+/\s]+={0,2}$/.test(text) === false) {
    return plain;
  }
  const decoded = Buffer.from(text, "base64").toString("utf8");
  // base64 of ABAP decodes to something with line breaks; base64 of nothing
  // useful decodes to bytes that are not text at all
  return /[\r\n]/.test(decoded) && /\uFFFD/.test(decoded) === false ? decoded : plain;
}

// A lock result. The handle is the whole payload; the rest of the envelope is
// what a client expects around it, and the same envelope carries the node
// structure, so the shape is already confirmed by one round trip.
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
      <MODIFICATION_SUPPORT>${options.modifiable === false ? "" : "X"}</MODIFICATION_SUPPORT>
    </DATA>
  </asx:values>
</asx:abap>
`;
}

// How a system refuses. A client looks for the exception marker and shows the
// type and the message, so an honest refusal reaches a person rather than
// becoming a status code they have to guess about.
export function exceptionDocument(type, message, options = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="${xmlEscape(options.namespace ?? "com.sap.adt")}"/>
  <type id="${xmlEscape(type)}"/>
  <message lang="EN">${xmlEscape(message)}</message>
  <localizedMessage lang="EN">${xmlEscape(message)}</localizedMessage>
  <properties/>
</exc:exception>
`;
}

// The answer to an activation that did not happen. An activation that did
// happen answers nothing at all, which is the convention and not our choice:
// a client reads an empty body as success and a document as failure, so a
// document has to mean failure and nothing else.
export function activationFailureDocument(objects) {
  const message = (o, issue) => `    <msg:msg objDescr="${xmlEscape(o.name)}" type="E" line="${issue.line ?? 1}" href="${xmlEscape((uriOf(o.type, o.name) ?? "") + "/source/main#start=" + (issue.line ?? 1) + "," + (issue.column ?? 1))}" forceSupported="false">
      <shortText><txt>${xmlEscape(issue.message)}</txt></shortText>
    </msg:msg>`;

  const inactive = (o) => `    <ioc:entry adtcore:name="${xmlEscape(o.name)}" adtcore:type="${xmlEscape(ADT_TYPE[o.type] ?? o.type)}" adtcore:uri="${xmlEscape(uriOf(o.type, o.name) ?? "")}"/>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"
               xmlns:msg="http://www.sap.com/abapxml/checklist/message"
               xmlns:ioc="http://www.sap.com/adt/inactivectsobjects"
               xmlns:adtcore="http://www.sap.com/adt/core"
               activationExecuted="false">
${objects.flatMap((o) => (o.issues ?? []).map((i) => message(o, i))).join("\n")}
  <ioc:inactiveObjects>
${objects.map(inactive).join("\n")}
  </ioc:inactiveObjects>
</chkl:messages>
`;
}

// The objects a client named in an activation or a check run. The bodies are
// small documents of a known shape, so they are read with a pattern rather
// than with a parser we would otherwise not need.
export function objectReferencesIn(body, collections) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  const out = [];
  for (const match of text.matchAll(/adtcore:uri="([^"]+)"/g)) {
    const parsed = objectFromUri(match[1], collections);
    if (parsed !== undefined) {
      out.push(parsed);
    }
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
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  const field = (name) => new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(text)?.[1];
  return {uri: field("URI"), devclass: field("DEVCLASS"), operation: field("OPERATION")};
}

// The result of a test run: a program, its test classes, their methods, and
// the alerts on whichever of them failed. No alert on a method is what
// "passed" means, so an empty alerts element is a pass and not an omission.
//
// Navigation is the part worth getting right. Every class and method knows
// the line it is written at and which include it lives in, so a client can
// jump straight to a failure instead of opening a file and searching.
// the file a stack frame names, as an address in the façade. The suffix
// says which include of a class it is; anything else we do not serve by
// this route comes back undefined and the caller keeps the file name.
const FRAME_INCLUDES = {
  "locals_def": "definitions",
  "locals_imp": "implementations",
  "macros": "macros",
  "testclasses": "testclasses",
};

export function frameUri(file, line, column) {
  if (typeof file !== "string" || file === "") {
    return undefined;
  }
  const name = file.split("/").pop();
  const at = `#start=${line ?? 1},${column ?? 1}`;
  const include = /^(.+)\.clas\.([a-z_]+)\.abap$/.exec(name);
  if (include !== null && FRAME_INCLUDES[include[2]] !== undefined) {
    return `${uriOf("CLAS", include[1])}/includes/${FRAME_INCLUDES[include[2]]}/source/main${at}`;
  }
  const clas = /^(.+)\.clas\.abap$/.exec(name);
  if (clas !== null) {
    return `${uriOf("CLAS", clas[1])}/source/main${at}`;
  }
  const prog = /^(.+)\.prog\.abap$/.exec(name);
  if (prog !== null) {
    return `${uriOf("PROG", prog[1])}/source/main${at}`;
  }
  return undefined;
}

export function unitResultDocument(run, options = {}) {
  const base = options.base ?? uriOf(run.program?.typeName ?? "CLAS", run.program?.name ?? "") ?? "";
  const at = (include, line, column) => `${base}/includes/${include ?? "testclasses"}/source/main#start=${line ?? 1},${column ?? 1}`;

  // A frame arrives as the file the source map resolved to, which is a file
  // name and not an address a client can follow. Turned into one here, so a
  // failure is a place to jump to; a file whose shape we do not recognise
  // keeps its name and gets no navigationUri, because a link that goes
  // nowhere is worse than no link.
  const stackEntry = (e) => {
    const uri = frameUri(e.uri, e.line, e.column);
    return `            <stackEntry adtcore:uri="${xmlEscape(uri ?? e.uri ?? "")}" adtcore:name="${xmlEscape(e.name ?? "")}" adtcore:description="${xmlEscape(e.line === undefined ? "" : "line " + e.line)}"${uri === undefined ? "" : ` navigationUri="${xmlEscape(uri)}"`}/>`;
  };

  const alert = (a) => `        <alert kind="${xmlEscape(a.kind ?? "failedAssertion")}" severity="${xmlEscape(a.severity ?? "critical")}">
          <title>${xmlEscape(a.title ?? "")}</title>
          <details>
${(a.details ?? []).map((d) => `            <detail text="${xmlEscape(d)}"/>`).join("\n")}
          </details>
          <stack>
${(a.stack ?? []).map(stackEntry).join("\n")}
          </stack>
        </alert>`;

  const method = (m, include) => `      <testMethod adtcore:name="${xmlEscape(m.name)}" adtcore:uri="${xmlEscape(at(include, m.line, m.column))}" executionTime="${xmlEscape(m.executionTime ?? "0.000")}" unit="${xmlEscape(m.unit ?? "s")}" navigationUri="${xmlEscape(at(include, m.line, m.column))}">
        <alerts>
${(m.alerts ?? []).map(alert).join("\n")}
        </alerts>
      </testMethod>`;

  const testClass = (c) => `    <testClass adtcore:name="${xmlEscape(c.name)}" adtcore:uri="${xmlEscape(at(c.include, c.line, c.column))}" durationCategory="${xmlEscape(c.durationCategory ?? "short")}" riskLevel="${xmlEscape(c.riskLevel ?? "harmless")}" navigationUri="${xmlEscape(at(c.include, c.line, c.column))}">
      <alerts>
${(c.alerts ?? []).map(alert).join("\n")}
      </alerts>
      <testMethods>
${(c.testMethods ?? []).map((m) => method(m, c.include)).join("\n")}
      </testMethods>
    </testClass>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit" xmlns:adtcore="http://www.sap.com/adt/core">
  <program adtcore:name="${xmlEscape(run.program?.name ?? "")}" adtcore:type="${xmlEscape(run.program?.type ?? "CLAS/OC")}" adtcore:uri="${xmlEscape(base)}">
    <testClasses>
${(run.testClasses ?? []).map(testClass).join("\n")}
    </testClasses>
  </program>
</aunit:runResult>
`;
}

// -------------------------------------------------------------- search

// The answer to a repository search: a flat list of references into the
// resource tree. A client shows the list and follows a URI when one is
// picked, so the URI matters more than the description.
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
