// MIT SAP LZC/LZH decoder for DIAG and RFC payloads.
// Ported with permission from the same author's MIT vibing-steampunk decoder.

import {inflateRawSync} from "node:zlib";

const HEADER_LENGTH = 8;
const LZC = 1;
const LZH = 2;

export class SAPCompressError extends Error {
  constructor(message) {
    super(message);
    this.name = "SAPCompressError";
  }
}

function bytes(value) {
  if (!ArrayBuffer.isView(value)) throw new TypeError("SAP compressed input must be a Buffer or Uint8Array");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function parseSAPCompressHeader(value, {maxOutputLength = 1024 * 1024} = {}) {
  const input = bytes(value);
  if (input.length < HEADER_LENGTH) throw new SAPCompressError(`compressed input has ${input.length} bytes; header needs 8`);
  if (input[5] !== 0x1f || input[6] !== 0x9d) throw new SAPCompressError("missing SAP compression signature");
  const length = input.readUInt32LE(0);
  if (length > maxOutputLength) throw new SAPCompressError(`declared output ${length} exceeds limit ${maxOutputLength}`);
  return {length, algorithm: input[4] & 0x0f, version: input[4] >>> 4, extra: input[7]};
}

function decodeLZH(body, expectedLength) {
  if (body.length === 0) throw new SAPCompressError("empty LZH body");
  const shift = 2 + (body[0] & 0x03);
  const shifted = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index++) {
    shifted[index] = (body[index] >>> shift) | (index + 1 < body.length ? body[index + 1] << (8 - shift) : 0);
  }
  try {
    return inflateRawSync(shifted, {maxOutputLength: expectedLength + 1});
  } catch (error) {
    throw new SAPCompressError(`invalid LZH body: ${error.message}`);
  }
}

function decodeLZC(body, {length, extra}) {
  const blockMode = (extra & 0x80) !== 0;
  const limit = extra & 0x1f;
  if (limit < 9 || limit > 16) throw new SAPCompressError(`LZC code width ${limit} is outside 9..16`);
  const firstFree = blockMode ? 257 : 256;
  const tableSize = 1 << limit;
  const prefix = new Int32Array(tableSize).fill(-1);
  const last = new Uint8Array(tableSize);
  const lengths = new Int32Array(tableSize);
  for (let index = 0; index < 256; index++) {
    last[index] = index;
    lengths[index] = 1;
  }

  let sourceOffset = 0;
  let chunk = Buffer.alloc(0);
  let chunkBit = 0;
  let width = 9;
  let maxCode = (1 << width) - 1;
  let nextFree = firstFree;
  const nextChunk = () => {
    chunk = body.subarray(sourceOffset, Math.min(body.length, sourceOffset + width));
    sourceOffset += chunk.length;
    chunkBit = 0;
  };
  const setWidth = (value) => {
    if (value > limit) throw new SAPCompressError("LZC dictionary exceeded its width limit");
    width = value;
    maxCode = value === limit ? 1 << limit : (1 << value) - 1;
  };
  const bitsLeft = () => chunk.length * 8 - chunkBit;
  const readBits = (count) => {
    let result = 0;
    for (let bit = 0; bit < count; bit++) {
      result |= ((chunk[chunkBit >>> 3] >>> (chunkBit & 7)) & 1) << bit;
      chunkBit++;
    }
    return result;
  };
  const readCode = () => {
    if (bitsLeft() < width || nextFree > maxCode) {
      if (nextFree > maxCode) setWidth(width + 1);
      nextChunk();
    }
    return bitsLeft() < width ? null : readBits(width);
  };
  const expand = (code) => {
    const output = Buffer.alloc(lengths[code]);
    for (let index = output.length - 1; index >= 0; index--) {
      output[index] = last[code];
      code = prefix[code];
    }
    return output;
  };

  nextChunk();
  const output = Buffer.alloc(length);
  let written = 0;
  let previous = -1;
  while (written < length) {
    const code = readCode();
    if (code === null) break;
    if (blockMode && code === 256) {
      nextFree = firstFree;
      setWidth(9);
      nextChunk();
      previous = -1;
      continue;
    }
    let chain;
    if (code < nextFree && (code < 256 || lengths[code] > 0)) {
      chain = expand(code);
    } else if (code === nextFree && previous >= 0) {
      const old = expand(previous);
      chain = Buffer.concat([old, old.subarray(0, 1)]);
    } else {
      throw new SAPCompressError(`unknown LZC code ${code}`);
    }
    if (written + chain.length > length) throw new SAPCompressError("LZC stream expanded past declared length");
    chain.copy(output, written);
    written += chain.length;
    if (previous >= 0 && nextFree < tableSize) {
      prefix[nextFree] = previous;
      last[nextFree] = chain[0];
      lengths[nextFree] = lengths[previous] + 1;
      nextFree++;
    }
    previous = code;
  }
  if (written !== length) throw new SAPCompressError(`LZC stream produced ${written} bytes; header promised ${length}`);
  return output;
}

export function decompressSAP(value, options) {
  const input = bytes(value);
  const header = parseSAPCompressHeader(input, options);
  const body = input.subarray(HEADER_LENGTH);
  let output;
  if (header.algorithm === LZH) output = decodeLZH(body, header.length);
  else if (header.algorithm === LZC) output = decodeLZC(body, header);
  else throw new SAPCompressError(`unknown SAP compression algorithm ${header.algorithm}`);
  if (output.length !== header.length) {
    throw new SAPCompressError(`stream produced ${output.length} bytes; header promised ${header.length}`);
  }
  return output;
}
