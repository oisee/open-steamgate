// The lock server (tools/osd-enq.mjs) wired into the ABAP: what every host
// installs through test/setup.mjs, so the Node server, osd serve, the
// preview and the unit runs answer alike.
//
// - ENQUEUE_<obj> / DEQUEUE_<obj> are the transpiler's (handle_enqu.ts): they
//   call abap.Classes.KERNEL_LOCK, which this replaces. The argument is the
//   lock table's key fields from abap.DDIC (a lock object over its primary
//   table; secondary tables are not served yet), MANDT from the call or
//   sy-mandt, an initial field generic unless X_<field> = 'X'.
// - DEQUEUE_ALL and ENQUEUE_READ are function modules registered here.
// - A session is the dialog step, unless a host binds a longer one
//   (bindEnqSession: a stateful connection, an APC channel, a job): a step's
//   own session ends with the step, so a stateless request leaves no lock.
// - COMMIT WORK and ROLLBACK WORK are the ABAP statements, wrapped here; the
//   database commit at the end of a step is not COMMIT WORK and touches no
//   lock. The runtime runs CALL FUNCTION ... IN UPDATE TASK at once, so an
//   update module (UPDATE_TASK in its *.fugr.xml) marks the LUW as updated
//   when it runs, and COMMIT WORK then hands the update owner's locks to
//   that update, which has already run: they go at the COMMIT.
// - A step that ends in a dump rolls back: its update halves go. A dump ends
//   the context on a system, and with it the context's dialog locks: a bound
//   session that dumps is ended too, and the key's next step opens a new one.
// - A key ended by its host (logoff, expiry, a closed channel) stays ended: a
//   step of that key still queued or parked in a WAIT when the end came
//   cannot open a fresh session under it and take a lock nobody will ever
//   end. Binding it or enqueuing under it throws EnqSessionEnded, which the
//   host answers as a clean error; DEQUEUE, COMMIT and ROLLBACK under it
//   have nothing to touch and do nothing.
// - _WAIT sleeps through WAIT UP TO, which gives the work process up inside
//   a step (tools/osd-dialog-step.mjs) -- and, as WAIT does, commits.
import {installEnqSession} from "./osd-enq-session.mjs";
import {collide, garg, locks} from "./osd-enq.mjs";
import {currentStepToken, holderToken, onEveryStep, stepContextTracked} from "./osd-dialog-step.mjs";

const PROCESS = {what: "the process, outside any step"};
const sessions = new Map(); // a session key (a step token, or a bound key) -> handle
const updated = new Set(); // session handles whose LUW ran an update module

/** a bound key its host has ended; the host answers it as an error of its
 * protocol (the ADT front: an exception document), never as a fresh session */
export class EnqSessionEnded extends Error {
  constructor(key) {
    super(`the session ${typeof key === "string" ? key : "bound by the host"} has ended`);
    this.name = "EnqSessionEnded";
    this.code = "ENQ_SESSION_ENDED";
    this.key = key;
  }
}

// ended keys: an object key is held weakly; a primitive one (a cookie id) in
// insertion order, the oldest forgotten past ENDED_KEEP -- long after any
// step queued behind its end has run. A key ended without ever being bound
// (a host ends every session it had, stateful or not) counts too; harmless
// A bound step keeps the session of its key at the moment it bound
// (token.enqSid, pinned by bindEnqSession, whether or not it locks), so a
// dump in another step of its key can retire that session without taking
// it from under the step: the retired session stays doomed until the last
// step pinned to it is out, and the key's next step opens a new one
const pins = new Map(); // a bound session's handle -> the running steps pinned to it
const doomed = new Map(); // a retired session's handle -> its key
const contextEnded = [];
const ENDED_KEEP = 10000;
const endedObjects = new WeakSet();
const endedValues = new Set();
const isObject = (key) => (typeof key === "object" && key !== null) || typeof key === "function";
const isEnded = (key) => (isObject(key) ? endedObjects.has(key) : endedValues.has(key));
function markEnded(key) {
  if (isObject(key)) {
    endedObjects.add(key);
    return;
  }
  endedValues.delete(key);
  endedValues.add(key);
  if (endedValues.size > ENDED_KEEP) endedValues.delete(endedValues.values().next().value);
}

