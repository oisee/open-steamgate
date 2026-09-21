// GW0's strict reference oracle. It is deliberately pure JavaScript with no
// filesystem, network or destination access, so fixtures and the future ABAP
// kernel can be checked against the same explicit behavior.

const MODES = new Set(["internal", "wire", "replay"]);
const SESSIONS = new Set(["isolated", "reuse"]);
const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "proxy-authorization",
  "x-api-key",
]);
const RESPONSE_SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "proxy-authenticate",
  "proxy-authorization",
  "x-api-key",
]);
const RESPONSE_CAPTURE_HEADERS = new Set([
  "content-type",
  "dataserviceversion",
  "etag",
  "odata-version",
]);
const MASKED = "__OSG_EXPLICITLY_MASKED__";
const HTTP_METHODS = new Set(["GET"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const DESTINATION_NAME = /^[A-Z][A-Z0-9_.-]{0,63}$/u;

const own = (value, key) =>
  value !== null && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, key);

const kindOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const pointerEscape = (value) => String(value).replace(/~/g, "~0").replace(/\//g, "~1");

export function pointerTokens(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new Error("JSON Pointer must be empty or begin with /");
  }
  return pointer.slice(1).split("/").map((token) => {
    if (/~(?![01])/u.test(token)) throw new Error(`invalid JSON Pointer escape in ${pointer}`);
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

export function atPointer(value, pointer) {
  let current = value;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return {found: false};
      const index = Number(token);
      if (index >= current.length) return {found: false};
      current = current[index];
    } else if (own(current, token)) {
      current = current[token];
    } else {
      return {found: false};
    }
  }
  return {found: true, value: current};
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function replaceAtPointer(value, pointer, replacement) {
  const tokens = pointerTokens(pointer);
  if (tokens.length === 0) return replacement;
  let current = value;
  for (const token of tokens.slice(0, -1)) {
    current = Array.isArray(current) ? current[Number(token)] : current[token];
  }
  const last = tokens.at(-1);
  if (Array.isArray(current)) current[Number(last)] = replacement;
  else current[last] = replacement;
  return value;
}

function issue(path, message) {
  return {path, message};
}

function rejectUnknown(errors, value, path, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue(`${path}/${pointerEscape(key)}`, "unsupported field"));
  }
}

export function validateCase(testCase) {
  const errors = [];
  if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) {
    return [issue("", "case must be an object")];
  }
  rejectUnknown(errors, testCase, "", new Set([
    "schemaVersion", "id", "version", "description", "destination",
    "request", "execution", "redaction", "expect",
  ]));
  if (testCase.schemaVersion !== 1) errors.push(issue("/schemaVersion", "only schemaVersion 1 is supported"));
  for (const field of ["id", "version", "description", "destination"]) {
    if (typeof testCase[field] !== "string" || testCase[field].trim() === "") {
      errors.push(issue(`/${field}`, `${field} must be a nonempty string`));
    }
  }
  if (typeof testCase.destination === "string" && !DESTINATION_NAME.test(testCase.destination)) {
    errors.push(issue("/destination", "destination must be an uppercase logical name, not a URL"));
  }
  const request = testCase.request;
  if (!request || typeof request !== "object") {
    errors.push(issue("/request", "request must be an object"));
  } else {
    rejectUnknown(errors, request, "/request", new Set(["method", "path", "headers"]));
    if (!HTTP_METHODS.has(request.method)) {
      errors.push(issue("/request/method", "method is not supported by RegressionCase v1"));
    }
    if (typeof request.path !== "string" || !request.path.startsWith("/")
        || request.path.startsWith("//") || request.path.includes("://")
        || request.path.includes("\\") || request.path.includes("#") || CONTROL.test(request.path)) {
      errors.push(issue("/request/path", "path must be relative and begin with one /"));
    } else {
      const parsed = new URL(request.path, "https://osg.invalid");
      if (parsed.origin !== "https://osg.invalid") {
        errors.push(issue("/request/path", "path must not escape the configured destination origin"));
      }
      if (parsed.search !== "") errors.push(issue("/request/path", "query parameters are not supported by RegressionCase v1"));
    }
    const requestHeaders = request.headers ?? {};
    if (!requestHeaders || typeof requestHeaders !== "object" || Array.isArray(requestHeaders)) {
      errors.push(issue("/request/headers", "request headers must be an object"));
    }
    for (const name of Object.keys(
      requestHeaders && typeof requestHeaders === "object" && !Array.isArray(requestHeaders)
        ? requestHeaders : {},
    )) {
      if (!HEADER_NAME.test(name)) {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "request header name must be an RFC token"));
      }
      if (name.toLowerCase() !== "accept") {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "only the Accept header is supported by RegressionCase v1"));
      }
      if (SECRET_HEADERS.has(name.toLowerCase())) {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "session secret headers cannot be stored in a case"));
      }
      if (typeof request.headers[name] !== "string") {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "request header values must be strings"));
      } else if (CONTROL.test(request.headers[name])) {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "request header values cannot contain controls"));
      } else if (name.toLowerCase() === "accept" && request.headers[name].toLowerCase() !== "application/json") {
        errors.push(issue(`/request/headers/${pointerEscape(name)}`, "GW0 Accept must be application/json"));
      }
    }
  }
  const execution = testCase.execution;
  if (!execution || typeof execution !== "object") {
    errors.push(issue("/execution", "execution must be an object"));
  } else {
    rejectUnknown(errors, execution, "/execution", new Set(["mode", "timeoutMs", "session"]));
    if (!MODES.has(execution.mode)) errors.push(issue("/execution/mode", "unsupported execution mode"));
    if (!SESSIONS.has(execution.session)) errors.push(issue("/execution/session", "session must be isolated or reuse"));
    if (!Number.isInteger(execution.timeoutMs) || execution.timeoutMs < 1 || execution.timeoutMs > 300000) {
      errors.push(issue("/execution/timeoutMs", "timeoutMs must be an integer from 1 through 300000"));
    }
  }
  const expect = testCase.expect;
  if (!expect || typeof expect !== "object") {
    errors.push(issue("/expect", "expect must be an object"));
  } else {
    rejectUnknown(errors, expect, "/expect", new Set(["status", "headers", "body"]));
    if (!Number.isInteger(expect.status) || expect.status < 100 || expect.status > 599) {
      errors.push(issue("/expect/status", "status must be one HTTP status integer"));
    }
    const expectedHeaders = expect.headers ?? {};
    if (!expectedHeaders || typeof expectedHeaders !== "object" || Array.isArray(expectedHeaders)) {
      errors.push(issue("/expect/headers", "expected headers must be an object"));
    }
    for (const [name, rule] of Object.entries(
      expectedHeaders && typeof expectedHeaders === "object" && !Array.isArray(expectedHeaders)
        ? expectedHeaders : {},
    )) {
      if (!HEADER_NAME.test(name)) {
        errors.push(issue(`/expect/headers/${pointerEscape(name)}`, "expected header name must be an RFC token"));
      }
      if (name.toLowerCase() !== "content-type") {
        errors.push(issue(`/expect/headers/${pointerEscape(name)}`, "only Content-Type may be asserted in RegressionCase v1"));
      }
      if (SECRET_HEADERS.has(name.toLowerCase()) || RESPONSE_SECRET_HEADERS.has(name.toLowerCase())) {
        errors.push(issue(`/expect/headers/${pointerEscape(name)}`, "session secret headers cannot be asserted or exported"));
        continue;
      }
      const valid = rule && typeof rule === "object"
          && Object.keys(rule).length === 1
          && typeof rule.mediaType === "string"
          && rule.mediaType.toLowerCase() === "application/json";
      if (!valid) errors.push(issue(`/expect/headers/${pointerEscape(name)}`, "GW0 header rule must be mediaType application/json"));
    }
    const body = expect.body;
    if (!body || body.format !== "json" || !own(body, "value")) {
      errors.push(issue("/expect/body", "GW0 requires a json body with value"));
    } else {
      rejectUnknown(errors, body, "/expect/body", new Set(["format", "value", "masks"]));
      const masks = body.masks ?? [];
      if (!Array.isArray(masks)) {
        errors.push(issue("/expect/body/masks", "masks must be an array"));
      }
      const seen = new Set();
      for (const [index, mask] of (Array.isArray(masks) ? masks : []).entries()) {
        const base = `/expect/body/masks/${index}`;
        if (!mask || typeof mask.path !== "string" || mask.path === "") {
          errors.push(issue(base + "/path", "mask path must be a non-root JSON Pointer"));
          continue;
        }
        rejectUnknown(errors, mask, base, new Set(["path", "reason"]));
        try {
          pointerTokens(mask.path);
        } catch (error) {
          errors.push(issue(base + "/path", error.message));
        }
        if (typeof mask.reason !== "string" || mask.reason.trim() === "") {
          errors.push(issue(base + "/reason", "mask reason is required"));
        }
        if (seen.has(mask.path)) errors.push(issue(base + "/path", "duplicate mask path"));
        if ([...seen].some((path) => path.startsWith(mask.path + "/") || mask.path.startsWith(path + "/"))) {
          errors.push(issue(base + "/path", "overlapping mask paths are not allowed"));
        }
        seen.add(mask.path);
      }
    }
  }
  const redactions = testCase.redaction?.body ?? [];
  if (testCase.redaction !== undefined) {
    if (!testCase.redaction || typeof testCase.redaction !== "object" || Array.isArray(testCase.redaction)) {
      errors.push(issue("/redaction", "redaction must be an object"));
    } else {
      rejectUnknown(errors, testCase.redaction, "/redaction", new Set(["body"]));
    }
  }
  if (!Array.isArray(redactions)) {
    errors.push(issue("/redaction/body", "body redactions must be an array"));
  }
  for (const [index, rule] of (Array.isArray(redactions) ? redactions : []).entries()) {
    const base = `/redaction/body/${index}`;
    if (!rule || typeof rule.path !== "string" || rule.path === "") {
      errors.push(issue(base + "/path", "redaction path must be a non-root JSON Pointer"));
    } else {
      rejectUnknown(errors, rule, base, new Set(["path", "reason"]));
      let validPointer = true;
      try {
        pointerTokens(rule.path);
      } catch (error) {
        validPointer = false;
        errors.push(issue(base + "/path", error.message));
      }
      if (validPointer && testCase.expect?.body?.format === "json"
          && atPointer(testCase.expect.body.value, rule.path).found) {
        errors.push(issue(base + "/path", "literal expected secrets cannot be stored; redaction paths must be response-only"));
      }
    }
    if (!rule || typeof rule.reason !== "string" || rule.reason.trim() === "") {
      errors.push(issue(base + "/reason", "redaction reason is required"));
    }
  }
  return errors;
}

