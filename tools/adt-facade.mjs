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
import {randomUUID} from "node:crypto";
import {Sessions} from "./adt-session.mjs";
import {ObjectStore, TYPES, NotFound, ReadOnly, NotSupported} from "./osd-store.mjs";
import {objectStructureDocument, structureOf, objectReferencesDocument, searchObjects, packageDocument, nodeStructureDocument, nodesOf, classIncludeDocument, lockResultDocument, exceptionDocument, activationFailureDocument, objectReferencesIn, checkReportDocument, checkObjectsIn} from "./adt-documents.mjs";

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
  if (adt.startsWith("repository/") || adt.startsWith("packages")) {
    return "Repository";
  }
  return adt === "activation" || adt === "checkruns" || adt.startsWith("abapunit") ? "Development Loop" : "Source Library";
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
    answer(res, () => {
      const named = objectReferencesIn(body, collections);
      if (named.length === 0) {
        res.status(400).type("application/xml").send(exceptionDocument("ExceptionInvalidRequest", "no object references in the request"));
        return;
      }
      const results = named.map((o) => store.activate(o.type, o.name));
      const failed = results.filter((r) => r.active === false);
      if (failed.length > 0) {
        res.status(200).type("application/xml").send(activationFailureDocument(failed.map((r, i) => ({...r, type: named[i].type}))));
        return;
      }
      // the modules the runtime loads are written after the verdict goes out,
      // because the next request is what needs them and this client does not.
      // Deliberately not awaited, and its failure is logged rather than
      // returned: the client has already been told the source is good.
      if (options.transpileOnActivate !== false) {
        Promise.resolve(store.transpile()).then((r) => {
          if (r?.ok === false) {
            console.error("transpile after activation failed:", r.output ?? "");
          }
        }).catch((e) => console.error("transpile after activation failed:", e?.message ?? e));
      }
      res.status(200).type("text/plain").send("");
    });
  });

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
  const missed = new Map();
  router.all(`${BASE}/*`, (req, res) => {
    const key = `${req.method} ${req.path}`;
    const seen = missed.get(key);
    missed.set(key, {
      method: req.method,
      path: req.path,
      accept: seen?.accept ?? req.headers.accept,
      count: (seen?.count ?? 0) + 1,
      first: seen?.first ?? new Date().toISOString(),
    });
    if (options.logMisses !== false && seen === undefined) {
      console.log(`ADT not served: ${key}  accept=${req.headers.accept ?? "-"}`);
    }
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
