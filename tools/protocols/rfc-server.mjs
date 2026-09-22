// SPDX-License-Identifier: MIT
import net from "node:net";
import {timingSafeEqual} from "node:crypto";
import {pathToFileURL} from "node:url";
import {NIFrameDecoder, encodeNIFrame, niControl, NI_PONG} from "./ni.mjs";
import {
  decodeAdtRequest,
  decodeRfcLogon,
  encodeAdtCompactResponse,
  encodeAdtCutResponse,
  encodeAdtHttpResponse,
  parseAdtHttpRequest,
  wrapRfcResponse,
  unscrambleRfcPassword,
} from "./rfc.mjs";
import {encodeAdtBxmlResponse, parseAdtBxmlRequest} from "./bxml.mjs";
import {fieldInfoResponse, functionInterfaceResponse} from "./rfc-metadata.mjs";

const MAX_FRAME = 16 * 1024 * 1024;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const REQUEST_MANAGED = new Set([...HOP_BY_HOP, "authorization", "content-length", "cookie", "host"]);

// Scrubbed structural Eclipse logon response. Runtime conversation and session
// identifiers are overwritten before it is sent; the text slots describe OSD.
const LOGON_ACCEPT = Buffer.from(
  "06cb0200ffff0006000000000001000001000001f4020000000100080000050c00000000000000003030303030303030" +
  "00006d60000000020000029a000000010000000000343130330000000000000001010008010101050401000301010103" +
  "000400000e0b01030106000b040100030103020000002301060161000100016100160008310031003000300000160450" +
  "00064f00530044000450045100144f005300440020004200520049004400470045000451045200043000300004520453" +
  "00146f00730064002d0062007200690064006700650004530007001e3100390032002e0030002e0032002e0031002000" +
  "2000200020002000200000070020005c0000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000002000210014000000000000000000000000000000000000000000210018001431003900" +
  "32002e0030002e0032002e00310020000018000800226f00730064002d006200720069006400670065005f004f005300" +
  "44005f003000300000080011000233000011001300083700390033002000001300120008370035003800200000120006" +
  "00224f00530044005f003000300031005f006200720069006400670065005f0065006e00000601300010530041005000" +
  "4c0053005900530055000130015000184f00530044005500530045005200200020002000200020000150015100063000" +
  "300031000151015200024500015205000000050005030000050305140010000000000000000000000000000000000514" +
  "04200004000000000420051200000512013000505300410050004c005300590053005500200020002000200020002000" +
  "200020002000200020002000200020002000200020002000200020002000200020002000200020002000200020002000" +
  "2000200001300667000800000000007086400667ffff0000ffff",
  "hex",
);
// Proven JCo/ADT profile. It leads JCo to classic metadata calls and compact
// BASXML (0x4000), not Fast Serialization (0x5001). The latter is rejected by
// the request decoder even if a future client attempts to negotiate it.
const ADT_JCO_CAPABILITIES = Buffer.from("0401000301030200000023", "hex");
const CAPABILITY_MARKER = Buffer.from([0x01, 0x06, 0x00, 0x0b]);
const LOGON_CAPABILITIES_AT = LOGON_ACCEPT.indexOf(CAPABILITY_MARKER) + CAPABILITY_MARKER.length;
if (LOGON_CAPABILITIES_AT < CAPABILITY_MARKER.length || LOGON_ACCEPT.indexOf(CAPABILITY_MARKER, LOGON_CAPABILITIES_AT) >= 0) {
  throw new Error("logon template must contain exactly one capability field");
}

let conversationCounter = 0;

function nextConversationID() {
  conversationCounter = (conversationCounter + 1) % 100000000;
  return Buffer.from(String(conversationCounter).padStart(8, "0"), "ascii");
}

function findSessionGuid(frame) {
  const marker = Buffer.from([0x05, 0x14, 0x00, 0x10]);
  const at = frame.indexOf(marker);
  return at >= 0 && at + 20 <= frame.length ? frame.subarray(at + 4, at + 20) : undefined;
}

function utf16Slot(reply, at, width, value) {
  Buffer.from(String(value).slice(0, width).padEnd(width, " "), "utf16le").copy(reply, at);
}

