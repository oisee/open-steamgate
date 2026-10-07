// A destination runs where its resource lives. The parent owns the source
// store; the serving child owns its database and compiled class graph.
import {AsyncLocalStorage} from "node:async_hooks";
import {fill, givenText} from "./osd-destination.mjs";
import {toJson} from "./rfc-replay.mjs";
import {currentStepToken, onEveryStep} from "./osd-dialog-step.mjs";
import {sendIPC, onIPCFailure} from "./osd-ipc.mjs";

import {PARENT_SYSTEM_KINDS, CHILD_SYSTEM_KINDS} from "./osd-system-kinds.mjs";
export {PARENT_SYSTEM_KINDS, CHILD_SYSTEM_KINDS};
const calls = new AsyncLocalStorage();
export const withStoreIPC = (context, work) => calls.run(context, work);

export class StoreIPCClient {
  constructor(channel = process, {localSystem} = {}) {
    this.channel = channel;
    this.localSystem = localSystem;
    this.seq = 0;
    this.steps = 0;
    this.pending = new Map();
    this.finishing = new Map();
    this.repositorySessions = new Map();
    this.unhookRepository = undefined;
    this.receive = (message) => {
      if (message?.type === "store-step-completed") {
        const waiting = this.finishing.get(message.step);
        this.finishing.delete(message.step);
        if (message.error) waiting?.reject(new Error(message.error));
        else waiting?.resolve();
        return;
      }
      if (message?.type !== "store-response") return;
      const waiting = this.pending.get(message.id);
      if (waiting === undefined) return;
      this.pending.delete(message.id);
      this.repositorySessions.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error));
      else waiting.resolve(message.values);
    };
    this.disconnected = () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("STORE process channel disconnected"));
      }
      this.pending.clear();
      this.repositorySessions.clear();
      for (const waiting of this.finishing.values()) waiting.reject(new Error("STORE process channel disconnected"));
      this.finishing.clear();
    };
    channel.on("message", this.receive);
    this.unhookChannel = onIPCFailure(channel, this.disconnected);
    this.unhook = onEveryStep({onEnd: (token, {dumped}) => {
      if (token.storeIPCClient !== this) return;
      if (token.afterStep !== undefined && token.storePublication && token.storeContext === undefined) return;
      if (token.storeIPC !== undefined) sendIPC(channel, {type: "store-step-ended", step: token.storeIPC, ok: !dumped});
    }, afterStep: (token, {dumped}) => {
      // ADT's parent context owns publicationRecord() and must receive the
      // response before a cold publication can replace this child. Other
      // entries (APC, ICF, jobs) await completion here before their next turn.
      if (token.storeIPCClient !== this || !token.storePublication || token.storeContext !== undefined) return;
      return new Promise((resolve, reject) => {
        const step = token.storeIPC;
        this.finishing.set(step, {resolve, reject});
        sendIPC(channel, {type: "store-step-ended", step, ok: !dumped, acknowledge: true}, error => {
          if (!error) return;
          this.finishing.delete(step);
          reject(error);
        });
      });
    }});
  }
  close() {
    this.channel.off("message", this.receive);
    this.unhookChannel();
    this.unhook();
    this.unhookRepository?.();
    this.disconnected();
  }
  request(parameters, name = "ZOSD_STORE", repositoryUser, repositorySession, repositoryActivationError) {
    if (!this.channel.connected) return Promise.reject(new Error("STORE needs the parent process channel"));
    const id = ++this.seq;
    const contextID = calls.getStore();
    const token = currentStepToken();
    if (token !== undefined) {
      token.storeIPC ??= ++this.steps;
      token.storeIPCClient = this;
      token.storeContext = contextID;
    }
    return new Promise((resolve, reject) => {
      const command = String(parameters.IV_COMMAND ?? "").toUpperCase();
      if (token !== undefined && command === "ACTIVATE") token.storePublication = true;
      const long = command === "CREATE" || command === "DELETE" || command === "ACTIVATE" || command === "RUN_TESTS" || (command === "SYSTEM" && String(parameters.IV_TYPE).toUpperCase() === "BUILD");
      const timer = long ? undefined : setTimeout(() => {
        this.pending.delete(id);
        this.repositorySessions.delete(id);
        if (name === "OSD_SESSION_CALLBACK") {
          sendIPC(this.channel, {type: "store-context-ended", context: contextID});
        }
        reject(new Error("STORE IPC request timed out"));
      }, 120000);
      this.pending.set(id, {resolve, reject, timer});
      if (repositorySession !== undefined) this.repositorySessions.set(id, repositorySession);
      sendIPC(this.channel, {type: "store-request", id, context: contextID, step: token?.storeIPC, name, parameters, repositoryUser, repositoryActivationError}, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.repositorySessions.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  async call(name, signature) {
    const command = givenText(signature, "IV_COMMAND", "LIST").toUpperCase();
    const kind = givenText(signature, "IV_TYPE").toUpperCase();
    // Session facts also belong here, and are answered by the request's
    // withSystem binding, installed by the remote front.
    if (command === "SYSTEM" && !PARENT_SYSTEM_KINDS.has(kind)) {
      return this.localSystem.call(name, signature);
    }
    const parameters = Object.fromEntries(Object.entries(signature.exporting ?? signature.EXPORTING ?? {})
      .map(([key, value]) => [key.toUpperCase(), typeof value?.get === "function" ? toJson(value) : value]));
    if (command === "ACTIVATE") {
      const {preflightRepositoryActivation} = await import("./osd-enq-host.mjs");
      let rejection = null;
      try { preflightRepositoryActivation(kind, givenText(signature, "IV_NAME").toUpperCase()); }
      catch (error) { rejection = {code: error.code ?? "INTERNAL", message: error.message}; }
      // Even a refusal reaches the parent journal and returns its op_id.
      // This internal field is never read from IV_JSON or ABAP parameters.
      fill(signature, await this.request(parameters, name, undefined, undefined, rejection));
      return;
    }
    if (command === "CREATE" || command === "DELETE") {
      const {storeCrud} = await import("./osd-store-crud.mjs");
      const {onRepositorySessionEnd, repositorySessionKey, repositoryCaller} = await import("./osd-enq-host.mjs");
      if (!this.unhookRepository) this.unhookRepository = onRepositorySessionEnd(key => {
        for (const [id, session] of this.repositorySessions) if (session === key && this.channel.connected) {
          sendIPC(this.channel, {type: "store-mutation-cancel", id});
        }
      });
      // Guard in the runtime that owns the caller and the repository ENQ
      // context. The source-owning parent receives only the guarded request.
      const forward = async (_type, _name, options) => {
        const values = await this.request(parameters, name,
          options?.author ?? repositoryCaller(), repositorySessionKey());
        fill(signature, values);
        return values;
      };
      try {
        await storeCrud({create: forward, delete: forward}, command, {
          type: kind, name: givenText(signature, "IV_NAME").toUpperCase(),
          json: givenText(signature, "IV_JSON"),
          source: parameters.IV_SOURCE,
        });
      } catch (error) {
        fill(signature, {EV_ERROR: error.message, EV_JSON: JSON.stringify({error: {
          code: error.code ?? "INTERNAL", message: error.message}})});
      }
      return;
    }
    fill(signature, await this.request(parameters, name));
  }
}

// Installed per supervisor, never process-global. Request contexts allow
// test façades with separate stores/identities to use one serving runtime.
export function attachStoreIPC(child, runtime) {
  const deferred = new Map();
  const activeMutations = new Set();
  const contexts = new Map();
  let channelFailed = false;
  const failDeferred = reason => {
    for (const work of deferred.values()) for (const item of work) {
      try { item.continuation.fail?.(reason); }
      catch (error) { console.warn(`STORE activation failure could not be recorded: ${error.message}`); }
      finally { item.resolve({EV_ACTIVE: "", EV_NOTE: reason, type: item.type, name: item.name}); }
    }
    deferred.clear();
  };
  const unhookChannel = onIPCFailure(child, () => {
    channelFailed = true;
    activeMutations.clear();
    for (const id of contexts.keys()) runtime.adtContexts?.delete(id);
    contexts.clear();
    failDeferred("activation child disconnected");
  });
  const replyError = (id, error) => sendIPC(child, {type: "store-response", id, error: String(error.message ?? error)});
  const reply = (id, values) => sendIPC(child, {type: "store-response", id, values}, error => {
    // Serialization can fail while the pipe is healthy (e.g. BigInt in a
    // callback result). The child must receive the error and end its step.
    if (error && !channelFailed) replyError(id, error);
  });
  const receive = async (message) => {
    if (message?.type === "store-mutation-cancel") { activeMutations.delete(message.id); return; }
    if (message?.type === "store-context-ended") {
      runtime.adtContexts?.delete(message.context);
      return;
    }
    if (message?.type === "store-step-ended") {
      const work = deferred.get(message.step) ?? [];
      deferred.delete(message.step);
      try {
        for (const {continuation, resolve, type, name} of work) {
          try {
            if (!message.ok) continuation.fail?.("activation step dumped");
            resolve(message.ok ? await continuation() : {EV_ACTIVE: "", EV_NOTE: "activation step dumped", type, name});
          } catch (error) {
            continuation.fail?.(String(error.message ?? error));
            resolve({EV_ACTIVE: "", EV_NOTE: String(error.message ?? error), type, name});
          }
        }
      } finally {
        if (message.acknowledge) sendIPC(child, {type: "store-step-completed", step: message.step});
      }
      return;
    }
    if (message?.type !== "store-request") return;
    if (channelFailed) return;
    if (message.context !== undefined) contexts.set(message.context, (contexts.get(message.context) ?? 0) + 1);
    const mutation = ["CREATE", "DELETE"].includes(String(message.parameters?.IV_COMMAND ?? "").toUpperCase());
    if (mutation) activeMutations.add(message.id);
    try {
      const context = runtime.adtContexts?.get(message.context);
      let values;
      if (message.name === "OSD_SESSION_CALLBACK") {
        if (context?.callback === undefined) throw new Error("session callback context ended");
        try {
          values = await context.callback(message.parameters);
        } finally {
          if (runtime.adtContexts?.get(message.context) !== context) {
            console.warn("ADT session callback completed after its context ended; uncertain write", message.context);
            throw new Error("session callback context ended during work");
          }
        }
      } else {
        const {StoreDestination, withSystem} = await import("./osd-store-destination.mjs");
        const destination = runtime.storeDestination ?? new StoreDestination({reason: "no parent store installed"});
        values = await withSystem(context?.system ?? runtime.systemAnswers ?? (() => undefined),
          () => destination.execute(message.parameters), {store: context?.store, oneRuntime: true,
            repositoryUser: message.repositoryUser, repositoryActivationError: message.repositoryActivationError,
            repositoryGuard: mutation ? () => !channelFailed && child.connected && activeMutations.has(message.id) : undefined,
            deferActivate: message.step === undefined ? undefined : (continuation) => {
              if (channelFailed || !child.connected) throw new Error("activation child disconnected before scheduling");
              const list = deferred.get(message.step) ?? [];
              let resolve;
              const promise = new Promise(r => { resolve = r; });
              list.push({continuation, resolve, type: message.parameters.IV_TYPE, name: message.parameters.IV_NAME});
              if (context) (context.publications ??= []).push(promise);
              deferred.set(message.step, list);
            }});
      }
      reply(message.id, values);
    } catch (error) {
      replyError(message.id, error);
    } finally {
      activeMutations.delete(message.id);
      const remaining = (contexts.get(message.context) ?? 0) - 1;
      if (remaining > 0) contexts.set(message.context, remaining);
      else contexts.delete(message.context);
    }
  };
  child.on("message", receive);
  child.once("exit", () => {
    failDeferred("activation child exited");
    unhookChannel();
    child.off("message", receive);
  });
}
