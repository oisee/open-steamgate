// SPDX-License-Identifier: MIT
// Minimal, bounded RFC/CPIC profile used by the built-in ADT bridge.
import {deflateRawSync, inflateRawSync} from "node:zlib";

const MAX_FIELD_BYTES = 16 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const RFC_LOGON_SIGNATURE = Buffer.from("d9c6c3f0f0f0f0f0f0f0f0f0", "hex");
// The final capability selector differs between the compact open-rfc probe and
// SAP JCo 3. A prefix is admitted explicitly; the following field chain still
// has to satisfy the same previous-tag and length grammar.
const RFC_LOGON_PREFIXES = [
  Buffer.from("010100080301", "hex"),
  Buffer.from("010100080102", "hex"),
];
const SCRAMBLE_TABLE = Buffer.from([
  0xf0, 0xed, 0x53, 0xb8, 0x32, 0x44, 0xf1, 0xf8, 0x76, 0xc6, 0x79, 0x59, 0xfd, 0x4f, 0x13, 0xa2,
  0xc1, 0x51, 0x95, 0xec, 0x54, 0x83, 0xc2, 0x34, 0x77, 0x49, 0x43, 0xa2, 0x7d, 0xe2, 0x65, 0x96,
  0x5e, 0x53, 0x98, 0x78, 0x9a, 0x17, 0xa3, 0x3c, 0xd3, 0x83, 0xa8, 0xb8, 0x29, 0xfb, 0xdc, 0xa5,
  0x55, 0xd7, 0x02, 0x77, 0x84, 0x13, 0xac, 0xdd, 0xf9, 0xb8, 0x31, 0x16, 0x61, 0x0e, 0x6d, 0xfa,
]);

function bytes(value, label = "value") {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError(`${label} must be bytes`);
  return Buffer.from(value);
}

function u16(value) {
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16BE(value);
  return out;
}

function u32(value) {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32BE(value);
  return out;
}

export function encodeUtf16le(value, width) {
  if (typeof value !== "string") throw new TypeError("value must be a string");
  const text = width === undefined ? value : value.slice(0, width).padEnd(width, " ");
  return Buffer.from(text, "utf16le");
}

export function encodeRfcFieldChain(initialPreviousTag, fields) {
  let previous = initialPreviousTag;
  const parts = [];
  let total = 0;
  for (const field of fields) {
    const value = bytes(field.value ?? Buffer.alloc(0), "field value");
    if (!Number.isInteger(field.tag) || field.tag < 0 || field.tag > 0xffff) throw new RangeError("RFC tag must fit uint16");
    if (value.length > MAX_FIELD_BYTES) throw new RangeError("RFC field exceeds bridge limit");
    const header = value.length < 0xffff
      ? Buffer.concat([u16(previous), u16(field.tag), u16(value.length)])
      : Buffer.concat([u16(previous), u16(field.tag), u16(0xffff), u32(value.length)]);
    total += header.length + value.length;
    if (total > MAX_XML_BYTES + 65536) throw new RangeError("RFC field chain exceeds bridge limit");
    parts.push(header, value);
    previous = field.tag;
  }
  return Buffer.concat(parts, total);
}

export function decodeRfcFieldChain(data, initialPreviousTag, terminalTag = 0xffff) {
  const input = bytes(data, "field chain");
  const fields = [];
  let previous = initialPreviousTag;
  let offset = 0;
  while (offset < input.length) {
    if (offset + 6 > input.length) throw new Error("truncated RFC field header");
    const claimedPrevious = input.readUInt16BE(offset);
    const tag = input.readUInt16BE(offset + 2);
    let length = input.readUInt16BE(offset + 4);
    let headerLength = 6;
    if (claimedPrevious !== previous) throw new Error("broken RFC field chain");
    if (length === 0xffff) {
      if (offset + 10 > input.length) throw new Error("truncated RFC extended length");
      length = input.readUInt32BE(offset + 6);
      headerLength = 10;
    }
    if (length > MAX_FIELD_BYTES || offset + headerLength + length > input.length) throw new Error("invalid RFC field length");
    const value = input.subarray(offset + headerLength, offset + headerLength + length);
    fields.push({tag, value});
    offset += headerLength + length;
    previous = tag;
    if (tag === terminalTag) return {fields, bytesConsumed: offset};
  }
  throw new Error("RFC field chain has no terminal field");
}

