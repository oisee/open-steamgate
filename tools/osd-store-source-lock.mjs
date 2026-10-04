// One store source lock for warm/cold compilation and source mutations.
// Reads run to completion over a stable store view. A save arriving during
// compilation is acknowledged only after its queued write has landed.
const locks = new Map();
function lockOf(store) {
  let lock = locks.get(store.root);
  if (!lock) { lock = {root: store.root, busy: false, queue: []}; locks.set(store.root, lock); }
  return lock;
}
function release(lock) {
  const next = lock.queue.shift();
  if (next) next();
  else { lock.busy = false; locks.delete(lock.root); }
}
export function withSourceLock(store, work) {
  const lock = lockOf(store);
  return new Promise((resolve, reject) => {
    const run = () => {
      lock.busy = true;
      Promise.resolve().then(work).then(resolve, reject).finally(() => release(lock));
    };
    if (lock.busy) lock.queue.push(run);
    else run();
  });
}
// Preserve the synchronous store API when idle. During a compile callers
// must await the result, just as the HTTP and ABAP destination adapters do.
export function deferSourceMutation(store, method, args) {
  const lock = locks.get(store.root);
  if (!lock?.busy) return undefined;
  return new Promise((resolve, reject) => {
    lock.queue.push(() => {
      // This mutation owns the turn; nested synchronous store operations
      // are allowed, and another compiler cannot run on this event loop.
      lock.busy = false;
      try { resolve(store[method](...args)); } catch (error) { reject(error); }
      lock.busy = true;
      release(lock);
    });
  });
}
