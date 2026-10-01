// Proxy caller: a CALL FUNCTION without DESTINATION whose function module is
// not transpiled here is forwarded to a destination, recorded, and replayed
// later without the system. Opt-in (STG_RFC_PROXY in test/setup.mjs).
//
// The transpiler emits, for static and dynamic calls alike,
//
//   if (abap.FunctionModules[NAME] === undefined) { throw ILLEGAL_FUNC }
//   await abap.FunctionModules[NAME]({exporting, importing, tables, changing})
//
// and abap.FunctionModules is a plain field read each time. So a Proxy over
// that object is enough: a defined name comes back untouched, an undefined
// name that the allow list names comes back as a forwarder, anything else
// stays undefined and dumps as before. The forwarder hands the call to the
// client tools/rfc-replay.mjs builds for the destination (live, record or
// replay), so there is one client and one capture format.
//
// Differences from `CALL FUNCTION ... DESTINATION` that the forwarder bridges:
// the call carries no EXCEPTIONS map (the caller catches a classic error whose
// name it switches on), so the client gets `raise(key)`, which throws one.
//
// Not proxied, because a remote call cannot carry them: authority checks,
// COMMIT WORK (the remote LUW is the remote system's), ABAP memory, enqueue.
import {ORIGINAL_FUNCTION_MODULES, clientFor, loadDestinations, localClient} from "./rfc-replay.mjs";

const JOURNAL = Symbol.for("osd.rfc.proxyJournal");

/** `NAME` exact or `PREFIX*`, case-insensitive, as a predicate */
export function allowMatcher(allow) {
  const entries = (Array.isArray(allow) ? allow : String(allow ?? "").split(","))
    .map((e) => e.trim().toUpperCase()).filter((e) => e !== "");
  const exact = new Set(entries.filter((e) => !e.endsWith("*")));
  const prefixes = entries.filter((e) => e.endsWith("*")).map((e) => e.slice(0, -1));
  return (name) => exact.has(name) || prefixes.some((p) => name.startsWith(p));
}

/** every forwarded call so far, [{name, source, destination}] (a copy) */
export function proxyJournal(abap = globalThis.abap) {
  return [...(abap[JOURNAL] ?? [])];
}

/**
 * @param options.destination destination name (messages, capture header)
 * @param options.allow function names, `PREFIX*` allowed; array or comma list
 * @param options.mode live | record | replay (default: the entry of the
 *   destinations file for that name, else replay)
 * @param options.folder capture folder
 * @param options.connection live/record: see resolveConnection (rfc-live.mjs)
 * @param options.noLive CI: live and record fall back to replay, which fails
 *   with the capture path when there is nothing to replay
 * @param options.clientFactory open-rfc Client factory, for tests
 * @returns {uninstall()} puts the original table back
 */
export async function installFunctionProxy(abap, options = {}) {
  const destination = (options.destination ?? "").toUpperCase();
  if (destination === "") {
    throw new Error("function proxy: a destination is required");
  }
  if (abap[ORIGINAL_FUNCTION_MODULES] !== undefined) {
    throw new Error("function proxy: already installed on this runtime");
  }
  const matches = allowMatcher(options.allow);
  const original = abap.FunctionModules;
  const entry = options.mode !== undefined
    ? {kind: options.mode, capture: options.folder, connection: options.connection}
    : (options.destinations ?? loadDestinations(options.config))[destination] ?? {kind: "replay"};
  if (!["live", "record", "replay", "fallback"].includes(entry.kind)) {
    throw new Error(`function proxy: mode '${entry.kind}' is not live, record or replay`);
  }
  // fallback asks "is it transpiled" of the table the proxy wrapped, which
  // is the table the forwarder is only ever asked about when it is not
  const client = await clientFor(destination, entry, {
    local: localClient(), folder: options.folder, trace: options.trace,
    noLive: options.noLive, clientFactory: options.clientFactory,
  });
  const source = options.noLive === true || entry.kind === "replay" ? "replay"
    : entry.kind === "record" ? "record" : "live";
  const journal = abap[JOURNAL] = [];
  const forwarders = new Map();
  const forwarder = (name) => {
    if (!forwarders.has(name)) {
      forwarders.set(name, async (param) => {
        journal.push({name, source, destination});
        await client.call(name, {
          exporting: param?.exporting, importing: param?.importing,
          tables: param?.tables, changing: param?.changing,
          raise: (key) => {
            throw new abap.ClassicError({classic: key});
          },
        });
      });
    }
    return forwarders.get(name);
  };
  abap[ORIGINAL_FUNCTION_MODULES] = original;
  abap.FunctionModules = new Proxy(original, {
    get: (target, key, receiver) => {
      const value = Reflect.get(target, key, receiver);
      if (value !== undefined || typeof key !== "string") {
        return value;
      }
      const name = key.trimEnd().toUpperCase();
      return matches(name) && target[name] === undefined ? forwarder(name) : undefined;
    },
  });
  return {
    uninstall() {
      abap.FunctionModules = original;
      delete abap[ORIGINAL_FUNCTION_MODULES];
      delete abap[JOURNAL];
    },
  };
}