function decodeUtf16le(value) {
  if (value.length & 1) throw new Error("odd UTF-16LE field length");
  return value.toString("utf16le");
}

function decodeRfcName(value) {
  const little = decodeUtf16le(value).trimEnd();
  if (/^[A-Z0-9_]*$/.test(little)) return little;
  const swapped = Buffer.from(value);
  for (let at = 0; at < swapped.length; at += 2) [swapped[at], swapped[at + 1]] = [swapped[at + 1], swapped[at]];
  const big = decodeUtf16le(swapped).trimEnd();
  if (/^[A-Z0-9_]*$/.test(big)) return big;
  throw new Error("RFC name is not canonical ASCII");
}

export function decodeRfcRequest(cut) {
  const input = bytes(cut, "CUT request");
  if (input.length < 12) throw new Error("short CUT request");
  const classic = input.subarray(0, 4).equals(Buffer.from([0x05, 0x02, 0x00, 0x00]));
  // Eclipse omits only the predecessor of its opening TagStart field. Restore
  // that zero predecessor and feed the same bounded chain decoder; this is not
  // a second, permissive grammar.
  const eclipse = !classic && input.readUInt16BE(0) === 0x0101;
  if (!classic && !eclipse) throw new Error("unsupported CUT request prefix");
  const chainInput = classic ? input.subarray(4) : Buffer.concat([Buffer.alloc(2), input]);
  const chain = decodeRfcFieldChain(chainInput, classic ? 0x0502 : 0x0000);
  const consumed = chain.bytesConsumed + (classic ? 4 : -2);
  const trailer = input.subarray(consumed);
  if (trailer.length !== 10 || trailer.readUInt16BE(0) !== 0xffff || trailer.readUInt16BE(2) !== 0 ||
      trailer.readUInt16BE(4) !== input.length - 8 || trailer.readUInt16BE(6) !== 0 || trailer.readUInt16BE(8) !== 0x8500) {
    throw new Error("invalid CUT request trailer");
  }
  if (chain.fields.some((field) => field.tag === 0x5001)) throw new Error("Fast Serialization is not supported; use classic or ADT BASXML");
  const functionField = chain.fields.find((field) => field.tag === 0x0102);
  if (!functionField) throw new Error("RFC request has no function name");
  const functionName = decodeRfcName(functionField.value);
  const requestedOutputs = chain.fields.filter((field) => field.tag === 0x0205).map((field) => decodeRfcName(field.value));
  const imports = new Map();
  const tables = [];
  let importName;
  let table;
  for (const field of chain.fields) {
    if (field.tag === 0x0201) importName = decodeRfcName(field.value);
    else if (field.tag === 0x0203 && importName) {
      imports.set(importName, Buffer.from(field.value));
      importName = undefined;
    } else if (field.tag === 0x0301) { table = {name: decodeRfcName(field.value), rows: []}; tables.push(table); }
    else if (field.tag === 0x0330 && table) table.id = Buffer.from(field.value);
    else if (field.tag === 0x0302 && table && field.value.length >= 8) table.rowLength = field.value.readUInt32BE(0);
    else if ([0x0303, 0x0304].includes(field.tag) && table) table.rows.push(Buffer.from(field.value));
  }
  const xml = Buffer.concat(chain.fields.filter((field) => field.tag === 0x3c05).map((field) => field.value));
  if (xml.length > MAX_XML_BYTES) throw new Error("xRFC XML exceeds bridge limit");
  const compactFlag = chain.fields.find((field) => field.tag === 0x4000)?.value;
  let compact = Buffer.concat(chain.fields.filter((field) => field.tag === 0x4001).map((field) => field.value));
  if (compact.length > 64 * 1024 * 1024) throw new Error("compact RFC parameter exceeds bridge limit");
  if (compactFlag) {
    if (compactFlag.length !== 2 || compactFlag[0] !== 1 || ![0, 1].includes(compactFlag[1])) throw new Error("unsupported compact RFC flags");
    if (compactFlag[1]) compact = inflateRawSync(compact, {maxOutputLength: 64 * 1024 * 1024});
  }
  const sessionGUID = chain.fields.find((field) => field.tag === 0x0514 && field.value.length === 16)?.value;
  return {functionName, requestedOutputs, imports, tables, sessionGUID: sessionGUID && Buffer.from(sessionGUID), xml: xml.toString("utf8"), compact: compactFlag ? compact : undefined, eclipse};
}