function compareJson(expected, actual, path = "") {
  const expectedKind = kindOf(expected);
  const actualKind = kindOf(actual);
  if (expectedKind !== actualKind) {
    return [{kind: "type-mismatch", path, expected: expectedKind, actual: actualKind}];
  }
  if (expectedKind === "array") {
    const findings = [];
    if (expected.length !== actual.length) {
      findings.push({kind: "length-mismatch", path, expected: expected.length, actual: actual.length});
    }
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
      findings.push(...compareJson(expected[i], actual[i], `${path}/${i}`));
    }
    return findings;
  }
  if (expectedKind === "object") {
    const findings = [];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const child = `${path}/${pointerEscape(key)}`;
      if (!own(expected, key)) {
        findings.push({kind: "unexpected-value", path: child, actual: actual[key]});
      } else if (!own(actual, key)) {
        findings.push({kind: "missing-value", path: child, expected: expected[key]});
      } else {
        findings.push(...compareJson(expected[key], actual[key], child));
      }
    }
    return findings;
  }
  return Object.is(expected, actual)
    ? []
    : [{kind: "value-mismatch", path, expected, actual}];
}

function responseBody(response) {
  const body = response?.body;
  if (body?.format === "json" && own(body, "value")) return body.value;
  throw new Error("response body is not tagged JSON");
}

