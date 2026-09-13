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
import {TYPES} from "./osd-store.mjs";

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

  return {name: entry.name, type: ADT_TYPE[type] ?? type, children};
}

// The base resource of a class include. A client resolves a method body by
// asking for the implementations include, and it asks for the include object
// before it asks for the include's source. SHAPE NOT CONFIRMED: this answers
// with the include as an object, carrying the link to its source, and a
// client that wanted the source itself gets that instead when it says so in
// its Accept header.
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
export function packageDocument(pkg) {
  const parent = pkg.parent === undefined || pkg.parent === null ? "" : `
  <pak:superPackage adtcore:name="${xmlEscape(pkg.parent)}" adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(String(pkg.parent).toLowerCase())}"/>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:name="${xmlEscape(pkg.name)}"
             adtcore:type="DEVC/K"
             adtcore:description="${xmlEscape(pkg.description ?? "")}">${parent}
  <pak:attributes pak:isPackageTypeEditable="false" pak:isAddingObjectsAllowed="${pkg.library === true ? "false" : "true"}"/>
</pak:package>
`;
}

// The contents of one node of the repository tree. A client walks this: it
// asks for a package and gets its subpackages and its objects, each with the
// URI to ask about next.
//
// SHAPE NOT YET CONFIRMED. vsp holds the request body of the real resource
// and has it ready; this answers the parameters as we understand them and is
// meant to be corrected.
export function nodeStructureDocument(nodes) {
  const node = (n) => `    <SEU_ADT_REPOSITORY_OBJ_NODE>
      <OBJECT_TYPE>${xmlEscape(n.type)}</OBJECT_TYPE>
      <OBJECT_NAME>${xmlEscape(n.name)}</OBJECT_NAME>
      <TECH_NAME>${xmlEscape(n.name)}</TECH_NAME>
      <OBJECT_URI>${xmlEscape(n.uri ?? "")}</OBJECT_URI>
      <EXPANDABLE>${n.expandable === true ? "X" : ""}</EXPANDABLE>
      <DESCRIPTION>${xmlEscape(n.description ?? "")}</DESCRIPTION>
    </SEU_ADT_REPOSITORY_OBJ_NODE>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <TREE_CONTENT>
${nodes.map(node).join("\n")}
      </TREE_CONTENT>
    </DATA>
  </asx:values>
</asx:abap>
`;
}

// the subpackages and objects of one package, as tree nodes
export function nodesOf(store, name) {
  const pkg = store.package(name);
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
      expandable: false,
      description: object.library === true ? "library object" : undefined,
    });
  }
  return nodes;
}

// ------------------------------------------------------- the dev loop

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
