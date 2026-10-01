// The end of a dialog step, for every host that runs the ABAP.
//
// An AS ABAP commits the database implicitly when a request's work is done
// and rolls it back when the request ends in an uncaught exception. A DPC
// that inserts without a COMMIT WORK of its own relies on the first half;
// the transactional bracket in ZCL_STG_HTTP_HANDLER relies on the second,
// because an exception nobody declared -- a conversion, a missing line, a
// zero divide -- unwinds straight past its ROLLBACK WORK.
//
// This is the kernel's job and not the application's: on a system such an
// exception is a short dump, and a dump ends the LUW. So the rule lives
// here, in one file, rather than in the ABAP -- and rather than in one host
// out of three, which is how it was until 2026-09-18. tools/osd-serve.mjs
// had it; test/start.mjs's inline front and web/preview-backend.mjs did
// not, so there a request that dumped left its rows pending on the
// connection and the *next* modifying request's fencing COMMIT WORK made
// them permanent. test/mocha.mjs, "a request that dumps leaves nothing
// behind", is that half-write.
//
// **One step at a time** (2026-09-24). Every step shares the one connection
// and so the one LUW, and nothing stopped two steps from overlapping: with
// sql.js every await settles as a microtask and a step ran to its end before
// the next began, but DuckDB, PostgreSQL and HANA answer on a macrotask, and
// so do WAIT, outbound HTTP and live RFC. There a step that dumped rolled
// back the half-written rows of the step beside it, which then committed and
// answered 201 -- a partial write reported as a whole one -- and
// CL_EXPRESS_ICF_SHIM's static server let the two answer each other's
// requests. An AS ABAP gives each step a work process of its own; this
// process has one, so a step waits for it (test/dialog-step.mjs).
//
// WAIT is where a system rolls the session out and frees the work process,
// so a step in a WAIT lets the others run: it commits its own LUW first, as
// the runtime's WAIT does, then releases, and takes the work process back
// when the wait is over. The runtime's own WAIT committed every connection
// whenever it ran, which with overlapping steps was somebody else's LUW too.
//
// Not covered: ABAP that calls this same process over HTTP inside a step
// waits for itself. Nothing in the tree does; a system would serve it from
// another work process.
const connection = () => globalThis.abap.context.databaseConnections.DEFAULT;

// Who holds the work process. On Node (and Bun) an AsyncLocalStorage says
// whether the code asking is inside the step that holds it; the browser
// preview has none, and serialises its HTTP steps itself, so there the lock
// is only the queue.
let steps;
try {
  if (typeof process !== "undefined" && process.versions?.node !== undefined) {
    const {AsyncLocalStorage} = await import(/* webpackIgnore: true */ "node:async_hooks");
    steps = new AsyncLocalStorage();
  }
} catch {
  steps = undefined;
}

let holder;          // the token of the step that has the work process
const waiting = [];  // [token, resolve] in arrival order
let since = 0;       // when the holder got it
function acquire(token) {
  if (holder === undefined) {
    holder = token;
    since = Date.now();
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push([token, resolve]));
}
function release() {
  // handed on, not dropped: the next step in line gets it before anything
  // that arrives later
  const next = waiting.shift();
  if (next === undefined) {
    holder = undefined;
    return;
  }
  holder = next[0];
  since = Date.now();
  next[1]();
}
/** is the code asking the step that holds the work process? Without a
 *  store (the preview) any holder counts, as before */
const mine = () => (steps === undefined ? holder !== undefined : holder !== undefined && steps.getStore() === holder);
let waitPump;
export function registerWaitPump(callback) {
  waitPump = callback;
}

// Host services with pending ABAP definitions may keep data only for the
// current execution. The browser has no AsyncLocalStorage: fail closed there
// rather than treating every request as one caller.
/** the step that holds the work process now: in the browser, where there is
 *  no AsyncLocalStorage, the only way to tell which step is running */
export function holderToken() {
  return holder;
}

export function currentStepToken() {
  const token = steps?.getStore();
  return token !== undefined && token.dialog === true && token.done !== true && token === holder ? token : undefined;
}

// A timer created by ABAP inherits its arming step's AsyncLocalStorage.
// Its expiry is a new event, including when the old step is still running.
export function outsideStepContext(work) {
  return steps === undefined ? work() : steps.exit(work);
}

// Every step's start and end, for the host services that keep state per
// session (tools/osd-enq-host.mjs): onStart(token) when it has the work
// process, onEnd(token, {dumped}) when it gives it back for good. The token
// identifies the step in the browser too, where there is no
// AsyncLocalStorage.
const stepHooks = new Set();
export function onEveryStep(hooks) {
  stepHooks.add(hooks);
  return () => stepHooks.delete(hooks);
}