const value = (v) => (v === undefined || v === null ? "" : typeof v.get === "function" ? String(v.get()) : String(v));
const upper = (s) => String(s).toUpperCase();

// the step running this code: its own context on Node; in the browser,
// which tracks none, the step that holds the work process. ABAP outside any
// step on Node (startup, a unit run, a timer) is the process's own session,
// which nothing ends: a lock taken there stays until DEQUEUE or DEQUEUE_ALL
function token() {
  return stepContextTracked() ? currentStepToken() : holderToken();
}

function sessionKey() {
  const t = token();
  return t?.enqSession ?? t ?? PROCESS;
}

function user() {
  try {
    return value(globalThis.abap.builtin.sy.get().uname).trim() || "OSD";
  } catch {
    return "OSD";
  }
}

/** the lock server's handle of the session running now, opened if need be;
 * throws EnqSessionEnded under a key its host has ended */
export function currentEnqSession() {
  const key = sessionKey();
  if (isEnded(key)) throw new EnqSessionEnded(key);
  const t = token();
  if (t?.enqSession === undefined) return sessionOf(key, t?.enqUser ?? user());
  if (t.enqSid === undefined) pin(t, key);
  return t.enqSid;
}

/** the step belongs to key's session as it is now, opened if need be */
function pin(t, key) {
  const sid = sessionOf(key, t.enqUser ?? user());
  t.enqSid = sid;
  pins.set(sid, (pins.get(sid) ?? 0) + 1);
}

/** the step is no longer pinned to its session; a doomed one ends with the
 * last step out */
function unpin(t) {
  const sid = t?.enqSid;
  if (sid === undefined) return;
  t.enqSid = undefined;
  const n = (pins.get(sid) ?? 1) - 1;
  if (n > 0) {
    pins.set(sid, n);
    return;
  }
  pins.delete(sid);
  if (doomed.has(sid)) retireNow(sid, doomed.get(sid), true);
}

function sessionOf(key, owner) {
  let sid = sessions.get(key);
  if (sid === undefined || sid === 0) {
    sid = locks().open(owner);
    sessions.set(key, sid);
  }
  return sid;
}

/** the handle of the session running now if it has one, opening none:
 * what a release needs (an ended key has nothing left to release) */
function existingEnqSession() {
  const key = sessionKey();
  if (isEnded(key)) return undefined;
  const t = token();
  return t?.enqSession !== undefined ? t.enqSid : sessions.get(key);
}

/** a host's longer session: the step running now belongs to key (any value
 * the host keeps for its connection) until endEnqSession(key); a key already
 * ended throws EnqSessionEnded. user is the logon user the session's locks
 * name (sy-msgv1 of a refusal, GUNAME); it defaults to sy-uname, which is
 * the process's and not a client's */
export function bindEnqSession(key, {user: owner} = {}) {
  if (isEnded(key)) throw new EnqSessionEnded(key);
  const t = token();
  if (t === undefined) return;
  if (owner !== undefined) t.enqUser = owner;
  if (t.enqSession === key) return;
  unpin(t);
  t.enqSession = key;
  pin(t, key);
}

/** callback(key) when a bound session ends by a dump, not by its host: the
 * host's own record of it (an ADT session and its lock handles) can go too */
export function onEnqContextEnded(callback) {
  contextEnded.push(callback);
}

/** a dump ended key's context: the session sid is no longer the key's; it
 * ends now if no other running step is pinned to it, else with the last */
function retire(sid, key) {
  if (sessions.get(key) === sid) sessions.delete(key);
  if ((pins.get(sid) ?? 0) > 0) doomed.set(sid, key);
  else retireNow(sid, key, true);
}

function retireNow(sid, key, tell) {
  doomed.delete(sid);
  updated.delete(sid);
  locks().end(sid);
  if (!tell) return;
  for (const callback of contextEnded) {
    try {
      callback(key);
    } catch (e) {
      console.error(`osd-enq-host: a context-ended callback failed: ${e?.message ?? e}`);
    }
  }
}

