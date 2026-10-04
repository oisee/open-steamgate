// Synthetic CUT client for exercising the RFC bridge through its real socket.
import {connect} from "node:net";
import {encodeNIFrame, NIFrameDecoder} from "../../tools/protocols/ni.mjs";
import {encodeRfcFieldChain, decodeRfcFieldChain, encodeUtf16le} from "../../tools/protocols/rfc.mjs";

const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function appc(fn, length = 80) {
  const frame = Buffer.alloc(length);
  frame[0] = 6; frame[1] = fn; frame.writeUInt16BE(8, 26);
  frame[30] = 5; frame[31] = 0x0c; frame.write("00000001", 40, "ascii");
  return frame;
}
function data(payload) {
  const frame = appc(0xcb); frame.writeUInt16BE(7, 4);
  return Buffer.concat([frame, payload]);
}
function logon() {
  const prefix = Buffer.from("d9c6c3f0f0f0f0f0f0f0f0f0010100080301", "hex");
  const chain = encodeRfcFieldChain(0x0101, [
    {tag: 0x0101}, {tag: 0x0103, value: Buffer.from("00000e09", "hex")},
    {tag: 0x0106, value: Buffer.from("04010003000a0200000023", "hex")}, {tag: 0x0337},
    {tag: 0x0514, value: Buffer.alloc(16,7)}, {tag: 0x0114, value: Buffer.from("001")},
    {tag: 0x0111, value: Buffer.from("DEVELOPER")},
    {tag: 0x0117, value: Buffer.from("150000008981dc9b914e", "hex")},
    {tag: 0x0115, value: Buffer.from("E")}, {tag: 0x0501, value: Buffer.from([1])},
    {tag: 0x0007, value: Buffer.from("127.0.0.1")}, {tag: 0x0018, value: Buffer.from("::1")},
    {tag: 0x0011, value: Buffer.from("E")}, {tag: 0x0012, value: Buffer.from("754")},
    {tag: 0x0013, value: Buffer.from("754")}, {tag: 0x0008, value: Buffer.from("test-host")},
    {tag: 0x0006, value: Buffer.from("TEST")}, {tag: 0x0130, value: Buffer.from("TEST")},
    {tag: 0x0502}, {tag: 0x000b, value: Buffer.from("754")},
    {tag: 0x0102, value: Buffer.from("RFCPING")}, {tag: 0xffff},
  ]);
  const trailer = Buffer.alloc(10); trailer.writeUInt16BE(0xffff, 0);
  trailer.writeUInt16BE(prefix.length + chain.length + 2, 4); trailer.writeUInt32BE(0x8500, 6);
  return Buffer.concat([prefix, chain, trailer]);
}
function request(method, path, body = "", headers = {}) {
  const fields = Object.entries({Accept: "*/*", ...headers}).map(([k,v]) =>
    `<item><NAME>${xml(k)}</NAME><VALUE>${xml(v)}</VALUE></item>`).join("");
  const doc = `<REQUEST><REQUEST_LINE><METHOD>${method}</METHOD><URI>${xml(path)}</URI><VERSION>HTTP/1.1</VERSION></REQUEST_LINE><HEADER_FIELDS>${fields}</HEADER_FIELDS><MESSAGE_BODY>${Buffer.from(body).toString("base64")}</MESSAGE_BODY></REQUEST>`;
  const chain = encodeRfcFieldChain(0x0502, [
    {tag: 0x000b, value: Buffer.from([0,6,0x37,0,0x35,0])},
    {tag: 0x0102, value: encodeUtf16le("SADT_REST_RFC_ENDPOINT")}, {tag: 0x0512},
    {tag: 0x0205, value: encodeUtf16le("RESPONSE")}, {tag: 0x3c02},
    {tag: 0x3c05, value: Buffer.from(doc)}, {tag: 0x3c02}, {tag: 0xffff},
  ]);
  const trailer = Buffer.alloc(10); trailer.writeUInt16BE(0xffff, 0);
  trailer.writeUInt16BE(chain.length + 6, 4); trailer.writeUInt16BE(0x8500, 8);
  return Buffer.concat([Buffer.from([5,2,0,0]), chain, trailer]);
}

export async function connectAdt(port) {
  const socket = connect(port, "127.0.0.1"), decoder = new NIFrameDecoder();
  const queued = [], waiting = [];
  const fail = (error) => {for (const w of waiting.splice(0)) w.reject(error);};
  socket.on("error", fail).on("close", () => fail(new Error("RFC connection closed")));
  socket.on("data", (chunk) => {
    try {for (const frame of decoder.push(chunk)) {
      if (waiting.length) waiting.shift().resolve(frame); else queued.push(frame);
    }} catch (error) {fail(error); socket.destroy();}
  });
  const receive = () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve,reject) => {
    const timer = setTimeout(() => {socket.destroy(); reject(new Error("RFC response timed out"));}, 10000);
    waiting.push({resolve: (v) => {clearTimeout(timer); resolve(v);}, reject: (e) => {clearTimeout(timer); reject(e);}});
  });
  await new Promise((resolve,reject) => socket.once("connect",resolve).once("error",reject));
  const init = appc(0x01,453); init.writeUInt16BE(3,76);
  for (const frame of [Buffer.alloc(64),init,appc(0x0f,224),appc(0x05),data(logon())]) socket.write(encodeNIFrame(frame));
  for (let i=0;i<4;i++) await receive();
  return {close: () => socket.destroy(), async call(method,path,body,headers) {
    socket.write(encodeNIFrame(data(request(method,path,body,headers))));
    const frame = await receive(), chain = decodeRfcFieldChain(frame.subarray(84),0x0500);
    const doc = Buffer.concat(chain.fields.filter((f) => f.tag === 0x3c05).map((f) => f.value)).toString();
    const status = Number(/<STATUS_CODE>(\d+)<\/STATUS_CODE>/.exec(doc)?.[1]);
    const text = Buffer.from(/<MESSAGE_BODY>([^<]*)<\/MESSAGE_BODY>/.exec(doc)?.[1] ?? "","base64").toString();
    return {status, body:text, handle:/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(text)?.[1]};
  }};
}
