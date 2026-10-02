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
// The ENQ key of an ADT session is "adt:<session id>"; the argument is built
// by tools/osd-enq-host.mjs from the dictionary, as an ENQUEUE_ from ABAP
// builds it, so the two sides cannot disagree on it.
import {randomUUID} from "node:crypto";
import {bindEnqSession, endEnqSession, enqDrop, enqHolder, enqTake} from "./osd-enq-host.mjs";

export const LOCK_TABLE = "ZOSD_ADT_LOCK";
export const LOCK_OBJECT = "EZOSD_ADT_OBJ";
const PREFIX = "adt:";

/** the ENQ session key of an ADT session */
export const enqKey = (id) => `${PREFIX}${id}`;

/** the exporting parameters ZCL_OSD_ADT_LOCK passes, said for the host */
const argument = (type, name) => ({
  mode_zosd_adt_lock: "X", objtype: String(type).toUpperCase(), objname: String(name).toUpperCase(),
  x_objtype: "X", x_objname: "X", _scope: "1",
});

export class EnqOwners {
  holder(type, name) {
    const held = enqHolder(LOCK_TABLE, argument(type, name));
    if (held === undefined) {
      return undefined;
    }
    const id = typeof held.key === "string" && held.key.startsWith(PREFIX) ? held.key.slice(PREFIX.length) : undefined;
    return {id, user: held.user};
  }

  // the Node LOCK route, which serves only when the ABAP route table could
  // not be read: the same lock, taken from the host
  take(session, type, name) {
    const res = enqTake(enqKey(session.id), session.user, LOCK_TABLE, LOCK_OBJECT, argument(type, name));
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
    enqDrop(enqKey(session.id), LOCK_TABLE, LOCK_OBJECT, argument(type, name));
  }

  end(id) {
    endEnqSession(enqKey(id));
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
 * - system: SYSTEM LOCK_HANDLE and LOCK_RELEASE, the session's handle map,
 *   which stays in the Node session until the session moves into ABAP; any
 *   other kind goes to `other` (the façade's IDENTITY).
 */
export function abapSession(sessions, other) {
  return {
    enter(req) {
      const session = req.adt?.session;
      if (session?.stateful === true) bindEnqSession(enqKey(session.id), {user: session.user});
    },
    system(kind, name, req) {
      const session = req.adt?.session;
      if (kind === "LOCK_HANDLE" && session !== undefined) {
        const [type, ...rest] = String(name).split(" ");
        return {handle: sessions.adopt(session, type, rest.join(" "), () => randomUUID())};
      }
      if (kind === "LOCK_RELEASE" && session !== undefined) {
        const lock = sessions.forget(session, String(name));
        return lock === undefined ? {} : {type: lock.type, name: lock.name};
      }
      return other(kind, name, req);
    },
  };
}
