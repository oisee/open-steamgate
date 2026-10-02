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

// Which session a request's cookies name. Two cookies can name one, and
// the context cookie wins when present because it is the one that carries
// statefulness; the session cookie answers for everyone else (see the
// middleware below for why). Undefined for none, "" for an empty context
// cookie, which is a client asking for a fresh context.
export function sessionIdOf(cookies) {
  return cookies[CONTEXT_COOKIE] || cookies[SESSION_COOKIE];
}

export class Session {
  constructor(user) {
    this.id = randomBytes(12).toString("hex");
    this.token = token();
    this.user = user;
    this.created = Date.now();
    this.touched = this.created;
    this.stateful = false;
    // lock handle -> what is locked. The handles are the session's, because
    // affinity is a property of the session, not of the write. Who holds an
    // object across sessions is the owner table's (Sessions#owners), and the
    // two are changed through Sessions and nowhere else.
    this.locks = new Map();
  }
}

const objectKey = (type, name) => `${String(type).toUpperCase()} ${String(name).toUpperCase()}`;

// The owner table a Sessions keeps when nobody passes one: "TYPE NAME" ->
// session id, in this object, one holder per object across the sessions of
// this Sessions. With the ABAP front the table is the lock server instead
// (tools/adt-enq.mjs), shared with the ABAP LOCK route; both answer the same
// four questions, and holder() names a session by its id.
export class SessionOwners {
  constructor() {
    this.byObject = new Map();
  }

  holder(type, name) {
    const id = this.byObject.get(objectKey(type, name));
    return id === undefined ? undefined : {id};
  }

  take(session, type, name) {
    const key = objectKey(type, name);
    const id = this.byObject.get(key);
    if (id !== undefined && id !== session.id) {
      return {heldBy: {id}};
    }
    this.byObject.set(key, session.id);
    return {};
  }

  drop(session, type, name) {
    const key = objectKey(type, name);
    if (this.byObject.get(key) === session.id) {
      this.byObject.delete(key);
    }
  }

  end(id) {
    for (const [key, holder] of [...this.byObject]) {
      if (holder === id) {
        this.byObject.delete(key);
      }
    }
  }
}

export class Sessions {
  // ttlMs: a session nobody has touched for this long is gone. Long by
  // default, because an editor holds one across a coffee break and a local
  // system has no reason to be stingy.
  // owners: who holds which object (SessionOwners when not given)
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.byId = new Map();
    // one holder per object across every session, the enqueue table of a
    // system. A session's own map says which handles it has; this one says
    // whether anybody else may take the object.
    this.owners = options.owners ?? new SessionOwners();
  }

  #sweep() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, session] of this.byId) {
      if (session.touched < cutoff) {
        this.end(id);
      }
    }
  }

  static #handleOf(session, type, name) {
    const key = objectKey(type, name);
    for (const [handle, lock] of session.locks) {
      if (objectKey(lock.type, lock.name) === key) {
        return handle;
      }
    }
    return undefined;
  }

  // {session, handle} of the session that holds an object, or undefined; an
  // owner whose session has expired holds nothing, and is released on the
  // way. A holder this Sessions does not know (another façade's session on
  // the same lock server, or ABAP outside any ADT session) is answered with
  // its user and no handle.
  holderOf(type, name) {
    const owner = this.owners.holder(type, name);
    if (owner === undefined) {
      return undefined;
    }
    const session = owner.id === undefined ? undefined : this.byId.get(owner.id);
    if (session === undefined) {
      return {session: {id: owner.id, user: owner.user ?? "", locks: new Map()}, handle: undefined};
    }
    // looked at without touching it: asking who holds an object must not
    // keep the holder's session alive
    if (session.touched < Date.now() - this.ttlMs) {
      this.end(session.id);
      return undefined;
    }
    return {session, handle: Sessions.#handleOf(session, type, name)};
  }

  // Whether handle is this session's for the object and the session holds
  // it: what a write checks before it writes (port-map section 2, step 8).
  holds(session, handle, type, name) {
    const lock = session.locks.get(handle);
    if (lock === undefined || objectKey(lock.type, lock.name) !== objectKey(type, name)) {
      return false;
    }
    const holder = this.holderOf(type, name);
    return holder?.session === session && holder.handle === handle;
  }

  // Take the lock on an object for a session. The same session asking again
  // gets the handle it already has; another session gets {heldBy}, naming
  // the session (and so the user) that holds it, and no handle.
  lock(session, type, name, makeHandle) {
    const owner = this.holderOf(type, name);
    if (owner !== undefined && owner.session !== session) {
      return {heldBy: owner.session};
    }
    const taken = this.owners.take(session, type, name);
    if (taken.heldBy !== undefined) {
      return {heldBy: this.byId.get(taken.heldBy.id) ?? {user: taken.heldBy.user ?? ""}};
    }
    return {handle: this.adopt(session, type, name, makeHandle)};
  }

  // The session's handle for an object it holds: the one it has, or a new
  // one. The owner table is not asked; the caller has just taken the object
  // (the ABAP LOCK route, through SYSTEM LOCK_HANDLE, or lock above).
  adopt(session, type, name, makeHandle) {
    const known = Sessions.#handleOf(session, type, name);
    if (known !== undefined) {
      return known;
    }
    const handle = makeHandle();
    session.locks.set(handle, {handle, type, name, since: Date.now()});
    return handle;
  }

  // Forget one handle of a session and answer what it locked; the owner
  // table is not told (the ABAP UNLOCK route dequeues itself, through
  // SYSTEM LOCK_RELEASE).
  forget(session, handle) {
    const lock = session.locks.get(handle);
    if (lock !== undefined) {
      session.locks.delete(handle);
    }
    return lock;
  }

  // Release one handle of a session; a handle the session does not hold is
  // ignored, as UNLOCK always has been.
  unlock(session, handle) {
    const lock = this.forget(session, handle);
    if (lock !== undefined) {
      this.owners.drop(session, lock.type, lock.name);
    }
  }

  // The object is gone (deleted): whoever held it holds nothing now.
  release(type, name) {
    const owner = this.holderOf(type, name);
    if (owner === undefined || this.byId.get(owner.session.id) !== owner.session) {
      return;
    }
    if (owner.handle !== undefined) {
      this.forget(owner.session, owner.handle);
    }
    this.owners.drop(owner.session, type, name);
  }

  // An explicit end (logoff) or an expiry: the session goes, and every lock
  // it held goes with it. This and UNLOCK are the only ways a lock is lost.
  end(id) {
    const session = this.byId.get(id);
    if (session === undefined) {
      return;
    }
    this.byId.delete(id);
    session.locks.clear();
    this.owners.end(id);
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
      this.end(id);
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
      const asked = sessionIdOf(cookies);

      // an empty cookie is a heal attempt: the client believes the
      // context is gone and wants a new one rather than an error
      let session = asked === undefined || asked === "" ? undefined : this.get(asked);
      const fresh = session === undefined;
      if (fresh) {
        session = this.open(Sessions.user(req));
      }

      // A stateless request is one request that does not need the context,
      // not the end of the context. A client interleaves them freely -- LOCK
      // stateful, a stateless GET of the source, then the PUT with the
      // handle -- and A4H keeps the lock through all three. Clearing the
      // handles here made that PUT a 409 "lock handle does not hold this
      // object". Only an explicit end (logoff) or an expiry drops a lock.
      const type = String(req.headers["x-sap-adt-sessiontype"] ?? "").toLowerCase();
      if (type === "stateful") {
        session.stateful = true;
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