export const decodeAdtRequest = decodeRfcRequest;

export function decodeRfcLogon(payload) {
  const input = bytes(payload, "RFC logon");
  const prefixLength = RFC_LOGON_SIGNATURE.length + RFC_LOGON_PREFIXES[0].length;
  const prefix = input.subarray(RFC_LOGON_SIGNATURE.length, prefixLength);
  if (input.length < prefixLength + 10 || !input.subarray(0, 12).equals(RFC_LOGON_SIGNATURE) ||
      !RFC_LOGON_PREFIXES.some((candidate) => prefix.equals(candidate))) throw new Error("invalid RFC logon prefix");
  const chain = decodeRfcFieldChain(input.subarray(prefixLength), 0x0101);
  const trailer = input.subarray(prefixLength + chain.bytesConsumed);
  if (trailer.length !== 10 || trailer.readUInt16BE(0) !== 0xffff || trailer.readUInt16BE(2) !== 0 ||
      trailer.readUInt16BE(4) !== prefixLength + chain.bytesConsumed + 2) throw new Error("invalid RFC logon trailer");
  const byTag = new Map(chain.fields.map((field) => [field.tag, field.value]));
  const ascii = (tag, label) => {
    const value = byTag.get(tag);
    if (!value || !/^[\x20-\x7e]+$/.test(value.toString("latin1"))) throw new Error(`invalid RFC logon ${label}`);
    return value.toString("ascii");
  };
  return {
    client: ascii(0x0114, "client"),
    user: ascii(0x0111, "user"),
    language: ascii(0x0115, "language"),
    passwordField: byTag.has(0x0117) ? Buffer.from(byTag.get(0x0117)) : undefined,
    ticket: byTag.has(0x0670) ? Buffer.from(byTag.get(0x0670)) : undefined,
  };
}

export function unscrambleRfcPassword(field) {
  const input = bytes(field, "RFC password field");
  if (input.length < 4 || input.length > 44) throw new Error("invalid RFC password field length");
  const seed = input.readUInt32LE(0);
  const start = (seed ^ (seed >>> 5) ^ (seed << 1)) >>> 0;
  const clear = Buffer.alloc(input.length - 4);
  for (let index = 0; index < clear.length; index++) {
    const table = SCRAMBLE_TABLE[(start + index) & 0x3f];
    const term = Number((BigInt(seed) * BigInt(index) * BigInt(index) - BigInt(index)) & 0xffn);
    clear[index] = input[4 + index] ^ table ^ term;
  }
  if (!/^[\x20-\x7e]*$/.test(clear.toString("latin1"))) throw new Error("RFC password is outside the supported ASCII profile");
  return clear.toString("ascii");
}

function xmlUnescape(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#(?:x[0-9a-fA-F]+|[0-9]+));/g, (entity) => {
    const names = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'"};
    if (names[entity]) return names[entity];
    const raw = entity.slice(2, -1);
    const point = raw[0].toLowerCase() === "x" ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
    if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("invalid XML character reference");
    return String.fromCodePoint(point);
  });
}

