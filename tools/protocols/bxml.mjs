// SPDX-License-Identifier: MIT
// Bounded SAP Binary XML 0.7 codec for ADT's REQUEST/RESPONSE values.

const MAGIC = Buffer.from("BXML");
const T = {header: 0x3f, name: 0x2b, open: 0x3c, close: 0x3e, attr: 0x40, attrValue: 0x41, bind: 0x3a, xmlns: 0x2a, text: 0x54, body: 0x42, string: 0x43};
const MAX_DOC = 64 * 1024 * 1024;

function lengthAt(doc, at) {
  if (at >= doc.length) throw new Error("BXML length past end");
  const a = doc[at];
  let size, value;
  if (a < 0x80) return [a, at + 1];
  if (a < 0xe0) { size = 2; value = a & 0x1f; }
  else if (a < 0xf0) { size = 3; value = a & 0x0f; }
  else if (a < 0xf8) { size = 4; value = a & 7; }
  else throw new Error("invalid BXML length scalar");
  if (at + size > doc.length) throw new Error("truncated BXML length");
  for (let index = 1; index < size; index++) {
    const next = doc[at + index];
    if ((next & 0xc0) !== 0x80) throw new Error("invalid BXML length continuation");
    value = (value << 6) | (next & 0x3f);
  }
  return [value, at + size];
}

function valueAt(doc, at, binary = false) {
  const [length, from] = lengthAt(doc, at);
  if (length > MAX_DOC || from + length > doc.length) throw new Error("BXML value exceeds document");
  const value = doc.subarray(from, from + length);
  return [binary ? Buffer.from(value) : value.toString("utf8"), from + length];
}

export function decodeBxml(value) {
  const doc = Buffer.from(value);
  if (doc.length > MAX_DOC || !doc.subarray(0, 4).equals(MAGIC)) throw new Error("invalid BXML document");
  const names = [];
  const root = {name: "#document", attrs: [], children: []};
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const nameOf = (ref) => {
    const name = names[ref - 2];
    if (name === undefined) throw new Error("BXML name reference out of range");
    return name;
  };
  let at = 4;
  while (at < doc.length) {
    const token = doc[at++];
    if (token === T.header) { [, at] = valueAt(doc, at); [, at] = valueAt(doc, at); }
    else if (token === T.name) { let name; [name, at] = valueAt(doc, at); names.push(name); }
    else if (token === T.open) {
      if (at + 2 > doc.length) throw new Error("truncated BXML open");
      const node = {name: nameOf(doc[at]), attrs: [], children: []};
      at += 2;
      top().children.push(node);
      stack.push(node);
    } else if (token === T.close) {
      if (stack.length === 1) throw new Error("unmatched BXML close");
      stack.pop();
    } else if (token === T.attr) {
      if (at + 3 > doc.length) throw new Error("truncated BXML attribute");
      const name = nameOf(doc[at]);
      at += 2;
      if (doc[at++] !== T.attrValue) throw new Error("BXML attribute has no value");
      let text; [text, at] = valueAt(doc, at); top().attrs.push({name, value: text});
    } else if (token === T.attrValue) { [, at] = valueAt(doc, at); }
    else if (token === T.bind) { if (at + 2 > doc.length) throw new Error("truncated BXML namespace"); at += 2; }
    else if (token === T.xmlns) { if (at >= doc.length) throw new Error("truncated BXML xmlns"); at++; }
    else if ([T.text, T.string].includes(token)) { [top().text, at] = valueAt(doc, at); }
    else if (token === T.body) { [top().body, at] = valueAt(doc, at, true); }
    else throw new Error(`unknown BXML token 0x${token.toString(16).padStart(2, "0")}`);
  }
  if (stack.length !== 1) throw new Error("BXML has unclosed elements");
  return root;
}

function child(node, name) { return node?.children.find((candidate) => candidate.name === name); }
function text(node, name) { return child(node, name)?.text ?? ""; }

export function bxmlPayload(document) {
  const abap = child(document, "abap") ?? document.children[0];
  const values = child(abap, "values") ?? abap?.children[0];
  if (!values?.children.length) throw new Error("BXML has no payload root");
  return values.children[0];
}

