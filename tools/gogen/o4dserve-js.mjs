// The ZO4D demo channel answered by the JS emitted from the IR (built by
// o4dserve.mjs), everything else proxied to an OSG server. The host is the
// APC framework's part: a handler per socket, ON_START, each message,
// ON_CLOSE, and the three lines of ON_MESSAGE (see cmd/o4dserve/main.go).
//
//   node tools/gogen/o4dserve-js.mjs --listen 3093 --upstream http://127.0.0.1:3091
import {createHash} from "node:crypto";
import http from "node:http";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const listen = Number(arg("--listen", "3093"));
const upstream = new URL(arg("--upstream", "http://127.0.0.1:3091"));
const m = await import(pathToFileURL(join(here, ".out", "o4dserve", "demo.mjs")).href);
const CHANNEL = /^\/sap\/bc\/apc\/sap\/zo4d_demo\/?(\?|$)/;

// a WebSocket server, the part of RFC 6455 a page talking text needs
function frame(text) {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
}
function reader(onText, onClose) {
  let buf = Buffer.alloc(0);
  let parts = [];
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + len);
      if (op === 8) { onClose(); return; }
      if (op === 9 || op === 10) continue;
      parts.push(payload);
      if (fin) { onText(Buffer.concat(parts).toString("utf8")); parts = []; }
    }
  };
}

let connections = 0;
function channel(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const s = {sy: {index: 0, tabix: 0, subrc: 0}};
  const mm = {
    IF_APC_WSP_MESSAGE_MANAGER__CREATE_MESSAGE: () => {
      const msg = {text: ""};
      msg.IF_APC_WSP_MESSAGE__GET_TEXT = () => msg.text;
      msg.IF_APC_WSP_MESSAGE__SET_TEXT = (_s, v) => { msg.text = v; };
      msg.IF_APC_WSP_MESSAGE__GET_BINARY = () => msg.text;
      msg.IF_APC_WSP_MESSAGE__SET_BINARY = (_s, v) => { msg.text = v; };
      msg.IF_APC_WSP_MESSAGE__GET_MESSAGE_TYPE = () => 1;
      return msg;
    },
    IF_APC_WSP_MESSAGE_MANAGER__SEND: (_s, msg) => { if (!socket.destroyed) socket.write(frame(msg.IF_APC_WSP_MESSAGE__GET_TEXT(s))); },
    IF_APC_WSP_MESSAGE_MANAGER__SET_SEND_MODE: () => {},
  };
  const cx = {id: String(++connections)};
  for (const k of ["IF_APC_WSP_SERVER_CONTEXT", "IF_APC_WSP_SERVER_CONTEXT_BASE"]) {
    cx[`${k}__GET_CONNECTION_ID`] = () => cx.id;
    cx[`${k}__GET_INITIAL_REQUEST`] = () => null;
    cx[`${k}__GET_BINDING_MANAGER`] = () => null;
  }
  const h = m.ZCL_O4D_APC_HANDLER.$new(s);
  const step = (name, f) => { try { f(); } catch (e) { console.error(`dump in ${name}: ${e.message ?? e}`); } };
  step("ON_START", () => h.IF_APC_WSP_EXTENSION__ON_START(s, cx, mm));
  let closed = false;
  const close = () => { if (closed) return; closed = true; step("ON_CLOSE", () => h.IF_APC_WSP_EXTENSION__ON_CLOSE(s, "", 1000, cx)); socket.end(); };
  socket.on("data", reader((text) => step("ON_MESSAGE", () => {
    if (text.startsWith("{")) { h.HANDLE_JSON_CMD(s, mm, text); return; }
    if (text === "start") h.mv_running = "X";
    else if (text === "stop") h.mv_running = "";
    else if (text === "frame" && h.mv_running === "X") { h.SEND_FRAME(s, mm, h.mv_frame_num / h.mo_demo.GET_FPS(s)); h.mv_frame_num += 1; }
    else if (text === "reset") { h.mv_frame_num = 0; h.mv_last_effect = ""; h.mv_effect_start_bar = 0; }
    else if (text === "scenario") h.SEND_SCENARIO(s, mm);
  }), close));
  socket.on("close", close);
  socket.on("error", close);
}

const server = http.createServer((req, res) => {
  const p = http.request({host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: {...req.headers, host: upstream.host}},
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
server.on("upgrade", (req, socket) => {
  if (CHANNEL.test(req.url)) channel(req, socket);
  else socket.destroy();
});
server.listen(listen, () => console.log(`ZO4D frames from the IR's JS on :${listen}, the rest from ${upstream.origin}`));
