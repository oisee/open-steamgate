"""Regression tests for the former audit's false positives; no live systems."""
import base64
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('corpus', Path(__file__).resolve().parents[1] / 'tools/adt-corpus.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def part(text, mime='application/xml', compress=False):
    data = text.encode()
    h = {'content-type': mime}
    if compress:
        data = gzip.compress(data)
        h['content-encoding'] = 'gzip'
    return {'headers': h, 'body': {'bytes': len(data), 'truncated': False, 'base64': base64.b64encode(data).decode()}}


class CorpusTest(unittest.TestCase):
    def test_namespace_aliases_are_equivalent(self):
        a = c.profile(part('<a:r xmlns:a="urn:test"><a:x a:v="1"/></a:r>'))
        b = c.profile(part('<b:r xmlns:b="urn:test"><b:x b:v="1"/></b:r>'))
        self.assertEqual(c.structural(a), c.structural(b))

    def test_wrong_parent_is_not_equivalent(self):
        a = c.profile(part('<r><x><y/></x></r>'))
        b = c.profile(part('<r><x/><y/></r>'))
        self.assertTrue(c.differences(a, b))

    def test_uri_shape_and_cardinality(self):
        a = c.profile(part('<r><x sourceUri="source/main"/><x/></r>'))
        b = c.profile(part('<r><x sourceUri="/sap/bc/adt/x/source/main"/></r>'))
        self.assertEqual({d.get('change') for d in c.differences(a, b)}, {'forms', 'count'})

    def test_text_xml_and_parse_error_never_match(self):
        xml = c.profile(part('<r/>'))
        text = c.profile(part('<r/>', 'text/plain'))
        bad = c.profile(part('<r>'))
        self.assertTrue(c.differences(xml, text))
        self.assertEqual(bad['kind'], 'unreadable')

    def test_compression_and_truncation(self):
        self.assertEqual(c.structural(c.profile(part('<r/>', compress=True))), c.structural(c.profile(part('<r/>'))))
        p = part('<r/>'); p['body']['truncated'] = True
        self.assertEqual(c.profile(p)['kind'], 'unreadable')

    def test_collections_and_significant_queries(self):
        self.assertEqual(c.route('/sap/bc/adt/oo/classes/%2FDEMO%2FCL_A/includes/definitions'), '/sap/bc/adt/oo/classes/{object}/includes/definitions')
        self.assertEqual(c.route('/sap/bc/adt/packages/settings'), '/sap/bc/adt/packages/settings')
        self.assertNotEqual(c.query_signature('/x?_action=LOCK'), c.query_signature('/x?_action=UNLOCK'))
        self.assertEqual(c.query_signature('/x?_=123'), c.query_signature('/x?_=456'))

    def test_empty_containers_are_inconclusive(self):
        self.assertTrue(c.empty_observation(c.profile(part('<r/>'))))
        self.assertTrue(c.empty_observation(c.profile(part('[]', 'application/json'))))
        self.assertFalse(c.empty_observation(c.profile(part('<r><entry/></r>'))))
        self.assertTrue(c.empty_observation(c.profile(part('<checkRunReports><checkReport><checkMessageList/></checkReport></checkRunReports>'))))

    def test_values_beyond_examples_remain_detectable(self):
        a = c.profile(part('<r><x>a</x><x>b</x><x>c</x><x>d</x></r>'))
        b = c.profile(part('<r><x>a</x><x>b</x><x>c</x><x>e</x></r>'))
        self.assertEqual(a['fields']['/r/x/#text']['examples'], b['fields']['/r/x/#text']['examples'])
        self.assertNotEqual(a['fields']['/r/x/#text']['value_hashes'], b['fields']['/r/x/#text']['value_hashes'])

    def test_exact_reuse_is_scoped_to_capture(self):
        def row(i, file, incoming, outgoing):
            return {'id': i, 'ref': file + ':' + str(i), 'file': file, 'url': '/x',
                    'request_headers': {'x-csrf-token': incoming},
                    'response_headers': {'x-csrf-token': outgoing},
                    'request': {'fields': {}}, 'response': {'fields': {}}}
        result = c.correlations([row(1, 'one', 'fetch', '123456789token'), row(2, 'one', '123456789token', 'newtoken123'),
                                 row(3, 'two', '123456789token', 'something-else')])
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]['response_request_reuse'])
        self.assertNotIn('123456789token', json.dumps(result))

    def test_end_to_end_keeps_history_errors_and_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def row(body, status=200):
                return {'at': '2026-01-01T00:00:00Z', 'method': 'GET', 'url': '/sap/bc/adt/oo/classes/demo',
                        'request': part('', 'text/plain'), 'response': dict(body, status=status)}
            a = root / 'a.jsonl'; b = root / 'b.jsonl'
            a.write_text(json.dumps(row(part('<r/>'))) + '\n')
            b.write_text('\n'.join(json.dumps(r) for r in [row(part('wrong', 'text/plain')), row(part('<r/>')), row(part('<error/>'), 404)]) + '\nnot json\n')
            out = root / 'out'
            rc = c.build(SimpleNamespace(capture=['a4h=' + str(a), 'osd=' + str(b)], reference='a4h', target='osd', out=str(out), vsp=None))
            self.assertEqual(rc, 2)
            self.assertEqual(len(json.loads((out / 'records.json').read_text())), 4)
            self.assertEqual(len(json.loads((out / 'errors.json').read_text())), 1)
            self.assertEqual(len(list((out / 'resources').glob('*.md'))), 1)
            comp = json.loads((out / 'comparisons.json').read_text())[0]
            self.assertEqual(comp['result'], 'observed-difference')
            self.assertEqual(comp['target'], 3)  # latest response, not a convenient older 200


if __name__ == '__main__':
    unittest.main()
