import {name} from '../fixtures/source.mjs';
import {expected} from '../fixtures/outline.mjs';
import {outlineBytes} from '../fixtures/bytes.mjs';
const path = `/oo/classes/${name.toLowerCase()}/objectstructure`;
// All five read contracts compare the complete independent #642 fixture, including
// main/global members, local helper methods, test methods, coordinates and text elements.
export default [
  ['O1', 'global-members', 'application/vnd.sap.adt.objectstructure.v2+xml', {}],
  ['O2', 'local-class-methods', 'application/vnd.sap.adt.objectstructure+xml', {}],
  ['O3', 'test-class-methods', 'application/xml', {}],
  ['O4', 'source-coordinates', '*/*', {}],
  ['O5', 'active-structure', 'application/vnd.sap.adt.objectstructure.v2+xml', {version: 'active'}],
].map(([point, title, accept, query]) => ({id: `${point}-${title}`, point, title,
  request: {path, query, headers: {accept}},
  expect: {status: 200, contentType: `application/vnd.sap.adt.objectstructure${['application/xml', 'application/vnd.sap.adt.objectstructure+xml'].includes(accept) ? '' : '.v2'}+xml; charset=utf-8`,
    bodyBytes: outlineBytes(expected, {base: '/sap/bc/adt' + path})},
}));
