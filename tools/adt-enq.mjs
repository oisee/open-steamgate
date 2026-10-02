// The ADT façade's owner table on the lock server (ADR 0008; slice 2 of
// ADR 0007, docs/adt-abap-port/abap-skeleton.md).
//
// With the ABAP front mounted, LOCK and UNLOCK are ZCL_OSD_ADT_LOCK, which
// takes ENQUEUE_EZOSD_ADT_OBJ (mode X, _SCOPE 1, the object's type and name)
// in the ENQ session the front bound to the ADT session. The Node routes that
// still check a lock -- PUT, DELETE, POST include -- ask the same lock table
// through this object, which Sessions takes as its owner table: so who holds
// an object is said once, by the lock server, and the Node session map keeps
// only the handles, which are ADT values (port-map section 2, step 8).
//
// The ENQ key of an ADT session is "adt:<instance>:<session id>", the
// instance shared by Node owners and the ABAP kernel, so an unknown holder is
// told apart: under this host's prefix it is a session that has ended (dead, and
// ended on sight), under another prefix it is another façade's on the same
// lock server (alive, its user quoted). The argument is built by
// tools/osd-enq-host.mjs from the dictionary, as an ENQUEUE_ from ABAP builds
// it, so the two sides cannot disagree on it.
import {adtEnqOwner} from "./adt-enq-key.mjs";
import {randomUUID} from "node:crypto";
import {EnqSessionEnded, bindEnqSession, endEnqSession, enqDrop, enqHolder, enqTake, onEnqContextEnded, reviveEnqSession} from "./osd-enq-host.mjs";
import {Sessions, refuseToken} from "./adt-session.mjs";

export const LOCK_TABLE = "ZOSD_ADT_LOCK";
export const LOCK_OBJECT = "EZOSD_ADT_OBJ";

/** the exporting parameters ZCL_OSD_ADT_LOCK passes, said for the host */
const argument = (type, name) => ({
  mode_zosd_adt_lock: "X", objtype: String(type).toUpperCase(), objname: String(name).toUpperCase(),
  x_objtype: "X", x_objname: "X", _scope: "1",
});

export class EnqOwners {
  constructor() {
    this.prefix = adtEnqOwner.prefix;
  }

  /** the ENQ session key of an ADT session of this table */
  key(id) {
    return adtEnqOwner.key(id);
  }

  // {id, user, mine}: mine when the key is this table's, so that an id the
  // sessions do not know is one that ended, not somebody else's
  holder(type, name) {
    const held = enqHolder(LOCK_TABLE, argument(type, name));
    if (held === undefined) {
      return undefined;
    }
    const mine = adtEnqOwner.owns(held.key);
    return {id: mine ? adtEnqOwner.idOf(held.key) : undefined, user: held.user, mine};
  }

  // the Node LOCK route, which serves only when the ABAP route table could
  // not be read: the same lock, taken from the host
  take(session, type, name) {
    const res = enqTake(this.key(session.id), session.user, LOCK_TABLE, LOCK_OBJECT, argument(type, name));
    // 602: the session's own lock, which LOCK answers with its handle
    if (res.subrc === 0 || res.msgno === "602") {
      return {};
    }
    if (res.subrc === 1) {
      return {heldBy: {user: res.holder}};
    }
    throw new Error(`${type} ${name} could not be locked: the lock server answered ${res.subrc}`);
  }

  drop(session, type, name) {
    enqDrop(this.key(session.id), LOCK_TABLE, LOCK_OBJECT, argument(type, name));
  }

  end(id) {
    endEnqSession(this.key(id));
  }
}