function xmlEscape(value) {
  return String(value).replace(/[&<>]/g, (ch) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"})[ch]);
}

function element(xml, name, required = true) {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = xml.indexOf(open);
  if (start < 0) {
    if (!required) return "";
    throw new Error(`xRFC XML lacks ${name}`);
  }
  const from = start + open.length;
  const end = xml.indexOf(close, from);
  if (end < 0 || xml.indexOf(open, from) >= 0 && xml.indexOf(open, from) < end) throw new Error(`malformed xRFC ${name}`);
  return xmlUnescape(xml.slice(from, end));
}

export function parseAdtHttpRequest(xml) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error("invalid xRFC request XML");
  if (!xml.startsWith("<REQUEST>") || !xml.endsWith("</REQUEST>")) throw new Error("xRFC root must be REQUEST");
  const requestLine = element(xml, "REQUEST_LINE");
  const method = element(requestLine, "METHOD").toUpperCase();
  const url = element(requestLine, "URI");
  const version = element(requestLine, "VERSION");
  if (!/^[A-Z]{1,16}$/.test(method) || !url.startsWith("/") || url.startsWith("//") || version !== "HTTP/1.1") throw new Error("invalid tunneled HTTP request line");
  const headersXml = element(xml, "HEADER_FIELDS");
  const headers = [];
  let at = 0;
  while ((at = headersXml.indexOf("<item>", at)) >= 0) {
    const end = headersXml.indexOf("</item>", at + 6);
    if (end < 0) throw new Error("malformed tunneled HTTP headers");
    const row = headersXml.slice(at + 6, end);
    const name = element(row, "NAME");
    const value = element(row, "VALUE");
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error("invalid tunneled HTTP header");
    headers.push([name, value]);
    at = end + 7;
    if (headers.length > 256) throw new Error("too many tunneled HTTP headers");
  }
  const encodedBody = element(xml, "MESSAGE_BODY", false).replace(/[\r\n]/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedBody)) throw new Error("invalid tunneled HTTP body");
  const body = Buffer.from(encodedBody, "base64");
  if (body.length > MAX_XML_BYTES) throw new Error("tunneled HTTP body exceeds bridge limit");
  return {method, url, headers, body};
}

export function encodeAdtHttpResponse({status, reason, headers = [], body = Buffer.alloc(0)}) {
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("invalid HTTP status");
  const payload = bytes(body, "HTTP body");
  if (payload.length > MAX_XML_BYTES) throw new RangeError("HTTP response body exceeds bridge limit");
  const headerXml = headers.map(([name, value]) => `<item><NAME>${xmlEscape(name)}</NAME><VALUE>${xmlEscape(value)}</VALUE></item>`).join("");
  return `<RESPONSE><STATUS_LINE><VERSION>HTTP/1.1</VERSION><STATUS_CODE>${status}</STATUS_CODE><REASON_PHRASE>${xmlEscape(reason || "")}</REASON_PHRASE></STATUS_LINE><HEADER_FIELDS>${headerXml}</HEADER_FIELDS><MESSAGE_BODY>${payload.toString("base64")}</MESSAGE_BODY></RESPONSE>`;
}

