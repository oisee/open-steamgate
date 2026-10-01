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
// - A step that ends in a dump rolls back: its update halves go.
// - _WAIT sleeps through WAIT UP TO, which gives the work process up inside
//   a step (tools/osd-dialog-step.mjs) -- and, as WAIT does, commits.
import {locks} from "./osd-enq.mjs";
import {currentStepToken, holderToken, onEveryStep} from "./osd-dialog-step.mjs";

const PROCESS = {what: "the process, outside any step"};
const sessions = new Map(); // a session key (a step token, or a bound key) -> handle
const updated = new Set(); // session handles whose LUW ran an update module

const value = (v) => (v === undefined || v === null ? "" : typeof v.get === "function" ? String(v.get()) : String(v));
const upper = (s) => String(s).toUpperCase();

function token() {
  return currentStepToken() ?? holderToken();
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

/** the lock server's handle of the session running now */
export function currentEnqSession() {
  const key = sessionKey();
  let sid = sessions.get(key);
  if (sid === undefined || sid === 0) {
    sid = locks().open(user());
    sessions.set(key, sid);
  }
  return sid;
}

/** a host's longer session: the step running now belongs to key (any value
 * the host keeps for its connection) until endEnqSession(key) */
export function bindEnqSession(key) {
  const t = token();
  if (t !== undefined) t.enqSession = key;
}

export function endEnqSession(key) {
  const sid = sessions.get(key);
  if (sid === undefined) return;
  sessions.delete(key);
  updated.delete(sid);
  locks().end(sid);
}

/** an update module ran in the session's LUW (what the wrapped update
 * modules call; a host or a test that runs one some other way says so here) */
export function noteUpdateTask() {
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
    fields.push({value: v.replace(/ +$/, ""), generic: v.trim() === "" && !literal, length: length(name)});
  }
  const mode = value(p[`mode_${t.toLowerCase()}`]).trim().toUpperCase() || "E";
  return {client, table: t, object, mode, scope: value(p._scope).trim(), fields, wait: value(p._wait).trim().toUpperCase() === "X",
    collect: value(p._collect).trim().toUpperCase() === "X"};
}

/** _WAIT's sleep: WAIT UP TO, which gives the work process up inside a step */
async function yieldingSleep(abap, ms) {
  await abap.statements.wait({seconds: {get: () => ms / 1000}});
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
  if (abap.__osdEnq === true) return;
  abap.__osdEnq = true;

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
      locks().dequeue(currentEnqSession(), request(abap, value(table), value(object), input));
      abap.builtin.sy.get().subrc.set(0);
    },
  };
  Object.defineProperty(abap.Classes, "KERNEL_LOCK", {get: () => kernelLock, set: () => {}, enumerable: true, configurable: true});

  abap.FunctionModules.DEQUEUE_ALL = async () => {
    locks().dequeueAll(currentEnqSession());
  };

  // ENQUEUE_READ: NUMBER, SUBRC and the rows into ENQ, field by field as far
  // as the caller's row has them (GUSR/GUSRVB, GUSE/GUSEVB, GARG, GMODE ...)
  abap.FunctionModules.ENQUEUE_READ = async (INPUT) => {
    const p = Object.fromEntries(Object.entries(INPUT?.exporting ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const rows = locks().read({client: value(p.gclient).trim(), table: upper(value(p.gname)).trim(), user: upper(value(p.guname)).trim()});
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
      const sid = currentEnqSession();
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
      const sid = currentEnqSession();
      updated.delete(sid);
      locks().rollback(sid);
    }
    return result;
  };

  onEveryStep({
    onEnd(stepToken, {dumped}) {
      const sid = sessions.get(stepToken.enqSession ?? stepToken);
      if (sid !== undefined && dumped) {
        updated.delete(sid);
        locks().rollback(sid);
      }
      // a step's own session ends with it; a bound one goes on
      if (stepToken.enqSession === undefined) endEnqSession(stepToken);
    },
  });
}