function logonAccept(frame, conversationID, sequence, identity) {
  const reply = Buffer.from(LOGON_ACCEPT);
  ADT_JCO_CAPABILITIES.copy(reply, LOGON_CAPABILITIES_AT);
  conversationID.copy(reply, 40);
  reply[77] = sequence[0];
  reply[79] = sequence[1];
  findSessionGuid(frame)?.copy(reply, 606);
  utf16Slot(reply, 146, 3, identity.systemID);
  utf16Slot(reply, 158, 10, `${identity.systemID} BRIDGE`);
  utf16Slot(reply, 194, 10, identity.host);
  utf16Slot(reply, 406, 17, `${identity.host}_${identity.systemID}_00`);
  utf16Slot(reply, 482, 17, `${identity.systemID}_${identity.client}_${identity.user}_${identity.language}`);
  utf16Slot(reply, 544, 12, identity.user);
  return reply;
}

function sameSecret(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authenticateLogon(frame, auth) {
  const logon = decodeRfcLogon(frame.subarray(80));
  if (auth.mode === "demo") return logon;
  if (auth.mode !== "static") throw new Error(`unsupported RFC auth mode ${auth.mode}`);
  if (logon.ticket || !logon.passwordField) throw new Error("RFC authentication failed");
  const password = unscrambleRfcPassword(logon.passwordField);
  if (!sameSecret(logon.user, auth.user) || !sameSecret(password, auth.password) ||
      (auth.client && !sameSecret(logon.client, auth.client))) throw new Error("RFC authentication failed");
  return logon;
}

function gatewayAccept(frame) {
  if (frame.length !== 64) throw new Error("invalid RFC gateway record");
  const reply = Buffer.from(frame);
  reply[29] = 0x0f;
  reply[55] = 0xfb;
  reply.write("4103", 20, "ascii");
  return reply;
}

function initializeAccept(frame, conversationID) {
  if (frame.length < 80) throw new Error("short F_INITIALIZE");
  const reply = Buffer.from(frame.subarray(0, 80));
  reply[21] = 6;
  conversationID.copy(reply, 40);
  frame.copy(reply, 78, 76, 78);
  return reply;
}

function allocateAccept(frame, sequence) {
  if (frame.length !== 80) throw new Error("invalid F_ALLOCATE");
  const reply = Buffer.from(frame);
  reply[16] = 1;
  reply[21] = 2;
  reply.write("4103", 69, "ascii");
  sequence.copy(reply, 76);
  return reply;
}

function setCookies(headers, jar) {
  const split = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const values = split.length ? split : headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const equals = pair.indexOf("=");
    if (equals > 0) jar.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
}

function csrfTokenOf(headers) {
  const value = headers.get("x-csrf-token") ?? "";
  return value && value.toLowerCase() !== "required" ? value : "";
}

function modifying(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function backendRequestTarget(path, backend, auth) {
  const target = new URL(path, backend);
  if (target.origin !== backend.origin) throw new Error("ADT request escaped configured backend");
  if (auth.client && !target.searchParams.has("sap-client")) target.searchParams.set("sap-client", auth.client);
  if (auth.language && !target.searchParams.has("sap-language")) target.searchParams.set("sap-language", auth.language);
  return target;
}

function admitAdtRequest(request) {
  if (!/^[A-Z]{1,16}$/.test(request.method) || !request.url.startsWith("/") || request.url.startsWith("//") ||
      (request.version && request.version !== "HTTP/1.1") || request.body.length > 8 * 1024 * 1024) throw new Error("invalid tunneled HTTP request");
  for (const [name, value] of request.headers) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error("invalid tunneled HTTP header");
  }
  return request;
}

function applyBackendAuth(headers, auth) {
  if (auth.user) headers.set("authorization", `Basic ${Buffer.from(`${auth.user}:${auth.password ?? ""}`).toString("base64")}`);
}

async function fetchCsrfToken(backend, auth, session, timeoutMs) {
  const target = backendRequestTarget("/sap/bc/adt/core/discovery", backend, auth);
  for (const method of ["HEAD", "GET"]) {
    const headers = new Headers({accept: "*/*", "x-csrf-token": "fetch"});
    applyBackendAuth(headers, auth);
    if (session.jar.size) headers.set("cookie", [...session.jar].map(([name, value]) => `${name}=${value}`).join("; "));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, {method, headers, redirect: "manual", signal: controller.signal});
      setCookies(response.headers, session.jar);
      await readBoundedBody(response);
      const token = csrfTokenOf(response.headers);
      if (token) return token;
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
}

function responseHeaders(headers) {
  const rows = [];
  const split = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const cookies = split.length ? split : headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  for (const value of cookies) rows.push(["Set-Cookie", value]);
  for (const [name, value] of headers) {
    if (name.toLowerCase() === "set-cookie" || HOP_BY_HOP.has(name.toLowerCase())) continue;
    rows.push([name, value]);
  }
  return rows;
}

async function forwardAdt(backend, auth, request, session, timeoutMs) {
  const target = backendRequestTarget(request.url, backend, auth);
  const send = async () => {
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (!REQUEST_MANAGED.has(name.toLowerCase()) && !(modifying(request.method) && name.toLowerCase() === "x-csrf-token")) headers.append(name, value);
    }
    applyBackendAuth(headers, auth);
    if (modifying(request.method)) {
      if (!session.csrfToken) session.csrfToken = await fetchCsrfToken(backend, auth, session, timeoutMs);
      if (session.csrfToken) headers.set("x-csrf-token", session.csrfToken);
    }
    // The CSRF probe may have established the backend session, so cookies are
    // attached after it rather than from a stale pre-probe view of the jar.
    if (session.jar.size) headers.set("cookie", [...session.jar].map(([name, value]) => `${name}=${value}`).join("; "));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: request.body.length && !["GET", "HEAD"].includes(request.method) ? request.body : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
      setCookies(response.headers, session.jar);
      const replacement = csrfTokenOf(response.headers);
      if (replacement) session.csrfToken = replacement;
      return response;
    } finally {
      clearTimeout(timer);
    }
  };
  let response = await send();
  if (modifying(request.method) && response.status === 403 && response.headers.get("x-csrf-token")?.toLowerCase() === "required") {
    await readBoundedBody(response);
    session.csrfToken = "";
    response = await send();
  }
  const body = await readBoundedBody(response);
  return {status: response.status, reason: response.statusText, headers: responseHeaders(response.headers), body};
}

