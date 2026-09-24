// More than one work process (backlog B.12).
//
// A serving runtime is one process with one JavaScript thread, so every
// session's ABAP runs on one core. Measured on a sixteen-core machine: the
// demo's PRELOAD pulling frames on four sockets at once left fifteen cores
// idle, and the total throughput was the same as on one socket — four
// throats, one work process.
//
// This is the dispatcher's half of the answer, and it is SAP's: a pool of
// dialog work processes, with a session pinned to one of them for as long
// as it lasts. Nothing in the ABAP changes and nothing in a page changes;
// there is simply somewhere else for the next session to go.
//
// What is pinned and what is not:
//
//   a push channel  one socket, one runtime, for the life of the socket —
//                   the handler holds state (the demo it loaded), so the
//                   session cannot wander
//   HTTP            the primary, as before. OData and ICF are stateless per
//                   request in principle, but the store, the SEGW tables
//                   and a dialog step's LUW are not things to spread over
//                   processes without deciding what a session is first
//
// The children share one database file, which SQLite in WAL mode allows:
// readers do not block, writers serialise. They are started one after the
// other so that the first seeds the file and the rest open it, rather than
// three of them racing to create the same base image.
import {ServingRuntime} from "./osd-runtime.mjs";

export class RuntimePool {
  constructor(options = {}) {
    const size = Math.max(1, Number(options.size ?? process.env.OSD_WORKERS ?? 1));
    this.runtimes = Array.from({length: size}, () => new ServingRuntime(options));
    this.at = 0;
  }

  get size() {
    return this.runtimes.length;
  }

  /** the one HTTP goes to; everything that was single-process still is */
  get primary() {
    return this.runtimes[0];
  }

  // Everything that used one runtime goes on using one: the pool answers
  // for the primary, because HTTP is not spread over the work processes
  // until there is a decision about what a session is (backlog B.12).
  get url() {
    return this.primary.url;
  }

  get port() {
    return this.primary.port;
  }

  get running() {
    return this.primary.running;
  }

  get generation() {
    return this.primary.generation;
  }

  get epoch() {
    return this.primary.epoch;
  }

  get died() {
    return this.primary.died;
  }

  whenReady() {
    return this.primary.whenReady();
  }

  /** the next work process a session should be pinned to */
  next() {
    const runtime = this.runtimes[this.at % this.runtimes.length];
    this.at = this.at + 1;
    return runtime;
  }

  /** one after the other: the first makes the database, the rest open it */
  async start() {
    const started = [];
    for (const runtime of this.runtimes) {
      started.push(await runtime.start());
    }
    return started;
  }

  async ensure() {
    return this.primary.ensure();
  }

  // One work process after the other. A stop that arrives in the middle
  // leaves some already recycled and some not; the stop then takes them all
  // (each runtime's stop wins over its own recycle), so nothing half-done
  // keeps serving, and the half-done recycle is harmless (review of #60)
  async recycle() {
    const done = [];
    for (const runtime of this.runtimes) {
      done.push(await runtime.recycle());
    }
    return done[0];
  }

  async stop() {
    await Promise.all(this.runtimes.map((r) => r.stop()));
  }

  /** what a caller reports: the primary's answer, and how many there are */
  describe() {
    return {workers: this.size, ports: this.runtimes.map((r) => r.port).filter((p) => p !== undefined)};
  }
}
