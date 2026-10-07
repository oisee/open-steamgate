import assert from 'node:assert/strict';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
// ADT response names differ from request admission names (Atom content is not
// checkrun content). Validate well-formed XML without applying request schemas.
export function responseElements(xml) {
  assert.ok(Buffer.byteLength(xml) <= 16 * 1024 * 1024, 'XML response exceeds limit');
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'XML declarations are unsupported');
  assert.equal(XMLValidator.validate(xml), true, 'malformed XML response');
  const nodes = new XMLParser({preserveOrder: true, ignoreAttributes: false,
    trimValues: false, parseTagValue: false, parseAttributeValue: false}).parse(xml);
  const elements = [];
  const expanded = (name, bindings, attribute = false) => {
    const parts = name.split(':'); assert.ok(parts.length <= 2, 'invalid qualified name');
    if (parts.length === 1) return {local: name, uri: attribute ? '' : bindings.get('') ?? ''};
    assert.ok(bindings.get(parts[0]), `undeclared XML prefix ${parts[0]}`);
    return {local: parts[1], uri: bindings.get(parts[0])};
  };
  const visit = (nodes, parent, bindings, depth) => {
    assert.ok(depth <= 64, 'XML response exceeds depth limit');
    for (const node of nodes) {
      const name = Object.keys(node).find(k => k !== ':@');
      if (name === '#text') {if (parent) elements[parent - 1].text += node[name]; continue;}
      if (!name || name.startsWith('?') || name === '#comment') continue;
      const scope = new Map(bindings);
      const attrs = Object.entries(node[':@'] ?? {}).map(([k, v]) => [k.slice(2), v]);
      for (const [k, v] of attrs) if (k === 'xmlns' || k.startsWith('xmlns:')) {
        const prefix = k === 'xmlns' ? '' : k.slice(6);
        assert.ok(prefix !== 'xmlns' && v !== 'http://www.w3.org/2000/xmlns/', 'invalid namespace binding');
        assert.equal(prefix === 'xml', v === 'http://www.w3.org/XML/1998/namespace', 'invalid xml namespace binding');
        assert.ok(!prefix || v, 'empty prefixed namespace'); scope.set(prefix, v);
      }
      const attributes = attrs.filter(([k]) => k !== 'xmlns' && !k.startsWith('xmlns:'))
        .map(([k, value]) => ({...expanded(k, scope, true), value}));
      const ids = attributes.map(a => JSON.stringify([a.uri, a.local]));
      assert.equal(new Set(ids).size, ids.length, 'duplicate expanded attribute');
      elements.push({...expanded(name, scope), parent, text: '', attributes});
      const id = elements.length;
      visit(node[name], id, scope, depth + 1);
    }
  };
  visit(nodes, 0, new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]), 0);
  return elements;
}
