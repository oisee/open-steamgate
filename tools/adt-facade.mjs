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
import {Sessions} from "./adt-session.mjs";
import {ObjectStore, TYPES, NotFound, ReadOnly, NotSupported} from "./osd-store.mjs";
import {objectStructureDocument, structureOf, objectReferencesDocument, searchObjects, packageDocument, nodeStructureDocument, nodesOf} from "./adt-documents.mjs";

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
${(r.accept ?? []).map((a) => `      <app:accept>${xmlEscape(a)}</app:accept>`).join("\n")}${(r.accept ?? []).length === 0 ? "" : "\n"}    </app:collection>`;

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
  "packages": ["application/vnd.sap.adt.packages.v1+xml"],
};

// which workspace a collection is filed under in the discovery document
const WORKSPACE = (adt) => {
  if (adt.startsWith("ddic/") || adt.startsWith("datapreview/")) {
    return "Data Dictionary";
  }
  return adt.startsWith("repository/") || adt.startsWith("packages") ? "Repository" : "Source Library";
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
};

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
  });

  // scoped to the façade's own prefix: this router is mounted on the same
  // app as the OData front, and a CSRF gate over somebody else's POST is a
  // 403 they never asked for
  router.use(BASE, sessions.middleware());

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
    // a class's other includes: definitions, implementations, macros, tests
    router.get(`${BASE}/${adt}/:name/includes/:include/source/main`, (req, res) => {
      answer(res, () => {
        res.type("text/plain; charset=utf-8").send(store.read(type, req.params.name, req.params.include).source);
      });
    });
    // the object structure: what a client reads before asking for one method
    // rather than the whole source. A plain full-source read never comes
    // through here, which is why wave 0 could do without it.
    router.get(`${BASE}/${adt}/:name/objectstructure`, (req, res) => {
      answer(res, () => {
        const structure = structureOf(store, type, req.params.name);
        if (structure === undefined) {
          throw new NotFound(type, req.params.name);
        }
        res.type("application/vnd.sap.adt.objectstructure.v2+xml").send(objectStructureDocument(structure));
      });
    });
  }

  // ---- packages: what a package is, and what is inside it. A package here
  // is a folder, which is what abapGit already means when it writes one; when
  // a real repository arrives with its DEVC objects, the same two resources
  // answer from those instead.
  advertise("packages");
  router.get(`${BASE}/packages/:name`, (req, res) => {
    answer(res, () => {
      res.type("application/vnd.sap.adt.packages.v1+xml").send(packageDocument(store.package(req.params.name)));
    });
  });

  // the tree, one level at a time, which is how a client walks it
  advertise("repository/nodestructure");
  router.post(`${BASE}/repository/nodestructure`, (req, res) => {
    answer(res, () => {
      const name = req.query.parent_name ?? req.query.parentName ?? req.query.package ?? "";
      res.type("application/vnd.sap.adt.repository.nodestructure.v1+xml").send(nodeStructureDocument(nodesOf(store, name)));
    });
  });

  // ---- searching the repository: a flat list of references into the tree
  advertise("repository/informationsystem/search");
  router.get(`${BASE}/repository/informationsystem/search`, (req, res) => {
    answer(res, () => {
      const found = searchObjects(store, req.query.query ?? req.query.search ?? "", {
        max: Number(req.query.maxResults ?? 100),
      });
      res.type("application/xml").send(objectReferencesDocument(found));
    });
  });

  // ---- reading table contents: freestyle SQL in the body, rows back. This
  // is how the client's whole graph layer works, not only its table preview.
  advertise("datapreview/freestyle");
  router.post(`${BASE}/datapreview/freestyle`, async (req, res) => {
    const query = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
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

  return {router, sessions, store, data, resources};
}

// The store's errors as the statuses a client expects.
//
// One status is deliberately not used: 403. vsp reads a 403 on a modifying
// request as "your token is stale", re-fetches one and retries exactly once,
// so a 403 that means anything else costs it its only retry and then fails
// with the wrong reason. A library object that cannot be written is
// therefore 405, not 403. 403 belongs to the session layer alone.
function answer(res, body) {
  try {
    body();
  } catch (e) {
    if (e instanceof NotFound) {
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