export function onStepLuwEnd(callback) {
  const token = currentStepToken();
  if (token === undefined) throw new Error("a dialog step is required");
  installLuwEndHooks();
  (token.luwEnd ??= new Set()).add(callback);
  return () => token.luwEnd?.delete(callback);
}

function endLuw(token = currentStepToken()) {
  if (token === undefined) return;
  const callbacks = token.luwEnd;
  token.luwEnd = undefined;
  for (const callback of callbacks ?? []) callback();
}

let luwHookedClient;
function installLuwEndHooks() {
  const client = connection();
  if (client === luwHookedClient) return;
  luwHookedClient = client;
  for (const operation of ["commit", "rollback"]) {
    const original = client[operation];
    if (typeof original !== "function") continue;
    client[operation] = async function (...args) {
      try {
        return await original.apply(this, args);
      } finally {
        endLuw();
      }
    };
  }
}

/** the queue, for a status page and for tests: who waits, and for how long
 *  the work process has been held */
export function workProcess() {
  return {held: holder !== undefined, waiting: waiting.length, heldMs: holder === undefined ? 0 : Date.now() - since};
}

// A step with no end holds everybody else: a query that never answers, an
// RFC or HTTP call with no timeout. It is not cut off -- a system would dump
// it, and a dump here is a rollback of work that may yet finish -- but it is
// said, with how many wait behind it.
const SLOW_MS = Number(globalThis.process?.env?.OSD_STEP_WARN_MS) > 0 ? Number(globalThis.process.env.OSD_STEP_WARN_MS) : 30000;
let warned;
setInterval?.(() => {
  if (holder !== undefined && holder !== warned && Date.now() - since > SLOW_MS) {
    warned = holder;
    console.warn(`osd-dialog-step: one step has held the work process for ${Math.round((Date.now() - since) / 1000)} s; ${waiting.length} waiting (${holder.what ?? "a step"})`);
  }
}, Math.min(SLOW_MS, 5000))?.unref?.();

/** the work process, without the commit bracket: for a read of the shared
 *  connection that is not a step of its own (the data preview's SQL door) */
export async function exclusive(work, what, {dialog = false} = {}) {
  installWait();
  // a step inside a step would wait for itself; said, not hung. A timer the
  // step left behind carries its context past its end, and is no nesting
  const outer = steps?.getStore();
  if (outer !== undefined && outer.done !== true) {
    throw new Error(`a nested dialog step${what === undefined ? "" : ` (${what})`}: the step that would run it holds the work process`);
  }
  const token = {what, dialog};
  await acquire(token);
  try {
    for (const hooks of stepHooks) hooks.onStart?.(token);
    return steps === undefined ? await work() : await steps.run(token, work);
  } finally {
    endLuw(token);
    token.done = true;
    for (const hooks of stepHooks) {
      try { hooks.onEnd?.(token, {dumped: token.dumped === true}); } catch { /* a hook must not hold the work process */ }
    }
    release();
  }
}

/** a connection whose every call waits for the work process: for a reader
 *  that is handed the client itself (the ADT facade's Data) */
export function lockedClient(client, what = "a read of the shared connection") {
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args) => exclusive(() => value.apply(target, args), what);
    },
  });
}

export async function dialogStep(work, what) {
  return exclusive(async () => {
    try {
      const result = await work();
      await connection().commit?.();
      endLuw();
      return result;
    } catch (e) {
      const token = currentStepToken() ?? holder;
      if (token !== undefined) token.dumped = true;
      await connection().rollback?.();
      endLuw();
      throw e;
    }
  }, what, {dialog: true});
}

async function commitAll() {
  const connections = globalThis.abap.context.databaseConnections;
  for (const name of Object.keys(connections)) await connections[name].commit?.();
  endLuw();
}

/** WAIT inside a step: the runtime's semantics (sy-subrc 0, or 8 when the
 *  condition is still false at the deadline; the condition polled every
 *  500 ms), with the work process given up while it sleeps. A WAIT outside
 *  a step -- at startup, in a test -- is the runtime's own. */
function installWait() {
  const statements = globalThis.abap?.statements;
  if (statements === undefined || statements.wait === undefined || statements.wait.osdStep === true) return;
  const original = statements.wait.bind(statements);
  const wait = async (options) => {
    if (!mine()) return original(options);
    const token = holder;
    const subrc = (value) => globalThis.abap.builtin.sy.get().subrc.set(value);
    const timeout = options.seconds === undefined ? undefined : options.seconds.get() * 1000;
    const deadline = timeout === undefined ? undefined : Date.now() + timeout;
    if (options.cond === undefined) {
      // committed while still holding it: a failed commit ends the step
      // here, and the step's own bracket releases
      await commitAll();
      release();
      try {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, Math.min(100, until - Date.now())));
          await waitPump?.(token);
        }
      } finally {
        await acquire(token);
      }
      subrc(0);
      return;
    }
    let released = false;
    try {
      for (;;) {
        if (options.cond() === true) { subrc(0); return; }
        const remaining = deadline === undefined ? 500 : deadline - Date.now();
        if (remaining <= 0) { subrc(8); return; }
        if (released === false) {
          await commitAll();
          release();
          released = true;
        }
        // polled while rolled out, without the work process: a system asks
        // it after the roll-in; here it reads only this step's own memory
        await new Promise((r) => setTimeout(r, Math.min(500, remaining)));
        await waitPump?.(token);
      }
    } finally {
      if (released === true) await acquire(token);
    }
  };
  wait.osdStep = true;
  statements.wait = wait;
}

