// MIT-licensed DIAG primitives used by open-steamgate's built-in 32NN stub.
// This is protocol structure, not replayed session, host, user, or system data.

import {diagTapeTemplate} from "./diag-tape-template.mjs";

export const DIAG_HEADER_LENGTH = 8;
export const DIAG_DP_HEADER_LENGTH = 200;
export const DIAG_ITEM = Object.freeze({SES: 0x01, EOM: 0x0c, APPL: 0x10, XML: 0x11, APPL4: 0x12});
export const DIAG_ATOM = Object.freeze({FRAME: 0x7f, LABEL: 0x84});
export const DIAG_ATTR_PROTECTED = 0x01;

function bytes(value, name) {
  if (!ArrayBuffer.isView(value)) throw new TypeError(`${name} must be a Buffer or Uint8Array`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function size(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}, got ${value}`);
  }
  return value;
}

const octet = (value, name) => size(value, 0xff, name);
const u16 = (value, name) => size(value, 0xffff, name);

function ascii(value, name) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  for (const character of value) {
    if (character.codePointAt(0) > 0x7f) throw new RangeError(`${name} must contain only ASCII characters until codepage negotiation exists`);
  }
  return Buffer.from(value, "ascii");
}

export function encodeDiagHeader({
  mode = 0, comFlag = 0, modeStat = 0, errNo = 0,
  msgType = 0, msgInfo = 0, msgRC = 0, compress = 0,
} = {}) {
  return Buffer.from([
    octet(mode, "DIAG mode"), octet(comFlag, "DIAG comFlag"),
    octet(modeStat, "DIAG modeStat"), octet(errNo, "DIAG errNo"),
    octet(msgType, "DIAG msgType"), octet(msgInfo, "DIAG msgInfo"),
    octet(msgRC, "DIAG msgRC"), octet(compress, "DIAG compression"),
  ]);
}

export function encodeDiagItem({type, id = 0, sid = 0, value = Buffer.alloc(0)}) {
  const itemType = octet(type, "DIAG item type");
  const body = bytes(value, "DIAG item value");
  if (itemType === DIAG_ITEM.APPL) {
    u16(body.length, "DIAG APPL value length");
    const output = Buffer.allocUnsafe(5 + body.length);
    output[0] = itemType;
    output[1] = octet(id, "DIAG APPL id");
    output[2] = octet(sid, "DIAG APPL sid");
    output.writeUInt16BE(body.length, 3);
    body.copy(output, 5);
    return output;
  }
  if (itemType === DIAG_ITEM.APPL4) {
    const output = Buffer.allocUnsafe(7 + body.length);
    output[0] = itemType;
    output[1] = octet(id, "DIAG APPL4 id");
    output[2] = octet(sid, "DIAG APPL4 sid");
    output.writeUInt32BE(body.length, 3);
    body.copy(output, 7);
    return output;
  }
  if (itemType === DIAG_ITEM.XML) {
    const output = Buffer.allocUnsafe(5 + body.length);
    output[0] = itemType;
    output.writeUInt32BE(body.length, 1);
    body.copy(output, 5);
    return output;
  }
  return Buffer.concat([Buffer.from([itemType]), body]);
}

export function encodeDiagMessage(header, items) {
  if (!Array.isArray(items)) throw new TypeError("DIAG items must be an array");
  if (header?.compress) throw new Error("built-in DIAG responses are deliberately uncompressed");
  return Buffer.concat([encodeDiagHeader(header), ...items.map(encodeDiagItem)]);
}

export function parseDiagItems(value) {
  const body = bytes(value, "DIAG item stream");
  const output = [];
  let offset = 0;
  const fixed = new Map([
    [0x01, 16], [0x02, 20], [0x03, 3], [0x07, 76], [0x08, 1], [0x09, 22],
    [0x0a, 3], [0x0b, 2], [0x0c, 0], [0x13, 2], [0x15, 9],
  ]);
  while (offset < body.length) {
    const type = body[offset];
    let id;
    let sid;
    let start;
    let length;
    if (type === DIAG_ITEM.APPL || type === DIAG_ITEM.APPL4) {
      const lengthBytes = type === DIAG_ITEM.APPL ? 2 : 4;
      if (offset + 3 + lengthBytes > body.length) throw new Error("truncated DIAG APPL header");
      id = body[offset + 1];
      sid = body[offset + 2];
      length = lengthBytes === 2 ? body.readUInt16BE(offset + 3) : body.readUInt32BE(offset + 3);
      start = offset + 3 + lengthBytes;
    } else if (type === DIAG_ITEM.XML) {
      if (offset + 5 > body.length) throw new Error("truncated DIAG XML header");
      length = body.readUInt32BE(offset + 1);
      start = offset + 5;
    } else if (fixed.has(type)) {
      length = fixed.get(type);
      start = offset + 1;
    } else {
      throw new Error(`unknown DIAG item type 0x${type.toString(16).padStart(2, "0")}`);
    }
    if (length > body.length - start) throw new Error(`DIAG item overruns message by ${length - (body.length - start)} bytes`);
    output.push({type, id, sid, value: body.subarray(start, start + length)});
    offset = start + length;
  }
  return output;
}

function encodeAtomHeader({type, row, col, body}) {
  const atomBody = bytes(body, "DIAG atom body");
  const length = u16(12 + atomBody.length, "DIAG atom length");
  const output = Buffer.allocUnsafe(length);
  output.writeUInt16BE(length, 0);
  output.fill(0, 2, 12);
  output[4] = octet(type, "DIAG atom type");
  output.writeUInt16BE(u16(row, "DIAG atom row"), 8);
  output.writeUInt16BE(u16(col, "DIAG atom column"), 10);
  atomBody.copy(output, 12);
  return output;
}

export function encodeDiagFrame({row, col, width, height, title = ""}) {
  const titleBytes = ascii(title, "DIAG frame title");
  const body = Buffer.allocUnsafe(5 + titleBytes.length);
  body[0] = DIAG_ATTR_PROTECTED;
  body.writeUInt16BE(u16(height, "DIAG frame height"), 1);
  body.writeUInt16BE(u16(width, "DIAG frame width"), 3);
  titleBytes.copy(body, 5);
  return encodeAtomHeader({type: DIAG_ATOM.FRAME, row, col, body});
}

export function encodeDiagLabel({row, col, text}) {
  const textBytes = ascii(text, "DIAG label text");
  if (textBytes.length > 0xff) throw new RangeError("DIAG label text holds at most 255 bytes");
  const body = Buffer.alloc(7 + textBytes.length);
  body[0] = DIAG_ATTR_PROTECTED;
  body[3] = textBytes.length;
  body[4] = textBytes.length;
  body.writeUInt16BE(textBytes.length, 5);
  textBytes.copy(body, 7);
  return encodeAtomHeader({type: DIAG_ATOM.LABEL, row, col, body});
}

/** A scrubbed, uncompressed SAP GUI shell whose two DYNT atoms are generated here. */
export function buildDiagTapeScreen({text = "R Tape loading error, 0:1"} = {}) {
  const atoms = Buffer.concat([
    encodeDiagFrame({row: 1, col: 1, width: 78, height: 22}),
    encodeDiagLabel({row: 20, col: 3, text}),
  ]);
  const template = diagTapeTemplate();
  if (template.length < DIAG_HEADER_LENGTH) throw new Error("built-in DIAG tape template is truncated");
  const items = parseDiagItems(template.subarray(DIAG_HEADER_LENGTH)).map((item) =>
    item.type === DIAG_ITEM.APPL4 && item.id === 0x09 && item.sid === 0x02
      ? {...item, value: atoms}
      : item);
  return encodeDiagMessage({
    mode: template[0], comFlag: template[1], modeStat: template[2], errNo: template[3],
    msgType: template[4], msgInfo: template[5], msgRC: template[6], compress: template[7],
  }, items);
}