export function encodeRfcCutResponse({requestedOutputs, exports = [], tables = [], xrfc = [], eclipse = false, sessionGUID}) {
  const fields = [];
  const numbered = tables.some((table) => table.id?.length === 4);
  if (numbered && tables[0]?.id?.length === 4) fields.push({tag: 0x0331, value: tables[0].id});
  fields.push({tag: 0x0503});
  if ((eclipse || numbered) && sessionGUID?.length === 16) fields.push({tag: 0x0514, value: sessionGUID});
  fields.push({tag: 0x0420, value: Buffer.alloc(4)}, {tag: 0x0512});
  for (const name of requestedOutputs ?? exports.map((output) => output.name)) fields.push({tag: 0x0205, value: encodeUtf16le(name)});
  for (const output of exports) fields.push(
    {tag: 0x0201, value: encodeUtf16le(output.name)},
    {tag: 0x0203, value: bytes(output.value, `${output.name} value`)},
  );
  for (const table of tables) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(table.rowLength, 0);
    header.writeUInt32BE(table.rows.length, 4);
    if (table.id?.length === 4) {
      const idHeader = Buffer.alloc(12);
      idHeader.writeUInt32BE(0x0a, 0);
      table.id.copy(idHeader, 4);
      idHeader.writeUInt32BE(table.rows.length, 8);
      fields.push({tag: 0x0335, value: idHeader}, {tag: 0x0302, value: header});
    } else fields.push({tag: 0x0301, value: encodeUtf16le(table.name)}, {tag: 0x0302, value: header});
    for (const row of table.rows) {
      const value = bytes(row, `${table.name} row`);
      if (value.length !== table.rowLength) throw new Error(`${table.name} row has the wrong length`);
      fields.push({tag: table.id?.length === 4 ? 0x0303 : 0x0304, value});
    }
    if (table.id?.length === 4) fields.push({tag: 0x0336, value: table.id});
  }
  for (const parameter of xrfc) {
    const document = bytes(parameter.value, `${parameter.name} xRFC value`);
    if (document.length === 0 || document.length > MAX_XML_BYTES) throw new RangeError("invalid xRFC response XML length");
    fields.push({tag: 0x3c02});
    for (let at = 0; at < document.length; at += 16 * 1024) fields.push({tag: 0x3c05, value: document.subarray(at, at + 16 * 1024)});
    fields.push({tag: 0x3c02});
  }
  fields.push(
    {tag: 0x0130, value: encodeUtf16le("OPEN_STEAMGATE", 40)},
    {tag: 0x0667, value: Buffer.alloc(8)},
    {tag: 0xffff},
  );
  return Buffer.concat([Buffer.from([0x05, 0x00, 0x00, 0x00]), encodeRfcFieldChain(0x0500, fields), Buffer.from([0xff, 0xff])]);
}

export function encodeAdtCutResponse(xml) {
  return encodeRfcCutResponse({requestedOutputs: ["RESPONSE"], xrfc: [{name: "RESPONSE", value: Buffer.from(xml, "utf8")}]});
}

export function encodeAdtCompactResponse(document, sessionGUID) {
  const compressed = deflateRawSync(bytes(document, "BXML response"));
  const fields = [{tag: 0x0503}];
  if (sessionGUID?.length === 16) fields.push({tag: 0x0514, value: sessionGUID});
  fields.push(
    {tag: 0x0420, value: Buffer.alloc(4)},
    {tag: 0x0512},
    {tag: 0x0205, value: encodeUtf16le("RESPONSE")},
    {tag: 0x4000, value: Buffer.from([1, 1])},
  );
  for (let at = 0; at < compressed.length; at += 16 * 1024) fields.push({tag: 0x4002, value: compressed.subarray(at, at + 16 * 1024)});
  fields.push(
    {tag: 0x4004},
    {tag: 0x0130, value: encodeUtf16le("OPEN_STEAMGATE", 40)},
    {tag: 0x0667, value: Buffer.alloc(8)},
    {tag: 0x0523},
    {tag: 0xffff},
  );
  return Buffer.concat([Buffer.from([0x05, 0x00, 0x00, 0x00]), encodeRfcFieldChain(0x0500, fields), Buffer.from([0xff, 0xff])]);
}

export function wrapRfcResponse(cut, requestHeader) {
  const payload = bytes(cut, "CUT response");
  const request = bytes(requestHeader, "request header");
  if (request.length < 80) throw new Error("short APPC request header");
  const out = Buffer.alloc(80 + payload.length);
  out[0] = 0x06;
  out[1] = 0xcb;
  out[2] = 0x02;
  out.writeUInt16BE(request.readUInt16BE(4), 4);
  out.writeUInt16BE(0x0007, 6);
  out.writeUInt32BE(0x00010000, 12);
  out[16] = 1;
  out.writeUInt32BE(0xffffffff, 17);
  out[21] = 2;
  out.writeUInt32BE(1, 22);
  out.writeUInt16BE(8, 26);
  out[30] = 5;
  out[31] = 0x0c;
  request.copy(out, 40, 40, 48);
  out.writeUInt32BE(0x00006d60, 48);
  out.writeUInt32BE(2, 52);
  out.writeUInt32BE(payload.length, 56);
  out.writeUInt32BE(1, 60);
  out.write("4103", 69, "ascii");
  request.copy(out, 78, 78, 80);
  payload.copy(out, 80);
  return out;
}
