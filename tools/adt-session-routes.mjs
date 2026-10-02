// Node routes retained for child mode and the byte-equality oracle.
// ABAP mode does not mount them: a stale front must not end a session in a second step.
import {createHash} from "node:crypto";
import {parseCookies, sessionIdOf} from "./adt-session.mjs";
const BASE = "/sap/bc/adt";
const sessionIdentifier = (req) => createHash("sha256").update(req.adt.session.id).digest("hex").slice(0, 32).toUpperCase();

export function sessionRoutes(router, sessions, answer) {
  router.get(`${BASE}/core/http/sessions`, (req, res) => {
    const id = sessionIdentifier(req);
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

  router.delete(`${BASE}/core/http/sessions/:id`, (req, res) => answer(res, async () => {
    if (String(req.params.id).toUpperCase() === sessionIdentifier(req)) {
      await sessions.end(req.adt.session.id);
    }
    res.status(200).end();
  }));
  router.get("/sap/public/bc/icf/logoff", (req, res) => answer(res, async () => {
    const id = sessionIdOf(parseCookies(req.headers.cookie));
    if (id) await sessions.end(id);
    res.status(200).type("text/plain").send("logged off");
  }));
}
