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

let held = false;
const waiting = [];
function acquire() {
  if (held === false) {
    held = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  // handed on, not dropped: the next step in line gets it before anything
  // that arrives later
  const next = waiting.shift();
  if (next === undefined) held = false;
  else next();
}

/** the work process, without the commit bracket: for a read of the shared
 *  connection that is not a step of its own (the data preview's SQL door) */
export async function exclusive(work) {
  installWait();
  await acquire();
  try {
    return await work();
  } finally {
    release();
  }
}

export async function dialogStep(work) {
  return exclusive(async () => {
    try {
      const result = await work();
      await connection().commit?.();
      return result;
    } catch (e) {
      await connection().rollback?.();
      throw e;
    }
  });
}

async function commitAll() {
  const connections = globalThis.abap.context.databaseConnections;
  for (const name of Object.keys(connections)) await connections[name].commit?.();
}

/** WAIT inside a step: the runtime's semantics (sy-subrc 0, or 8 when the
 *  condition is still false at the deadline; the condition polled every
 *  500 ms), with the work process given up while it sleeps */
function installWait() {
  const statements = globalThis.abap?.statements;
  if (statements === undefined || statements.wait === undefined || statements.wait.osdStep === true) return;
  const original = statements.wait.bind(statements);
  const wait = async (options) => {
    if (held === false) return original(options);
    const subrc = (value) => globalThis.abap.builtin.sy.get().subrc.set(value);
    const timeout = options.seconds === undefined ? undefined : options.seconds.get() * 1000;
    const deadline = timeout === undefined ? undefined : Date.now() + timeout;
    if (options.cond === undefined) {
      await commitAll();
      release();
      try {
        await new Promise((r) => setTimeout(r, timeout));
      } finally {
        await acquire();
      }
      subrc(0);
      return;
    }
    let interrupted = false;
    try {
      for (;;) {
        if (options.cond() === true) { subrc(0); return; }
        const remaining = deadline === undefined ? 500 : deadline - Date.now();
        if (remaining <= 0) { subrc(8); return; }
        if (interrupted === false) {
          interrupted = true;
          await commitAll();
          release();
        }
        await new Promise((r) => setTimeout(r, Math.min(500, remaining)));
      }
    } finally {
      if (interrupted === true) await acquire();
    }
  };
  wait.osdStep = true;
  statements.wait = wait;
}
