// connected is only a snapshot: send can fail later, after the peer exits.
// Keep one error listener for the channel's lifetime, including late writes
// after callers detach. A send callback handles serialization errors separately
// so a bad reply can still be replaced by an error reply on the same channel.
const channels = new WeakMap();
const brokenPipe = error => ["EPIPE", "ECONNRESET", "ERR_IPC_CHANNEL_CLOSED", "ERR_IPC_DISCONNECTED"].includes(error?.code);
function stateOf(channel) {
  let state = channels.get(channel);
  if (state) return state;
  state = {listeners: new Set(), failure: undefined};
  state.fail = error => {
    if (state.failure) return;
    state.failure = error;
    for (const listener of state.listeners) listener(error);
  };
  channels.set(channel, state);
  channel.on("error", state.fail);
  channel.once("disconnect", () => state.fail(new Error("IPC channel disconnected")));
  channel.once("exit", () => state.fail(new Error("IPC peer exited")));
  return state;
}
export function onIPCFailure(channel, listener) {
  const state = stateOf(channel);
  state.listeners.add(listener);
  if (state.failure) listener(state.failure);
  return () => state.listeners.delete(listener);
}
export function sendIPC(channel, message, callback = () => {}) {
  const state = stateOf(channel);
  if (state.failure || !channel.connected || typeof channel.send !== "function") {
    const error = state.failure ?? Object.assign(new Error("IPC channel disconnected"), {code: "ERR_IPC_CHANNEL_CLOSED"});
    state.fail(error);
    callback(error);
    return false;
  }
  let called = false;
  const done = error => {
    if (called) return;
    called = true;
    if (brokenPipe(error)) state.fail(error);
    callback(error);
  };
  // Test/embedded channels may invoke callbacks synchronously. Run them
  // outside the send try block so caller exceptions are never swallowed.
  let result, thrown, sending = true, synchronous;
  try { result = channel.send(message, error => {
    if (sending) synchronous = {error};
    else done(error);
  }); }
  catch (error) { thrown = error; }
  sending = false;
  if (thrown) done(thrown);
  else if (synchronous) done(synchronous.error);
  return result ?? false;
}
