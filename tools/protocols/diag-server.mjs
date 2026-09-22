// MIT-licensed capture-free DIAG tape stub for open-steamgate.

import {createServer} from "node:net";
import {fileURLToPath} from "node:url";
import {
  buildDiagTapeScreen, DIAG_DP_HEADER_LENGTH, DIAG_HEADER_LENGTH, DIAG_ITEM, encodeDiagMessage, parseDiagItems,
} from "./diag.mjs";
import {encodeNIFrame, NIFrameDecoder, NI_PONG, niControl} from "./ni.mjs";
import {decompressSAP} from "./sap-compress.mjs";

const DEFAULT_DIAG_MAX_PAYLOAD = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_HOLD_MS = 12_000;
const DEFAULT_MAX_CONNECTIONS = 64;

function parseClientMessage(payload, first) {
  const headerOffset = first ? DIAG_DP_HEADER_LENGTH : 0;
  if (payload.length < headerOffset + DIAG_HEADER_LENGTH) {
    throw new Error(`short DIAG client message: ${payload.length} bytes`);
  }
  if (first) {
    if (!payload.subarray(0, 4).equals(Buffer.from([0xff, 0xff, 0xff, 0xff]))) {
      throw new Error("DIAG hello has no dispatcher route prefix");
    }
    if ((payload[headerOffset + 1] & 0x10) === 0) throw new Error("DIAG hello has no INI flag");
    if (payload[headerOffset + 7] !== 0) throw new Error("compressed DIAG hello is unsupported");
  }
  const compression = payload[headerOffset + 7];
  const encodedBody = payload.subarray(headerOffset + DIAG_HEADER_LENGTH);
  const body = compression === 0 ? encodedBody : decompressSAP(encodedBody);
  const items = parseDiagItems(body);
  if (first && items.length === 0) throw new Error("DIAG hello has no items");
  return {header: payload.subarray(headerOffset, headerOffset + DIAG_HEADER_LENGTH), items};
}

function isExit(items) {
  return items.some((item) => {
    if (item.type !== DIAG_ITEM.APPL || item.id !== 0x0c || item.sid !== 0x04) return false;
    return ["/I", "/NEX", "/NEND", "/N/EX"].includes(item.value.toString("latin1").trim().toUpperCase());
  });
}

export function createDiagTapeServer({
  logger = () => {}, maxPayloadLength = DEFAULT_DIAG_MAX_PAYLOAD,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, holdMs = DEFAULT_HOLD_MS,
  maxConnections = DEFAULT_MAX_CONNECTIONS, screenPayload = buildDiagTapeScreen(),
} = {}) {
  if (!ArrayBuffer.isView(screenPayload)) throw new TypeError("DIAG screen payload must be a Buffer or Uint8Array");
  const screen = encodeNIFrame(screenPayload);
  const sessionEnd = encodeNIFrame(encodeDiagMessage({comFlag: 0x0a, msgInfo: 0x01}, []));
  const server = createServer((socket) => {
    const peer = `${socket.remoteAddress ?? "peer"}:${socket.remotePort ?? "?"}`;
    const decoder = new NIFrameDecoder({maxPayloadLength});
    let first = true;
    let holdTimer;
    logger("connect", peer);
    socket.setTimeout(idleTimeoutMs, () => {
      logger("idle-timeout", peer);
      socket.destroy();
    });
    const write = (data) => {
      if (!socket.write(data)) {
        socket.pause();
        socket.once("drain", () => socket.resume());
      }
    };
    const armHold = () => {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => socket.end(sessionEnd), holdMs);
      holdTimer.unref();
    };
    socket.on("data", (chunk) => {
      try {
        for (const payload of decoder.push(chunk)) {
          const control = niControl(payload);
          if (control === "NI_PING") {
            write(encodeNIFrame(NI_PONG));
            continue;
          }
          if (control === "NI_PONG") continue;
          const message = parseClientMessage(payload, first);
          first = false;
          if (isExit(message.items)) {
            clearTimeout(holdTimer);
            socket.end(sessionEnd);
            continue;
          }
          write(screen);
          armHold();
        }
      } catch (error) {
        logger("protocol-error", peer, error);
        socket.destroy(error);
      }
    });
    socket.on("end", () => {
      try {
        decoder.finish();
      } catch (error) {
        logger("protocol-error", peer, error);
      }
    });
    socket.on("error", (error) => logger("socket-error", peer, error));
    socket.on("close", () => {
      clearTimeout(holdTimer);
      logger("close", peer);
    });
  });
  server.maxConnections = maxConnections;
  return server;
}

export async function listenDiagTape({port, host = "0.0.0.0", logger} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`DIAG port must be an integer from 0 to 65535, got ${port}`);
  }
  const server = createDiagTapeServer({logger});
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

function instancePort(value) {
  if (!/^\d{2}$/.test(value)) throw new Error(`INSTANCE must be two digits, got ${JSON.stringify(value)}`);
  return 3200 + Number(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = process.env.DIAG_PORT ? Number(process.env.DIAG_PORT) : instancePort(process.env.INSTANCE ?? "00");
  const host = process.env.DIAG_HOST ?? "0.0.0.0";
  const server = await listenDiagTape({port, host, logger: (event, peer, error) => {
    if (error) console.error(`diag ${event} ${peer}:`, error.message);
  }});
  console.log(`OSD JS DIAG tape stub listening on ${host}:${server.address().port}`);
}