export function evaluateCase(testCase, response) {
  const invalid = validateCase(testCase);
  if (invalid.length) {
    return {
      outcome: "error",
      findings: invalid.map((entry) => ({kind: "invalid-case", scope: "case", ...entry})),
    };
  }
  const responseErrors = [];
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    responseErrors.push(issue("", "response must be an object"));
  } else {
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      responseErrors.push(issue("/status", "response status must be an HTTP status integer"));
    }
    if (!response.headers || typeof response.headers !== "object" || Array.isArray(response.headers)) {
      responseErrors.push(issue("/headers", "response headers must be an object"));
    } else {
      for (const [name, value] of Object.entries(response.headers)) {
        if (!HEADER_NAME.test(name)) responseErrors.push(issue(`/headers/${pointerEscape(name)}`, "response header name must be an RFC token"));
        if (typeof value !== "string" || CONTROL.test(value)) {
          responseErrors.push(issue(`/headers/${pointerEscape(name)}`, "response header value must be a control-free string"));
        }
      }
    }
  }
  if (responseErrors.length) {
    return {
      outcome: "error",
      findings: responseErrors.map((entry) => ({kind: "invalid-response", scope: "http", ...entry})),
    };
  }
  const findings = [];
  if (response?.status !== testCase.expect.status) {
    findings.push({
      kind: "status-mismatch",
      scope: "http",
      path: "/status",
      expected: testCase.expect.status,
      actual: response?.status,
    });
  }
  const actualHeaders = Object.fromEntries(
    Object.entries(response?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  for (const [name, rule] of Object.entries(testCase.expect.headers ?? {})) {
    const path = `/headers/${pointerEscape(name.toLowerCase())}`;
    const actual = actualHeaders[name.toLowerCase()];
    if (typeof rule === "string" && actual !== rule) {
      findings.push({kind: "header-mismatch", scope: "http", path, expected: rule, actual});
    } else if (rule.mediaType) {
      const mediaType = String(actual ?? "").split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== rule.mediaType.toLowerCase()) {
        findings.push({kind: "header-mismatch", scope: "http", path, expected: rule.mediaType, actual});
      }
    }
  }
  let actualBody;
  try {
    actualBody = responseBody(response);
  } catch (error) {
    return {outcome: "error", findings: [...findings, {
      kind: "invalid-response",
      scope: "body",
      path: "/body",
      message: "response body could not be decoded as JSON",
    }]};
  }
  let expectedBody = cloneJson(testCase.expect.body.value);
  actualBody = cloneJson(actualBody);
  const configuration = [];
  for (const mask of testCase.expect.body.masks ?? []) {
    const expectedAt = atPointer(expectedBody, mask.path);
    const actualAt = atPointer(actualBody, mask.path);
    if (!expectedAt.found || !actualAt.found) {
      configuration.push({
        kind: "invalid-mask",
        scope: "body",
        path: mask.path,
        message: `mask does not resolve in ${!expectedAt.found ? "expected" : "actual"} body`,
      });
      continue;
    }
    expectedBody = replaceAtPointer(expectedBody, mask.path, MASKED);
    actualBody = replaceAtPointer(actualBody, mask.path, MASKED);
  }
  if (configuration.length) return {outcome: "error", findings: [...findings, ...configuration]};
  findings.push(...compareJson(expectedBody, actualBody).map((finding) => ({scope: "body", ...finding})));
  return {outcome: findings.length ? "failed" : "passed", findings};
}