/**
 * What the ABAP front of one façade instance needs from its sessions
 * (tools/adt-abap-front.mjs, options enter and system):
 *
 * - enter: a step of a stateful ADT session is that session's ENQ session,
 *   so a lock it takes outlives the request and goes with logoff, the
 *   session DELETE or expiry (Sessions#end -> EnqOwners#end). The session is
 *   the one the middleware chose by sessionIdOf, the one precedence rule. A
 *   session that never asked for state binds nothing: its step is its ENQ
 *   session, as a stateless request is on a system. A stateless request of a
 *   stateful session is bound like any other, so it clears nothing.
 * - ended: a session that ended while its step waited for the work process
 *   (a LOCK queued behind its own logoff) cannot be bound again
 *   (EnqSessionEnded); the request is answered as one from a session that
 *   is gone, the CSRF refusal (refuseToken), and no ABAP runs for it.
 * - system: SYSTEM LOCK_HANDLE and LOCK_RELEASE, the session's handle map,
 *   SESSION (stateful or not) and LOCK_HOLDER (Sessions#holderOf, which
 *   ends a holder whose session is gone), all of which stay in the Node
 *   session until it moves into ABAP; any other kind goes to `other` (the
 *   façade's IDENTITY).
 */
export function abapSession(sessions, other) {
  // A dump ends the bound ENQ context (#433) and its locks with it, but not
  // the key: the session's next step opens a new context, as on a system.
  // The handles that context gave out go too, so none of them looks alive.
  // The logon session itself stays (its token, its cookies): a write with an
  // old handle is then the 409 of a handle that holds nothing, not a CSRF
  // refusal, and the client locks again.
  // ABAP clears persisted handles when its next resolve sees the ended
  // context. Only the Node table needs immediate in-memory cleanup here.
  if (sessions instanceof Sessions) onEnqContextEnded((key) => {
    const prefix = sessions.owners.prefix;
    if (typeof key !== "string" || prefix === undefined || key.startsWith(prefix) === false) return;
    sessions.byId.get(key.slice(prefix.length))?.locks.clear();
  });
  return {
    async enter(req) {
      const session = req.adt?.session;
      if (session?.stateful !== true) return;
      const key = sessions.owners.key(session.id);
      try {
        bindEnqSession(key, {user: session.user});
      } catch (e) {
        // The lock server ended this context. If the session still exists it
        // goes on in a new context: a read is answered, a write with a handle
        // of the old one is the 409 of a handle that holds nothing.
        if (!(e instanceof EnqSessionEnded)) throw e;
        // ...but the request resolved its session before it queued, so ask
        // again: a logoff that ran meanwhile has removed it, and then this is
        // the refusal (#432: no lock under a logged-off session)
        const live = await sessions.get(session.id);
        if (live === undefined) throw e;
        // the handles of the ended context hold nothing: they go before the
        // key lives again, so a relock gives a new handle, never an old one
        if (typeof sessions.contextEnded === "function") await sessions.contextEnded(session.id);
        else live.locks.clear();
        session.locks?.clear?.();
        reviveEnqSession(key);
        bindEnqSession(key, {user: session.user});
      }
    },
    ended: refuseToken,
    async system(kind, name, req) {
      const session = req.adt?.session;
      if (kind === "LOCK_HANDLE" && session !== undefined) {
        const [type, ...rest] = String(name).split(" ");
        return {handle: await sessions.adopt(session, type, rest.join(" "), () => randomUUID())};
      }
      if (kind === "LOCK_RELEASE" && session !== undefined) {
        const lock = await sessions.forget(session, String(name));
        return lock === undefined ? {} : {type: lock.type, name: lock.name};
      }
      if (kind === "SESSION" && session !== undefined) {
        return {stateful: session.stateful === true};
      }
      if (kind === "LOCK_HOLDER") {
        const [type, ...rest] = String(name).split(" ");
        return {alive: await sessions.holderOf(type, rest.join(" ")) !== undefined};
      }
      return other(kind, name, req);
    },
  };
}

/** The refusal of a LOCK outside a stateful session, said once for the Node
 *  route; ZCL_OSD_ADT_LOCK writes the same words. Without state the ENQ
 *  session is the request's, and the lock would be gone before its handle
 *  was used. Unmeasured on A4H (docs/adt-abap-port/abap-skeleton.md). */
export const statelessLock = (entry) =>
  `${entry.type} ${entry.name} cannot be locked outside a stateful session; send x-sap-adt-sessiontype: stateful`;
