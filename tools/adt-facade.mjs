// The ADT façade of OSD: `/sap/bc/adt/**` answered by a local system that
// has no system behind it. A client that speaks ADT to a real ABAP server
// should not be able to tell, within the surface we advertise.
//
// Two rules, and everything here follows from them.
//
// 1. Discovery is the gatekeeper. A collection appears in the discovery
//    document only because a handler for it was mounted; the list is built
//    from the mounted routes rather than written by hand, so the document
//    cannot promise what we do not serve. A client that sweeps discovery to
//    learn what exists then gets one honest answer.
// 2. The client is the test. vsp's ADT client is strict on purpose and
//    learned the quirks over a thousand commits against real systems. Where
//    this file guesses a shape it says so, and the guess is settled by
//    pointing that client at it rather than by argument.
//
// The façade never touches the file system or the database: sources come
// from the object store, table contents from its data layer. The store never
// parses HTTP. That seam is the contract between this session and the one
// that owns the store.
import express from "express";
import {readFileSync, appendFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID, randomBytes, createHash} from "node:crypto";
import {Sessions} from "./adt-session.mjs";
import {SOURCE_PROPERTY_MIME, sourcePropertiesDocument} from "./adt-source-properties.mjs";
import {ObjectStore, TYPES, NotFound, ReadOnly, NotSupported, Conflict} from "./osd-store.mjs";
import {ADT_TYPE, dataElementDocument, tableFieldsOf, tableDocument, tableSourceDocument, TREE_FOLDER, TREE_CATEGORY, TREE_TYPE_LABEL, TREE_CATEGORY_LABEL, classDocument, activationSuccessDocument, namedItemsDocument, objectStructureDocument, structureOf, objectReferencesDocument, searchObjects, packageDocument, packageOf, nodeStructureDocument, nodesOf, classIncludeDocument, lockResultDocument, exceptionDocument, activationFailureDocument, objectReferencesIn, objectFromUri, checkReportDocument, checkObjectsIn, unitResultDocument, transportCheckDocument, transportCheckRequest} from "./adt-documents.mjs";

export const BASE = "/sap/bc/adt";

const xmlEscape = (s) => String(s)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

// ADT persists the entity tag from a properties/source response alongside
// the workspace file. Without it the filesystem synchronizer refuses to
// create the editor part. The tag describes the representation, so properties
// and source intentionally get different values and change with their body.
const sendEntity = (req, res, body) => {
  const tag = createHash("sha256").update(Buffer.from(String(body))).digest("hex").slice(0, 32);
  res.set("ETag", tag);
  const candidates = String(req.headers["if-none-match"] ?? "")
    .split(",").map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""));
  if (candidates.includes(tag)) {
    res.status(304).end();
    return;
  }
  res.send(body);
};

// ------------------------------------------------------------- discovery

// An ADT discovery document is an Atom service document: workspaces of
// collections, each collection a resource with the content types it takes.
//
// The shape follows the sanitized sample vsp supplied from its own client
// (`docs/fixtures/adt-discovery.sample.xml` in that repository). Worth
// knowing, because it decides what breaks: vsp does not parse this XML. It
// scans the body for `href="/sap/bc/adt/<collection>"` and reads the token
// off the response header. So the bar for vsp is low, and the reason to emit
// a structurally real document anyway is the stricter clients behind it,
// adt-fs and eventually Eclipse.
// An empty compatibility graph: well formed, and claiming nothing. See the
// route for why it is empty rather than populated.
// What this system can do, said in the vocabulary a client checks against.
//
// This was an empty element under the wrong name, and an empty graph does not
// mean "no opinion" — it means "supports nothing". The client acted on it
// exactly as told: it deleted the content handler for object references and
// reported "Outdated content handler ... was deleted", it concluded
// "Activation is not supported on this project", and it stopped filling in
// package contents. Three unrelated-looking failures, one document, and none
// of them a request that any resource here answered wrongly — the client had
// decided before asking.
//
// The element is compatibility:graph, not adtcomp:graph. The prefix is
// arbitrary but the local name is not, and ours was a different element
// entirely.
//
// The nodes are feature flags and the edges are what makes them mean
// something.
//
// Declaring the flags alone was not enough, and the reason is the second
// measurement: an obligatory edge says a feature is incomplete without its
// partner. OO/classes obligatorily requires classModelXmlSchemaConform,
// PROGRAMS/programs requires programsXmlSchemaConform, CORE/checkruns
// requires checkrunsVendorContentType, ACTIVATION/activate requires
// CORE/xmlFormat. A client reading a feature whose obligations are missing
// treats it as unusable — which is what "Outdated content handler ... was
// deleted" and "Activation is not supported on this project" were both
// saying.
//
// So the set below is the obligatory closure of what this façade serves,
// computed from the system's own edges rather than assembled by hand: start
// from the features there are resources for, and add whatever they are
// declared to require, transitively. Nineteen nodes became thirty-two.
//
// The names ending XmlSchemaConform are promises about the shape of the
// documents here, not about which resources exist, and they are made
// knowingly: a client that finds them false will say so, and there is a real
// system beside this one to compare against when it does.
const COMPATIBILITY = {
  // The one node without which none of the others count for anything.
  //
  // Read off the client's own code rather than guessed: GraphAnalyzer's
  // isNodeAvailable looks up COM.SAP.ADT.COMPATIBILITY/compatibilityAvailable
  // *before* the node it was asked about, and returns false for everything if
  // that node is missing from this system's graph. So a graph that carefully
  // lists activation, checkruns and search, and omits this one line, says "I
  // support nothing" just as loudly as the empty graph did -- and the client
  // says so without sending a request, which is why the resources were all
  // there and none of them were ever called.
  "COM.SAP.ADT.COMPATIBILITY": ["compatibilityAvailable"],
  "COM.SAP.ADT.ABAPUNIT": ["abapunit", "uriBasedAbapUnit", "xmlVersion2"],
  // The one promise in this map with nothing behind it yet, made on purpose.
  //
  // Without this namespace the client says "Navigation to ABAP in Eclipse
  // might not work correctly in this system" and offers SAP GUI for Java,
  // which is the one GUI not installed on the machine that asks. With it the
  // client reaches for SAP GUI for Windows instead, which is installed, and
  // that GUI then opens DIAG to the dispatcher port of whatever instance the
  // project names — where, today, nothing is listening.
  //
  // So this does not make F8 work, and is not meant to. It converts a dialog
  // that ends the story into a real client knocking on a real port, which is
  // a thing that can be recorded and answered. That recording is the first
  // step of the DIAG side quest (docs/backlog.md, track C); until C.4 stands
  // up a listener, the honest reading of this entry is "we intend to".
  //
  // reentranceTickets is included because there is a resource behind it —
  // /sap/bc/adt/core/http/reentranceticket — and because matching the three
  // a real system declares is a better bet than guessing which one the client
  // keys on.
  "COM.SAP.ADT.SAPGUI": ["navigationEvents", "reentranceTickets", "sapguiForWindows"],
  "COM.SAP.ADT.ACTIVATION": ["activate", "check"],
  "COM.SAP.ADT.CORE": ["checkruns", "checkrunsVendorContentType", "xmlFormat", "xmlNameSpace"],
  "COM.SAP.ADT.DDIC": ["ddic"],
  // The DDL editor asks for DDLSOURCES/ddlSources before it opens anything
  // (cds.ddl.ui!DdlSourceEditor#getFeatureNamespaceForInitialCheck), and a
  // double click on a CDS view sent no request at all while it was absent.
  // ddlParserV1 is deliberately not promised: it would make the client
  // fetch the system's own DDL grammar, which is not served here; without
  // the promise the client parses with its built-in version.
  "COM.SAP.ADT.DDIC.DDLSOURCES": ["ddlSources"],
  "COM.SAP.ADT.DDIC.VIEWS": ["views"],
  "COM.SAP.ADT.FUNCTIONS": ["fmodulesSignatureEditable", "functionGroupIncludes",
    "functionGroupIncludesXmlSchemaConform", "functionGroups", "functionModules",
    "functionModulesXmlSchemaConform", "functions"],
  "COM.SAP.ADT.OO": ["classModelXmlSchemaConform", "classes", "interfaces",
    "interfacesModelXmlSchemaConform", "startUriAdaptationToMainResource"],
  "COM.SAP.ADT.PROGRAMS": ["includes", "includesXmlSchemaConform", "programs", "programsXmlSchemaConform"],
  // treePath is deliberately absent: it promises repository/nodepath, which
  // nothing here answers, and a client that believes the promise asks for it
  // while expanding a package instead of falling back to nodestructure. The
  // other three are kept because there is a resource behind each —
  // nodestructure, informationsystem/search and typestructure.
  "COM.SAP.ADT.PROJECTEXPLORER": ["fullRepositoryTree", "repositoryQueryService", "typeMetaData"],
  "COM.SAP.ADT.RIS": ["ris", "search"],
  // The outline of a class or interface is gated here, not at the resource.
  // The client's outline provider asks the graph for this node before it
  // does anything else (abapsource.ui!AdtOutlineTreeContentProvider
  // #isObjectStructureResourceAvailable@34-58) and, told no, cancels its job
  // without a request, an error or a refresh — "Loading outline structure
  // ..." forever, nothing in the log. The objectstructure resource behind
  // it had been answering the whole time. Declared without the obligatory
  // edge the system carries (outline -> outlineBlockInformation), because
  // block information is not served here and a promise of it would be false.
  "COM.SAP.ADT.SOURCESERVICES": ["outline"],
};

// [source namespace, source, target namespace, target, obligatory]
const COMPATIBILITY_EDGES = [
  ["COM.SAP.ADT.ABAPUNIT", "abapunit", "COM.SAP.ADT.ABAPUNIT", "uriBasedAbapUnit", true],
  ["COM.SAP.ADT.ABAPUNIT", "abapunit", "COM.SAP.ADT.ABAPUNIT", "xmlVersion2", true],
  ["COM.SAP.ADT.ACTIVATION", "activate", "COM.SAP.ADT.CORE", "xmlFormat", true],
  ["COM.SAP.ADT.CORE", "checkruns", "COM.SAP.ADT.CORE", "checkrunsVendorContentType", true],
  ["COM.SAP.ADT.CORE", "xmlFormat", "COM.SAP.ADT.CORE", "xmlNameSpace", true],
  ["COM.SAP.ADT.FUNCTIONS", "functionGroupIncludes", "COM.SAP.ADT.FUNCTIONS", "functionGroupIncludesXmlSchemaConform", true],
  ["COM.SAP.ADT.FUNCTIONS", "functionModules", "COM.SAP.ADT.FUNCTIONS", "fmodulesSignatureEditable", true],
  ["COM.SAP.ADT.FUNCTIONS", "functionModules", "COM.SAP.ADT.FUNCTIONS", "functionModulesXmlSchemaConform", true],
  ["COM.SAP.ADT.FUNCTIONS", "functions", "COM.SAP.ADT.FUNCTIONS", "fmodulesSignatureEditable", true],
  ["COM.SAP.ADT.FUNCTIONS", "functions", "COM.SAP.ADT.FUNCTIONS", "functionGroupIncludes", true],
  ["COM.SAP.ADT.FUNCTIONS", "functions", "COM.SAP.ADT.FUNCTIONS", "functionGroups", false],
  ["COM.SAP.ADT.FUNCTIONS", "functions", "COM.SAP.ADT.FUNCTIONS", "functionModules", true],
  ["COM.SAP.ADT.OO", "classes", "COM.SAP.ADT.OO", "classModelXmlSchemaConform", true],
  ["COM.SAP.ADT.OO", "classes", "COM.SAP.ADT.OO", "startUriAdaptationToMainResource", true],
  ["COM.SAP.ADT.OO", "interfaces", "COM.SAP.ADT.OO", "interfacesModelXmlSchemaConform", true],
  ["COM.SAP.ADT.OO", "interfaces", "COM.SAP.ADT.OO", "startUriAdaptationToMainResource", true],
  ["COM.SAP.ADT.PROGRAMS", "includes", "COM.SAP.ADT.PROGRAMS", "includesXmlSchemaConform", true],
  ["COM.SAP.ADT.PROGRAMS", "programs", "COM.SAP.ADT.PROGRAMS", "programsXmlSchemaConform", true],
  ["COM.SAP.ADT.RIS", "ris", "COM.SAP.ADT.RIS", "search", true],
];

