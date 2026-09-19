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
import {fromJson} from "./rfc-replay.mjs";

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
    // **The contract is the signature, not a shape of ours.**
    //
    // A destination does not RETURN an answer -- it fills the caller's typed
    // values, and the direction names are ABAP's, in lower case: the ABAP
    // `EXPORTING` is the module's INPUT, and `importing` / `tables` are what
    // the module gives back (tools/rfc-replay.mjs is the reference
    // implementation). The first version of this file invented
    // `{EXPORTING: {...}}` and its tests passed, because they asked the
    // invention what the invention did. Running it against a real CALL
    // FUNCTION is what said otherwise: the screen rendered, said "off", and
    // showed neither numbers nor an error, because nothing was ever
    // assigned.
    // The parameter name is matched WITHOUT CASE, because the case it
    // arrives in is the runtime's business and not the contract's. Asking
    // for `IV_COMMAND` exactly gave `undefined` on every call, which fell
    // back to SUMMARY -- so the screen rendered, said "off", showed no
    // error, and every button did the same thing. A lookup that misses
    // returns a default, and a default is indistinguishable from an answer.
    const given = (param) => {
      const box = signature?.exporting ?? signature?.EXPORTING ?? {};
      const key = Object.keys(box).find((k) => k.toLowerCase() === param.toLowerCase());
      const value = key === undefined ? undefined : box[key];
      return value === undefined ? undefined : (typeof value?.get === "function" ? value.get() : value);
    };
    const command = String(given("IV_COMMAND") ?? "SUMMARY").trim().toUpperCase();
    const limit = Number(given("IV_LIMIT") ?? 200) || 200;

    const answer = this.#answer(command, limit);
    for (const direction of ["importing", "tables", "changing"]) {
      for (const [param, value] of Object.entries(signature?.[direction] ?? {})) {
        const out = answer[param.toUpperCase()] ?? answer[param];
        if (out !== undefined) fromJson(value, out);
      }
    }
    return undefined;
  }

  /** one flat object keyed by parameter name, which is what the caller's
   *  signature is walked against */
  #answer(command, limit) {
    switch (command) {
      case "START": return this.#state(this.ring.start());
      case "STOP": return this.#state(this.ring.stop());
      case "CLEAR": return this.#state(this.ring.clear());
      case "LIST": return this.#list(limit);
      case "SUMMARY": return this.#summary();
      default:
        // named, not ignored: a command nobody implemented that answers the
        // summary anyway is a screen showing the wrong panel in silence
        return {...this.#state(this.ring.read({limit: 0})), EV_ERROR: `unknown trace command ${command}`};
    }
  }

  /** the scalars every answer carries: what the ring is doing, and how much
   *  of what it was asked about it still has */
  #state(read, extra = {}) {
    return {
      EV_ON: read.on === true ? "X" : "",
      EV_HELD: String(read.held ?? 0),
      EV_DROPPED: String(read.dropped ?? 0),
      EV_MS: "0",
      EV_ERROR: "",
      ET_STATEMENT: [],
      ...extra,
    };
  }

  /** the statements, one row per ZOSD_SQLTRACE_S, canonical so two reads of
   *  one screen agree */
  #list(limit) {
    const read = this.ring.read({limit});
    const answer = this.#state(read);
    answer.ET_STATEMENT = read.entries.map((e) => ({
      SEQ: e.n ?? 0,
      OPERATION: String(e.op ?? ""),
      TABNAME: String(e.table ?? ""),
      MS: String(e.ms ?? 0),
      ROWCOUNT: Number(e.rows ?? 0),
      STATEMENT: canonical(e.sql ?? "").text,
    }));
    return answer;
  }

  /**
   * The analysis, in the same row shape as the list.
   *
   * One structure rather than two, and it is not laziness: a summary row and
   * a statement row answer the same columns -- what, where, how long, how
   * many -- and a second structure would be a second thing to keep in step
   * with the first. `SEQ` carries the repeat count, which is the only column
   * that means something different, and the screen says so in its heading.
   */
  #summary() {
    const report = this.ring.summary();
    const answer = this.#state({on: report.on, held: report.held, dropped: report.dropped});
    answer.EV_MS = String(report.ms ?? 0);
    answer.ET_STATEMENT = [
      ...report.tables.map((t) => ({
        SEQ: t.count, OPERATION: "table", TABNAME: String(t.table ?? ""),
        MS: String(Math.round(t.ms)), ROWCOUNT: Number(t.rows ?? 0), STATEMENT: "",
      })),
      ...report.repeated.map((r) => ({
        SEQ: r.count, OPERATION: "repeated", TABNAME: String(r.table ?? ""),
        MS: String(Math.round(r.ms)), ROWCOUNT: 0, STATEMENT: String(r.shape ?? ""),
      })),
      ...report.slowest.map((one) => ({
        SEQ: 1, OPERATION: "slowest", TABNAME: String(one.table ?? ""),
        MS: String(one.ms ?? 0), ROWCOUNT: 0, STATEMENT: String(one.sql ?? ""),
      })),
    ];
    return answer;
  }
}
