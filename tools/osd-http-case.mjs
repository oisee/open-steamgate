// Deliberately bounded, pure .http syntax. The returned request is ready for fetch.
const keys = new Set(["id", "kind", "clock", "uuid", "golden"]);
const variable = /\{\{([A-Za-z_][\w.-]*)\}\}/g;
const hasTemplate = /\{\{|\}\}/;
const fail = (line, why) => { throw new Error(".http line " + line + ": " + why); };

export function parseHttpCases(source, initial = {}) {
  if (typeof source !== "string") throw new TypeError(".http source must be text");
  const vars = {...initial};
  const ids = new Set();
  const cases = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let pending = {uuid: []};
  let name;
  let state = "before";
  let request;
  let bodyStarted = false;
  const expand = (value, line) => {
    const result = value.replace(variable, (_, key) => {
      if (!Object.hasOwn(vars, key)) fail(line, "unresolved variable " + key);
      return String(vars[key]);
    });
    if (hasTemplate.test(result)) fail(line, "invalid or unresolved variable");
    return result;
  };
  const finish = (line) => {
    if (state === "before") {
      if (name || Object.keys(pending).length > 1 || pending.uuid.length) fail(line, "annotations without a request");
      return;
    }
    request.body = expand(request.body, line);
    request.id = pending.id ?? name;
    if (!request.id) fail(line, "case id or name required");
    if (ids.has(request.id)) fail(line, "duplicate case id " + request.id);
    ids.add(request.id);
    request.annotations = {...pending, uuid: [...pending.uuid]};
    cases.push(request);
    pending = {uuid: []};
    name = undefined;
    request = undefined;
    state = "before";
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (/^###(?:\s.*)?$/.test(raw)) { finish(line); continue; }
    if (state === "body") {
      request.body += (bodyStarted ? "\n" : "") + raw;
      bodyStarted = true;
      continue;
    }
    if (state === "headers") {
      if (raw.trim() === "") { state = "body"; continue; }
      const header = /^([!#$%&'*+.^_~\w-]+):\s*(.*)$/.exec(raw);
      if (!header) fail(line, "expected header or blank line");
      const headerName = header[1].toLowerCase();
      if (Object.hasOwn(request.headers, headerName)) fail(line, "duplicate header " + headerName);
      request.headers[headerName] = expand(header[2], line);
      continue;
    }
    if (raw.trim() === "") continue;
    if (/^\s*(?:#|\/\/)/.test(raw)) {
      const annotation = /^\s*(?:#|\/\/)\s*@osd\.([\w.-]+)(?:\s+(.*))?$/.exec(raw);
      if (annotation) {
        const key = annotation[1];
        if (!keys.has(key)) fail(line, "unknown @osd." + key);
        const value = annotation[2]?.trim();
        if (!value) fail(line, "missing @osd." + key + " value");
        if (key === "uuid") pending.uuid.push(value);
        else if (Object.hasOwn(pending, key)) fail(line, "duplicate @osd." + key);
        else pending[key] = value;
        continue;
      }
      if (/^\s*(?:#|\/\/)\s*@osd\./.test(raw)) fail(line, "malformed @osd annotation");
      const named = /^\s*(?:#|\/\/)\s*@name\s+(\S+)\s*$/.exec(raw);
      if (named) { if (name) fail(line, "duplicate @name"); name = named[1]; continue; }
      if (/^\s*(?:#|\/\/)\s*@/.test(raw)) fail(line, "unsupported annotation");
      continue;
    }
    const assign = /^@([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(raw);
    if (assign) {
      vars[assign[1]] = expand(assign[2], line);
      continue;
    }
    const method = /^([A-Z]+)\s+(\S+)(?:\s+HTTP\/1\.1)?$/.exec(raw);
    if (!method) fail(line, "unsupported syntax");
    request = {method: method[1], url: expand(method[2], line), headers: {}, body: ""};
    bodyStarted = false;
    state = "headers";
  }
  finish(lines.length);
  if (!cases.length) fail(lines.length, "no requests");
  return cases;
}
