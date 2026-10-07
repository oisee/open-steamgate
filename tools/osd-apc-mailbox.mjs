// A channel owns one conversation, including startup and after-step work.
// The work-process FIFO only fences ABAP execution, not publication after
// its lock is released. All APC hosts use this completion boundary.
export function apcMailbox() {
  let tail = Promise.resolve();
  let closed = false;
  let failed = false;
  let cleanupQueued = false;
  function append(work, closing = false) {
    const result = tail.then(async () => {
      if (failed || (closed && !closing)) return;
      try { return await work(); }
      catch (error) { closed = true; failed = true; throw error; }
    });
    // Keep the queue usable for cleanup while reporting failure to its caller.
    tail = result.catch(() => {});
    return result;
  }
  return {
    enqueue: work => append(work),
    get closed() { return closed; },
    close() { closed = true; },
    closeTurn(work) {
      if (cleanupQueued) return tail;
      cleanupQueued = true;
      closed = true;
      return append(work, true);
    },
  };
}
