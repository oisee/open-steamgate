// A test that edits the tracked tree puts it back in a `finally` or an
// `after`, and neither runs when the run is interrupted: Ctrl-C or a
// SIGTERM ends mocha before either, and the edit stays behind as a change
// nobody made (`src/cds/zc_osd_pack.ddls.asddls` with its label renamed,
// an untracked `src/osd/zcl_osd_scratch.clas.abap`). Found 2026-09-27 by
// two sessions whose own checks saw the tree dirty while a full run was
// going.
//
// `undoOnExit(fn)` keeps `fn` until the returned function is called, and runs
// whatever is still kept when the process exits or is sent SIGINT, SIGTERM
// or SIGHUP, the last registered first. `fn` must be synchronous: nothing
// asynchronous runs during `exit`. After a signal the same signal is raised
// again, so the process still ends the way it was asked to.

const pending = new Map();
let installed = false;

function runPending() {
  const undo = [...pending.values()].reverse();
  pending.clear();
  for (const fn of undo) {
    try {
      fn();
    } catch {
      // one undo that fails must not keep the others from running
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.once("exit", runPending);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      runPending();
      process.kill(process.pid, signal);
    });
  }
}

export function undoOnExit(fn) {
  install();
  const key = Symbol("undo");
  pending.set(key, fn);
  return () => {
    pending.delete(key);
  };
}