export function compatibilityGraphDocument(features = COMPATIBILITY, edges = COMPATIBILITY_EDGES) {
  const nodes = Object.entries(features).flatMap(([nameSpace, names]) =>
    names.map((name) => `<node nameSpace="${nameSpace}" name="${name}"/>`)).join("");
  const wires = edges.map(([sourceSpace, source, targetSpace, target, obligatory]) =>
    `<edge isObligatory="${obligatory}">` +
    `<sourceNode nameSpace="${sourceSpace}" name="${source}"/>` +
    `<targetNode nameSpace="${targetSpace}" name="${target}"/>` +
    "</edge>").join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<compatibility:graph xmlns:compatibility="http://www.sap.com/adt/compatibility"><nodes>${nodes}</nodes><edges>${wires}</edges></compatibility:graph>
`;
}

export function discoveryDocument(resources) {
  const workspaces = new Map();
  for (const resource of resources) {
    if (workspaces.has(resource.workspace) === false) {
      workspaces.set(resource.workspace, []);
    }
    workspaces.get(resource.workspace).push(resource);
  }

  const collection = (r) => `    <app:collection href="${xmlEscape(r.href)}">
      <atom:title>${xmlEscape(r.title)}</atom:title>
${(r.accept ?? []).map((a) => `      <app:accept>${xmlEscape(a)}</app:accept>`).join("\n")}${(r.accept ?? []).length === 0 ? "" : "\n"}${r.category === undefined ? "" : `      <atom:category term="${xmlEscape(r.category[0])}" scheme="${xmlEscape(r.category[1])}"/>\n`}${(r.templates ?? []).length === 0 ? `      <adtcomp:templateLinks/>\n` : `      <adtcomp:templateLinks>\n${r.templates.map(([rel, template]) => `        <adtcomp:templateLink rel="${xmlEscape(rel)}" template="${xmlEscape(template)}"/>`).join("\n")}\n      </adtcomp:templateLinks>\n`}    </app:collection>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app"
             xmlns:atom="http://www.w3.org/2005/Atom"
             xmlns:adtcomp="http://www.sap.com/adt/compatibility">
${[...workspaces].map(([title, list]) => `  <app:workspace>
    <atom:title>${xmlEscape(title)}</atom:title>
${list.map(collection).join("\n")}
  </app:workspace>`).join("\n")}
</app:service>
`;
}

// ------------------------------------------------------- data preview XML

// The answer to freestyle SQL is column-oriented: per column its metadata,
// then every value of that column. SHAPE NOT YET CONFIRMED against a real
// system; this is the structure as we understand it and the first thing to
// check when the round trip runs.
export function tableDataDocument(answer, options = {}) {
  const rows = answer.rows ?? [];
  const columns = answer.columns ?? (rows.length === 0 ? [] : Object.keys(rows[0]));
  const render = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? Buffer.from(v).toString("hex").toUpperCase() : String(v));
  // C for a character column, I for a number, X for raw: enough for a client
  // to lay out a preview, and all the runtime's rows can tell us
  const type = (name) => {
    const first = rows.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
    return typeof first === "number" ? "I" : typeof first === "object" && first !== null ? "X" : "C";
  };

  // The dictionary's own metadata when the table is known (a4h-adt.jsonl:642:
  // type letter, colType, length, description per column), the guess from
  // the first row for freestyle SQL, whose columns are whatever was selected.
  const known = new Map((options.fields ?? []).map((f) => [f.name.toUpperCase(), f]));
  const metadata = (name) => {
    const f = known.get(name.toUpperCase());
    return f === undefined
      ? `dataPreview:type="${type(name)}" dataPreview:description="${xmlEscape(name.toUpperCase())}" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false"`
      : `dataPreview:type="${xmlEscape(f.letter)}" dataPreview:description="${xmlEscape(f.description || f.name)}" dataPreview:keyAttribute="false" dataPreview:colType="${xmlEscape(f.dataType)}" dataPreview:isKeyFigure="false" dataPreview:length="${f.length}" dataPreview:caseSensitive="false"`;
  };
  const body = columns.map((name) => `  <dataPreview:columns>
    <dataPreview:metadata dataPreview:name="${xmlEscape(name.toUpperCase())}" ${metadata(name)}/>
    <dataPreview:dataSet>
${rows.map((r) => `      <dataPreview:data>${xmlEscape(render(r[name]))}</dataPreview:data>`).join("\n")}
    </dataPreview:dataSet>
  </dataPreview:columns>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
  <dataPreview:totalRows>${rows.length}</dataPreview:totalRows>${options.name === undefined ? "" : `
  <dataPreview:name>${xmlEscape(options.name)}</dataPreview:name>`}
  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>
  <dataPreview:executedQueryString>${xmlEscape(answer.sql ?? "")}</dataPreview:executedQueryString>
  <dataPreview:queryExecutionTime>${options.ms ?? 0}</dataPreview:queryExecutionTime>
${body}
</dataPreview:tableData>
`;
}

// ---------------------------------------------------------------- routing

// which object types answer a source read, and under which ADT collection.
// The store already knows the mapping, because it is the same fact: an
// object type, a file extension and a resource path. INCL and PROG share a
// file on disk and differ by resource, which is why both are here.
const SOURCE_TYPES = Object.entries(TYPES)
  .filter(([, meta]) => meta.source === true && meta.adt !== undefined)
  .map(([type, meta]) => ({type, adt: meta.adt}));

// the content type a collection takes, where a client cares. Taken from the
// sample vsp supplied; a collection absent from here advertises none.
const ACCEPT = {
  "programs/programs": ["application/vnd.sap.adt.programs.programs.v2+xml"],
  "programs/includes": ["application/vnd.sap.adt.programs.includes.v2+xml"],
  "oo/classes": ["application/vnd.sap.adt.oo.classes.v4+xml"],
  "oo/interfaces": ["application/vnd.sap.adt.oo.interfaces.v2+xml"],
  "functions/groups": ["application/vnd.sap.adt.functions.groups.v3+xml"],
  // Both, newest first, the way A4H advertises them: a client picks the
  // highest it knows and a façade that offers only v1 tells a modern one
  // that there is nothing here it can open.
  "packages": ["application/vnd.sap.adt.packages.v2+xml", "application/vnd.sap.adt.packages.v1+xml"],
  "cts/transportchecks": ["application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData"],
  "ddic/dataelements": ["application/vnd.sap.adt.dataelements.v2+xml"],
  "ddic/tables": ["application/vnd.sap.adt.tables.v2+xml"],
  // the run configurations the system says it takes (a4h-adt.jsonl discovery),
  // which is also what tells the client to talk to this resource the typed way
  "abapunit/testruns": ["application/vnd.sap.adt.abapunit.testruns.config.v1+xml",
    "application/vnd.sap.adt.abapunit.testruns.config.v2+xml",
    "application/vnd.sap.adt.abapunit.testruns.config.v3+xml",
    "application/vnd.sap.adt.abapunit.testruns.config.v4+xml", "application/xml"],
};

// which workspace a collection is filed under in the discovery document
// The category every collection carries, and which a client needs before it
// will parse the collection at all.
//
// Read off A4H's own discovery document rather than invented: a cloud project
// reported "Error parsing collection" for every collection this façade
// advertised, and the message named what was wrong — categories=[]. The terms
// and schemes below are the system's, including the two that misspell
// "repository" as "respository", because a client matching on the string
// would not forgive the correction.
const CATEGORY = {
  "programs/programs": ["programs", "http://www.sap.com/adt/categories/programs"],
  "programs/includes": ["includes", "http://www.sap.com/adt/categories/programs"],
  "oo/classes": ["classes", "http://www.sap.com/adt/categories/oo"],
  "oo/interfaces": ["interfaces", "http://www.sap.com/adt/categories/oo"],
  "functions/groups": ["groups", "http://www.sap.com/adt/categories/functions"],
  "packages": ["devck", "http://www.sap.com/wbobj/packages"],
  "ddic/tables": ["tabldt", "http://www.sap.com/wbobj/dictionary"],
  // What opens a data element is this line. The client's navigation looks
  // the object's category up in discovery (BlueObjectTypeUtil
  // #getBlueObjectTypeInfo@78-155) before it sends anything, and with no
  // collection under this scheme and term it offered to install software
  // instead — "/sap/bc/adt/ddic/dataelements/icfname is not installed".
  "ddic/dataelements": ["dtelde", "http://www.sap.com/wbobj/dictionary"],
  // F8 on a table: the system's own term and scheme (a4h-adt.jsonl discovery)
  "datapreview/ddic": ["DatapreviewDdic", "http://www.sap.com/adt/categories/datapreview"],
  "abapunit/testruns": ["unittestruns", "http://www.sap.com/adt/categories/abapunit"],
  "activation": ["activationruns", "http://www.sap.com/adt/categories/activation"],
  "checkruns": ["checkruns", "http://www.sap.com/adt/categories/check"],
  "repository/nodestructure": ["nodestructure", "http://www.sap.com/adt/categories/respository"],
  "repository/informationsystem/search": ["search", "http://www.sap.com/adt/categories/respository"],
  "repository/informationsystem/virtualfolders": ["virtualfolders", "http://www.sap.com/adt/categories/repository"],
  "cts/transportchecks": ["transportchecks", "http://www.sap.com/adt/categories/cts"],
  "checkruns/reporters": ["reporters", "http://www.sap.com/adt/categories/check"],
  "activation/inactiveobjects": ["inactiveobjects", "http://www.sap.com/adt/categories/activation"],
  "datapreview/freestyle": ["DatapreviewFreeStyle", "http://www.sap.com/adt/categories/datapreview"],
  "ddic/ddl/sources": ["ddlsources", "http://www.sap.com/adt/categories/ddic/ddlsources"],
  "ddic/srvd/sources": ["srvdsrv", "http://www.sap.com/wbobj/raps"],
  // These three were advertised with no category at all, and a collection
  // without one is not a collection the client can read: its discovery
  // handler calls category.getScheme() without checking, so one such entry
  // throws NullPointerException and the *whole* discovery document fails to
  // deserialize — which is why the tree sat on "Loading repository tree ..."
  // under every package while three unrelated-looking errors sat in the log.
  // Terms and schemes are the system's own, "respository" included: that
  // misspelling is in SAP's scheme and fixing it would be inventing a scheme
  // nobody looks for.
  "abapunit/metadata": ["metadata", "http://www.sap.com/adt/categories/abapunit"],
  "repository/informationsystem/objecttypes": ["objecttypes", "http://www.sap.com/adt/categories/respository"],
  "repository/informationsystem/releasestates": ["releasestates", "http://www.sap.com/adt/categories/respository"],
};

// How a client builds a URL it was never told in full.
//
// Some resources are not just a path: a client reads the template and fills
// it in. Without one it cannot form the request at all, and it does not fail
// at the server — it fails before the network, which is why the search dialog
// reported "Outdated content handler" while nothing whatsoever arrived here.
// The same search against A4H went out and came back fine, and the difference
// was this element.
//
// Templates copied from the system rather than reduced to what this façade
// honours. A client fills in what it wants and an unknown parameter is
// ignored here, so offering fewer would only teach it to ask for less.
const SEARCH_TEMPLATE =
  "/sap/bc/adt/repository/informationsystem/search{?operation,query,useSearchProvider,noDescription,maxResults}" +
  "{&objectType*}{&group*}{&packageName*}{&sourcetype*}{&state*}{&lifecycle*}{&rollout*}{&category*}{&appl*}" +
  "{&userName*}{&releaseState*}{&language*}{&system*}{&version*}{&docu*}{&fav*}{&created*}{&month*}{&date*}{&comp*}";