async function readBoundedBody(response) {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > 8 * 1024 * 1024) throw new Error("ADT response exceeds bridge limit");
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > 8 * 1024 * 1024) throw new Error("ADT response exceeds bridge limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function writeFrame(socket, frame) {
  if (!socket.destroyed) socket.write(encodeNIFrame(frame));
}

export function createRfcAdtServer({backend, backendUser = "", backendPassword = "", backendClient = "", backendLanguage = "", rfcAuthMode = "demo", rfcUser = "", rfcPassword = "", rfcClient = "", systemID = "OSD", systemHost = "osd-bridge", host = "0.0.0.0", port, timeoutMs = 120000, maxConnections = 64, log = () => {}}) {
  const backendURL = new URL(backend);
  if (!/^https?:$/.test(backendURL.protocol) || backendURL.username || backendURL.password) throw new Error("backend must be an HTTP(S) origin without embedded credentials");
  if (!["demo", "static"].includes(rfcAuthMode)) throw new Error("RFC auth mode must be demo or static");
  if (rfcAuthMode === "static" && (!rfcUser || !rfcPassword)) throw new Error("static RFC auth requires STG_RFC_USER and STG_RFC_PASSWORD");
  if (backendPassword && !backendUser) throw new Error("backend password requires STG_ADT_USER");
  const backendAuth = {user: backendUser, password: backendPassword, client: backendClient, language: backendLanguage};
  const rfcAuth = {mode: rfcAuthMode, user: rfcUser, password: rfcPassword, client: rfcClient};
  const server = net.createServer((socket) => {
    const decoder = new NIFrameDecoder({maxPayloadLength: MAX_FRAME});
    const session = {jar: new Map(), csrfToken: ""};
    let phase = "gateway";
    let conversationID;
    let sequence;
    let chain = Promise.resolve();
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("RFC connection timed out")));
    const handle = async (frame) => {
      if (niControl(frame) === "NI_PING") return writeFrame(socket, NI_PONG);
      if (phase === "gateway") {
        writeFrame(socket, gatewayAccept(frame));
        phase = "initialize";
        return;
      }
      if (frame.length < 2 || frame[0] !== 0x06) throw new Error("unsupported APPC record");
      if (phase === "initialize" && frame[1] === 0x01) {
        conversationID = nextConversationID();
        sequence = Buffer.from(frame.subarray(76, 78));
        writeFrame(socket, initializeAccept(frame, conversationID));
        phase = "allocate";
        return;
      }
      if (phase === "allocate" && frame[1] === 0x0f) return; // F_SET_PARTNER_LU_NAME is one-way.
      if (phase === "allocate" && frame[1] === 0x05) {
        writeFrame(socket, allocateAccept(frame, sequence));
        phase = "logon";
        return;
      }
      if (frame[1] !== 0xcb || frame.length <= 80) throw new Error("unsupported APPC conversation step");
      if (phase === "logon") {
        const caller = authenticateLogon(frame, rfcAuth);
        const identity = {
          systemID,
          host: systemHost,
          user: caller.user,
          client: caller.client,
          language: caller.language,
        };
        writeFrame(socket, logonAccept(frame, conversationID, sequence, identity));
        phase = "calls";
        return;
      }
      const call = decodeAdtRequest(frame.subarray(80));
      if (call.functionName === "RFC_GET_FUNCTION_INTERFACE") {
        writeFrame(socket, wrapRfcResponse(functionInterfaceResponse(call), frame.subarray(0, 80)));
        log({function: call.functionName, status: "ok"});
        return;
      }
      if (call.functionName === "DDIF_FIELDINFO_GET") {
        writeFrame(socket, wrapRfcResponse(fieldInfoResponse(call), frame.subarray(0, 80)));
        log({function: call.functionName, status: "ok"});
        return;
      }
      if (call.functionName !== "SADT_REST_RFC_ENDPOINT") throw new Error(`unsupported RFC function ${call.functionName}`);
      const request = admitAdtRequest(call.compact ? parseAdtBxmlRequest(call.compact) : parseAdtHttpRequest(call.xml));
      const response = await forwardAdt(backendURL, backendAuth, request, session, timeoutMs);
      const cut = call.compact
        ? encodeAdtCompactResponse(encodeAdtBxmlResponse(response), findSessionGuid(frame))
        : encodeAdtCutResponse(encodeAdtHttpResponse(response));
      writeFrame(socket, wrapRfcResponse(cut, frame.subarray(0, 80)));
      log({function: call.functionName, method: request.method, path: request.url, status: response.status});
    };
    socket.on("data", (chunk) => {
      try {
        for (const frame of decoder.push(chunk)) chain = chain.then(() => handle(frame));
        chain.catch((error) => socket.destroy(error));
      } catch (error) {
        socket.destroy(error);
      }
    });
    socket.on("end", () => {
      try { decoder.finish(); } catch (error) { socket.destroy(error); }
    });
    socket.on("error", (error) => log({error: error.message}));
  });
  server.maxConnections = maxConnections;
  return {server, listen: () => new Promise((resolve, reject) => server.once("error", reject).listen(port, host, resolve))};
}

