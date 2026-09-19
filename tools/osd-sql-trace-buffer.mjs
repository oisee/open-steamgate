// The trace a running system holds, for a screen to read (backlog G.10).
//
// **Outside the database, on purpose.** The obvious design is a DDIC table:
// then the screen is ordinary ABAP with an ordinary SELECT and there is no
// new mechanism at all. It is wrong here for two reasons that are not about
// taste. The tracer sits on the one connection every statement goes through,
// so writing a trace row would trace itself; and a trace row written inside
// an open LUW is lost when that LUW rolls back and changes the commit shape
// when it does not -- which is the exact thing the trace is measuring. A
// measurement that takes part in what it measures is not one.
//
// So the buffer is a ring in the host, and ABAP reaches it the way it
// reaches HANA: through a destination (`tools/amdp-destination.mjs` is the
// same shape). No new protocol, and the screen stays ABAP.
import {canonical, summarise} from "./osd-sql-trace.mjs";

/** A ring, because a trace is bounded by what a person will read and a
 *  server that keeps every statement of a day is a memory leak with a
 *  screen on it. */
export class TraceRing {
  constructor({size = 2000} = {}) {
    this.size = size;
    this.entries = [];
    this.dropped = 0;
    this.on = false;
  }

  record(entry) {
    if (this.on !== true) return;
    this.entries.push(entry);
    while (this.entries.length > this.size) {
      this.entries.shift();
      this.dropped += 1;
    }
  }

  /** what is held, oldest first, with the count of what was not */
  read({limit = 200} = {}) {
    const from = Math.max(0, this.entries.length - limit);
    return {entries: this.entries.slice(from), held: this.entries.length, dropped: this.dropped, on: this.on};
  }

  summary() {
    return {...summarise(this.entries), held: this.entries.length, dropped: this.dropped, on: this.on};
  }

  start() {
    this.on = true;
    return this.read({limit: 0});
  }

  stop() {
    this.on = false;
    return this.read({limit: 0});
  }

  clear() {
    this.entries = [];
    this.dropped = 0;
    return this.read({limit: 0});
  }
}

/**
 * The destination an ABAP screen calls.
 *
 * `CALL FUNCTION 'ZOSD_SQL_TRACE' DESTINATION 'SQLTRACE'` with a command,
 * exactly as the AMDP tile reaches HANA. The contract is the one
 * tools/rfc-replay.mjs implements: `call(name, signature)`.
 */
export class TraceDestination {
  constructor(ring) {
    this.ring = ring;
  }

  async call(name, signature) {
    const asked = String(signature?.IMPORTING?.IV_COMMAND?.get?.() ?? signature?.IMPORTING?.IV_COMMAND ?? "SUMMARY");
    const command = asked.trim().toUpperCase();
    const limit = Number(signature?.IMPORTING?.IV_LIMIT?.get?.() ?? signature?.IMPORTING?.IV_LIMIT ?? 200) || 200;
    switch (command) {
      case "START": return {EXPORTING: {EV_JSON: JSON.stringify(this.ring.start())}};
      case "STOP": return {EXPORTING: {EV_JSON: JSON.stringify(this.ring.stop())}};
      case "CLEAR": return {EXPORTING: {EV_JSON: JSON.stringify(this.ring.clear())}};
      case "LIST": return {EXPORTING: {EV_JSON: JSON.stringify(this.#list(limit))}};
      case "SUMMARY": return {EXPORTING: {EV_JSON: JSON.stringify(this.ring.summary())}};
      default:
        // named, not ignored: a command nobody implemented that answers the
        // summary anyway is a screen showing the wrong panel in silence
        return {EXPORTING: {EV_JSON: JSON.stringify({error: `unknown trace command ${command}`})}};
    }
  }

  /** the statements, canonical, so two reads of one screen agree */
  #list(limit) {
    const {entries, held, dropped, on} = this.ring.read({limit});
    return {
      on, held, dropped,
      entries: entries.map((e) => ({
        n: e.n, op: e.op, ms: e.ms ?? 0, rows: e.rows ?? 0, table: e.table ?? "",
        sql: canonical(e.sql ?? "").text,
      })),
    };
  }
}
