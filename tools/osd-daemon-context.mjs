// Which daemon callback is running. Node keeps it per async context; a browser
// (the preview's service worker) has no daemons, and node:async_hooks must not
// reach its bundle, so there the context is always empty.
const hooks = globalThis.process?.versions?.node ? await import(/* webpackIgnore: true */ "node:async_hooks") : null;
export const daemonContext = hooks ? new hooks.AsyncLocalStorage() : {getStore: () => undefined, run: (_store, fn) => fn()};
export const inDaemon = () => daemonContext.getStore() !== undefined;
