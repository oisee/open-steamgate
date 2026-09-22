// SPDX-License-Identifier: MIT
// Replays the client side of a private RFC JSONL capture against a server.
// Payloads are never printed: captures may contain credentials and source code.
import {readFile} from "node:fs/promises";
import net from "node:net";
import {pathToFileURL} from "node:url";
import {encodeNIFrame, NIFrameDecoder} from "./ni.mjs";

const MAX_CAPTURE_FRAME = 16 * 1024 * 1024;

function option(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at < 0 ? fallback : argv[at + 1];
}

export async function loadCaptureConnection(path, connection = 1) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean);
  const rows = [];
  for (const [index, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`capture line ${index + 1} is not JSON`); }
    if (row.conn !== connection) continue;
    if (!["C->S", "S->C"].includes(row.dir) || typeof row.hex !== "string" || !/^(?:[0-9a-fA-F]{2})*$/u.test(row.hex)) {
      throw new Error(`capture line ${index + 1} has an invalid frame`);
    }
    const payload = Buffer.from(row.hex, "hex");
    if (payload.length !== row.len || payload.length > MAX_CAPTURE_FRAME) throw new Error(`capture line ${index + 1} has an invalid length`);
    rows.push({dir: row.dir, payload});
  }
  if (!rows.length) throw new Error(`capture has no connection ${connection}`);
  if (rows[0].dir !== "C->S") throw new Error("capture connection does not begin with a client frame");
  return rows;
}

function sameEnvelope(actual, expected) {
  if (actual.length < 2 || expected.length < 2) return actual.length === expected.length;
  if (expected[0] === 0x06) return actual[0] === 0x06 && actual[1] === expected[1];
  return actual.length === expected.length;
}

export async function replayRfcClient({capture, connection = 1, host = "127.0.0.1", port, timeoutMs = 5000}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be in 1..65535");
  const script = await loadCaptureConnection(capture, connection);
  const socket = net.createConnection({host, port});
  const decoder = new NIFrameDecoder({maxPayloadLength: MAX_CAPTURE_FRAME});
  const queued = [];
  const waiting = [];
  const failWaiting = (error) => { while (waiting.length) waiting.shift().reject(error); };
  socket.on("data", (chunk) => {
    try {
      for (const frame of decoder.push(chunk)) {
        if (waiting.length) waiting.shift().resolve(frame);
        else queued.push(frame);
      }
    } catch (error) { failWaiting(error); socket.destroy(); }
  });
  socket.on("error", failWaiting);
  const receive = () => {
    if (queued.length) return Promise.resolve(queued.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for RFC server frame")), timeoutMs);
      waiting.push({resolve: (frame) => { clearTimeout(timer); resolve(frame); }, reject: (error) => { clearTimeout(timer); reject(error); }});
    });
  };
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  let sent = 0;
  let received = 0;
  try {
    for (const step of script) {
      if (step.dir === "C->S") {
        if (!socket.write(encodeNIFrame(step.payload))) await new Promise((resolve) => socket.once("drain", resolve));
        sent++;
      } else {
        const actual = await receive();
        if (!sameEnvelope(actual, step.payload)) throw new Error(`server frame ${received + 1} has a different NI/APPC envelope`);
        received++;
      }
    }
    return {connection, sent, received};
  } finally {
    socket.destroy();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const capture = option(argv, "--capture");
  const port = Number(option(argv, "--port"));
  if (!capture || !port) throw new Error("usage: rfc-replay-client --capture FILE --port PORT [--host HOST] [--connection N]");
  const result = await replayRfcClient({
    capture,
    port,
    host: option(argv, "--host", "127.0.0.1"),
    connection: Number(option(argv, "--connection", "1")),
    timeoutMs: Number(option(argv, "--timeout-ms", "5000")),
  });
  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