/** the host ends key's session (logoff, expiry, a closed channel): its locks
 * go, and the key stays ended */
export function endEnqSession(key) {
  markEnded(key);
  dropEnqSession(key);
  for (const [sid, k] of [...doomed]) if (k === key) retireNow(sid, key, false);
}

/** the session behind key goes, with its locks; the key may open a new one */
function dropEnqSession(key) {
  const sid = sessions.get(key);
  if (sid === undefined) return;
  sessions.delete(key);
  updated.delete(sid);
  locks().end(sid);
}

// ---- the lock table seen from the host, outside any step: what a host
// route asks about a lock an ABAP route took (the ADT façade's write routes,
// tools/adt-enq.mjs). The argument is built by the same rules as an
// ENQUEUE_ from ABAP (request below), so the two cannot disagree on it.

/** who holds the lock argument of table for input (the exporting parameters
 * an ENQUEUE_ would get): {key, user} of the first row that collides, key
 * the host's key of a bound session (undefined for a step's own one) */
export function enqHolder(table, input) {
  const r = request(globalThis.abap, table, "", input);
  const arg = garg(r.client, r.fields);
  const row = locks().read({client: r.client, table: r.table}).find((w) => collide(w.arg, arg));
  if (row === undefined) return undefined;
  let key = doomed.get(row.session);
  for (const [k, sid] of sessions) {
    if (sid === row.session) key = k;
  }
  return {key, user: row.user};
}

/** ENQUEUE_<object> on behalf of the bound session key, without a step:
 * {subrc, msgno, holder} as the lock server answers (no _WAIT) */
export function enqTake(key, owner, table, object, input) {
  if (isEnded(key)) throw new EnqSessionEnded(key);
  return locks().tryEnqueue(sessionOf(key, owner), request(globalThis.abap, table, object, input));
}

/** DEQUEUE_<object> on behalf of the bound session key, without a step */
export function enqDrop(key, table, object, input) {
  if (isEnded(key)) throw new EnqSessionEnded(key);
  const r = request(globalThis.abap, table, object, input);
  // the key's session now, and any retired by a dump that a parked step
  // still holds: enqHolder names those under the key too
  const sid = sessions.get(key);
  if (sid !== undefined) locks().dequeue(sid, r);
  for (const [retired, k] of doomed) if (k === key) locks().dequeue(retired, r);
}

/** an update module ran in the session's LUW (what the wrapped update
 * modules call; a host or a test that runs one some other way says so here) */
export function noteUpdateTask() {
  if (isEnded(sessionKey())) return;
  updated.add(currentEnqSession());
}

