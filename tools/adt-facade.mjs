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
import {randomUUID, randomBytes, createHash} from "node:crypto";
import {Sessions} from "./adt-session.mjs";
import {ObjectStore, TYPES, NotFound, ReadOnly, NotSupported} from "./osd-store.mjs";
import {ADT_TYPE, namedItemsDocument, objectStructureDocument, structureOf, objectReferencesDocument, searchObjects, packageDocument, packageOf, nodeStructureDocument, nodesOf, classIncludeDocument, lockResultDocument, exceptionDocument, activationFailureDocument, objectReferencesIn, objectFromUri, checkReportDocument, checkObjectsIn, unitResultDocument, transportCheckDocument, transportCheckRequest} from "./adt-documents.mjs";

export const BASE = "/sap/bc/adt";

const xmlEscape = (s) => String(s)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

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
export function compatibilityGraphDocument() {
  return `<?xml version="1.0" encoding="utf-8"?>
<adtcomp:graph xmlns:adtcomp="http://www.sap.com/adt/compatibility"/>
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
${(r.accept ?? []).map((a) => `      <app:accept>${xmlEscape(a)}</app:accept>`).join("\n")}${(r.accept ?? []).length === 0 ? "" : "\n"}${r.category === undefined ? "" : `      <atom:category term="${xmlEscape(r.category[0])}" scheme="${xmlEscape(r.category[1])}"/>\n`}${r.templates === undefined ? "" : `      <adtcomp:templateLinks>\n${r.templates.map(([rel, template]) => `        <adtcomp:templateLink rel="${xmlEscape(rel)}" template="${xmlEscape(template)}"/>`).join("\n")}\n      </adtcomp:templateLinks>\n`}    </app:collection>`;

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

  const body = columns.map((name) => `  <dataPreview:columns>
    <dataPreview:metadata dataPreview:name="${xmlEscape(name.toUpperCase())}" dataPreview:type="${type(name)}" dataPreview:description="${xmlEscape(name.toUpperCase())}" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false"/>
    <dataPreview:dataSet>
${rows.map((r) => `      <dataPreview:data>${xmlEscape(render(r[name]))}</dataPreview:data>`).join("\n")}
    </dataPreview:dataSet>
  </dataPreview:columns>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
  <dataPreview:totalRows>${rows.length}</dataPreview:totalRows>
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
  "abapunit/testruns": ["unittestruns", "http://www.sap.com/adt/categories/abapunit"],
  "activation": ["activationruns", "http://www.sap.com/adt/categories/activation"],
  "checkruns": ["checkruns", "http://www.sap.com/adt/categories/check"],
  "repository/nodestructure": ["nodestructure", "http://www.sap.com/adt/categories/respository"],
  "repository/informationsystem/search": ["search", "http://www.sap.com/adt/categories/respository"],
  "repository/informationsystem/virtualfolders": ["virtualfolders", "http://www.sap.com/adt/categories/repository"],
  "cts/transportchecks": ["transportchecks", "http://www.sap.com/adt/categories/cts"],
  "datapreview/freestyle": ["DatapreviewFreeStyle", "http://www.sap.com/adt/categories/datapreview"],
  "ddic/ddl/sources": ["ddlsources", "http://www.sap.com/adt/categories/ddic/ddlsources"],
  "ddic/srvd/sources": ["srvdsrv", "http://www.sap.com/wbobj/raps"],
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
  "repository/informationsystem/search": [
    ["http://www.sap.com/adt/relations/informationsystem/search/quicksearch", SEARCH_TEMPLATE],
    ["http://www.sap.com/adt/relations/informationsystem/search/whitelisting", SEARCH_TEMPLATE],
  ],
  "datapreview/freestyle": [
    ["http://www.sap.com/adt/categories/datapreview/freestyle", "/sap/bc/adt/datapreview/freestyle{?rowNumber}"],
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

export function adtRouter(options = {}) {
  const store = options.store ?? new ObjectStore({root: options.root});
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
  const identity = {
    systemID: options.systemID ?? "OSD",
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
  const FACETS = ["package", "type", "group"];

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

  // Every object this façade holds, with the two properties the facets
  // select on.
  const everyObject = () => {
    const all = [];
    for (const pkg of store.packages()) {
      for (const object of store.package(pkg.name).objects) {
        all.push({...object, package: pkg.name});
      }
    }
    return all;
  };

  const matchesPattern = (name, pattern) => {
    if (pattern === "" || pattern === "*") {
      return true;
    }
    const escaped = pattern.toUpperCase().split("*")
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}$`).test(name.toUpperCase());
  };

  const facetValue = (object, facet) => {
    if (facet === "package") {
      return object.package;
    }
    if (facet === "type") {
      return object.type;
    }
    // "group" splits the workbench into its top-level drawers; everything
    // here is source or dictionary, and the client only ever uses it to
    // narrow, so one value it recognises is enough.
    return "SOURCE_LIBRARY";
  };

  const xmlEscape = (text) => String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

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

  router.post(`${BASE}/repository/informationsystem/virtualfolders/contents`, async (req, res) => {
    const asked = virtualFoldersRequest((await rawBody(req)).toString("utf8"));

    let objects = everyObject().filter((object) => matchesPattern(object.name, asked.pattern));
    for (const [facet, values] of asked.preselection) {
      objects = objects.filter((object) => values.includes(facetValue(object, facet)));
    }

    const selection = [...asked.preselection]
      .map(([facet, values]) => `${facet}:${values.join(",")}`).join(" ");
    const link =
      `<atom:link href="${BASE}/repository/informationsystem/virtualfolders?selection=${encodeURIComponent(selection)}"` +
      ' rel="http://www.sap.com/adt/relations/informationsystem/virtualfolders/selection"' +
      ' title="Virtual Folder Selection" xmlns:atom="http://www.w3.org/2005/Atom"/>';

    let body;
    if (asked.order.length === 0) {
      // the leaves
      body = objects.map((object) => {
        const type = TYPES[object.type];
        const uri = `${BASE}/${type?.adt ?? "unknown"}/${object.name.toLowerCase()}`;
        return `<vfs:object uri="${uri}" text="${xmlEscape(object.name)}" name="${xmlEscape(object.name)}"` +
          ` package="${xmlEscape(object.package)}" type="${ADT_TYPE[object.type] ?? object.type}" expandable="${type?.source === true}">` +
          `<atom:link href="${uri}" rel="http://www.sap.com/adt/relations/objects"` +
          ' title="ADT Object Reference" xmlns:atom="http://www.w3.org/2005/Atom"/>' +
          "</vfs:object>";
      }).join("");
    } else {
      // the folders of the next facet, each counting what is under it
      const facet = asked.order[0];
      const counts = new Map();
      for (const object of objects) {
        const value = facetValue(object, facet);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      body = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) =>
        `<vfs:virtualFolder hasChildrenOfSameFacet="false" counter="${count}"` +
        ` name="${xmlEscape(value)}" text="${xmlEscape(value)}" facet="${facet}"/>`).join("");
    }

    res.type("application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8").send(
      '<?xml version="1.0" encoding="utf-8"?>' +
      `<vfs:virtualFoldersResult objectCount="${objects.length}"` +
      ' xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders">' +
      link + body +
      "</vfs:virtualFoldersResult>",
    );
  });

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
  // The body is deliberately an empty graph. A compatibility graph is a
  // system telling a client which resources it may use at which version, and
  // OSD has measured no such facts; filling it in would be inventing
  // permissions on behalf of a system that has not been asked. Discovery is
  // where this façade says what it serves, and it says it from the routes
  // that are actually mounted. An empty graph adds no claim to that, which is
  // the honest answer to a question we cannot answer.
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
        res.type("text/plain; charset=utf-8").send(store.read(type, req.params.name).source);
      });
    });
    // the base resource of a class include. A client resolving a method body
    // asks for the include object before it asks for the include's source, so
    // a 404 here stops a method read that would otherwise work.
    router.get(`${BASE}/${adt}/:name/includes/:include`, (req, res) => {
      answer(res, () => {
        const {name, include} = req.params;
        const part = store.read(type, name, include);
        // a client that wants the text says so; otherwise it gets the object
        if (String(req.headers.accept ?? "").includes("text/plain")) {
          res.type("text/plain; charset=utf-8").send(part.source);
          return;
        }
        res.type("application/vnd.sap.adt.oo.classes.includes.v2+xml")
          .send(classIncludeDocument(store.find(type, name).name, include, `${BASE}/${adt}/${encodeURIComponent(String(name).toLowerCase())}/includes/${include}/source/main`));
      });
    });
    // a class's other includes: definitions, implementations, macros, tests
    router.get(`${BASE}/${adt}/:name/includes/:include/source/main`, (req, res) => {
      answer(res, () => {
        res.type("text/plain; charset=utf-8").send(store.read(type, req.params.name, req.params.include).source);
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
        res.type("application/vnd.sap.adt.objectstructure.v2+xml").send(objectStructureDocument(found));
      });
    };
    router.get(`${BASE}/${adt}/:name/objectstructure`, structure);
    router.get(`${BASE}/${adt}/:name`, structure);
  }

  // ---- the development loop: lock, write, unlock, activate.
  //
  // A lock is synthetic, because a local system has nobody to lock against
  // but itself. What makes it more than a formality is affinity: the handle
  // lives on the session, so a client that loses its context loses its lock,
  // which is exactly what a real system does and exactly what a client's
  // sequencing bugs look like.
  const collections = SOURCE_TYPES.map(({type, adt}) => [type, adt]);

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
          res.status(200).type("application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.lock.result")
            .send(lockResultDocument("", {modifiable: false}));
          return;
        }
        const held = [...session.locks.values()].find((l) => l.type === entry.type && l.name === entry.name);
        const handle = held?.handle ?? randomUUID();
        session.locks.set(handle, {handle, type: entry.type, name: entry.name, since: Date.now()});
        res.status(200).type("application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.lock.result").send(lockResultDocument(handle));
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
    router.put(`${BASE}/${adt}/:name/source/main`, (req, res) => {
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
          store.write(type, req.params.name, body.toString("utf8"));
          res.status(200).type("text/plain").send("");
        });
      });
    });
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

  router.post(`${BASE}/checkruns`, async (req, res) => {
    const body = await rawBody(req);
    answer(res, () => {
      const objects = checkObjectsIn(body, collections);
      if (objects.length === 0) {
        res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no check object in the request"));
        return;
      }
      const reports = objects.map((o) => {
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
      });
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
        res.status(200).type("text/plain").send("");
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
      res.status(200).type("text/plain").send("");
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
      res.status(200).type("application/vnd.sap.adt.api.junit.run-result.v1+xml")
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
  advertise("repository/nodestructure");
  router.post(`${BASE}/repository/nodestructure`, (req, res) => {
    answer(res, () => {
      const name = req.query.parent_name ?? req.query.parentName ?? req.query.package ?? "";
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
        .send(nodeStructureDocument(nodesOf(store, name)));
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
      res.status(e?.code === "NOT_BUILT" ? 503 : 400).type("text/plain").send(String(e?.message ?? e));
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
      res.status(404).type("text/plain").send(e.message);
    } else if (e instanceof ReadOnly) {
      res.status(405).type("text/plain").send(e.message);
    } else if (e instanceof NotSupported) {
      res.status(501).type("text/plain").send(e.message);
    } else {
      res.status(500).type("text/plain").send(String(e?.message ?? e));
    }
  }
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
