// node --import: the start.mjs redirect, and the probe that notes which
// requests each test sent to the server under test (fetch and node:http).
import {register} from "node:module";
import http from "node:http";

register(new URL("./hooks.mjs", import.meta.url).href);

const PORT = String(process.env.STG_PORT ?? 3030);
const probe = globalThis.__parity = {current: undefined, requests: []};
const ours = (url) => {
  try {
    const u = new URL(url);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.port || "80") === PORT;
  } catch { return false; }
};
const note = (entry) => { if (probe.current) probe.current.requests.push(entry); };

const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (!ours(url)) return realFetch(input, init);
  const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
  const path = new URL(url).pathname + new URL(url).search;
  const entry = {method, path, status: 0};
  note(entry);
  try {
    const res = await realFetch(input, init);
    entry.status = res.status;
    if (res.status >= 400) {
      try { entry.body = (await res.clone().text()).slice(0, 600); } catch {}
    }
    return res;
  } catch (e) {
    entry.error = String(e?.cause?.code ?? e?.message ?? e);
    throw e;
  }
};

for (const name of ["request", "get"]) {
  const real = http[name];
  http[name] = function (...args) {
    const a = args[0];
    let url;
    if (typeof a === "string" || a instanceof URL) url = String(a);
    else if (a && typeof a === "object") url = `http://${a.hostname ?? a.host ?? "localhost"}:${a.port ?? 80}${a.path ?? "/"}`;
    if (url && ours(url)) {
      const entry = {method: String(a?.method ?? args[1]?.method ?? "GET").toUpperCase(), path: new URL(url).pathname + new URL(url).search, status: 0, via: "http"};
      note(entry);
      const req = real.apply(this, args);
      req.on("response", (res) => { entry.status = res.statusCode; });
      req.on("error", (e) => { entry.error = String(e?.code ?? e?.message); });
      return req;
    }
    return real.apply(this, args);
  };
}