function redactionRules(testCase) {
  const configured = testCase.redaction?.body;
  if (!Array.isArray(configured)) return [];
  return configured.filter((rule) => {
    if (!rule || typeof rule.path !== "string" || rule.path === "") return false;
    try {
      pointerTokens(rule.path);
      return true;
    } catch {
      return false;
    }
  });
}

function persistentResponse(testCase, response, {omitBody = false} = {}) {
  const headers = {};
  for (const [name, value] of Object.entries(response?.headers ?? {})) {
    const lower = name.toLowerCase();
    if (RESPONSE_SECRET_HEADERS.has(lower)) headers[name] = "[redacted]";
    else if (RESPONSE_CAPTURE_HEADERS.has(lower)) headers[name] = value;
  }
  let body;
  if (omitBody) {
    body = {format: "unavailable", value: "[redacted due to invalid case or redaction]"};
  } else try {
    body = cloneJson(responseBody(response));
    for (const rule of redactionRules(testCase)) {
      if (atPointer(body, rule.path).found) {
        body = replaceAtPointer(body, rule.path, "[redacted]");
      }
    }
    body = {format: "json", value: body};
  } catch {
    body = {format: "unavailable", value: "[redacted or invalid]"};
  }
  return {status: response?.status, headers, body};
}

function persistentFindings(testCase, findings) {
  const redactions = redactionRules(testCase);
  return findings.map((finding) => {
    const out = {...finding};
    const header = finding.path?.match(/^\/headers\/([^/]+)$/)?.[1];
    if (finding.scope === "http" && header
        && RESPONSE_SECRET_HEADERS.has(pointerTokens(`/x/${header}`)[1].toLowerCase())) {
      if (own(out, "expected")) out.expected = "[redacted]";
      if (own(out, "actual")) out.actual = "[redacted]";
      return out;
    }
    for (const rule of redactions) {
      if (finding.path === rule.path || finding.path.startsWith(rule.path + "/")) {
        if (own(out, "expected")) out.expected = "[redacted]";
        if (own(out, "actual")) out.actual = "[redacted]";
        continue;
      }
      if (rule.path.startsWith(finding.path + "/")) {
        const suffix = rule.path.slice(finding.path.length);
        for (const field of ["expected", "actual"]) {
          if (!own(out, field) || out[field] === undefined) continue;
          const value = cloneJson(out[field]);
          if (atPointer(value, suffix).found) out[field] = replaceAtPointer(value, suffix, "[redacted]");
        }
      }
    }
    return out;
  });
}

