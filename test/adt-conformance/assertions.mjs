import assert from 'node:assert/strict';
import {namespaces} from '../../tools/adt-request-xml.mjs';
import {responseElements} from './xml.mjs';
import {normalize} from './normalize.mjs';
export const NS = {...namespaces, app: 'http://www.w3.org/2007/app',
  abapsource: 'http://www.sap.com/adt/abapsource', exc: 'http://www.sap.com/abapxml/types/communicationframework'};
function named(node, name, ns) {
  if (name === '*') return true;
  const parts = name.split(':');
  if (parts.length === 1) return node.local === name && node.uri === '';
  assert.ok(ns[parts[0]], `unknown XPath namespace ${parts[0]}`);
  return node.local === parts[1] && node.uri === ns[parts[0]];
}
// Deliberately bounded XPath: / and // steps, qualified names, * and attribute equality,
// terminal /@attribute or /text(). Unknown syntax is an error, never a silent pass.
export function xpath(xml, path, ns = NS) {
  assert.ok(typeof path === 'string' && path.startsWith('/') && path.length > 1, 'invalid XPath');
  const elements = responseElements(xml);
  const steps = [...path.matchAll(/(\/\/|\/)([^/]+)/g)];
  assert.equal(steps.map(s => s[0]).join(''), path, `unsupported XPath ${path}`);
  let selected = [{id: 0}];
  for (const [index, step] of steps.entries()) {
    const [, axis, expression] = step;
    if (expression === 'text()' || expression.startsWith('@')) {
      assert.equal(index, steps.length - 1, 'XPath value step must be terminal');
      return selected.map(e => expression === 'text()' ? e.text :
        e.attributes?.find(a => named(a, expression.slice(1), ns))?.value).filter(v => v !== undefined);
    }
    const match = /^(\*|[\w:.-]+)(?:\[@([\w:.-]+)=(?:"([^"]*)"|'([^']*)')\])?$/.exec(expression);
    assert.ok(match, `unsupported XPath ${path}`);
    const descendant = (e, parent) => {
      while (e && e.parent !== parent) e = elements[e.parent - 1];
      return e?.parent === parent;
    };
    selected = elements.map((e, i) => ({...e, id: i + 1})).filter(e =>
      selected.some(p => axis === '//' ? descendant(e, p.id) : e.parent === p.id)
      && named(e, match[1], ns) && (!match[2] || e.attributes.some(a =>
        named(a, match[2], ns) && a.value === (match[3] ?? match[4]))));
  }
  return selected.map(e => e.text);
}
function fact(actual, expected, label) {
  if (expected instanceof RegExp) {assert.notEqual(actual, undefined, label); assert.match(String(actual), expected, label);}
  else assert.deepEqual(actual, expected, label);
}
export function assertResponse(response, expect) {
  assert.equal(response.status, expect.status, 'HTTP status');
  if (expect.contentType !== undefined) fact(response.headers.get('content-type'), expect.contentType, 'Content-Type');
  const body = expect.normalize ? normalize(response.body, expect.normalize) : response.body;
  if (expect.bodyBytes !== undefined) assert.deepEqual(response.bytes,
    Buffer.isBuffer(expect.bodyBytes) ? expect.bodyBytes : Buffer.from(expect.bodyBytes), 'body bytes');
  if (expect.body !== undefined) fact(body, expect.body, 'body');
  for (const rule of expect.xml ?? []) {
    const values = xpath(body, rule.xpath, {...NS, ...expect.namespaces});
    if (rule.count !== undefined) assert.equal(values.length, rule.count, rule.xpath);
    else {
      assert.ok(values.length, `XPath selected nothing: ${rule.xpath}`);
      if (Array.isArray(rule.value)) fact(values, rule.value, rule.xpath);
      else values.forEach(v => fact(v, rule.value ?? rule.regexp, rule.xpath));
    }
  }
  if (expect.json !== undefined) {
    const json = expect.normalize ? normalize(JSON.parse(response.body), expect.normalize) : JSON.parse(response.body);
    for (const [key, value] of Object.entries(expect.json)) fact(json[key], value, `JSON ${key}`);
  }
  for (const [key, value] of Object.entries(expect.headers ?? {})) fact(response.headers.get(key), value, key);
}
