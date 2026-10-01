// The lock server (ENQ E1) on Node and in the browser: the table that
// ENQUEUE_<object>, DEQUEUE_<object>, DEQUEUE_ALL and ENQUEUE_READ work on,
// as measured on a system (docs/enq-contract.md, the fixtures in
// test/fixtures/enq/contract.json). It is a port of tools/gogen/go/enq,
// gated on the same cases (test/osd-enq.mjs), so the two runtimes answer
// alike.
//
// One table per process, as one goroutine owns it in Go. Every operation is
// synchronous, so the event loop runs it whole and no request sees another
// half done; only _WAIT is asynchronous, and it waits between attempts, never
// inside one.
//
// The owner model is the measured one. A session has two owners: the dialog
// owner (GUSR), which holds _SCOPE 1 and lives as long as the session, and
// the update owner (GUSRVB), which holds _SCOPE 2 and belongs to the SAP
// LUW. _SCOPE 3 is one row carrying both. ROLLBACK WORK releases the update
// halves and starts a new update owner; COMMIT WORK starts a new one only
// when it queued an update, and the old owner's locks go when that update
// has run (updateDone); meanwhile they are the update task's, another
// owner's to the session too. A COMMIT with nothing to update releases
// nothing. The end of a session releases its own halves.

//
// What a host calls, and where (every entry into the ABAP: the HTTP fronts,
// APC events, jobs -- the osd-dialog-step lesson):
//   open(user)               when a session starts (logon, a stateful
//                            connection, a job, a stateless request that is
//                            its own session); the handle goes with it
//   enqueue / dequeue /      from the generated ENQUEUE_<obj> / DEQUEUE_<obj>,
//   dequeueAll / read        DEQUEUE_ALL and ENQUEUE_READ
//   commit(sid, updated)     at COMMIT WORK, updated = an update module was
//                            registered in this LUW; keep what it returns
//   updateDone(sid, ended)   when that update has run (COMMIT WORK AND WAIT:
//                            before it returns)
//   rollback(sid)            at ROLLBACK WORK and when a dialog step ends in a
//                            dump (tools/osd-dialog-step.mjs rolls back)
//   end(sid)                 when the session ends: logoff, expiry, the end of
//                            a stateless request, a closed WebSocket, the end
//                            of a job
// locks() is the one table of the process.

const WAIT_INTERVAL_MS = 1000;
const WAIT_TRIES = 5;

const shared = (mode) => mode === "S" || mode === "O";

/** the argument as ENQUEUE_READ shows it: the client and each field at its
 * length, U+FFFF in every position of a generic field */
export function garg(client, fields) {
  let out = client;
  for (const f of fields) {
    if (f.generic) {
      out += "￿".repeat(f.length);
      continue;
    }
    let v = [...(f.value ?? "")];
    if (f.length > 0 && v.length > f.length) v = v.slice(0, f.length);
    out += v.join("") + " ".repeat(Math.max(0, f.length - v.length));
  }
  return out.replace(/ +$/, "");
}

/** two arguments of one table touch a common key: position by position,
 * U+FFFF matching anything and a missing position a blank */
export function collide(a, b) {
  const ra = [...a];
  const rb = [...b];
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const x = ra[i] ?? " ";
    const y = rb[i] ?? " ";
    if (x !== y && x !== "￿" && y !== "￿") return false;
  }
  return true;
}

const scopeOf = (r) => (r.scope ? Number(r.scope) : 2);

export class LockServer {
  /** instance names the server in owner ids, as an application server's
   * instance name does on a system; now is the clock of the rows' times */
  constructor(instance = "osd", {now = () => new Date()} = {}) {
    this.instance = instance;
    this.now = now;
    this.rows = [];
    this.sessions = new Map();
    this.seq = 0;
    this.closed = false;
  }

  /** 58 characters like a system's: a timestamp, a sequence and the
   * instance, padded with dots. Compared, never parsed. */
  ownerId() {
    this.seq += 1;
    const stamp = this.now().toISOString().replace(/[-:TZ.]/g, "").padEnd(20, "0");
    const id = `${stamp}${String(this.seq % 1000000).padStart(6, "0")}${this.instance}`.slice(0, 58);
    return id.padEnd(58, ".");
  }

  /** starts a session of user and returns its handle */
  open(user) {
    if (this.closed) return 0;
    this.seq += 1;
    const id = this.seq;
    this.sessions.set(id, {user, dialog: this.ownerId(), update: this.ownerId()});
    return id;
  }

  /** the session holds the row: its dialog half, or an update half of its
   * current update owner */
  static owns(s, w) {
    return (w.dialogs > 0 && w.dialog === s.dialog) || (w.updates > 0 && w.update === s.update);
  }

