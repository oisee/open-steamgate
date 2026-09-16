// The session layer of the ADT façade: the CSRF token dance, the context
// cookie, and the affinity that lock -> write -> activate rides on.
//
// This is built first because it is what breaks first. An ADT client does
// not ask whether it is logged on; it infers it from the shape of an answer,
// and infers wrong on a redirect or on a 200 without a token. So the rules
// below are about what every response must carry, not about what any
// endpoint does.
//
// OSD has no user store. Anyone may log on, and the name they send is
// remembered only so the documents that quote a user can quote one.
import {randomBytes} from "node:crypto";

// the three-letter system id and the client OSD presents itself as; the
// session cookie of a real system carries both, and vsp's profile is
// configured against these
export const SID = "OSD";
export const CLIENT = "001";
export const SESSION_COOKIE = `SAP_SESSIONID_${SID}_${CLIENT}`;
export const CONTEXT_COOKIE = "sap-contextid";

// what a client sends to ask for a token, and what a server sends back to
// say there is none yet. A token must never equal this word: a client that
// reads it in a token header concludes it is not logged on.
export const FETCH = "fetch";
export const REQUIRED = "Required";

const UNSAFE = new Set(["POST", "PUT", "DELETE", "PATCH", "MERGE"]);

const token = () => randomBytes(18).toString("base64url");

// Cookie: a=1; b=2 -> {a: "1", b: "2"}; an empty value is kept, because
// `sap-contextid=` with nothing after it is how a client asks for a fresh
// context after it decided the old one was gone
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export class Session {
  constructor(user) {
    this.id = randomBytes(12).toString("hex");
    this.token = token();
    this.user = user;
    this.created = Date.now();
    this.touched = this.created;
    this.stateful = false;
    // lock handle -> what is locked; wave 3 fills this, wave 0 owns the map
    // because affinity is a property of the session, not of the write
    this.locks = new Map();
  }
}

export class Sessions {
  // ttlMs: a session nobody has touched for this long is gone. Long by
  // default, because an editor holds one across a coffee break and a local
  // system has no reason to be stingy.
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.byId = new Map();
  }

  #sweep() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, session] of this.byId) {
      if (session.touched < cutoff) {
        this.byId.delete(id);
      }
    }
  }

  open(user) {
    const session = new Session(user);
    this.byId.set(session.id, session);
    return session;
  }

  get(id) {
    const session = this.byId.get(id);
    if (session === undefined) {
      return undefined;
    }
    if (session.touched < Date.now() - this.ttlMs) {
      this.byId.delete(id);
      return undefined;
    }
    session.touched = Date.now();
    return session;
  }

  // the user of a Basic header, for quoting only; credentials are not checked
  // because there is nothing to check them against
  static user(req) {
    const header = String(req.headers.authorization ?? "");
    if (/^Basic /i.test(header) === false) {
      return SID;
    }
    try {
      return (Buffer.from(header.slice(6), "base64").toString("utf8").split(":")[0] || SID).toUpperCase();
    } catch {
      return SID;
    }
  }

  // Express middleware. Every request leaves here with req.adt.session set
  // and the response already carrying its token and cookies, so no handler
  // can forget them.
  middleware() {
    return (req, res, next) => {
      this.#sweep();
      const cookies = parseCookies(req.headers.cookie);

      // Two cookies name the same session, and which one comes back depends
      // on how the client is using it.
      //
      // sap-contextid is the stateful context, and a client that has not
      // asked for a stateful session is right not to keep it. An ABAP Cloud
      // Project never does: measured over a whole session, every request came
      // back with SAP_SESSIONID_* and sap-usercontext and never once with
      // sap-contextid. Reading only the context cookie made every request a
      // new session with a new token, so the token the client had just been
      // handed always belonged to a session that no longer existed, and every
      // write was refused with a CSRF failure that no amount of re-fetching
      // could fix. The client was doing everything right.
      //
      // So the context cookie wins when present, because it is the one that
      // carries statefulness, and the session cookie answers for everyone
      // else. That is also how the real thing behaves: A4H binds its token to
      // the session it issued at logon.
      const asked = cookies[CONTEXT_COOKIE] || cookies[SESSION_COOKIE];

      // an empty cookie is a heal attempt: the client believes the
      // context is gone and wants a new one rather than an error
      let session = asked === undefined || asked === "" ? undefined : this.get(asked);
      const fresh = session === undefined;
      if (fresh) {
        session = this.open(Sessions.user(req));
      }

      const type = String(req.headers["x-sap-adt-sessiontype"] ?? "").toLowerCase();
      if (type === "stateful") {
        session.stateful = true;
      } else if (type === "stateless") {
        // a stateless hop retires the affinity, and with it the handles that
        // depended on it; the session itself survives so the token holds
        session.stateful = false;
        session.locks.clear();
      }

      if (fresh || session.stateful) {
        res.append("Set-Cookie", `${CONTEXT_COOKIE}=${session.id}; Path=/sap/bc/adt; HttpOnly; SameSite=Strict`);
        res.append("Set-Cookie", `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict`);
      }

      // the rule the client actually checks: an authenticated answer always
      // carries a token, and it is never the word that means "you have none"
      res.setHeader("x-csrf-token", session.token);

      const wanted = String(req.headers["x-csrf-token"] ?? "");
      if (UNSAFE.has(req.method.toUpperCase()) && wanted !== session.token) {
        // the one place the word appears: a write without a valid token is
        // refused, and the client is told to fetch one and retry
        res.setHeader("x-csrf-token", REQUIRED);
        res.status(403).type("text/plain").send("CSRF token validation failed");
        return;
      }

      req.adt = {session, sessions: this, fetching: wanted.toLowerCase() === FETCH};
      next();
    };
  }
}