/** the lock argument of table for the exporting parameters of an ENQUEUE_ */
function request(abap, table, object, input) {
  const t = upper(table).trim();
  const ddic = abap.DDIC?.[t];
  if (ddic === undefined) throw new Error(`ENQUEUE_${object}: table ${t} is not in the dictionary`);
  const type = typeof ddic.type === "function" ? ddic.type() : ddic.type;
  const components = type?.value ?? type?.getComponents?.() ?? {};
  const length = (name) => {
    const c = components[name.toLowerCase()];
    return typeof c?.getLength === "function" ? c.getLength() : value(c).length;
  };
  const p = Object.fromEntries(Object.entries(input ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let client = "";
  const fields = [];
  for (const key of ddic.keyFields ?? []) {
    const name = key.toLowerCase();
    if (name === "mandt" || name === "client") {
      client = value(p[name]).trim() || value(abap.builtin.sy.get().mandt);
      continue;
    }
    const v = value(p[name]);
    const literal = value(p[`x_${name}`]).trim().toUpperCase() === "X";
    // initial is generic: blank, or all zeros for a numeric field (NUMC, INT)
    const numeric = ["Integer", "Integer8", "Numc", "Packed", "Float", "DecFloat34"].includes(components[name]?.constructor?.name);
    const initial = v.trim() === "" || (numeric && /^[0\s.,+-]*$/.test(v));
    fields.push({value: v.replace(/ +$/, ""), generic: initial && !literal, length: length(name)});
  }
  const mode = value(p[`mode_${t.toLowerCase()}`]).trim().toUpperCase() || "E";
  return {client, table: t, object, mode, scope: value(p._scope).trim(), fields, wait: value(p._wait).trim().toUpperCase() === "X",
    collect: value(p._collect).trim().toUpperCase() === "X"};
}

/** _WAIT's sleep: WAIT UP TO, which gives the work process up inside a step */
async function yieldingSleep(abap, ms) {
  await abap.statements.wait({seconds: {get: () => ms / 1000}});
  // the host may have ended the key while this ENQUEUE waited for its lock
  const key = sessionKey();
  if (isEnded(key)) throw new EnqSessionEnded(key);
}

function raiseClassic(abap, name, msgno = "", holder = "") {
  if (msgno !== "") {
    const sy = abap.builtin.sy.get();
    sy.msgid.set("MC");
    sy.msgty.set("E");
    sy.msgno.set(msgno);
    sy.msgv1.set(holder);
  }
  throw new abap.ClassicError({classic: name});
}

/** installs the lock server into the ABAP runtime; updateModules: the names
 * of the update-task function modules of the tree */
export function installEnq(abap, {updateModules = []} = {}) {
  // a host or a test that sets up a database without the ABAP runtime's
  // registries (no Classes, FunctionModules or statements) has no ABAP to
  // lock for
  if (typeof abap?.Classes !== "object" || abap.Classes === null || typeof abap.FunctionModules !== "object" || abap.FunctionModules === null
      || typeof abap.statements?.commit !== "function") return;
  if (abap.__osdEnq === true) return;
  abap.__osdEnq = true;
  installEnqSession(abap, {
    bind: bindEnqSession, end: endEnqSession, Ended: EnqSessionEnded,
    contextAlive: (key) => !isEnded(key) && sessions.has(key),
  });

  // setup runs before the class modules load, and open-abap-core's
  // KERNEL_LOCK (which locks nothing) assigns itself afterwards: the slot
  // keeps this one
  const kernelLock = {
    async enqueue({table_name: table, enqueue_name: object, input}) {
      const r = request(abap, value(table), value(object), input);
      if (r.collect) raiseClassic(abap, "system_failure", "", "_COLLECT is not served");
      const res = await locks().enqueue(currentEnqSession(), r, r.wait ? {wait: true, sleep: (ms) => yieldingSleep(abap, ms)} : {});
      if (res.subrc === 1) raiseClassic(abap, "foreign_lock", res.msgno, res.holder);
      if (res.subrc !== 0) raiseClassic(abap, "system_failure");
      abap.builtin.sy.get().subrc.set(0);
    },
    async dequeue({table_name: table, enqueue_name: object, input}) {
      const sid = existingEnqSession();
      if (sid !== undefined) locks().dequeue(sid, request(abap, value(table), value(object), input));
      abap.builtin.sy.get().subrc.set(0);
    },
  };
  let replaced = false;
  Object.defineProperty(abap.Classes, "KERNEL_LOCK", {
    get: () => kernelLock,
    set: () => {
      // the first assignment is open-abap-core's own class loading; another
      // one is somebody else's double, said rather than dropped silently
      if (replaced) console.warn("osd-enq-host: KERNEL_LOCK is the lock server's; a second assignment is ignored");
      replaced = true;
    },
    enumerable: true, configurable: true,
  });

  abap.FunctionModules.DEQUEUE_ALL = async () => {
    const sid = existingEnqSession();
    if (sid !== undefined) locks().dequeueAll(sid);
  };

  // ENQUEUE_READ: NUMBER, SUBRC and the rows into ENQ, field by field as far
  // as the caller's row has them (GUSR/GUSRVB, GUSE/GUSEVB, GARG, GMODE ...)
  abap.FunctionModules.ENQUEUE_READ = async (INPUT) => {
    const p = Object.fromEntries(Object.entries(INPUT?.exporting ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    // GCLIENT defaults to sy-mandt and GUNAME to sy-uname, as on a system;
    // GUNAME = space is every user
    const sy = abap.builtin.sy.get();
    const gclient = "gclient" in p ? value(p.gclient).trim() : value(sy.mandt).trim();
    const guname = "guname" in p ? upper(value(p.guname)).trim() : upper(value(sy.uname)).trim();
    const rows = locks().read({client: gclient, table: upper(value(p.gname)).trim(), user: guname});
    const enq = INPUT?.tables?.enq ?? INPUT?.tables?.ENQ;
    if (enq !== undefined) {
      enq.clear?.();
      for (const r of rows) {
        const line = enq.getRowType ? enq.getRowType().clone() : undefined;
        if (line === undefined) continue;
        const set = (name, v) => { const f = line.get()[name.toLowerCase()]; if (f !== undefined) f.set(v); };
        set("gclient", r.client); set("gname", r.table); set("garg", r.arg);
        set("gmode", r.mode); set("gusr", r.dialog); set("gusrvb", r.update); set("gobj", r.object);
        set("gtarg", r.arg.slice(0, 50)); set("guname", r.user); set("guse", r.dialogs); set("gusevb", r.updates);
        set("gusetxt", String(r.dialogs).padStart(10, "0")); set("gusevbt", String(r.updates).padStart(10, "0"));
        enq.append(line);
      }
    }
    INPUT?.importing?.number?.set?.(rows.length);
    INPUT?.importing?.subrc?.set?.(0);
  };

  // an update module running in this LUW: COMMIT WORK hands the locks over
  // the function modules register after setup too: each update module is
  // wrapped when it is assigned (and now, if it already is)
  for (const name of updateModules.map(upper)) {
    let wrapped = abap.FunctionModules[name] === undefined ? undefined : wrap(abap.FunctionModules[name]);
    Object.defineProperty(abap.FunctionModules, name, {
      get: () => wrapped,
      set: (fm) => { wrapped = typeof fm === "function" ? wrap(fm) : fm; },
      enumerable: true, configurable: true,
    });
  }
  function wrap(original) {
    return async (...args) => {
      noteUpdateTask();
      return original(...args);
    };
  }

  const statements = abap.statements;
  const commit = statements.commit.bind(statements);
  statements.commit = async (options) => {
    const result = await commit(options);
    if (options?.connection === undefined) {
      const sid = existingEnqSession();
      if (sid === undefined) return result; // no session: no lock to hand over
      const ended = locks().commit(sid, updated.has(sid));
      updated.delete(sid);
      // the runtime ran the update when it was called: it is done now
      locks().updateDone(sid, ended);
    }
    return result;
  };
  const rollback = statements.rollback.bind(statements);
  statements.rollback = async (options) => {
    const result = await rollback(options);
    if (options?.connection === undefined) {
      const sid = existingEnqSession();
      if (sid !== undefined) {
        updated.delete(sid);
        locks().rollback(sid);
      }
    }
    return result;
  };

  onEveryStep({
    onEnd(stepToken, {dumped}) {
      const bound = stepToken.enqSession;
      const sid = bound === undefined ? sessions.get(stepToken) : stepToken.enqSid;
      // a step's own session ends with it (its token is never seen again, so
      // it is not remembered as ended)
      if (bound === undefined) {
        if (sid !== undefined && dumped) {
          updated.delete(sid);
          locks().rollback(sid);
        }
        dropEnqSession(stepToken);
        return;
      }
      if (sid !== undefined && dumped) {
        updated.delete(sid);
        locks().rollback(sid);
      }
      unpin(stepToken);
      // a dump ends the context, and its dialog locks with it; the bound key
      // is not ended -- its next step is a new context, as on a system. A
      // system runs one step of a context at a time; here another step of
      // the key can be parked in a WAIT, and keeps the old session until it
      // is out, while a step that binds after the dump starts the new one
      if (sid !== undefined && dumped && (sessions.get(bound) === sid || doomed.has(sid))) retire(sid, bound);
    },
  });
}