  /** one attempt: {subrc} 0, 1 = FOREIGN_LOCK with msgno 601 (another owner)
   * or 602 (the caller's own lock) and holder = sy-msgv1, 2 = SYSTEM_FAILURE */
  tryEnqueue(sid, r) {
    const s = this.closed ? undefined : this.sessions.get(sid);
    if (!s) return {subrc: 2};
    const arg = garg(r.client, r.fields);
    // the conflicting lock taken first decides, whoever holds it (measured,
    // precedence-* in E0); the rows are in the order they were taken
    let same;
    for (const w of this.rows) {
      if (w.client !== r.client || w.table !== r.table || !collide(w.arg, arg)) continue;
      // halves, not rows: another session's row, or the half of an update
      // owner a COMMIT ended (the update task's), is another owner's
      if ((w.session !== sid || (w.updates > 0 && w.update !== s.update)) && (!shared(w.mode) || !shared(r.mode))) {
        return {subrc: 1, msgno: "601", holder: w.user};
      }
      if (!LockServer.owns(s, w)) continue;
      if (w.mode === "X" || r.mode === "X") return {subrc: 1, msgno: "602", holder: w.user};
      // a lock is the table, the argument and the mode (GOBJ is shown only)
      if (w.arg === arg && w.mode === r.mode && (w.updates === 0 || w.update === s.update)) same = w;
    }
    if (!same) {
      same = {client: r.client, table: r.table, object: r.object, arg, mode: r.mode, user: s.user,
        dialog: "", update: "", dialogs: 0, updates: 0, taken: this.now(), session: sid};
      this.rows.push(same);
    }
    const scope = scopeOf(r);
    if (scope === 1 || scope === 3) {
      same.dialogs += 1;
      same.dialog = s.dialog;
    }
    if (scope === 2 || scope === 3) {
      same.updates += 1;
      same.update = s.update;
    }
    return {subrc: 0};
  }

  /** ENQUEUE: with wait a refusal is retried once a second for five seconds
   * (measured: a lock that stays held fails after about 4.7 s, one released
   * after about 1 s is granted after about 1.0 s) */
  async enqueue(sid, r, {wait = false, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))} = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = this.tryEnqueue(sid, r);
      if (res.subrc !== 1 || !wait || attempt >= WAIT_TRIES) return res;
      await sleep(WAIT_INTERVAL_MS);
    }
  }

  /** releases one count of a lock the session holds with exactly this
   * argument, mode and scope; anything else is a silent no-op */
  dequeue(sid, r) {
    const s = this.sessions.get(sid);
    if (!s) return;
    const arg = garg(r.client, r.fields);
    const scope = scopeOf(r);
    for (const w of this.rows) {
      if (!LockServer.owns(s, w) || w.client !== r.client || w.table !== r.table || w.arg !== arg || w.mode !== r.mode) continue;
      let released = false;
      if ((scope === 1 || scope === 3) && w.dialogs > 0 && w.dialog === s.dialog) {
        w.dialogs -= 1;
        released = true;
      }
      if ((scope === 2 || scope === 3) && w.updates > 0 && w.update === s.update) {
        w.updates -= 1;
        released = true;
      }
      if (released) break;
    }
    this.sweep();
  }

  /** drops the rows no half holds any more and blanks a released half */
  sweep() {
    this.rows = this.rows.filter((w) => {
      if (w.dialogs === 0) w.dialog = "";
      if (w.updates === 0) w.update = "";
      return w.dialogs > 0 || w.updates > 0;
    });
  }

  /** DEQUEUE_ALL: the session's own halves in every scope */
  dequeueAll(sid) {
    this.release(sid);
  }

  release(sid) {
    const s = this.sessions.get(sid);
    if (!s) return;
    for (const w of this.rows) {
      if (w.session !== sid) continue;
      if (w.dialog === s.dialog) w.dialogs = 0;
      if (w.update === s.update) w.updates = 0;
    }
    this.sweep();
  }

  /** ROLLBACK WORK: the update halves go and a new update owner starts */
  rollback(sid) {
    const s = this.sessions.get(sid);
    if (!s) return;
    this.releaseUpdate(sid, s.update);
    s.update = this.ownerId();
  }

  releaseUpdate(sid, owner) {
    if (!owner) return;
    for (const w of this.rows) {
      if (w.session === sid && w.update === owner) w.updates = 0;
    }
    this.sweep();
  }

  /** COMMIT WORK: with nothing to update it releases nothing and keeps the
   * update owner; with an update it starts a new one at once and returns the
   * one that ended, whose locks go at updateDone */
  commit(sid, updated) {
    const s = this.sessions.get(sid);
    if (!s || !updated) return "";
    const ended = s.update;
    s.update = this.ownerId();
    return ended;
  }

  /** the update has run: the locks of the owner commit ended go */
  updateDone(sid, owner) {
    this.releaseUpdate(sid, owner);
  }

  /** the session ends; the half its update task holds stays until updateDone */
  end(sid) {
    this.release(sid);
    this.sessions.delete(sid);
  }

  /** the session's current update owner (GUSRVB of its next _SCOPE 2 lock) */
  updateOwner(sid) {
    return this.sessions.get(sid)?.update ?? "";
  }

  /** ENQUEUE_READ: an empty filter field matches every row */
  read({client = "", table = "", user = ""} = {}) {
    return this.rows
      .filter((w) => (!client || w.client === client) && (!table || w.table === table) && (!user || w.user === user))
      .map((w) => ({...w}));
  }

  close() {
    this.closed = true;
  }
}

let processLocks;

/** the lock table of this process, as there is one enqueue server per system */
export function locks() {
  processLocks ??= new LockServer("osd");
  return processLocks;
}
