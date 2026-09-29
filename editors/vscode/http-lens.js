"use strict";

// A deliberately small .http reader. The full case parser lives elsewhere.
const {implementationMethodLine} = require("./lib.js");

function requestBlocks(source) {
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  const starts = [0];
  lines.forEach((line, index) => { if (/^\s*###(?:\s|$)/.test(line)) starts.push(index + 1); });
  return starts.map((start, i) => {
    const end = starts[i + 1] === undefined ? lines.length : starts[i + 1] - 1;
    for (let n = start; n < end; n++) {
      const line = lines[n].trim();
      if (!line || /^(?:#|\/\/|@)/.test(line)) continue;
      const match = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?\s*$/.exec(line);
      return match ? {line: n + 1, method: match[1].toUpperCase(), url: match[2]}
        : {line: n + 1, error: "request line"};
    }
    return undefined;
  }).filter(Boolean);
}

function unresolved(reason, line) { return {line, title: `unresolved: ${reason}`}; }

function servicePathOf(rawUrl) {
  try {
    // .http variables can stand for the host or base URL. They need only be
    // syntactically valid here; the path is what determines the handler.
    const url = new URL(rawUrl.replace(/\{\{[^{}]+\}\}/g, "placeholder"), "http://localhost");
    const match = /(?:^|\/)sap\/opu\/odata\/sap\/([^/]+)\/([^/]*)$/i.exec(url.pathname);
    return match && {service: match[1], tail: match[2], query: url.search.slice(1)};
  } catch {
    return undefined;
  }
}

// rows come from Osd#services, map from Osd#entitySets, and sources are
// keyed by class name. No filesystem, VS Code API or network access here.
function resolveRequest(request, rows, map, sources) {
  const {line, method, url} = request;
  if (request.error) return unresolved(request.error, line);
  if (method !== "GET") return unresolved(`${method} is unsupported`, line);
  const parsed = servicePathOf(url);
  if (!parsed) return unresolved("not a service entity-set URL", line);
  const {service, tail, query} = parsed;
  if (query) return unresolved(/(?:^|&)\$expand=/i.test(query) ? "$expand is unsupported" : "query options are unsupported", line);
  const match = /^([A-Za-z_][\w]*)(?:\(([^()]*)\))?$/.exec(tail);
  if (!match || (tail.includes("(") && !match[2])) return unresolved("unsupported resource path", line);
  const row = (rows ?? []).find((one) => one.kind === "ODATA" &&
    String(one.name ?? /\/sap\/opu\/odata\/sap\/([^/]+)/i.exec(one.path ?? "")?.[1] ?? "").toUpperCase() === service.toUpperCase());
  if (!row?.handler) return unresolved(`unknown service ${service}`, line);
  if (!map || String(map.service).toUpperCase() !== service.toUpperCase() ||
      String(map.class).toUpperCase() !== String(row.handler).toUpperCase()) return unresolved("entity-set map unavailable", line);
  const kind = match[2] === undefined ? "get_entityset" : "get_entity";
  const set = map.sets?.find((one) => one.kind === kind && one.set.toUpperCase() === match[1].toUpperCase());
  if (!set) return unresolved(`unknown entity set or ${kind.toUpperCase()} method`, line);
  const ext = String(row.handler).toUpperCase();
  const base = ext.replace(/_EXT$/, "");
  for (const owner of [...new Set([ext, base])]) {
    const file = sources?.[owner];
    const at = file && implementationMethodLine(file.source, set.method);
    if (at && file.path) return {line, title: `${service} › ${set.set} › ${kind.toUpperCase()} → ${owner.toLowerCase()}:${at} (static) · last: not run`,
      owner, set, path: file.path, methodLine: at};
  }
  return unresolved("owning method source unavailable", line);
}

module.exports = {requestBlocks, resolveRequest, servicePathOf};