const TEMPLATE_LINKS = {
  // the system's own template for a data element (a4h-adt.jsonl:121):
  // the lock handle and transport it carries are for the editor's save
  "ddic/dataelements": [
    ["http://www.sap.com/wbobj/dictionary/dtelde/properties",
      "/sap/bc/adt/ddic/dataelements/{object_name}{?corrNr,lockHandle,version,accessMode,_action}"],
  ],
  "repository/informationsystem/search": [
    ["http://www.sap.com/adt/relations/informationsystem/search/quicksearch", SEARCH_TEMPLATE],
    ["http://www.sap.com/adt/relations/informationsystem/search/whitelisting", SEARCH_TEMPLATE],
  ],
  "datapreview/freestyle": [
    ["http://www.sap.com/adt/categories/datapreview/freestyle", "/sap/bc/adt/datapreview/freestyle{?rowNumber}"],
  ],
  // the two of the system's four templates that are answered here; colcount
  // and hana are not, and are not offered
  "datapreview/ddic": [
    ["http://www.sap.com/adt/categories/datapreview/ddic/metadata", "/sap/bc/adt/datapreview/ddic/{object_name}/metadata"],
    ["http://www.sap.com/adt/categories/datapreview/ddic", "/sap/bc/adt/datapreview/ddic{?rowNumber,ddicEntityName}"],
  ],
  "checkruns": [
    ["http://www.sap.com/adt/categories/check/relations/reporters", "/sap/bc/adt/checkruns{?reporters}"],
  ],
  "activation/inactiveobjects": [
    ["http://www.sap.com/adt/relations/activation/inactiveobjects", "/sap/bc/adt/activation/inactiveobjects{?USERNAME}"],
    ["http://www.sap.com/adt/relations/activation/inactiveobjects/update", "/sap/bc/adt/activation/inactiveobjects{?action}"],
  ],
  "ddic/ddl/sources": [
    ["http://www.sap.com/adt/categories/ddic/ddlsources/properties",
      "/sap/bc/adt/ddic/ddl/sources/{object_name}{?corrNr,lockHandle,version,accessMode,_action}"],
    ["http://www.sap.com/adt/categories/ddic/ddlsources/source",
      "/sap/bc/adt/ddic/ddl/sources/{object_name}/source/main{?corrNr,lockHandle,version}"],
  ],
  "ddic/srvd/sources": [
    ["http://www.sap.com/wbobj/raps/srvdsrv/properties",
      "/sap/bc/adt/ddic/srvd/sources/{object_name}{?corrNr,lockHandle,version,accessMode,_action}"],
    ["http://www.sap.com/wbobj/raps/srvdsrv/source",
      "/sap/bc/adt/ddic/srvd/sources/{object_name}/source/main{?corrNr,lockHandle,version}"],
  ],
};

const WORKSPACE = (adt) => {
  if (adt.startsWith("ddic/") || adt.startsWith("datapreview/")) {
    return "Data Dictionary";
  }
  if (adt.startsWith("repository/") || adt.startsWith("packages")) {
    return "Repository";
  }
  return adt === "activation" || adt === "checkruns" || adt.startsWith("abapunit") || adt.startsWith("cts/") ? "Development Loop" : "Source Library";
};

const TITLE = {
  "programs/programs": "Programs",
  "programs/includes": "Includes",
  "oo/classes": "Classes",
  "oo/interfaces": "Interfaces",
  "ddic/ddl/sources": "CDS DDL Sources",
  "ddic/dataelements": "Data Element",
  "ddic/tables": "Database Table",
  "datapreview/ddic": "Modelled Data Preview for DDIC",
  "ddic/srvd/sources": "Service Definitions",
  "datapreview/freestyle": "Data Preview (freestyle SQL)",
  "repository/informationsystem/search": "Object Search",
  "repository/nodestructure": "Repository Node Structure",
  "packages": "Packages",
  "activation": "Activation",
  "checkruns": "Check Runs (syntax)",
  "abapunit/testruns": "ABAP Unit Test Runs",
  "cts/transportchecks": "Transport Checks",
};

