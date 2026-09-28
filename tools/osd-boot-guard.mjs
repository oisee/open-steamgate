// A serving child asked to go while it is still booting.
//
// Anywhere in the boot but one, there is nothing to drain: it goes at once,
// which is what made a stop during a long boot (minutes on a remote HANA)
// cost milliseconds rather than the whole boot (tools/osd-runtime.mjs).
//
// The one place is the database step (test/setup.mjs via initializeABAP):
// HANA commits a schema's CREATEs on their own and its seed INSERTs not, so
// a child ended there leaves tables that a later boot takes for seeded and
// serves empty. A stop that arrives there waits for the step to finish,
// then goes. SIGTERM, SIGINT (a Ctrl-C in the terminal reaches the child
// directly, it shares the process group), SIGHUP and the supervisor's
// "quiesce" message are all the same request. Once serving, the guard lets
// go and the defaults (or the serving quiesce, or the file save's own
// handler) are what they were.
//
// It narrows the window and does not close it: a crash, an OOM or a SIGKILL
// in the middle of the seed still leaves such a schema. The complete answer
// is a completion mark written with the seed, which the file database has
// (its stamp) and HANA does not yet.

const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];

export function bootGuard({proc = process, exit = (code) => process.exit(code)} = {}) {
  let inDatabaseStep = false;
  let exitAfterStep = false;
  let serving = false;
  const go = () => {
    if (serving) return;
    if (inDatabaseStep) {
      exitAfterStep = true;
      return;
    }
    exit(0);
  };
  const onMessage = (message) => {
    if (message?.type === "quiesce") go();
  };
  for (const signal of SIGNALS) proc.on(signal, go);
  proc.on("message", onMessage);
  return {
    get inDatabaseStep() {
      return inDatabaseStep;
    },
    /** runs the database step; a stop asked meanwhile is honoured after it */
    async databaseStep(step) {
      inDatabaseStep = true;
      try {
        return await step();
      } finally {
        inDatabaseStep = false;
        if (exitAfterStep) exit(0);
      }
    },
    /** the boot is over: the guard's listeners go */
    serving() {
      serving = true;
      for (const signal of SIGNALS) proc.off(signal, go);
      proc.off("message", onMessage);
    },
  };
}
