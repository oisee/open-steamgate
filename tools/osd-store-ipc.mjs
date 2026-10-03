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
    this.receive = (message) => {
      if (message?.type !== "store-response") return;
      const waiting = this.pending.get(message.id);
      if (waiting === undefined) return;
      this.pending.delete(message.id);
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
    this.disconnected();
  }
  request(parameters, name = "ZOSD_STORE") {
    if (!this.channel.connected) return Promise.reject(new Error("STORE needs the parent process channel"));
    const id = ++this.seq;
    const token = currentStepToken();
    if (token !== undefined) token.storeIPC ??= ++this.steps;
    return new Promise((resolve, reject) => {
      const command = String(parameters.IV_COMMAND ?? "").toUpperCase();
      const long = command === "ACTIVATE" || (command === "SYSTEM" && String(parameters.IV_TYPE).toUpperCase() === "BUILD");
      const timer = long ? undefined : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("STORE IPC request timed out"));
      }, 120000);
      this.pending.set(id, {resolve, reject, timer});
      this.channel.send({type: "store-request", id, context: calls.getStore(), step: token?.storeIPC, name, parameters}, (error) => {
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
    fill(signature, await this.request(parameters, name));
  }
}

// Installed per supervisor, never process-global. Request contexts allow
// test façades with separate stores/identities to use one serving runtime.
export function attachStoreIPC(child, runtime) {
  const deferred = new Map();
  const receive = async (message) => {
    if (message?.type === "store-step-ended") {
      const work = deferred.get(message.step) ?? [];
      deferred.delete(message.step);
      for (const {continuation, resolve, type, name} of work) {
        try { resolve(message.ok ? await continuation() : {EV_ACTIVE: "", EV_NOTE: "activation step dumped", type, name}); }
        catch (error) { resolve({EV_ACTIVE: "", EV_NOTE: String(error.message ?? error), type, name}); }
      }
      return;
    }
    if (message?.type !== "store-request") return;
    try {
      const context = runtime.adtContexts?.get(message.context);
      let values;
      if (message.name === "OSD_SESSION_CALLBACK") {
        if (context?.callback === undefined) throw new Error("session callback context ended");
        values = await context.callback(message.parameters);
      } else {
        const {StoreDestination, withSystem} = await import("./osd-store-destination.mjs");
        const destination = runtime.storeDestination ?? new StoreDestination({reason: "no parent store installed"});
        values = await withSystem(context?.system ?? runtime.systemAnswers ?? (() => undefined),
          () => destination.execute(message.parameters), {store: context?.store, oneRuntime: true,
            deferActivate: message.step === undefined ? undefined : (continuation) => {
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
    }
  };
  child.on("message", receive);
  child.once("exit", () => {
    for (const work of deferred.values()) for (const item of work) {
      item.resolve({EV_ACTIVE: "", EV_NOTE: "activation child exited", type: item.type, name: item.name});
    }
    deferred.clear();
    child.off("message", receive);
  });
}