// The body of a request, whatever the host application did with it.
//
// A client may send a wildcard content type — `application/*` is one a real
// system accepts on a check run — and a body parser that cannot resolve that
// to a media type quietly leaves the body unparsed. The façade then sees no
// body and answers "you sent me nothing", which is a lie about the request
// and a hard one to diagnose from the other end. So it reads the stream
// itself when the body did not arrive as bytes.
function rawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    return Promise.resolve(Buffer.from(req.body, "utf8"));
  }
  if (req.readableEnded === true || req.readable === false) {
    return Promise.resolve(Buffer.alloc(0));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const STARTED = new Date().toISOString();

export function adtRouter(options = {}) {
  const store = options.store ?? new ObjectStore({root: options.root});
  if (options.watch !== false && typeof store.watch === "function") {
    // the disk is the other editor: see ObjectStore#watch. A host may hand
    // in a stand-in store that does not watch, and that is not an error
    store.watch();
  }
  const sessions = options.sessions ?? new Sessions();
  const data = options.data ?? store.data();
  const router = express.Router();
  const resources = [];

  const advertise = (adt) => resources.push({
    workspace: WORKSPACE(adt),
    title: TITLE[adt] ?? adt,
    href: `${BASE}/${adt}`,
    accept: ACCEPT[adt] ?? [],
    category: CATEGORY[adt],
    templates: TEMPLATE_LINKS[adt],
  });

  // What a client asked for and did not get, in two kinds. "resource" is a
  // path nothing is mounted on, which is the next wave's work. "object" is a
  // mounted resource answering that the thing is not in this tree, which is
  // usually a client assuming a system convention we do not have — $TMP was
  // one of those and it never appeared here, because the route existed.
  // Recording only the first kind makes an empty list look like a clean bill
  // of health while a client is failing on every node it opens.
  const missed = new Map();
  const record = (req, kind, detail) => {
    if (req === undefined) {
      return;
    }
    const key = `${kind} ${req.method} ${req.path}`;
    const seen = missed.get(key);
    missed.set(key, {
      kind,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query ?? {}).length === 0 ? undefined : {...req.query},
      detail: seen?.detail ?? detail,
      accept: seen?.accept ?? req.headers.accept,
      count: (seen?.count ?? 0) + 1,
      first: seen?.first ?? new Date().toISOString(),
    });
    if (options.logMisses !== false && seen === undefined) {
      console.log(`ADT miss (${kind}): ${req.method} ${req.path}${detail === undefined ? "" : "  " + detail}`);
    }
  };
  // every answer() inside this router records the object misses it turns
  // into 404s, without each call site having to remember to
  const answer = (res, body) => answered(res, body, record);

  // scoped to the façade's own prefix: this router is mounted on the same
  // app as the OData front, and a CSRF gate over somebody else's POST is a
  // 403 they never asked for
  router.use(BASE, sessions.middleware());

  // STG_ADT_DUMP=<file.jsonl> records every exchange under the façade in
  // the shape of the A4H oracle captures: method, url, request headers and
  // body, response status, headers and body, both bodies base64. It exists
  // because the thing a client actually sent is the one thing a replay of
  // "what it must have sent" cannot show, and the proxy the client goes
  // through is on another machine. Off unless asked; a capture carries
  // logons and goes under .local/, never into the tree.
  const dump = options.dump ?? process.env.STG_ADT_DUMP;
  if (dump !== undefined && dump !== "") {
    let seq = 0;
    router.use(BASE, (req, res, next) => {
      const startedAt = new Date();
      const chunks = [];
      const write = res.write.bind(res);
      const end = res.end.bind(res);
      res.write = (chunk, ...rest) => { if (chunk) chunks.push(Buffer.from(chunk)); return write(chunk, ...rest); };
      res.end = (chunk, ...rest) => {
        if (chunk && typeof chunk !== "function") chunks.push(Buffer.from(chunk));
        rawBody(req).then((body) => {
          const line = {
            at: startedAt.toISOString(), seq: ++seq, ms: Date.now() - startedAt.getTime(),
            method: req.method, url: req.originalUrl,
            request: {headers: req.headers, body: {bytes: body.length, base64: body.toString("base64")}},
            response: {status: res.statusCode, headers: res.getHeaders(), body: {bytes: Buffer.concat(chunks).length, base64: Buffer.concat(chunks).toString("base64")}},
          };
          appendFileSync(dump, JSON.stringify(line) + "\n");
        }).catch(() => {});
        return end(chunk, ...rest);
      };
      next();
    });
  }

  // ---- What an ABAP Cloud Project needs that an ordinary one does not.
  //
  // Measured 2026-09-14 against A4H behind a TLS terminator: an ABAP Cloud
  // Project asks for exactly four things beyond the classic surface, and with
  // them a plain on-premise system opens as a cloud one — tree, sources, and
  // ABAP Unit runs. Everything else the wizard needs, including the released-
  // objects tree, comes from resources this façade already serves.
  //
  // The fourth is /sap/public/bc/icf/virtualhost, which is not here because
  // the right answer to it is 404 and that is what an unmounted path already
  // gives. A4H answers the same, and the wizard carries on regardless.
  //
  // The system id is OS2, not OSD, and it is the default rather than an
  // environment variable. A client logs on to a project by comparing the id
  // the system reports with the one the project was created against, and
  // refuses the logon when they differ ("Logon was not performed to the
  // service instance of the project OS2, but to service instance: OSD").
  // The id was set by STG_ADT_SID alone, so a restart without it renamed
  // the system under a working project and locked its owner out, twice.
  // OSD is the product; OS2 is what it answers to on the wire.
  const identity = {
    systemID: options.systemID ?? "OS2",
    userName: options.userName ?? "DEVELOPER",
    userFullName: options.userFullName ?? "Off-Stack Doppelganger",
    client: options.client ?? "001",
    language: options.language ?? "EN",
    ...options.identity,
  };

  // The logon, and the whole of what the wizard calls a challenge.
  //
  // It turns out to be neither OAuth nor PKCE. Eclipse opens a listener on a
  // loopback port, sends a browser here, and expects to be sent back to that
  // listener with a ticket in the query string; the ticket exists only to let
  // the client pick up a session cookie. A real system authenticates first.
  // This one has nobody to authenticate, so it issues the ticket directly —
  // which is the honest behaviour for a façade with no user store, and is why
  // it must not be exposed to a network that matters.
  //
  // The redirect target is restricted to loopback, which is where Eclipse's
  // listener always is. Without that this is an open redirect: anything could
  // hand out a link to this endpoint and have a trusted-looking host bounce a
  // browser wherever it liked, carrying a freshly minted credential.
  //
  // This is the one resource here that redirects, and adt-session's rule that
  // nothing does is not being broken: that rule is about requests for data,
  // where a client reads a redirect as having been logged out. A logon that
  // redirects is the logon working.
  //
  // For now it admits everyone. A façade over a local SQLite file has no user
  // store and inventing one would be pretending; when there is a reason to
  // ask for credentials, this is where the 401 goes, and A4H shows the shape
  // — a plain Basic challenge, then the same 307.
  router.get(`${BASE}/core/http/reentranceticket`, (req, res) => {
    const target = req.query["redirect-url"];
    if (typeof target !== "string" || target === "") {
      res.status(400).type("text/plain").send("redirect-url is required");
      return;
    }
    let url;
    try {
      url = new URL(target);
    } catch {
      res.status(400).type("text/plain").send("redirect-url is not a URL");
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
      res.status(400).type("text/plain").send("redirect-url must point at loopback");
      return;
    }

    const ticket = randomBytes(24).toString("base64url");
    url.searchParams.set("_", String(req.query._ ?? Date.now()));
    url.searchParams.set("reentrance-ticket", ticket);

    // The session cookie is not set here on purpose. The session middleware
    // above already issued one naming a real session, and writing the ticket
    // over it would leave the client holding a value that identifies nothing
    // — which is how every later write earned a CSRF refusal the first time
    // this ran against Eclipse.
    //
    // The ticket's whole life is this redirect. What the client uses
    // afterwards is the cookie: every request Eclipse made after logging on
    // carried one, and no Authorization header at all.
    res.cookie("sap-usercontext", `sap-client=${identity.client}`, {path: "/"});
    res.redirect(307, url.toString());
  });

  // Polled for the life of the project. The security-session link is what the
  // client watches; the timeout is advertised and never enforced here,
  // because there is nothing to expire.
  router.get(`${BASE}/core/http/sessions`, (req, res) => {
    const id = sessionIdentifier(req, identity);
    res.type("application/vnd.sap.adt.core.http.session.v3+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<http:session xmlns:http="http://www.sap.com/adt/http" xmlns:atom="http://www.w3.org/2005/Atom">' +
      `<atom:link href="${BASE}/core/http/sessions/${id}"` +
      ' rel="http://www.sap.com/adt/categories/core/http/sessions/securitysession"' +
      ' title="Security session"/>' +
      '<atom:link href="/sap/public/bc/icf/logoff"' +
      ' rel="http://www.sap.com/adt/categories/core/http/sessions/logoff"' +
      ' title="Logoff resource"/>' +
      `<atom:link href="${BASE}/core/http/systeminformation"` +
      ' rel="http://www.sap.com/adt/categories/core/http/system/systeminformation"' +
      ' type="application/vnd.sap.adt.core.http.systeminformation.v1+json"' +
      ' title="System information resource"/>' +
      '<http:properties><http:property name="inactivityTimeout">1800</http:property></http:properties>' +
      "</http:session>",
    );
  });

  // ---- Virtual folders: how a cloud project builds its tree.
  //
  // Measured on a working session: the tree came from 19 POSTs to
  // virtualfolders/contents and not one call to nodestructure. The two are
  // not interchangeable — a cloud client asked this façade for a tree, got
  // nodestructure back, and reported "No content-handler found for
  // content-type …nodestructure.v1+xml and data-type RepositoryObjectTreeContent".
  // It was not outdated and no plug-in was missing: it had asked for one
  // thing and been handed another.
  //
  // The model is a filter, not a hierarchy. The client sends preselections
  // (this package, that type) and an order of facets still to expand. A
  // non-empty facetorder asks for the folders of its first facet; an empty
  // one asks for the objects themselves. So one resource serves every level
  // of the tree, and the tree's shape is the client's choice rather than
  // ours.
  const FACETS = ["package", "group", "type", "api", "fav"];

  // What the facets call things. The type facet uses REPO for a program
  // (a4h-adt.jsonl:239, "Programs"), and the group facet puts CDS under its
  // own drawer rather than the dictionary (a4h-adt.jsonl:141). Everything
  // else is the workbench's own category and label tables, so a drawer here
  // and a drawer in nodestructure are named by one place.
  const vfsType = (type) => type === "PROG" ? "REPO" : type;
  const vfsTypeLabel = (value) => {
    const kind = value === "REPO" ? "PROG" : value;
    return TREE_FOLDER[kind]?.[1] ?? TREE_TYPE_LABEL[kind] ?? value;
  };
  const CDS = ["DDLS", "SRVD", "DCLS"];
  const vfsGroup = (type) => CDS.includes(type) ? "CORE_DATA_SERVICES" : (TREE_CATEGORY[type] ?? "other").toUpperCase();
  const GROUP_LABELS = {CORE_DATA_SERVICES: "Core Data Services", UC_OBJECT_TYPE_GROUP: "Connectivity"};
  const vfsGroupLabel = (value) => GROUP_LABELS[value] ?? TREE_CATEGORY_LABEL[value.toLowerCase()] ?? value;

  const virtualFoldersRequest = (xml) => {
    const preselection = new Map();
    for (const [, facet, inner] of xml.matchAll(
      /<vfs:preselection[^>]*facet="([^"]+)"[^>]*>([\s\S]*?)<\/vfs:preselection>/g)) {
      preselection.set(facet.toLowerCase(),
        [...inner.matchAll(/<vfs:value>([^<]*)<\/vfs:value>/g)].map((m) => m[1].toUpperCase()));
    }
    const order = [...xml.matchAll(/<vfs:facet>([^<]+)<\/vfs:facet>/g)].map((m) => m[1].toLowerCase());
    const pattern = /objectSearchPattern="([^"]*)"/.exec(xml)?.[1] ?? "*";
    return {preselection, order, pattern};
  };

  // Every object this façade holds, with the package it sits in.
  const everyObject = () => {
    const all = [];
    for (const pkg of store.packages()) {
      for (const object of store.package(pkg.name).objects) {
        all.push({...object, package: pkg.name});
      }
    }
    return all;
  };

  // The package tree, for the two spellings a selection has. A plain name
  // means the package and everything below it (a4h-adt.jsonl:44: $ZORK
  // counts 24, which is its subpackages' objects); a name with ".." in
  // front means only what is assigned to that package directly
  // (a4h-adt.jsonl:233: ..Z counts 2 where Z counted 8).
  const packageTree = () => {
    const byName = new Map(store.packages().map((p) => [p.name, p]));
    const subtree = (name) => {
      const out = [name];
      for (let i = 0; i < out.length; i++) {
        for (const child of byName.get(out[i])?.subpackages ?? []) {
          out.push(child);
        }
      }
      return out;
    };
    return {byName, subtree};
  };
  const packageMembers = (value, tree) =>
    value.startsWith("..") ? [value.slice(2)] : tree.subtree(value);

  const matchesPattern = (name, pattern) => {
    if (pattern === "" || pattern === "*") {
      return true;
    }
    const escaped = pattern.toUpperCase().split("*")
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}$`).test(name.toUpperCase());
  };

  // The value of a facet for one object. Two facets have no value here and
  // say so: "api" is the release contract of an object, which this façade
  // does not hold, and inventing one would tell a cloud project every object
  // is released; "fav" is a person's favourite packages, which the system
  // itself answers empty for (a4h-adt.jsonl:32). An empty drawer is the
  // honest answer for both.
  const facetValue = (object, facet) => {
    if (facet === "package") {
      return object.package;
    }
    if (facet === "type") {
      return vfsType(object.type);
    }
    if (facet === "group") {
      return vfsGroup(object.type);
    }
    return undefined;
  };

  const xmlEscape = (text) => String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const ATOM = ' xmlns:atom="http://www.w3.org/2005/Atom"';
  const SELECTION_REL = "http://www.sap.com/adt/relations/informationsystem/virtualfolders/selection";
  const selectionHref = (parts) =>
    `${BASE}/repository/informationsystem/virtualfolders?selection=${encodeURIComponent(parts.join(" "))}`;

  advertise("repository/informationsystem/virtualfolders");
  router.get(`${BASE}/repository/informationsystem/virtualfolders/facets`, (req, res) => {
    res.type("application/vnd.sap.adt.facets.v1+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<vf:facets xmlns:vf="http://www.sap.com/adt/ris/facets">' +
      FACETS.map((facet) =>
        `<vf:facet key="${facet}" displayName="${facet[0].toUpperCase() + facet.slice(1)}"` +
        ` description="${facet}" isHierarchical="false"` +
        ' isForFiltering="true" isForStructuring="true"/>').join("") +
      "</vf:facets>",
    );
  });

  // One resource for every level of the tree. The shape of the answer is
  // read off the request: a non-empty facetorder asks for the drawers of its
  // first facet, an empty one asks for the objects. The forms below are the
  // system's, by capture line: package drawers a4h-adt.jsonl:44 and :232,
  // several selected packages :231, group and type drawers :90 and :91,
  // objects :92, the direct-only spelling :233 and :239.
  router.post(`${BASE}/repository/informationsystem/virtualfolders/contents`, async (req, res) => {
    const asked = virtualFoldersRequest((await rawBody(req)).toString("utf8"));
    const tree = packageTree();
    const packageValues = asked.preselection.get("package") ?? [];

    let objects = everyObject().filter((object) => matchesPattern(object.name, asked.pattern));
    for (const [facet, values] of asked.preselection) {
      if (facet === "package") {
        const members = new Set(values.flatMap((value) => packageMembers(value, tree)));
        objects = objects.filter((object) => members.has(object.package));
      } else {
        objects = objects.filter((object) => values.includes(facetValue(object, facet)));
      }
    }
    const countIn = (names) => {
      const set = new Set(names);
      return objects.filter((object) => set.has(object.package)).length;
    };

    const selected = [...asked.preselection].map(([facet, values]) => `${facet}:${values.join(",")}`);
    const rootLink = `<atom:link href="${selectionHref(selected)}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>`;

    // Exactly one package, spelled plainly, and the client is told whether
    // that package has packages below it — which is how it decides whether
    // to ask for a package level next (:44 true, :90 false) — and nothing
    // for several packages (:231) or the direct-only spelling (:233).
    const onePackage = packageValues.length === 1 && !packageValues[0].startsWith("..") ? packageValues[0] : undefined;
    const hasSubpackages = (name) => (tree.byName.get(name)?.subpackages?.length ?? 0) > 0;
    const preselectionInfo = onePackage === undefined ? "" :
      `<vfs:preselectionInfo facet="PACKAGE" hasChildrenOfSameFacet="${hasSubpackages(onePackage)}"/>`;

    let body;
    if (asked.order.length === 0) {
      // The objects. The system also carries a vituri and a second link
      // into SAP GUI for HTML; nothing here answers those, and a link that
      // 404s is worse than one that is absent.
      body = objects.map((object) => {
        const type = TYPES[object.type];
        const uri = `${BASE}/${type?.adt ?? "unknown"}/${encodeURIComponent(object.name.toLowerCase())}`;
        return `<vfs:object uri="${uri}" text="${xmlEscape(object.description ?? object.name)}" name="${xmlEscape(object.name)}"` +
          ` package="${xmlEscape(object.package)}" type="${ADT_TYPE[object.type] ?? object.type}" expandable="${type?.source === true}">` +
          `<atom:link href="${uri}" rel="http://www.sap.com/adt/relations/objects" title="ADT Object Reference"${ATOM}/>` +
          "</vfs:object>";
      }).join("");
    } else if (asked.order[0] === "package") {
      // Package drawers. One selected package opens to its subpackages,
      // with a "..P" drawer first when P holds objects of its own (:232 has
      // one, :44 does not); several selected packages open to themselves
      // (:231); no package at all opens to the roots, which no capture
      // shows and is this façade's reading of what a root should be.
      const others = selected.filter((part) => !part.startsWith("package:"));
      const drawer = (name, direct) => {
        const pkg = tree.byName.get(name);
        const value = direct ? `..${name}` : name;
        const uri = `${BASE}/packages/${encodeURIComponent(name.toLowerCase())}`;
        return `<vfs:virtualFolder hasChildrenOfSameFacet="${!direct && hasSubpackages(name)}" uri="${uri}"` +
          ` counter="${countIn(packageMembers(value, tree))}"` +
          ` text="${xmlEscape(direct ? "directly assigned objects" : (pkg?.description ?? ""))}"` +
          ` name="${xmlEscape(value)}" displayName="${xmlEscape(value)}" facet="PACKAGE">` +
          `<atom:link href="${selectionHref([...others, `package:${value}`])}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>` +
          `<atom:link href="${uri}" rel="http://www.sap.com/adt/relations/packages" title="Package"${ATOM}/>` +
          "</vfs:virtualFolder>";
      };
      let drawers;
      if (onePackage !== undefined) {
        const own = objects.some((object) => object.package === onePackage);
        drawers = [...(own ? [drawer(onePackage, true)] : []),
          ...[...(tree.byName.get(onePackage)?.subpackages ?? [])].sort().map((child) => drawer(child, false))];
      } else if (packageValues.length === 0) {
        drawers = store.rootPackages().map((root) => root.name).sort().map((name) => drawer(name, false));
      } else {
        drawers = packageValues.map((value) => value.startsWith("..") ? drawer(value.slice(2), true) : drawer(value, false));
      }
      body = drawers.join("");
    } else {
      // Group and type drawers: the objects of the selection, counted by the
      // facet, each drawer linking to the selection narrowed by itself.
      const facet = asked.order[0];
      const counts = new Map();
      for (const object of objects) {
        const value = facetValue(object, facet);
        if (value !== undefined) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      body = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => {
        const label = facet === "group" ? vfsGroupLabel(value) : facet === "type" ? vfsTypeLabel(value) : value;
        return `<vfs:virtualFolder hasChildrenOfSameFacet="false" counter="${count}" text=""` +
          ` name="${xmlEscape(value)}" displayName="${xmlEscape(label)}" facet="${facet.toUpperCase()}">` +
          `<atom:link href="${selectionHref([...selected, `${facet}:${value}`])}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>` +
          "</vfs:virtualFolder>";
      }).join("");
    }

    res.type("application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      `<vfs:virtualFoldersResult objectCount="${objects.length}"` +
      ' xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders">' +
      preselectionInfo + rootLink + body +
      "</vfs:virtualFoldersResult>",
    );
  });

  // ---- The rest of what a client asks for before it will work.
  //
  // Found by a sweep rather than one failure at a time: every path the real
  // system answered was replayed against this façade, and these are the ones
  // that came back 404 while being asked for on every project open. Fixing
  // them one dialog at a time was costing a round trip with a person for
  // each, which is a slow way to find out what a client wants.

  // What kinds of object a client may filter a search by. Ours, not a
  // system's list of 304 — a filter for a type this façade cannot hold finds
  // nothing, and the client shows it as an option anyway.
  advertise("repository/informationsystem/objecttypes");
  router.get(`${BASE}/repository/informationsystem/objecttypes`, (req, res) => {
    res.type("application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8").send(
      namedItemsDocument(Object.keys(TYPES).map((code) => ({
        // The item name is the workbench kind. The qualified ADT type and
        // its consumers live in data; Eclipse parses this field without a
        // null check while pre-loading and while constructing search filters.
        name: code,
        description: (LABELS[code] ?? [code])[1] ?? code,
        data: `type:${ADT_TYPE[code] ?? code};usedBy:quick_search,virtual_folders`,
      }))),
    );
  });

  // Release states, which a cloud client uses to split released APIs from the
  // rest. Nothing here is released in that sense and the empty list says so.
  advertise("repository/informationsystem/releasestates");
  router.get(`${BASE}/repository/informationsystem/releasestates`, (req, res) => {
    res.type("application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8").send(namedItemsDocument([]));
  });

  // Property value helps behind the search dialog's filters.
  router.get(`${BASE}/repository/informationsystem/objectproperties/values`, (req, res) => {
    res.type("application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8").send(namedItemsDocument([]));
  });

  // Whether to report package check errors. False, because there are none.
  router.get(`${BASE}/packages/settings`, (req, res) => {
    res.type("application/vnd.sap.adt.packages.settings+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<pkcs:settings pkcs:showPackageCheckErrors="false" xmlns:pkcs="http://www.sap.com/adt/packages/settings"/>',
    );
  });

  // The feed list, and the feeds themselves elsewhere. A client activates
  // "registered feed queries" on every project open and logs an error when it
  // cannot read this.
  router.get(`${BASE}/feeds`, (req, res) => {
    emptyFeed(res, "ABAP System Monitoring", `${BASE}/feeds`);
  });
  router.get(`${BASE}/feeds/variants`, (req, res) => {
    emptyFeed(res, "Feed Variants", `${BASE}/feeds/variants`);
  });

  // Who exists. One user: the one this façade answers as, because there is no
  // user store behind it and pretending otherwise would put names in a
  // dropdown that mean nothing here.
  router.get(`${BASE}/system/users`, (req, res) => {
    res.type("application/atom+xml;type=feed").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">' +
      `<atom:title>Users</atom:title><atom:updated>${new Date().toISOString()}</atom:updated>` +
      `<atom:entry><atom:id>${identity.userName}</atom:id>` +
      `<atom:title>${identity.userFullName}</atom:title></atom:entry>` +
      "</atom:feed>",
    );
  });

  // Which object types can carry unit tests. Packages and classes here, which
  // is what this façade can actually run.
  advertise("abapunit/metadata");
  router.get(`${BASE}/abapunit/metadata`, (req, res) => {
    const feature = (kind, own) =>
      `<aunit:supportedTypeFeatures globalWorkbenchType="${kind}" ownTests="${own}"` +
      ' assignedTests="true" coverage="false"/>';
    res.type("application/vnd.sap.adt.abapunit.metadata.result.v1+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<aunit:metadata xmlns:aunit="http://www.sap.com/adt/aunit">' +
      feature("DEVC/K", "true") + feature("CLAS/OC", "true") + feature("PROG/P", "true") +
      "</aunit:metadata>",
    );
  });

  // Which build is answering.
  //
  // "Are we sure the server was restarted" is a question that should cost one
  // request, not a chain of inference. It was asked after a deploy that had
  // in fact landed, and the only way to answer was to probe three unrelated
  // resources and reason about what their shapes implied. The bridge grew the
  // same stamp for the same reason.
  //
  // The digest is over the façade's own sources, so it changes when the
  // answers change and not when the process merely restarts.
  router.get(`${BASE}/core/http/build`, (req, res) => {
    res.type("application/json; charset=utf-8").send(JSON.stringify({
      build: facadeBuildStamp(),
      started: STARTED,
      identity,
    }));
  });

  // Ending a session. There is nothing to end — the session is a cookie and a
  // token — but a client that gets 404 here reports a failed logoff.
  router.delete(`${BASE}/core/http/sessions/:id`, (req, res) => res.status(200).end());
  router.get("/sap/public/bc/icf/logoff", (req, res) => res.status(200).type("text/plain").send("logged off"));

  // ---- The workbench type list, which the client pre-loads before it will
  // open anything.
  //
  // Answered from what this façade actually serves rather than copied from a
  // system: TYPES already names every kind here and where it lives under
  // /sap/bc/adt, which is exactly the two things a descriptor carries. A list
  // borrowed from somewhere else would advertise types that 404 on the first
  // click.
  //
  // The real one is 359 KB of the same shape — a flat run of descriptors
  // inside asx:abap — and reaches the client gzipped by the ICM, which is
  // where the "binary" first impression came from. Express compresses it
  // here for the same reason.
  const LABELS = {
    CLAS: ["Class", "Classes", "Source Code Library"],
    INTF: ["Interface", "Interfaces", "Source Code Library"],
    PROG: ["Program", "Programs", "Source Code Library"],
    INCL: ["Include", "Includes", "Source Code Library"],
    FUGR: ["Function Group", "Function Groups", "Source Code Library"],
    TABL: ["Database Table", "Database Tables", "Dictionary"],
    DTEL: ["Data Element", "Data Elements", "Dictionary"],
    DOMA: ["Domain", "Domains", "Dictionary"],
    TTYP: ["Table Type", "Table Types", "Dictionary"],
    DDLS: ["Data Definition", "Data Definitions", "Dictionary"],
    SRVD: ["Service Definition", "Service Definitions", "Dictionary"],
    VIEW: ["View", "Views", "Dictionary"],
    SHLP: ["Search Help", "Search Helps", "Dictionary"],
    MSAG: ["Message Class", "Message Classes", "Source Code Library"],
    DEVC: ["Package", "Packages", "Others"],
  };

  router.post(`${BASE}/repository/typestructure`, (req, res) => {
    const descriptors = Object.entries(TYPES).map(([code, type]) => {
      const [label, plural, category] = LABELS[code] ?? [code, code, "Others"];
      return "<SEU_ADT_OBJECT_TYPE_DESCRIPTOR>" +
        `<OBJECT_TYPE>${ADT_TYPE[code] ?? code}</OBJECT_TYPE>` +
        `<OBJECT_TYPE_LABEL>${label}</OBJECT_TYPE_LABEL>` +
        `<OBJECT_TYPE_LABEL_PLURAL>${plural}</OBJECT_TYPE_LABEL_PLURAL>` +
        `<CATEGORY>${category}</CATEGORY>` +
        `<CATEGORY_LABEL>${category}</CATEGORY_LABEL>` +
        `<URI_TEMPLATE>${BASE}/${type.adt}/{name}</URI_TEMPLATE>` +
        "<PARENT_OBJECT_TYPE/>" +
        "<OBJNAME_MAXLENGTH>30</OBJNAME_MAXLENGTH>" +
        "<CAPABILITIES/><USER_AUTHORIZATIONS/>" +
        "</SEU_ADT_OBJECT_TYPE_DESCRIPTOR>";
    }).join("");

    res.type(asXmlTypeFor(req, "com.sap.adt.RepositoryTypeList")).send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>' +
      descriptors +
      "</DATA></asx:values></asx:abap>",
    );
  });

  // ---- What the client polls, and what a healthy system has to say about it.
  //
  // Measured: over a captured working session these were a quarter of every
  // request made — 108 calls to runtime/dumps and 54 to systemmessages, both
  // on a timer, both answered with an empty feed because nothing had gone
  // wrong. A façade that answers them sheds most of its traffic before
  // implementing anything interesting, and a façade that 404s them makes a
  // client report an error where the real answer is "nothing to report".
  //
  // An empty feed is not a stub. It is the correct answer, and it stays the
  // correct answer for as long as nothing here dumps.
  const emptyFeed = (res, title, self) => {
    res.type("application/atom+xml;type=feed").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">' +
      `<atom:author><atom:name>${identity.userFullName}</atom:name></atom:author>` +
      `<atom:contributor><atom:name>${identity.systemID}</atom:name></atom:contributor>` +
      `<atom:link href="${self}" rel="self" type="application/atom+xml;type=feed"/>` +
      `<atom:title type="text">${title}</atom:title>` +
      `<atom:updated>${new Date().toISOString()}</atom:updated>` +
      "</atom:feed>",
    );
  };

  router.get(`${BASE}/runtime/dumps`, (req, res) => {
    emptyFeed(res, "Runtime Errors", `${BASE}/runtime/dumps`);
  });

  router.get(`${BASE}/runtime/systemmessages`, (req, res) => {
    emptyFeed(res, "System Messages", `${BASE}/runtime/systemmessages`);
  });

  router.get(`${BASE}/gw/errorlog`, (req, res) => {
    emptyFeed(res, "SAP Gateway Error Log", `${BASE}/gw/errorlog`);
  });

  // The debugger's long poll. A4H answers 200 with no body at all, to every
  // one of GET, POST and DELETE, and that is the whole contract: there is no
  // listener, nobody is being debugged, come back later. Nothing here can be
  // debugged either, so the same answer is honest rather than a placeholder.
  for (const method of ["get", "post", "delete"]) {
    router[method](`${BASE}/debugger/listeners`, (req, res) => {
      res.status(200).end();
    });
  }

  // Read once at startup and shown in the window title.
  router.get(`${BASE}/core/http/systeminformation`, (req, res) => {
    res.type("application/vnd.sap.adt.core.http.systeminformation.v1+json; charset=utf-8")
      .send(JSON.stringify(identity));
  });

  // ---- discovery: the handshake and the gatekeeper, at both of its names.
  // core/discovery is what a client probes for reachability and a token;
  // discovery is the collection list it scans. The same document answers
  // both, because the same thing is true of both.
  const discovery = (req, res) => {
    res.status(200).type("application/atomsvc+xml").send(discoveryDocument(resources));
  };
  // HEAD before GET on purpose: a client fetches its token with HEAD and
  // falls back to GET only if HEAD is refused, so HEAD must work
  for (const path of [BASE + "/core/discovery", BASE + "/discovery"]) {
    router.head(path, (req, res) => {
      res.status(200).type("application/atomsvc+xml").end();
    });
    router.get(path, discovery);
  }

  // ---- compatibility/graph: the logon probe, and the whole of what stands
  // between OSD and a real IDE.
  //
  // abap-adt-api, which is what the VS Code client adt-fs runs on, calls this
  // and nothing else from login(): it sends basic auth, asks for a token with
  // `x-csrf-token: fetch`, and keeps the cookies. It never reads the body and
  // never checks the content type. So a 404 here is a failed logon, and a 200
  // here is a connected IDE, with no reentrance ticket and no RFC anywhere in
  // it. That is the entire reason this route exists.
  //
  // The graph says which features this façade serves; see
  // compatibilityGraphDocument for what an empty one turned out to mean and
  // why it is no longer empty. A client reads it before it reads discovery,
  // and disables what it finds unclaimed.
  for (const path of [BASE + "/compatibility/graph"]) {
    router.head(path, (req, res) => {
      res.status(200).type("application/xml").end();
    });
    router.get(path, (req, res) => {
      res.status(200).type("application/xml").send(compatibilityGraphDocument());
    });
  }

  // ---- reading source
  for (const {type, adt} of SOURCE_TYPES) {
    advertise(adt);
    // a namespaced name arrives URL-encoded (%2Fdemo%2Fzreport) and Express
    // has already decoded it by the time it is a parameter
    router.get(`${BASE}/${adt}/:name/source/main`, (req, res) => {
      answer(res, () => {
        const source = store.read(type, req.params.name).source;
        res.type("text/plain; charset=utf-8");
        sendEntity(req, res, source);
      });
    });
    // the base resource of a class include. A client resolving a method body
    // asks for the include object before it asks for the include's source, so
    // a 404 here stops a method read that would otherwise work.
    router.get(`${BASE}/${adt}/:name/includes/:include`, (req, res) => {
      answer(res, () => {
        const {name, include} = req.params;
        if (type !== "CLAS") {
          throw new NotFound(type, `${name} include ${include}`);
        }
        const part = store.read(type, name, include);
        // VSP and the source links in class properties use this URL directly
        // with */*. Only an explicit include-property request wants XML.
        if (!String(req.headers.accept ?? "").includes("application/vnd.sap.adt.oo.classes.includes.")) {
          res.type("text/plain; charset=utf-8");
          sendEntity(req, res, part.source);
          return;
        }
        const document = classIncludeDocument(store.find(type, name).name, include, `${BASE}/${adt}/${encodeURIComponent(String(name).toLowerCase())}/includes/${include}/source/main`);
        res.type("application/vnd.sap.adt.oo.classes.includes.v2+xml");
        sendEntity(req, res, document);
      });
    });
    // a class's other includes: definitions, implementations, macros, tests
    router.get(`${BASE}/${adt}/:name/includes/:include/source/main`, (req, res) => {
      answer(res, () => {
        if (type !== "CLAS") {
          throw new NotFound(type, `${req.params.name} include ${req.params.include}`);
        }
        const source = store.read(type, req.params.name, req.params.include).source;
        res.type("text/plain; charset=utf-8");
        sendEntity(req, res, source);
      });
    });
    // the object structure: what a client reads before asking for one method
    // rather than the whole source. A plain full-source read never comes
    // through here, which is why wave 0 could do without it.
    // The object itself, at two spellings of one resource.
    //
    // `.../objectstructure` is the one vsp asks for. The bare object URI is
    // the one abap-adt-api asks for, and through it adt-fs: its
    // objectStructure() GETs the object's own address and reads the
    // structure out of whatever comes back, taking the source from the
    // root's abapsource:sourceUri. So opening a class in VS Code hit the
    // bare path, met the catch-all, and failed with "not served by OSD"
    // after the tree had already opened — the object was there and its
    // front door was not.
    const structure = (req, res) => {
      answer(res, () => {
        const found = structureOf(store, type, req.params.name);
        if (found === undefined) {
          throw new NotFound(type, req.params.name);
        }
        // xml:base on the root is not decoration. The client merges this
        // structure with its own parse of the source and, first thing, takes
        // getBaseLinks().get(0) — a list filled only from xml:base
        // (abapsource!AdtStructuralInfoService#mergeOutlineContentWithRndBasedOutline@78-93,
        // ObjectStructureContentHandler#parseRecursively@135-231). Without it:
        // "Index 0 out of bounds for length 0" on every keystroke in the editor.
        res.type("application/vnd.sap.adt.objectstructure.v2+xml")
          .send(objectStructureDocument(found, {base: req.originalUrl}));
      });
    };
    router.get(`${BASE}/${adt}/:name/objectstructure`, structure);

    // A class answers as a class here, whatever the client asked for.
    //
    // This went through two wrong versions before the oracle settled it. The
    // first served the object structure, on a note saying abap-adt-api GETs
    // this address expecting one — written when a class would not open in VS
    // Code. The second served whichever the Accept header named, on the
    // reasoning that Eclipse and abap-adt-api want different things and both
    // could be right.
    //
    // They do not want different things. VS Code, handed the structure, said
    // "Operation not supported for object CLAS/OC CL_ICF_TREE" — it had
    // recognised the type and refused, because it wanted a class document
    // too. And the real system does not negotiate at all: asked with
    // Accept: */* and asked with the versioned class type, A4H answers
    // class:abapClass both times.
    //
    // So content negotiation here was a dialect no system speaks, invented to
    // reconcile a conflict that did not exist. The structure keeps its own
    // address under /objectstructure, which is where a client that wants one
    // asks.
    if (type === "CLAS") {
      router.get(`${BASE}/${adt}/:name`, (req, res) => {
        answer(res, () => {
          const found = store.find(type, req.params.name);
          if (found === undefined) {
            throw new NotFound(type, req.params.name);
          }
          // with its state: written and not activated reads as inactive, and
          // the document changes with it, which is what the client re-reads
          // for after a save
          const document = classDocument({...found, ...store.stateOf(found)}, {includes: store.classIncludes?.(found.name) ?? []});
          res.type("application/vnd.sap.adt.oo.classes.v4+xml");
          sendEntity(req, res, document);
        });
      });
    } else if (SOURCE_PROPERTY_MIME[type] !== undefined) {
      router.get(`${BASE}/${adt}/:name`, (req, res) => {
        answer(res, () => {
          const object = store.read(type, req.params.name);
          const document = sourcePropertiesDocument(type, object);
          res.type(SOURCE_PROPERTY_MIME[type]);
          sendEntity(req, res, document);
        });
      });
    } else {
      router.get(`${BASE}/${adt}/:name`, structure);
    }
  }

  // ---- the development loop: lock, write, unlock, activate.
  //
  // A lock is synthetic, because a local system has nobody to lock against
  // but itself. What makes it more than a formality is affinity: the handle
  // lives on the session, so a client that loses its context loses its lock,
  // which is exactly what a real system does and exactly what a client's
  // sequencing bugs look like.
  const collections = SOURCE_TYPES.map(({type, adt}) => [type, adt]);

  // CREATE is a POST on the collection, DELETE a DELETE on the object.
  // The create body is the object's own document with nothing in it but a
  // name, a description and the package it goes to (vsp!crud.go
  // buildCreateObjectBody; Eclipse's wizards send the same); the answer is
  // 201 with the object's URI in Location, and the client's next move is
  // the ordinary lock / PUT / activate, which is why a create writes a
  // skeleton and not a source. A package is created the same way under
  // /packages, with its parent in pack:superPackage. Function groups and
  // modules are not created here yet: a group is a folder of includes with
  // a header of its own, and nothing has asked for one.
  const attribute = (xml, element, name) => {
    const scope = element === undefined ? xml : (new RegExp(`<${element}\\b[^>]*>`).exec(xml)?.[0] ?? "");
    return new RegExp(`\\b${name}="([^"]*)"`).exec(scope)?.[1];
  };
  for (const {type, adt} of [...SOURCE_TYPES, {type: "DEVC", adt: "packages"}]) {
    router.post(`${BASE}/${adt}`, async (req, res) => {
      const body = (await rawBody(req)).toString("utf8");
      answer(res, () => {
        const name = attribute(body, undefined, "adtcore:name");
        if (name === undefined || name === "") {
          res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "the create body names no object"));
          return;
        }
        const home = type === "DEVC"
          ? attribute(body, "pack:superPackage", "adtcore:name")
          : attribute(body, "adtcore:packageRef", "adtcore:name") ?? attribute(body, "adtcore:packageRef", "adtcore:packageName");
        const made = store.create(type, name, {
          description: attribute(body, undefined, "adtcore:description") ?? "",
          package: home ?? "",
        });
        res.status(201)
          .set("Location", `${BASE}/${adt}/${encodeURIComponent(made.name.toLowerCase())}`)
          .end();
      });
    });
    router.delete(`${BASE}/${adt}/:name`, (req, res) => {
      answer(res, () => {
        store.delete(type, decodeURIComponent(req.params.name));
        res.status(200).end();
      });
    });
  }

  for (const {type, adt} of SOURCE_TYPES) {
    // LOCK and UNLOCK arrive on the object's own URI, told apart by _action
    router.post(`${BASE}/${adt}/:name`, (req, res) => {
      const action = String(req.query._action ?? "").toUpperCase();
      const {session} = req.adt;
      const entry = store.find(type, req.params.name);
      if (entry === undefined) {
        res.status(404).type("application/xml").send(exceptionDocument("ExceptionResourceNotFound", `${type} ${req.params.name} does not exist`));
        return;
      }

      if (action === "LOCK") {
        if (entry.writable === false) {
          // A library object is not ours to change, and the way to say so is
          // the lock envelope with no handle in it: that is what a real
          // system returns for an object ADT may not modify, and a client
          // reads it as "not modifiable" before it ever attempts a write.
          //
          // Deliberately not MODIFICATION_SUPPORT: a real system returns
          // NoModification for perfectly writable local objects, so a client
          // that trusted that field would find nothing writable at all.
          res.status(200).type(asXmlTypeFor(req, "com.sap.adt.lock.Result2"))
            .send(lockResultDocument("", {modifiable: false}));
          return;
        }
        const held = [...session.locks.values()].find((l) => l.type === entry.type && l.name === entry.name);
        const handle = held?.handle ?? randomUUID();
        session.locks.set(handle, {handle, type: entry.type, name: entry.name, since: Date.now()});
        res.status(200).type(asXmlTypeFor(req, "com.sap.adt.lock.Result2")).send(lockResultDocument(handle));
        return;
      }

      if (action === "UNLOCK") {
        session.locks.delete(String(req.query.lockHandle ?? ""));
        res.status(200).type("text/plain").send("");
        return;
      }

      res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", `unknown action ${action || "(none)"}`));
    });

    // WRITE. The file only: the transpile belongs to activation, where the
    // verdict is what the client waits for and the modules follow after.
    const writeSource = (req, res) => {
      const {session} = req.adt;
      const handle = String(req.query.lockHandle ?? "");
      const lock = session.locks.get(handle);
      const entry = store.find(type, req.params.name);
      if (entry !== undefined && entry.writable === false) {
        res.status(405).type("application/xml").send(exceptionDocument("ExceptionResourceNoAccess", `${entry.type} ${entry.name} is a library object and cannot be changed here`));
        return;
      }
      if (lock === undefined || lock.type !== (entry?.type ?? type) || lock.name !== (entry?.name ?? String(req.params.name).toUpperCase())) {
        // the handle is the client's proof it owns the object right now, and
        // a handle from another session or another object is neither
        res.status(409).type("application/xml").send(exceptionDocument("ExceptionResourceNotLocked", handle === "" ? "no lock handle was given" : `lock handle ${handle} does not hold this object in this session`));
        return;
      }
      rawBody(req).then((body) => {
        answer(res, () => {
          const include = req.params.include ?? "main";
          // Validate the include name before writing. Known empty includes may
          // be created, but arbitrary suffixes are not repository objects.
          if (include !== "main") {
            store.read(type, req.params.name, include);
          }
          store.write(type, req.params.name, body.toString("utf8"), include);
          // The tag of what was just written, computed from what a read now
          // returns so that it is the tag the next GET will carry. The
          // client files it beside the source it saved; a save answered
          // without one left "Properties file content do not contain an
          // entity tag for the source file" in the log and an editor that
          // showed nothing at all after the save had in fact succeeded.
          const stored = store.read(type, req.params.name, include).source;
          res.set("ETag", createHash("sha256").update(Buffer.from(String(stored))).digest("hex").slice(0, 32));
          res.status(200).type("text/plain").send("");
        });
      });
    };
    router.put(`${BASE}/${adt}/:name/source/main`, writeSource);
    if (type === "CLAS") {
      router.put(`${BASE}/${adt}/:name/includes/:include`, writeSource);
      router.put(`${BASE}/${adt}/:name/includes/:include/source/main`, writeSource);
    }
  }

  // SYNTAX CHECK. The source arrives inline, because a client checks what a
  // person has typed rather than what is on disk. The store checks the given
  // text against the parsed system without touching the file, so this is a
  // real check and not a formality: broken source comes back broken even
  // though nothing was written.
  advertise("checkruns");
  // ---- what a client asks before it writes: which transport would carry
  // this. Nothing would, and nothing needs to; the document says why.
  advertise("cts/transportchecks");
  router.post(`${BASE}/cts/transportchecks`, async (req, res) => {
    // express does not catch a rejection from an async handler, and an
    // uncaught one takes the listener down with it — which is how this route
    // killed the whole server the first time it ran. The façade holds a
    // developer's session; it does not get to die over one bad request.
    try {
      const asked = transportCheckRequest(await rawBody(req));
      const named = asked.uri === undefined ? undefined : objectFromUri(asked.uri, collections);
      let found;
      try {
        // an object the store does not know is still a question we can
        // answer: a write that creates one needs a transport no more than a
        // write that changes one does
        found = named === undefined ? undefined : store.find(named.type, named.name);
      } catch {
        found = undefined;
      }
      res.status(200).type("application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData")
        .send(transportCheckDocument({
          type: named?.type,
          name: named?.name,
          uri: asked.uri,
          operation: asked.operation,
          package: found?.package ?? asked.devclass ?? "$TMP",
        }));
    } catch (e) {
      if (res.headersSent === false) {
        res.status(500).type("application/xml").send(exceptionDocument("ExceptionTransportCheckFailed", String(e?.message ?? e)));
      }
    }
  });

  // Which checks this system offers, asked for before any check is run. A
  // client that cannot read this concludes checking is unavailable, and says
  // so about activation too, because the two travel together.
  //
  // One reporter, named as the real one names it, over the types this façade
  // actually holds — the list is what a client offers in its own UI, so
  // naming a type that is not here would advertise a check that finds nothing.
  advertise("checkruns/reporters");
  router.get(`${BASE}/checkruns/reporters`, (req, res) => {
    const supported = Object.keys(TYPES).map((code) =>
      `<chkrun:supportedType>${code}*</chkrun:supportedType>`).join("");
    res.type("application/vnd.sap.adt.reporters+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<chkrun:checkReporters xmlns:chkrun="http://www.sap.com/adt/checkrun">' +
      `<chkrun:reporter chkrun:name="abapCheckRun">${supported}</chkrun:reporter>` +
      "</chkrun:checkReporters>",
    );
  });

  // Nothing here is ever inactive: an object is what the file says and there
  // is no inactive version to hold. The empty list is the answer, and it is
  // the resource's absence rather than its content that a client reports as
  // "activation is not supported".
  advertise("activation/inactiveobjects");
  router.get(`${BASE}/activation/inactiveobjects`, (req, res) => {
    res.type("application/vnd.sap.adt.inactivectsobjects.v1+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/ioc"/>',
    );
  });

  router.post(`${BASE}/checkruns`, async (req, res) => {
    const body = await rawBody(req);
    answer(res, () => {
      // Every object this façade serves may be checked, not only the ones
      // with source. The data element editor checks its object the moment
      // it opens, and a URI it did not recognise here was a 400 — "Checking
      // object... has encountered a problem" as the first thing a person saw
      // after the editor finally opened. A dictionary object has no syntax
      // to check; what is reported for one is that it is here and readable,
      // and the status text says so rather than implying a check it did not
      // get.
      const objects = checkObjectsIn(body, Object.entries(TYPES).map(([type, meta]) => [type, meta.adt]));

      // A package is a legitimate thing to check, and this used to call it an
      // invalid request. Eclipse checks the package as soon as its editor
      // opens, so the first thing a person does after opening one produced
      // "Checking object... encountered a problem".
      //
      // A real system checks everything beneath it. This checks what is in
      // the package itself, not its subpackages: the tree here can be several
      // thousand objects deep and a check that takes a minute is reported as
      // a hang rather than as thoroughness.
      const packages = [...body.toString("utf8").matchAll(
        new RegExp(`adtcore:uri="${BASE}/packages/([^"]+)"`, "g"))].map((m) => decodeURIComponent(m[1]));
      const packageReports = [];
      for (const name of packages) {
        const uri = `${BASE}/packages/${encodeURIComponent(name.toLowerCase())}`;
        try {
          const pkg = store.package(name.toUpperCase());
          // CheckHandler looks up the result by the URI it submitted. Reports
          // for children do not stand in for the package itself; without this
          // row an empty/top-level package produces checkResult=null in the
          // Eclipse automatic syntax-check trigger.
          packageReports.push({uri, issues: []});
          for (const object of pkg.objects) {
            const adt = TYPES[object.type]?.adt;
            if (adt !== undefined) {
              objects.push({
                type: object.type,
                name: object.name,
                uri: `${BASE}/${adt}/${encodeURIComponent(object.name.toLowerCase())}`,
              });
            }
          }
        } catch {
          packageReports.push({uri, issues: [], status: "notProcessed", statusText: `package ${name} does not exist`});
        }
      }

      if (objects.length === 0 && packageReports.length === 0) {
        // Nothing to check is not the same as a request that made no sense.
        // An empty report is the honest answer for an empty package, and the
        // 400 stays for a body that named no object at all.
        res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no check object in the request"));
        return;
      }
      const reports = [...packageReports, ...objects.map((o) => {
        if (TYPES[o.type]?.source !== true) {
          try {
            store.read(o.type, o.name);
            return {uri: o.uri, issues: [], statusText: "no dictionary check here; the object is present and readable"};
          } catch (e) {
            return {uri: o.uri, issues: [], status: "notProcessed", statusText: String(e?.message ?? e)};
          }
        }
        try {
          const result = store.check(o.type, o.name, {
            source: o.source,
            include: o.include,
          });
          return {uri: o.uri, issues: result.issues};
        } catch (e) {
          // a check that could not run must not look like a check that found
          // nothing, or a client writes on the strength of it
          return {uri: o.uri, issues: [], status: "notProcessed", statusText: String(e?.message ?? e)};
        }
      })];
      res.status(200).type("application/vnd.sap.adt.checkmessages+xml").send(checkReportDocument(reports));
    });
  });

  // ACTIVATE. An empty body means it activated; a document means it did not.
  // That is the convention and not our choice, so a document has to mean
  // failure and nothing else.
  advertise("activation");
  router.post(`${BASE}/activation`, async (req, res) => {
    const body = await rawBody(req);
    let named = [];
    let published = false;
    answer(res, () => {
      named = objectReferencesIn(body, collections);
      if (named.length === 0) {
        res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no object references in the request"));
        return;
      }
      const results = named.map((o) => store.activate(o.type, o.name));
      const failed = results.filter((r) => r.active === false);
      if (failed.length > 0) {
        // the object that did not activate, then whatever it broke: an
        // object with no issues of its own still belongs in the list,
        // because it is still inactive and a client shows it as such
        const entries = failed.flatMap((r) => [r, ...(r.dependents ?? [])]);
        res.status(200).type("application/xml").send(activationFailureDocument(entries));
        return;
      }
      published = true;
    });
    if (published === false || options.transpileOnActivate === false) {
      if (published === true) {
        // A successful activation answers with its properties, not with
        // nothing: checkExecuted, activationExecuted and generationExecuted,
        // all true, under chkl:messages (a4h-adt.jsonl:489). The note that used
        // to stand here, that a clean activation "answers nothing at all", was wrong.
        res.status(200).type("application/xml").send(activationSuccessDocument());
      }
      return;
    }
    // The activation is finished here rather than promised. It used to
    // answer and then transpile behind the client's back, so a 200 meant
    // "the source is good" while the code a client would next read was still
    // the old code, and nothing said when that stopped being true. Awaiting
    // publish() makes the empty body mean what a real system means by it:
    // the modules are written, and the process that serves them is the one
    // that has them.
    try {
      const result = await store.publish();
      if (result?.ok === false) {
        const why = result.error ?? result.transpile?.output ?? "the build after activation failed";
        res.status(200).type("application/xml").send(activationFailureDocument(
          named.map((o) => ({type: o.type, name: o.name, issues: [{message: String(why).slice(-2000), severity: "E", line: 1, column: 1}]})),
        ));
        return;
      }
      // A successful activation answers with its properties, not with
      // nothing: checkExecuted, activationExecuted and generationExecuted,
      // all true, under chkl:messages (a4h-adt.jsonl:489). The note that used
      // to stand here, that a clean activation "answers nothing at all", was wrong.
      res.status(200).type("application/xml").send(activationSuccessDocument());
    } catch (e) {
      res.status(200).type("application/xml").send(activationFailureDocument(
        named.map((o) => ({type: o.type, name: o.name, issues: [{message: String(e?.message ?? e), severity: "E", line: 1, column: 1}]})),
      ));
    }
  });

  // ABAP UNIT. The runtime actually runs the tests, in a child process of its
  // own: a test writes to the database, and the database is the one this
  // server is answering requests from, so a client's test data must not land
  // in the gateway's rows. About a second for one class.
  advertise("abapunit/testruns");
  // The name of a run result follows what the client asks by. Eclipse's
  // ABAP Unit view asks for abapunit.testruns.result.v2 (a4h-adt.jsonl:495)
  // and has handlers for v1 and v2 and nothing else; vsp asks by the junit
  // name. The document is the classic aunit:runResult in every case.
  const unitResultType = (req, kind) => {
    const accept = String(req.headers.accept ?? "");
    if (/junit\.run-result/.test(accept)) {
      return "application/vnd.sap.adt.api.junit.run-result.v1+xml";
    }
    // v2 unless a version is asked for: the view's handler for its result
    // type is registered for v2, and a v1-named answer to a client that
    // sent Accept: application/xml was "No content-handler found for
    // content-type ...testruns.result.v1+xml and data-type IAbapUnitResult"
    const version = /testruns\.(?:evaluation\.)?result\.v(\d)/.exec(accept)?.[1] ?? "2";
    return `application/vnd.sap.adt.abapunit.testruns.${kind}.v${version}+xml`;
  };

  // The evaluation of a run: the same result for the objects named, which
  // the client asks for after the run to show the report and to navigate
  // from a result to its method (a4h-adt.jsonl:497). Its references carry
  // the test class and method as a fragment; the run is that of the object.
  router.post(`${BASE}/abapunit/testruns/evaluation`, async (req, res) => {
    const body = await rawBody(req);
    const named = objectReferencesIn(body.toString("utf8").replaceAll(/#testclass=[^"]*/g, ""), collections);
    if (named.length === 0) {
      res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no object references in the request"));
      return;
    }
    try {
      const runner = await store.unit();
      const run = await runner.runDetached(named[0].type, named[0].name);
      res.status(200).type(unitResultType(req, "evaluation.result"))
        .send(unitResultDocument(run, {base: `${BASE}/${TYPES[named[0].type]?.adt ?? "oo/classes"}/${encodeURIComponent(named[0].name.toLowerCase())}`}));
    } catch (e) {
      res.status(e?.code === "NOT_FOUND" ? 404 : 500).type("application/xml")
        .send(exceptionDocument("ExceptionTestRunFailed", String(e?.message ?? e)));
    }
  });

  router.post(`${BASE}/abapunit/testruns`, async (req, res) => {
    const body = await rawBody(req);
    const named = objectReferencesIn(body, collections);
    if (named.length === 0) {
      res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no object references in the request"));
      return;
    }
    try {
      const runner = await store.unit();
      const run = await runner.runDetached(named[0].type, named[0].name);
      // The document is the classic aunit:runResult either way; only its
      // name differs by client. Eclipse's ABAP Unit view has a handler for
      // abapunit.testruns.result (v1 and v2 in com.sap.adt.abapunit, no
      // other) and reported "No content-handler found for content-type
      // ...api.junit.run-result.v1+xml" for the name vsp asks by. A client
      // that asks for the junit name still gets it.
      res.status(200).type(unitResultType(req, "result"))
        .send(unitResultDocument(run, {base: `${BASE}/${TYPES[named[0].type]?.adt ?? "oo/classes"}/${encodeURIComponent(named[0].name.toLowerCase())}`}));
    } catch (e) {
      res.status(e?.code === "NOT_FOUND" ? 404 : 500).type("application/xml")
        .send(exceptionDocument("ExceptionTestRunFailed", String(e?.message ?? e)));
    }
  });

  // ---- packages: what a package is, and what is inside it. A package here
  // is a folder, which is what abapGit already means when it writes one; when
  // a real repository arrives with its DEVC objects, the same two resources
  // answer from those instead.
  advertise("packages");
  // The dropdowns of the package editor. Empty, because this façade has no
  // application components, software components or transport layers, and an
  // empty list is the true answer rather than a missing resource.
  router.get(`${BASE}/packages/valuehelps/:what`, (req, res) => {
    res.type("application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8")
      .send(namedItemsDocument(req.params.what === "abaplanguageversions"
        ? [{name: "standard", description: "Standard ABAP"}]
        : []));
  });

  router.get(`${BASE}/packages/:name`, (req, res) => {
    answer(res, () => {
      // Answered at the version asked for. The document is the same either
      // way; what differs is whether the client recognises it.
      const wants2 = String(req.headers.accept ?? "").includes("packages.v2+xml");
      const describe = (name) => store.packages().find((p) => p.name === name)?.description ?? "";
      res.type(`application/vnd.sap.adt.packages.v${wants2 ? 2 : 1}+xml`)
        .send(packageDocument(packageOf(store, req.params.name), {describe}));
    });
  });

  // the tree, one level at a time, which is how a client walks it
  // A data element, for the client's form editor. Read-only: the editor
  // opens on this document and the flags it needs to save are not offered.
  advertise("ddic/dataelements");
  router.get(`${BASE}/ddic/dataelements/:name`, (req, res) => {
    answer(res, () => {
      const entry = store.read("DTEL", req.params.name);
      res.type("application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8").send(dataElementDocument(entry));
    });
  });

  advertise("repository/nodestructure");
  router.post(`${BASE}/repository/nodestructure`, async (req, res) => {
    const body = await rawBody(req);
    answer(res, () => {
      const name = req.query.parent_name ?? req.query.parentName ?? req.query.package ?? "";
      const parentType = req.query.parent_type ?? req.query.parentType;
      const nodeKeys = [...body.toString("utf8").matchAll(/<TV_NODEKEY>([^<]+)<\/TV_NODEKEY>/g)]
        .map((match) => match[1]).filter((key) => key !== "000000");
      // Answered in the type the client asked for, which is not the one this
      // resource is named after.
      //
      // A client sends Accept: application/vnd.sap.as+xml; dataname=com.sap.
      // adt.RepositoryObjectTreeContent, and this used to answer
      // …nodestructure.v1+xml. The body was right all along — the asx:abap
      // with TREE_CONTENT that the client wanted — and only the label was
      // wrong, so the client reported "No content-handler found" for a
      // document it would have understood. The dataname is the client's own
      // name for the shape it expects; echoing it is the whole fix.
      res.type(asXmlTypeFor(req, "com.sap.adt.RepositoryObjectTreeContent"))
        // Who is asking decides whether a class is a folder: the Project
        // Explorer names the exact shape it wants and gets leaves, because
        // its outline is parked; a client that accepts anything builds its
        // own tree from this and needs the flag to name a class's files.
        .send(nodeStructureDocument(nodesOf(store, name, parentType, {
          classFolders: /dataname=com\.sap\.adt\.RepositoryObjectTreeContent/i.test(String(req.headers.accept ?? "")) === false,
        }), {
          flat: name === "" && parentType === "DEVC",
          nodeKeys,
        }));
    });
  });

  // ---- searching the repository: a flat list of references into the tree
  advertise("repository/informationsystem/search");
  router.get(`${BASE}/repository/informationsystem/search`, (req, res) => {
    answer(res, () => {
      const found = searchObjects(store, req.query.query ?? req.query.search ?? "", {
        max: Number(req.query.maxResults ?? 100),
        // a client narrows by ADT type code (DEVC/K) or by the bare type
        type: typeOf(req.query.objectType ?? req.query.type),
      });
      res.type("application/xml").send(objectReferencesDocument(found));
    });
  });

  // ---- reading table contents: freestyle SQL in the body, rows back. This
  // is how the client's whole graph layer works, not only its table preview.
  // ---- a table as an object, and its content on F8.
  //
  // The client's table editor is source-shaped: it reads the object
  // (a4h-adt.jsonl:403) and then a DDL source (:405). Its parser
  // information — a 30 KB grammar the system ships for the editor's
  // highlighting — is the system's and not served here; what the editor does
  // without it is the next thing to observe.
  advertise("ddic/tables");
  router.get(`${BASE}/ddic/tables/parser/info`, (req, res) => {
    record(req, "resource");
    refuse(res, 404, "ExceptionResourceNotFound", "the DDL parser information is the system's own and is not served here");
  });
  router.get(`${BASE}/ddic/tables/:name`, (req, res) => {
    answer(res, () => {
      const entry = store.read("TABL", req.params.name);
      const table = tableFieldsOf(store, entry);
      res.type("application/vnd.sap.adt.tables.v2+xml; charset=utf-8");
      sendEntity(req, res, tableDocument(entry, {description: table.description}));
    });
  });
  router.get(`${BASE}/ddic/tables/:name/source/main`, (req, res) => {
    answer(res, () => {
      const entry = store.read("TABL", req.params.name);
      res.type("text/plain; charset=utf-8");
      sendEntity(req, res, tableSourceDocument(tableFieldsOf(store, entry)));
    });
  });
  // F8: the columns first (a4h-adt.jsonl:642), then the rows for a SELECT
  // the client writes over the table (:643) — or over the whole table when
  // it sends none.
  advertise("datapreview/ddic");
  router.get(`${BASE}/datapreview/ddic/:name/metadata`, (req, res) => {
    answer(res, () => {
      const entry = store.read("TABL", req.params.name);
      const table = tableFieldsOf(store, entry);
      res.type("application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8")
        .send(tableDataDocument({rows: [], columns: table.fields.map((f) => f.name)}, {fields: table.fields, name: entry.name}));
    });
  });
  router.post(`${BASE}/datapreview/ddic`, async (req, res) => {
    const name = String(req.query.ddicEntityName ?? "").toUpperCase();
    const asked = (await rawBody(req)).toString("utf8").trim();
    let table;
    try {
      table = tableFieldsOf(store, store.read("TABL", name));
    } catch (e) {
      refuse(res, 404, "ExceptionResourceNotFound", `TABL ${name} does not exist`);
      return;
    }
    const query = asked === "" ? `SELECT * FROM ${name}` : asked;
    const started = Date.now();
    try {
      const result = await data.query(query, {max: Number(req.query.rowNumber ?? 100)});
      res.status(200).type("application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8")
        .send(tableDataDocument(result, {ms: Date.now() - started, fields: table.fields, name}));
    } catch (e) {
      // a refusal with an empty message told nobody anything: the database
      // client's error carries its text in a field of its own, or nowhere
      refuse(res, e?.code === "NOT_BUILT" ? 503 : 400,
        e?.code === "NOT_BUILT" ? "ExceptionResourceNoAccess" : "ExceptionResourceWrongData",
        String(e?.message || e?.cause?.message || e?.code || `the statement was refused: ${query}`));
    }
  });

  advertise("datapreview/freestyle");
  router.post(`${BASE}/datapreview/freestyle`, async (req, res) => {
    const query = (await rawBody(req)).toString("utf8");
    const started = Date.now();
    try {
      const result = await data.query(query, {max: Number(req.query.rowNumber ?? 100)});
      res.status(200).type("application/xml").send(tableDataDocument(result, {ms: Date.now() - started}));
    } catch (e) {
      // NOT_ALLOWED is a statement that is not a SELECT, NOT_BUILT is a
      // system that has never been transpiled; both are the client's answer
      // to give, and neither is a 403 (see below)
      refuse(res, e?.code === "NOT_BUILT" ? 503 : 400,
        e?.code === "NOT_BUILT" ? "ExceptionResourceNoAccess" : "ExceptionResourceWrongData",
        String(e?.message ?? e));
    }
  });

  // Everything under the façade that nothing above answered. A 404 is the
  // right answer and also the most useful thing a strange client can tell
  // us: Eclipse asks for far more than vsp does, and the list of what it
  // asked for and did not get is exactly the next wave's work. So each one
  // is recorded once, by method and path, and the server can print the set.
  router.all(`${BASE}/*`, (req, res) => {
    record(req, "resource");
    res.status(404).type("application/xml").send(exceptionDocument("ExceptionResourceNotFound", `${req.path} is not served by OSD`));
  });

  return {router, sessions, store, data, resources, missed};
}

// a client names a type either as ADT does (DEVC/K, CLAS/OC) or bare (DEVC)
function typeOf(asked) {
  if (asked === undefined || asked === "") {
    return undefined;
  }
  return String(asked).toUpperCase().split("/")[0];
}

// The store's errors as the statuses a client expects.
//
// One status is deliberately not used: 403. vsp reads a 403 on a modifying
// request as "your token is stale", re-fetches one and retries exactly once,
// so a 403 that means anything else costs it its only retry and then fails
// with the wrong reason. A library object that cannot be written is
// therefore 405, not 403. 403 belongs to the session layer alone.
// A refusal is a document, not a sentence.
//
// These answers were text/plain, and the catch-all beside them was already
// serving exc:exception, so the façade refused in two different languages
// depending on which one said no. The client reads only the second: a
// ResourceException built from a body it cannot parse carries no exception
// data at all, and the first thing that asks it a question dereferences null.
// That is why expanding a package produced "Cannot invoke
// IExceptionData.getNamespace() because ... getExceptionData() is null" and
// the neighbouring nodes sat on "Loading repository tree ..." forever —
// the error never became an error, so the expansion never finished failing.
//
// The type ids are the client's own vocabulary, read out of its jars rather
// than invented, so that a refusal names something it can recognise. The one
// exception is a genuine 500, which is a defect here and not a condition the
// SAP framework has a name for; it answers in this project's namespace so
// that nobody reading it mistakes our bug for a system's.
function answered(res, body, record) {
  try {
    body();
  } catch (e) {
    if (e instanceof NotFound) {
      // a 404 from here is a different animal from a 404 off the catch-all:
      // the resource is served and the object is not there. Both are things
      // a client asked for and did not get, so both are worth recording, and
      // telling them apart is the whole value of recording them
      record?.(res.req, "object", e.message);
      refuse(res, 404, "ExceptionResourceNotFound", e.message);
    } else if (e instanceof ReadOnly) {
      refuse(res, 405, "ExceptionResourceNoAccess", e.message);
    } else if (e instanceof NotSupported) {
      refuse(res, 501, "ExceptionResourceNoAccess", e.message);
    } else if (e instanceof Conflict) {
      // the id is the one the client shows for "already exists" on a
      // save over a changed object; there is no closer one in its vocabulary
      refuse(res, 409, "ExceptionResourceIsModified", e.message);
    } else {
      refuse(res, 500, "ExceptionInternalError", String(e?.message ?? e),
        {namespace: "org.open-steamgate.osd"});
    }
  }
}

// One way of saying no, so that every no is the same shape on the wire.
function refuse(res, status, type, message, options) {
  res.status(status).type("application/xml").send(exceptionDocument(type, message, options));
}

// sessionIdentifier names the security session in the sessions document.
//
// Derived from the cookie the logon set, so that it is stable for as long as
// the client's session is and changes when that does — the client treats it
// as an identity and polls it. A client that arrives without one gets a
// stable placeholder rather than a fresh value per request, which would look
// like a session ending on every poll.
function sessionIdentifier(req, identity) {
  const cookie = req.headers.cookie ?? "";
  const named = new RegExp(`SAP_SESSIONID_${identity.systemID}_${identity.client}=([^;]+)`).exec(cookie);
  const seed = named === null ? `${identity.systemID}${identity.client}${identity.userName}` : named[1];
  return createHash("sha256").update(seed).digest("hex").slice(0, 32).toUpperCase();
}

// asXmlTypeFor echoes back the vnd.sap.as+xml dataname a client asked for.
//
// These resources carry ABAP serialization rather than a document of their
// own, and the dataname is how a client knows which structure is inside.
// Naming a different one is how a correct body gets refused.
function asXmlTypeFor(req, fallback) {
  const asked = /dataname=([\w.]+)/.exec(String(req.headers.accept ?? ""));
  return `application/vnd.sap.as+xml; charset=utf-8; dataname=${asked === null ? fallback : asked[1]}`;
}

// facadeBuildStamp digests the files that decide what this façade answers.
//
// Cached after the first call: the answer cannot change without the process
// restarting, and hashing on every request would be a cost paid for nothing.
let stamp;
function facadeBuildStamp() {
  if (stamp !== undefined) {
    return stamp;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const digest = createHash("sha256");
  for (const file of ["adt-facade.mjs", "adt-documents.mjs", "adt-session.mjs", "adt-source-properties.mjs", "osd-store.mjs"]) {
    try {
      digest.update(readFileSync(join(here, file)));
    } catch {
      digest.update(file); // a missing file is itself part of what this build is
    }
  }
  stamp = digest.digest("hex").slice(0, 16);
  return stamp;
}