// **Hooks at the database seam** (docs/ideas.md B17): the one place a
// write or a read by the ABAP can be watched, failed or redirected with
// the ABAP none the wiser, the way a system's kernel sits below it. One
// owner, this module, and every hook visible by name (activeHooks()), so an
// interception is kernel mechanics and not hidden magic.
//
// First consumer: the ABAP Unit runtime guard (tools/osd-unit.mjs), which
// fails a test that declares RISK LEVEL HARMLESS and writes. A hook is
// {write(operation, table)}: called before a write reaches the client, and
// a throw from it is the write's failure. What counts as a write: Open
// SQL's insert/update/delete, and a data statement (INSERT, UPDATE, DELETE,
// MERGE, UPSERT, REPLACE, TRUNCATE) sent through execute, native, write or
// modifying -- the paths SQLScript and AMDP bodies take -- **into a table
// the DDIC knows**. DDL is not a write here, and neither is a table the
// DDIC does not know: a client's own scratch relations (DuckDB's views and
// materialised tables for an AMDP read) are the kernel's, not the test's.
// Only the DEFAULT connection is hooked. Reads are not hooked yet: the
// consumers that need them (a readiness gate, the OSQL test environment)
// add that half.
const hooks = new Map();
let hookedClient;
let unhooked;

// the verb, SQLite's "OR REPLACE"/"OR IGNORE", the INTO/FROM/TABLE word,
// and a name that may be schema-qualified ("SCHEMA"."ZTAB": the last part)
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|TRUNCATE)\b(?:\s+OR\s+\w+)?(?:\s+(?:INTO|FROM|TABLE))?\s+((?:["'`]?[\w/$]+["'`]?\.)*["'`]?[\w/$]+)/i;

/** the table a native SQL statement writes, or undefined for a read */
export function nativeWriteOf(sql) {
  const match = WRITE_SQL.exec(String(sql));
  if (match === null) return undefined;
  const table = match[2].split(".").pop().replace(/["'`]/g, "");
  return {operation: match[1].toUpperCase(), table: table.toUpperCase()};
}

function tableOf(options) {
  const table = options?.table;
  return String(typeof table === "string" ? table : table?.name ?? table ?? "?").replace(/^["'`]|["'`]$/g, "").toUpperCase();
}

function writeSeen(operation, table) {
  const ddic = globalThis.abap?.DDIC;
  if (ddic !== undefined && ddic[table] === undefined) return;
  for (const hook of hooks.values()) hook.write?.(operation, table);
}

const sqlOf = (argument) => (typeof argument === "string" ? argument : argument?.sql);

function installHooks() {
  const client = connection();
  if (client === undefined || hookedClient === client) return;
  removeHooks();
  const originals = {};
  for (const operation of ["insert", "update", "delete"]) {
    if (typeof client[operation] !== "function") continue;
    originals[operation] = client[operation];
    client[operation] = function (options) {
      writeSeen(operation.toUpperCase(), tableOf(options));
      return originals[operation].call(this, options);
    };
  }
  for (const operation of ["execute", "native", "write", "modifying"]) {
    if (typeof client[operation] !== "function") continue;
    originals[operation] = client[operation];
    client[operation] = function (argument, ...rest) {
      for (const one of Array.isArray(argument) ? argument : [argument]) {
        const write = nativeWriteOf(sqlOf(one) ?? "");
        if (write !== undefined) writeSeen(write.operation, write.table);
      }
      return originals[operation].call(this, argument, ...rest);
    };
  }
  hookedClient = client;
  unhooked = () => {
    for (const [operation, original] of Object.entries(originals)) client[operation] = original;
  };
}

function removeHooks() {
  unhooked?.();
  unhooked = undefined;
  hookedClient = undefined;
}

/** Installs a hook under `name` (replacing one of that name) and returns
 *  its removal. The client is patched while any hook is active and
 *  restored when the last one goes. */
export function hookDatabase(name, hook) {
  hooks.set(name, hook);
  installHooks();
  return () => {
    if (hooks.get(name) !== hook) return;
    hooks.delete(name);
    if (hooks.size === 0) removeHooks();
  };
}

/** the names of the hooks active now */
export function activeHooks() {
  return [...hooks.keys()];
}