async function main() {
  const instance = process.env.INSTANCE ?? "00";
  if (!/^[0-9]{2}$/.test(instance)) throw new Error("INSTANCE must be two digits");
  const port = Number(process.env.STG_RFC_PORT ?? `33${instance}`);
  const backend = process.env.STG_ADT_BACKEND ?? "http://127.0.0.1:3030";
  const bridge = createRfcAdtServer({
    backend,
    backendUser: process.env.STG_ADT_USER,
    backendPassword: process.env.STG_ADT_PASSWORD,
    backendClient: process.env.STG_ADT_CLIENT,
    backendLanguage: process.env.STG_ADT_LANGUAGE,
    rfcAuthMode: process.env.STG_RFC_AUTH_MODE ?? "demo",
    rfcUser: process.env.STG_RFC_USER,
    rfcPassword: process.env.STG_RFC_PASSWORD,
    rfcClient: process.env.STG_RFC_CLIENT,
    systemID: process.env.STG_SYSTEM_ID ?? process.env.OSD_SID ?? "OSD",
    systemHost: process.env.STG_HOST_NAME ?? "osd-bridge",
    port,
    log: (event) => console.error(JSON.stringify(event)),
  });
  await bridge.listen();
  console.error(`RFC-to-ADT listening on ${port} -> ${backend}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error); process.exitCode = 1; });