export function parseAdtBxmlRequest(document) {
  const request = bxmlPayload(decodeBxml(document));
  if (request.name !== "REQUEST") throw new Error("BXML payload is not REQUEST");
  const line = child(request, "REQUEST_LINE");
  const headers = (child(request, "HEADER_FIELDS")?.children ?? []).map((row) => [text(row, "NAME"), text(row, "VALUE")]);
  const bodyNode = child(request, "MESSAGE_BODY");
  return {method: text(line, "METHOD").toUpperCase(), url: text(line, "URI"), version: text(line, "VERSION"), headers, body: bodyNode?.body ?? Buffer.from(bodyNode?.text ?? "")};
}

function putLength(parts, length) {
  if (length < 0x80) parts.push(Buffer.from([length]));
  else if (length < 0x800) parts.push(Buffer.from([0xc0 | (length >> 6), 0x80 | (length & 0x3f)]));
  else if (length < 0x10000) parts.push(Buffer.from([0xe0 | (length >> 12), 0x80 | ((length >> 6) & 0x3f), 0x80 | (length & 0x3f)]));
  else parts.push(Buffer.from([0xf0 | (length >> 18), 0x80 | ((length >> 12) & 0x3f), 0x80 | ((length >> 6) & 0x3f), 0x80 | (length & 0x3f)]));
}

function putValue(parts, token, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  parts.push(Buffer.from([token])); putLength(parts, data.length); parts.push(data);
}

export function encodeBxml(payload) {
  const parts = [MAGIC];
  const names = new Map();
  const ref = (name) => {
    if (names.has(name)) return names.get(name) + 2;
    if (names.size >= 253) throw new Error("too many BXML names");
    const index = names.size; names.set(name, index); putValue(parts, T.name, name); return index + 2;
  };
  const header = (key, value) => { parts.push(Buffer.from([T.header])); const k = Buffer.from(key), v = Buffer.from(value); putLength(parts, k.length); parts.push(k); putLength(parts, v.length); parts.push(v); };
  header("VER", "0.7"); header("ENC", "utf-8");
  const asx = ref("asx"), asxUrl = ref("http://www.sap.com/abapxml"); parts.push(Buffer.from([T.bind, asx, asxUrl]));
  parts.push(Buffer.from([T.open, ref("abap"), 2, T.attr, ref("version"), 1])); putValue(parts, T.attrValue, "1.0");
  parts.push(Buffer.from([T.bind, ref("asxhint"), ref("http://www.sap.com/abapxml/hint"), T.xmlns, asxUrl, T.open, ref("values"), 2]));
  const element = (node) => {
    parts.push(Buffer.from([T.open, ref(node.name), 1]));
    for (const attr of node.attrs ?? []) { parts.push(Buffer.from([T.attr, ref(attr.name), attr.name === "lines" ? 3 : 1])); putValue(parts, T.attrValue, attr.value); }
    if (node.body !== undefined) putValue(parts, T.body, node.body);
    else if (node.text !== undefined) putValue(parts, T.text, node.text);
    for (const item of node.children ?? []) element(item);
    parts.push(Buffer.from([T.close]));
  };
  element(payload); parts.push(Buffer.from([T.close, T.close]));
  const output = Buffer.concat(parts);
  if (output.length > MAX_DOC) throw new Error("BXML document exceeds limit");
  return output;
}

export function encodeAdtBxmlResponse({status, reason, headers = [], body = Buffer.alloc(0)}) {
  const leaf = (name, value) => ({name, text: String(value)});
  const rows = [{name: "IHTTPNVP", children: [leaf("NAME", "~server_protocol"), leaf("VALUE", "HTTP/1.1")]},
    ...headers.map(([name, value]) => ({name: "IHTTPNVP", children: [leaf("NAME", name), leaf("VALUE", value)]}))];
  return encodeBxml({name: "RESPONSE", children: [
    {name: "STATUS_LINE", children: [leaf("VERSION", "HTTP/1.1"), leaf("STATUS_CODE", String(status).padEnd(4)), leaf("REASON_PHRASE", reason ?? "")]},
    {name: "HEADER_FIELDS", attrs: [{name: "lines", value: String(rows.length)}], children: rows},
    body.length ? {name: "MESSAGE_BODY", body: Buffer.from(body)} : {name: "MESSAGE_BODY"},
  ]});
}
