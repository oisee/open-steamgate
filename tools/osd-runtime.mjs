// The supervisor: what makes activated code actually run.
//
// A transpiled class becomes live only in a process that has not imported
// the old one, because Node pins a module graph for the life of a process
// and cache-busting one entry does not unpin the imports below it. So the
// serving runtime is a child (tools/osd-serve.mjs) and this replaces it.
//
// The order is deliberate and it is not the zero-downtime one. The old
// runtime is asked to go first, and only then does the new one start,
// because both of them would otherwise hold the same database file and the
// second to write would win. Correctness over a few hundred milliseconds:
// a recycle costs about a second, and the façade holds requests across it
// rather than failing them, which is what whenReady() is for.
//
// What this deliberately does not do: recycle on a write. Only a transpile
// that succeeded changes what a process would load, so only that is worth
// a new process.
//
// Every instance is (a source tree, a port, a database) and nothing here
// assumes there is one of them. Two of these can run side by side over two
// worktrees, which is what a branch under test would be.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const CHILD = fileURLToPath(new URL("./osd-serve.mjs", import.meta.url));

export class ServingRuntime {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.command = options.command ?? [process.execPath, CHILD];
    // a fixed port for an instance someone has to reach by name; the
    // default is whatever the system gives, because a supervised runtime is
    // reached through the supervisor
    this.port = undefined;
    this.wanted = options.port;
    // where this instance's rows live. Two instances must not share one
    // file, and two runtimes of the same instance must not hold it at once,
    // which is why a recycle stops the old one first.
    this.database = options.database;
    this.env = options.env ?? {};
    this.timeout = options.timeout ?? 60000;
    this.grace = options.grace ?? 2000;
    this.generation = 0;
    this.child = undefined;
    this.ready = undefined;
    this.recycling = undefined;
    // what the last unexpected death said, for a caller that wants to
    // report why nothing is serving rather than only that nothing is
    this.died = undefined;
  }

  // the address the façade proxies to; undefined until something is serving
  get url() {
    return this.port === undefined ? undefined : `http://127.0.0.1:${this.port}`;
  }

  get running() {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null;
  }

  // a promise that is resolved while a runtime is serving, pending while one
  // is being replaced, and rejected when there is none: the façade awaits
  // this before it forwards, so a request that arrives mid-recycle waits a
  // second instead of failing, and one that arrives after a crash is told
  // rather than sent to a port nothing is listening on
  whenReady() {
    return this.ready ?? Promise.reject(new NotServing());
  }

  async start() {
    if (this.running === true) {
      return {url: this.url, generation: this.generation, started: false};
    }
    return this.#spawn();
  }

  // what a proxy wants when it does not care why nothing is serving: a
  // runtime, now. It waits out a recycle, starts one after a crash, and is
  // idempotent while one is up. The crash is not hidden, because the
  // generation it answers with is a new one.
  async ensure() {
    if (this.recycling !== undefined) {
      await this.recycling.catch(() => undefined);
    }
    if (this.running === true) {
      return this.whenReady();
    }
    return this.#spawn();
  }

  // the old one goes, the new one comes up, and the caller learns when the
  // code it activated is the code that answers
  async recycle() {
    if (this.recycling !== undefined) {
      return this.recycling;
    }
    this.recycling = (async () => {
      const began = Date.now();
      let pending;
      this.ready = new Promise((resolve, reject) => {
        pending = {resolve, reject};
      });
      // nobody is waiting on this promise yet if the façade is idle, and an
      // unhandled rejection would take the process down with it
      this.ready.catch(() => undefined);
      try {
        await this.#stopChild();
        const answer = await this.#spawn({announce: pending});
        return {...answer, ms: Date.now() - began, recycled: true};
      } catch (error) {
        // whoever is waiting hears why; the next caller hears "nothing is
        // serving", because a stale error that never clears is a worse
        // answer than the plain truth
        pending.reject(error);
        this.ready = undefined;
        throw error;
      } finally {
        this.recycling = undefined;
      }
    })();
    return this.recycling;
  }

  async stop() {
    await this.#stopChild();
    this.ready = undefined;
    this.port = undefined;
  }

  #spawn(options = {}) {
    return new Promise((resolve, reject) => {
      const generation = this.generation + 1;
      const child = spawn(this.command[0], this.command.slice(1), {
        cwd: this.root,
        env: {
          ...process.env,
          // the tree, the port and the database are this instance's, and the
          // child is told rather than assuming
          OSD_ROOT: this.root,
          ...(this.wanted === undefined ? {} : {OSD_SERVE_PORT: String(this.wanted)}),
          ...(this.database === undefined ? {} : {STG_DB_PATH: this.database}),
          ...this.env,
          OSD_GENERATION: String(generation),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let out = "";
      child.stdout.on("data", (d) => {
        out += d.toString();
      });
      child.stderr.on("data", (d) => {
        out += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new NotServing(`the serving runtime did not answer within ${this.timeout} ms: ${out.slice(-2000)}`));
      }, this.timeout);

      child.once("message", (message) => {
        if (message?.type !== "ready") {
          return;
        }
        clearTimeout(timer);
        this.died = undefined;
        this.child = child;
        this.port = message.port;
        this.generation = generation;
        const answer = {url: this.url, port: this.port, generation, pid: message.pid, ms: message.ms, started: true};
        this.ready = Promise.resolve(answer);
        options.announce?.resolve(answer);
        resolve(answer);
      });

      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        // a recycle and a stop clear this.child before the exit arrives, so
        // reaching here with it still set means the runtime died on its own.
        // Then the readiness goes too: it described a process that is gone,
        // and handing that address to a proxy is a success report for work
        // that is not happening.
        if (this.child === child) {
          this.child = undefined;
          this.port = undefined;
          if (this.recycling === undefined) {
            this.ready = undefined;
            this.died = {generation, code, signal, at: Date.now(), output: out.slice(-2000)};
          }
        }
        // an exit before "ready" is a runtime that could not come up, and
        // the output is the only explanation anyone will get
        reject(new NotServing(`the serving runtime exited (${signal ?? code}) before it answered: ${out.slice(-2000)}`));
      });
    });
  }

  // ask, then insist. A runtime that will not go away holds the database
  // file the next one needs.
  #stopChild() {
    const child = this.child;
    this.child = undefined;
    this.port = undefined;
    if (child === undefined || child.exitCode !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, this.grace + 8000);
      child.once("exit", done);
      try {
        child.send({type: "quiesce", grace: this.grace});
      } catch {
        // the channel is already gone; SIGTERM still lets the database save
        child.kill("SIGTERM");
      }
    });
  }
}

export class NotServing extends Error {
  constructor(message = "no serving runtime is up") {
    super(message);
    this.code = "NOT_SERVING";
  }
}

async function main(args) {
  const runtime = new ServingRuntime();
  const first = await runtime.start();
  console.log(`serving generation ${first.generation} on ${first.url} after ${first.ms} ms`);
  if (args.includes("--recycle")) {
    const again = await runtime.recycle();
    console.log(`recycled to generation ${again.generation} on ${again.url} in ${again.ms} ms`);
  }
  if (args.includes("--stay") === false) {
    await runtime.stop();
    console.log("stopped");
  }
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  });
}
