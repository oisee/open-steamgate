// MIT-licensed NI record framing for the built-in OSD protocol listeners.
//
// NI is a byte-stream boundary: four big-endian bytes state the payload size.
// This implementation is written for open-steamgate from that wire contract;
// it does not depend on SAP SDKs or on the former Go sidecar.

export const DEFAULT_NI_MAX_PAYLOAD = 256 * 1024 * 1024;
export const NI_PING = Buffer.from("NI_PING\0", "ascii");
export const NI_PONG = Buffer.from("NI_PONG\0", "ascii");

export class NIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NIError";
    this.code = code;
  }
}

function bytes(value, name) {
  if (!ArrayBuffer.isView(value)) throw new TypeError(`${name} must be a Buffer or Uint8Array`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function encodeNIFrame(payload) {
  const body = bytes(payload, "NI payload");
  if (body.length > 0xffffffff) {
    throw new NIError("NI_PAYLOAD_TOO_LONG", `NI payload has ${body.length} bytes; the length field holds at most 4294967295`);
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function niControl(payload) {
  const value = bytes(payload, "NI control payload");
  if (value.equals(NI_PING)) return "NI_PING";
  if (value.equals(NI_PONG)) return "NI_PONG";
  return null;
}

/** Incremental NI decoder. One connection owns one decoder. */
export class NIFrameDecoder {
  #segments = [];
  #head = 0;
  #offset = 0;
  #buffered = 0;
  #failure = null;

  constructor({maxPayloadLength = DEFAULT_NI_MAX_PAYLOAD} = {}) {
    if (!Number.isSafeInteger(maxPayloadLength) || maxPayloadLength < 0 || maxPayloadLength > 0xffffffff) {
      throw new NIError("NI_INVALID_LIMIT", `NI maximum payload must be an integer from 0 to 4294967295, got ${maxPayloadLength}`);
    }
    this.maxPayloadLength = maxPayloadLength;
  }

  get bufferedBytes() { return this.#buffered; }

  push(chunk) {
    if (this.#failure) throw this.#failure;
    const incoming = bytes(chunk, "NI stream chunk");
    if (incoming.length > 0) {
      this.#segments.push(Buffer.from(incoming));
      this.#buffered += incoming.length;
    }

    const frames = [];
    while (this.#buffered >= 4) {
      const length = this.#peekLength();
      if (length > this.maxPayloadLength) {
        this.#failure = new NIError("NI_PAYLOAD_TOO_LARGE",
          `NI peer advertised ${length} bytes; configured maximum is ${this.maxPayloadLength}`);
        throw this.#failure;
      }
      if (this.#buffered < 4 + length) break;
      this.#take(4);
      frames.push(this.#take(length));
    }
    return frames;
  }

  finish() {
    if (this.#failure) throw this.#failure;
    if (this.#buffered !== 0) {
      throw new NIError("NI_TRUNCATED_STREAM", `NI stream ended with ${this.#buffered} incomplete bytes`);
    }
  }

  reset() {
    for (let index = this.#head; index < this.#segments.length; index++) this.#segments[index].fill(0);
    this.#segments = [];
    this.#head = 0;
    this.#offset = 0;
    this.#buffered = 0;
    this.#failure = null;
  }

  #peekLength() {
    const prefix = Buffer.allocUnsafe(4);
    let segment = this.#head;
    let offset = this.#offset;
    let written = 0;
    while (written < 4) {
      const current = this.#segments[segment];
      const count = Math.min(4 - written, current.length - offset);
      current.copy(prefix, written, offset, offset + count);
      written += count;
      segment++;
      offset = 0;
    }
    return prefix.readUInt32BE(0);
  }

  #take(length) {
    const output = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const current = this.#segments[this.#head];
      const count = Math.min(length - written, current.length - this.#offset);
      current.copy(output, written, this.#offset, this.#offset + count);
      written += count;
      this.#offset += count;
      if (this.#offset === current.length) {
        current.fill(0);
        this.#segments[this.#head] = null;
        this.#head++;
        this.#offset = 0;
      }
    }
    this.#buffered -= length;
    if (this.#head === this.#segments.length) {
      this.#segments = [];
      this.#head = 0;
    } else if (this.#head >= 64 && this.#head * 2 >= this.#segments.length) {
      this.#segments = this.#segments.slice(this.#head);
      this.#head = 0;
    }
    return output;
  }
}
