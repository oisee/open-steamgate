// A destination runs where its resource lives. The parent owns the source
// store; the serving child owns its database and compiled class graph.
import {AsyncLocalStorage} from "node:async_hooks";
import {fill, givenText} from "./osd-destination.mjs";
import {toJson} from "./rfc-replay.mjs";
import {currentStepToken, onEveryStep} from "./osd-dialog-step.mjs";

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
    this.repositorySessions = new Map();
    this.unhookRepository = undefined;
    this.receive = (message) => {
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
    };
    channel.on("message", this.receive);
    channel.on("disconnect", this.disconnected);
    this.unhook = onEveryStep({onEnd: (token, {dumped}) => {
      if (token.storeIPC !== undefined && channel.connected) channel.send({type: "store-step-ended", step: token.storeIPC, ok: !dumped});
    }});
  }
  close() {
    this.channel.off("message", this.receive);
    this.channel.off("disconnect", this.disconnected);
    this.unhook();
    this.unhookRepository?.();
    this.disconnected();
  }
  request(parameters, name = "ZOSD_STORE", repositoryUser, repositorySession) {
    if (!this.channel.connected) return Promise.reject(new Error("STORE needs the parent process channel"));
    const id = ++this.seq;
    const contextID = calls.getStore();
    const token = currentStepToken();
    if (token !== undefined) token.storeIPC ??= ++this.steps;
    return new Promise((resolve, reject) => {
      const command = String(parameters.IV_COMMAND ?? "").toUpperCase();
      const long = command === "CREATE" || command === "DELETE" || command === "ACTIVATE" || (command === "SYSTEM" && String(parameters.IV_TYPE).toUpperCase() === "BUILD");
      const timer = long ? undefined : setTimeout(() => {
        this.pending.delete(id);
        if (name === "OSD_SESSION_CALLBACK" && this.channel.connected) {
          this.channel.send({type: "store-context-ended", context: contextID});
        }
        reject(new Error("STORE IPC request timed out"));
      }, 120000);
      this.pending.set(id, {resolve, reject, timer});
      if (repositorySession !== undefined) this.repositorySessions.set(id, repositorySession);
      this.channel.send({type: "store-request", id, context: contextID, step: token?.storeIPC, name, parameters, repositoryUser}, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
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
    if (command === "CREATE" || command === "DELETE") {
      const {storeCrud} = await import("./osd-store-crud.mjs");
      const {onRepositorySessionEnd, repositorySessionKey, repositoryCaller} = await import("./osd-enq-host.mjs");
      if (!this.unhookRepository) this.unhookRepository = onRepositorySessionEnd(key => {
        for (const [id, session] of this.repositorySessions) if (session === key && this.channel.connected) {
          this.channel.send({type: "store-mutation-cancel", id});
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
  const failDeferred = reason => {
    for (const work of deferred.values()) for (const item of work) {
      item.continuation.fail?.(reason);
      item.resolve({EV_ACTIVE: "", EV_NOTE: reason, type: item.type, name: item.name});
    }
    deferred.clear();
  };
  child.on("disconnect", () => { activeMutations.clear(); failDeferred("activation child disconnected"); });
  child.on("exit", () => activeMutations.clear());
  const receive = async (message) => {
    if (message?.type === "store-mutation-cancel") { activeMutations.delete(message.id); return; }
    if (message?.type === "store-context-ended") {
      runtime.adtContexts?.delete(message.context);
      return;
    }
    if (message?.type === "store-step-ended") {
      const work = deferred.get(message.step) ?? [];
      deferred.delete(message.step);
      for (const {continuation, resolve, type, name} of work) {
        try { if (!message.ok) continuation.fail?.("activation step dumped"); resolve(message.ok ? await continuation() : {EV_ACTIVE: "", EV_NOTE: "activation step dumped", type, name}); }
        catch (error) { resolve({EV_ACTIVE: "", EV_NOTE: String(error.message ?? error), type, name}); }
      }
      return;
    }
    if (message?.type !== "store-request") return;
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
            repositoryUser: message.repositoryUser,
            repositoryGuard: mutation ? () => child.connected && activeMutations.has(message.id) : undefined,
            deferActivate: message.step === undefined ? undefined : (continuation) => {
              if (!child.connected) throw new Error("activation child disconnected before scheduling");
              const list = deferred.get(message.step) ?? [];
              let resolve;
              const promise = new Promise(r => { resolve = r; });
              list.push({continuation, resolve, type: message.parameters.IV_TYPE, name: message.parameters.IV_NAME});
              if (context) (context.publications ??= []).push(promise);
              deferred.set(message.step, list);
            }});
      }
      if (child.connected) child.send({type: "store-response", id: message.id, values});
    } catch (error) {
      if (child.connected) child.send({type: "store-response", id: message.id, error: String(error.message ?? error)});
    } finally {activeMutations.delete(message.id);}
  };
  child.on("message", receive);
  child.once("exit", () => {
    failDeferred("activation child exited");
    child.off("message", receive);
  });
}
