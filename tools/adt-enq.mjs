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
import {endEnqSession, enqDrop, enqHolder, enqTake} from "./osd-enq-host.mjs";

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

  // a lock taken from the host (AbapSessions#lock, Node's Sessions over
  // this table): the same lock ZCL_OSD_ADT_LOCK takes
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
 * (tools/adt-abap-front.mjs, option system): SYSTEM LOCK_HANDLE and
 * LOCK_RELEASE (the session's handles), SESSION (stateful or not) and
 * LOCK_HOLDER (holderOf, which ends a holder whose session is gone), asked by
 * ZCL_OSD_ADT_LOCK through the host; any other kind goes to `other` (the
 * façade's IDENTITY). The session is req.adt.session, which the RESOLVE of
 * the same step set (AbapSessions#sessionFor).
 *
 * The ENQ binding of a stateful session (its locks outlive the request) is
 * RESOLVE's (ZCL_OSD_ADT_SESSION, KERNEL_ENQ_SESSION). An ENQ context that
 * ended (a dump, #433, or the lock server) is not a session that ended: the
 * next RESOLVE clears the handles that context gave out and binds again
 * (#471). A step whose ENQ session ended while it waited (its logoff) is
 * answered by the front as the CSRF refusal.
 */
export function abapSession(sessions, other) {
  return {
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