export function syntheticRunResult(testCase, response, {runId = "synthetic", now = new Date()} = {}) {
  const invalid = validateCase(testCase);
  let verdict = evaluateCase(testCase, response);
  let omitBody = invalid.length > 0;
  if (!omitBody) {
    try {
      const actualBody = responseBody(response);
      const stale = redactionRules(testCase).filter((rule) => !atPointer(actualBody, rule.path).found);
      if (stale.length) {
        omitBody = true;
        verdict = {
          outcome: "error",
          findings: stale.map((rule) => ({
            kind: "invalid-redaction",
            scope: "case",
            path: rule.path,
            message: "redaction path does not resolve in response body",
          })),
        };
      }
    } catch {
      // evaluateCase already reports a payload-free invalid-response finding.
    }
  }
  const at = now.toISOString();
  return {
    schemaVersion: 1,
    runId,
    case: {id: testCase?.id ?? null, version: testCase?.version ?? null},
    target: {
      destination: testCase?.destination ?? null,
      requestedMode: testCase?.execution?.mode ?? null,
      actualMode: "replay",
    },
    provenance: {
      evidence: "synthetic",
      sourceRevision: null,
      liveGeneration: null,
      servingGeneration: null,
    },
    startedAt: at,
    finishedAt: at,
    outcome: verdict.outcome,
    response: persistentResponse(testCase ?? {}, response, {omitBody}),
    findings: persistentFindings(testCase ?? {}, verdict.findings),
    traceRefs: [],
  };
}
