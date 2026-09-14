#!/usr/bin/env python3
"""Offline ADT capture corpus. Standard library only; never sends requests.

See docs/adt-corpus.md. Generated artifacts contain private capture data.
"""
import argparse
import base64
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qsl, urlsplit, unquote
import xml.etree.ElementTree as ET
import zlib


def digest(value):
    raw = value if isinstance(value, bytes) else json.dumps(value, sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()


def headers(part):
    return {k.lower(): v for k, v in part.get('headers', {}).items()}


def route(url):
    """Explicit collection boundaries; preserve suffixes and encoded slashes."""
    path = urlsplit(url).path
    for collection in ('oo/classes', 'oo/interfaces', 'programs/programs',
                       'programs/includes', 'functions/groups', 'ddic/ddl/sources',
                       'ddic/dtel', 'ddic/domains', 'ddic/tables', 'ddic/views',
                       'ddic/structures', 'ddic/srvd/sources', 'ddic/bdef/sources'):
        path = re.sub(r'(/sap/bc/adt/' + collection + r')/[^/]+', r'\1/{object}', path)
    path = re.sub(r'(/fmodules)/[^/]+', r'\1/{object}', path)
    path = re.sub(r'(/sap/bc/adt/packages)/(?!settings(?:/|$)|valuehelps(?:/|$))[^/]+',
                  r'\1/{object}', path)
    path = re.sub(r'(/sap/bc/adt/core/http/sessions)/[^/]+', r'\1/{session}', path)
    return path


def form(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if value == '':
        return 'empty'
    if re.fullmatch(r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}', value):
        return 'uuid'
    if re.fullmatch(r'[0-9a-fA-F]{32}', value):
        return 'hex32-candidate'
    if re.match(r'^\d{4}-\d\d-\d\dT', value):
        return 'timestamp-candidate'
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', value):
        return 'absolute-uri'
    if value.startswith('//'):
        return 'network-path'
    if value.startswith('/'):
        return 'root-relative-path'
    if '/' in value and not re.search(r'\s', value):
        return 'relative-path-candidate'
    return 'string'


def decode(part):
    body = part.get('body') or {}
    if body.get('truncated'):
        raise ValueError('truncated body')
    raw = base64.b64decode(body.get('base64', ''), validate=True)
    if body.get('bytes', len(raw)) != len(raw):
        raise ValueError('captured byte count mismatch')
    for enc in reversed(str(headers(part).get('content-encoding', '')).lower().split(',')):
        enc = enc.strip()
        if enc == 'gzip':
            raw = gzip.decompress(raw)
        elif enc == 'deflate':
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        elif enc == 'br':
            # Node is already a repository prerequisite. No npm package or network.
            proc = subprocess.run(['node', '-e',
                                   'const fs=require("node:fs"),z=require("node:zlib");process.stdout.write(z.brotliDecompressSync(fs.readFileSync(0)))'],
                                  input=raw, capture_output=True, timeout=30)
            if proc.returncode:
                raise ValueError('Brotli decoding failed')
            raw = proc.stdout
        elif enc not in ('', 'identity'):
            raise ValueError('unsupported content-encoding: ' + enc)
    return raw


def profile(part):
    result = {'mime': str(headers(part).get('content-type', '')).split(';')[0].lower()}
    try:
        raw = decode(part)
        result.update(bytes=len(raw), sha256=digest(raw))
        if not raw:
            return dict(result, kind='empty', root=None, fields={}, links=[])
        xml = ('xml' in result['mime'] or raw.lstrip().startswith(b'<?xml') or
               (result['mime'] in ('', 'application/*', 'application/octet-stream') and raw.lstrip().startswith(b'<')))
        js = 'json' in result['mime']
        fields, links = {}, []

        def field(path, value=None, kind=None):
            f = fields.setdefault(path, {'count': 0, 'forms': [], 'examples': [], 'value_hashes': []})
            f['count'] += 1
            typ = kind or form(value)
            if typ not in f['forms']:
                f['forms'].append(typ)
            if kind is None and value not in f['examples'] and len(f['examples']) < 3:
                f['examples'].append(value[:180] if isinstance(value, str) else value)
            if kind is None and digest(value) not in f['value_hashes']:
                f['value_hashes'].append(digest(value))

        if xml:
            if re.search(br'<!\s*(DOCTYPE|ENTITY)', raw, re.I):
                raise ValueError('DTD/entity declarations are not supported')
            root = ET.fromstring(raw)

            def walk(el, parent):
                path = parent + '/' + el.tag
                field(path, kind='element')
                for name, value in sorted(el.attrib.items()):
                    field(path + '/@' + name, value)
                    if name.split('}')[-1].lower() in ('href', 'sourceuri', 'uri'):
                        links.append({'path': path + '/@' + name, 'value': value, 'form': form(value),
                                      'rel': el.attrib.get('rel')})
                if el.text and el.text.strip():
                    field(path + '/#text', el.text.strip())
                if el.tail and el.tail.strip():
                    field(path + '/#tail', el.tail.strip())
                # Child order is observed, but not assumed mandatory.
                if len(el):
                    field(path + '/#child-order', json.dumps([x.tag for x in el]))
                for child in el:
                    walk(child, path)
            walk(root, '')
            result.update(kind='xml', root=root.tag)
        elif js:
            data = json.loads(raw)

            def walk_json(value, path):
                if isinstance(value, dict):
                    field(path, kind='object')
                    for k, v in sorted(value.items()):
                        walk_json(v, path + '/' + k.replace('~', '~0').replace('/', '~1'))
                elif isinstance(value, list):
                    field(path, kind='array')
                    field(path + '/#length', len(value))
                    for v in value:
                        walk_json(v, path + '/*')
                else:
                    field(path, value)
            walk_json(data, '$')
            result.update(kind='json', root=type(data).__name__)
        else:
            try:
                text = raw.decode('utf-8')
                result.update(kind='text', root=None, preview=text[:160])
            except UnicodeDecodeError:
                result.update(kind='binary', root=None)
        for f in fields.values():
            f['forms'].sort()
            f['value_hashes'].sort()
        return dict(result, fields=fields, links=links)
    except (ValueError, OSError, ET.ParseError, zlib.error, subprocess.TimeoutExpired) as e:
        return dict(result, kind='unreadable', error=str(e), root=None, fields={}, links=[])


def structural(p):
    return {'kind': p['kind'], 'root': p['root'], 'mime': p['mime'],
            'fields': {k: {'count': v['count'], 'forms': v['forms']}
                       for k, v in p['fields'].items()}}


def empty_observation(p):
    if p['kind'] == 'empty':
        return True
    if p['kind'] == 'xml':
        collection_items = {'objectReferences': 'objectReference', 'feed': 'entry',
                            'checkRunReports': 'checkMessage', 'runResult': 'testMethod'}
        item = collection_items.get(p['root'].split('}')[-1])
        if item:
            return not any(f['forms'] == ['element'] and (k.endswith('}' + item) or k.endswith('/' + item))
                           for k, f in p['fields'].items())
        # A bare XML container is not evidence that a nonempty result can be read.
        return sum(f['count'] for f in p['fields'].values() if f['forms'] == ['element']) <= 1
    if p['kind'] == 'json':
        return not any(f['examples'] for k, f in p['fields'].items() if not k.endswith('/#length'))
    return False


def differences(a, b):
    out = []
    for key in ('status', 'mime', 'kind', 'root'):
        if a.get(key) != b.get(key):
            out.append({'path': '$' + key, 'expected': a.get(key), 'actual': b.get(key)})
    for path in sorted(set(a['fields']) | set(b['fields'])):
        left, right = a['fields'].get(path), b['fields'].get(path)
        if left is None or right is None:
            out.append({'path': path, 'change': 'extra' if left is None else 'missing'})
        else:
            for key in ('forms', 'count'):
                if left[key] != right[key]:
                    out.append({'path': path, 'change': key, 'expected': left[key], 'actual': right[key]})
    return out


def query_signature(url):
    # Only documented binding slots lose their literal value in the match key.
    bindings = {'_', 'lockHandle', 'sap-contextid'}
    return sorted((k, '<binding>' if k in bindings else v) for k, v in parse_qsl(urlsplit(url).query, keep_blank_values=True))


def load_capture(side, path, records, errors):
    raw = path.read_bytes()
    for line, data in enumerate(raw.splitlines(), 1):
        ref = str(path.resolve()) + ':' + str(line)
        try:
            r = json.loads(data)
            if not all(k in r for k in ('method', 'url', 'request', 'response')):
                raise ValueError('not an HTTP exchange')
            req, res = profile(r['request']), profile(r['response'])
            res['status'] = r['response'].get('status')
            h = headers(r['request'])
            signature = {'query': query_signature(r['url']), 'accept': h.get('accept', ''),
                         'content-type': h.get('content-type', ''),
                         'sessiontype': h.get('x-sap-adt-sessiontype', ''),
                         'body-shape': digest(structural(req))}
            records.append({'id': len(records), 'side': side, 'ref': ref, 'file': str(path.resolve()),
                            'row': line, 'at': r.get('at'), 'url': r['url'], 'method': r['method'],
                            'resource': r['method'] + ' ' + route(r['url']),
                            'request_signature': signature, 'request': req, 'response': res,
                            'request_headers': headers(r['request']), 'response_headers': headers(r['response'])})
        except (ValueError, TypeError, KeyError) as e:
            errors.append({'ref': ref, 'error': str(e)})
    return {'path': str(path.resolve()), 'side': side, 'bytes': len(raw), 'sha256': digest(raw)}


def correlations(records):
    """Exact value reuse, scoped to capture file. Candidates, not inferred sessions."""
    occurrences = defaultdict(list)
    for r in records:
        for direction in ('request', 'response'):
            values = []
            for name, raw in r[direction + '_headers'].items():
                for v in raw if isinstance(raw, list) else [str(raw)]:
                    if name in ('cookie', 'set-cookie'):
                        for key, val in re.findall(r'(?:^|;\s*)([^=;]+)=([^;]*)', v):
                            if key.lower() not in ('path', 'domain', 'expires', 'samesite'):
                                values.append(('header/' + name + '/' + key, val))
                    elif name in ('x-csrf-token', 'sap-contextid', 'etag', 'if-match', 'if-none-match', 'sap-adt-request-id'):
                        values.append(('header/' + name, v))
            for path, f in r[direction]['fields'].items():
                if any(x in path.lower() for x in ('guid', 'token', 'session', 'lock_handle', 'lockhandle')) or set(f['forms']) & {'uuid', 'hex32-candidate'}:
                    # A shortened display example is not the original token.
                    values.extend((path, str(v)) for v in f['examples'] if digest(v) in f['value_hashes'])
            if direction == 'request':
                values.extend(('query/' + k, v) for k, v in parse_qsl(urlsplit(r['url']).query)
                              if k in ('lockHandle', 'sap-contextid', '_'))
            for path, val in values:
                if len(val) >= 8 and val.lower() not in ('required',):
                    occurrences[(r['file'], digest(val))].append({'id': r['id'], 'ref': r['ref'],
                                                               'direction': direction, 'path': path})
    return [{'file': f, 'value_sha256': h, 'occurrences': occ,
             'response_request_reuse': {o['direction'] for o in occ} == {'request', 'response'},
             'note': 'Exact reuse only; no causal ordering or session scope proved.'}
            for (f, h), occ in sorted(occurrences.items()) if len(occ) > 1]


def scan_vsp(root, resources):
    """Lexical inventory with provenance. No claim of Go call-graph resolution."""
    inventory, xml_tags, files = [], [], []
    for path in sorted((root / 'pkg/adt').glob('*.go')):
        content = path.read_text()
        files.append({'path': str(path.resolve()), 'sha256': digest(content.encode())})
        owner = '<package>'
        for line, text in enumerate(content.splitlines(), 1):
            match = re.match(r'func\s+(?:\([^)]*\)\s+)?(\w+)\(', text)
            if match:
                owner = match.group(1)
            ref = str(path.resolve()) + ':' + str(line)
            for literal in re.findall(r'"(/sap/(?:bc/adt|public)[^"\s]*)"', text):
                normalized = route(re.sub(r'%[sdv]', '{object}', literal))
                seen = [key for key in resources if key.split(' ', 1)[1] == normalized]
                inventory.append({'ref': ref, 'function_context': owner, 'literal': literal,
                                  'route': normalized, 'test': path.name.endswith('_test.go'),
                                  'comment': text.lstrip().startswith('//'),
                                  'observed_resources': seen})
            for tag in re.findall(r'xml:"([^"]*)"', text):
                xml_tags.append({'ref': ref, 'tag': tag, 'function_context': owner,
                                 'test': path.name.endswith('_test.go')})
    return {'method': 'lexical candidates, not a call graph or client execution',
            'files': files, 'url_literals': inventory, 'xml_tags': xml_tags}


def consumer_report(path, records, out):
    """Check retained row counts, so nil/empty Go results cannot become successes."""
    probes = json.loads(Path(path).read_text())
    by_ref = {r['ref']: r for r in records}
    summary = defaultdict(Counter)
    details = []
    for probe in probes:
        r = by_ref.get(probe['ref'])
        if r is None:
            raise ValueError('consumer report references an exchange outside this corpus')
        op, value = probe['operation'], probe.get('value')
        p = r['response']
        def count(name):
            return sum(f['count'] for k, f in p['fields'].items() if f['forms'] == ['element'] and
                       (k.endswith('}' + name) or k.endswith('/' + name)))
        expected, actual, structural_extra = None, None, 0
        if op == 'SearchObjectByType': expected, actual = count('objectReference'), len(value or [])
        elif op == 'GetPackage':
            # VSP deliberately skips grouping nodes without OBJECT_NAME (client.go).
            expected = sum(f['count'] for k, f in p['fields'].items()
                           if k.endswith('/SEU_ADT_REPOSITORY_OBJ_NODE/OBJECT_NAME/#text'))
            structural_extra = count('SEU_ADT_REPOSITORY_OBJ_NODE') - expected
            actual = sum(len((value or {}).get(k) or []) for k in ('objects', 'subPackages'))
        elif op == 'GetClassObjectStructure':
            # VSP's struct reads direct children, not descendants nested inside them.
            direct = '/' + p['root'] + '/' + p['root']
            expected, actual = p['fields'].get(direct, {}).get('count', 0), len((value or {}).get('Elements') or [])
            structural_extra = max(0, count('objectStructureElement') - 1 - expected)
        elif op == 'SyntaxCheck': expected, actual = count('checkMessage'), len(value or [])
        elif op == 'RunUnitTests': expected, actual = count('testClass'), len((value or {}).get('classes') or [])
        elif op in ('GetClass', 'GetProgram', 'GetInterface', 'GetDDLS'):
            expected = p.get('bytes', 0)
            text = (value or {}).get('main', '') if op == 'GetClass' else (value or '')
            actual = len(text.encode())
        status = 'client-error' if probe['status'] != 'decoded-not-semantic-proof' or not probe.get('consumed') else (
                 'count-mismatch' if expected != actual else 'empty-inconclusive' if expected == 0 else
                 'nonempty-count-retained' if expected is not None else 'not-checked')
        summary[(r['side'], op)][status] += 1
        details.append({'ref': r['ref'], 'operation': op, 'side': r['side'], 'status': status,
                        'observed_items_or_bytes': expected, 'consumed_items_or_bytes': actual})
        details[-1]['structural_rows_outside_consumer_contract'] = structural_extra
    (out / 'vsp-consumer-checks.json').write_text(json.dumps(details, ensure_ascii=False, indent=2) + '\n')
    lines = ['# VSP response-consumer results', '',
             'Actual VSP client with an injected HTTPDoer that cannot access the network.',
             'Synthetic HEAD/CSRF; request bodies/query may differ. This is response decoding, not session replay.',
             'Nonempty-count-retained checks item/byte count only, not all field values or semantics.',
             'Package grouping nodes without OBJECT_NAME and nested class descendants are counted separately: VSP does not expose them here.',
             'Source version hashes: vsp.json. Per-response results: vsp-consumer-checks.json.', '',
             '| Side | VSP operation | Results |', '| --- | --- | --- |']
    for (side, op), counts in sorted(summary.items()):
        lines.append('| ' + ' | '.join(map(markdown_cell, [side, op, dict(counts)])) + ' |')
    lines += ['', 'No captured cases means no result: notably this corpus does not prove lock/write/unlock or activation compatibility.']
    (out / 'VSP-CONSUMER.md').write_text('\n'.join(lines) + '\n')


def markdown_cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def build(args):
    records, errors, manifest = [], [], []
    for spec in args.capture:
        side, sep, name = spec.partition('=')
        if not sep or not side:
            raise ValueError('--capture must be SIDE=FILE')
        manifest.append(load_capture(side, Path(name), records, errors))
    grouped = defaultdict(list)
    for r in records:
        grouped[r['resource']].append(r)
    schemas, resources, comparisons = {}, {}, []
    for key, rows in sorted(grouped.items()):
        variants = defaultdict(list)
        for r in rows:
            for direction in ('request', 'response'):
                p = r[direction]
                sid = digest(structural(p))[:20]
                p['schema_id'] = sid
                if sid not in schemas:
                    schemas[sid] = dict(structural(p), examples=p['fields'], occurrences=[])
                schemas[sid]['occurrences'].append({'ref': r['ref'], 'side': r['side'], 'direction': direction})
            variant = digest([r['side'], r['request_signature'], r['response']['status'], r['response']['schema_id']])[:20]
            variants[variant].append(r['id'])
        resources[key] = {'counts': dict(Counter(r['side'] for r in rows)),
                          'variants': dict(variants), 'records': [r['id'] for r in rows]}
        references = {}
        for r in rows:
            if r['side'] == args.reference:
                references[(digest(r['request_signature']), r['response']['status'], r['response']['schema_id'])] = r
        candidates = [r for r in rows if r['side'] == args.target]
        for ref in references.values():
            comp = {'resource': key, 'reference': ref['id'], 'target': None}
            if not candidates:
                comparisons.append(dict(comp, result='not-observed-on-target', differences=[]))
                continue
            same_request = [r for r in candidates if r['request_signature'] == ref['request_signature']]
            pool = same_request or candidates
            same_url = [r for r in pool if r['url'] == ref['url']]
            # at is completion time, used only for choosing latest captured observation.
            target = max(same_url or pool, key=lambda r: (r['at'] or '', r['row']))
            diff = differences(ref['response'], target['response'])
            value_diff = [{'path': p, 'expected_examples': f['examples'],
                           'actual_examples': target['response']['fields'][p]['examples']}
                          for p, f in ref['response']['fields'].items()
                          if p in target['response']['fields'] and f['value_hashes'] != target['response']['fields'][p]['value_hashes']]
            unreadable = any(r[side]['kind'] == 'unreadable' for r in (ref, target) for side in ('request', 'response'))
            comparisons.append(dict(comp, target=target['id'],
                                    result='unreadable' if unreadable else 'observed-difference' if diff else 'empty-observation' if empty_observation(ref['response']) and empty_observation(target['response']) else 'observed-content-difference' if ref['response']['kind'] in ('text', 'binary') and ref['response']['sha256'] != target['response']['sha256'] else 'observed-shape-match',
                                    comparable_request=bool(same_request), same_url=bool(same_url),
                                    selection='latest completion among exact request signatures and URLs when available',
                                    differences=diff, value_differences=value_diff,
                                    body_identical=ref['response'].get('sha256') == target['response'].get('sha256'),
                                    note='Observed samples; differing objects/requests/cardinality may explain differences. Not a compatibility verdict.'))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'resources').mkdir(exist_ok=True)
    (out / 'schemas').mkdir(exist_ok=True)
    if getattr(args, 'export_bodies', False):
        (out / 'bodies').mkdir(exist_ok=True)
        source_rows = {m['path']: Path(m['path']).read_bytes().splitlines() for m in manifest}
        for r in records:
            original = json.loads(source_rows[r['file']][r['row'] - 1])
            for direction in ('request', 'response'):
                p = r[direction]
                if p['kind'] in ('empty', 'unreadable'):
                    continue
                suffix = {'xml': 'xml', 'json': 'json', 'text': 'txt', 'binary': 'bin'}[p['kind']]
                relative = f"bodies/{r['id']:05d}-{direction}.{suffix}"
                (out / relative).write_bytes(decode(original[direction]))
                p['body_file'] = relative
    def write(name, value):
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    write('manifest.json', manifest)
    write('records.json', records)
    write('resources.json', resources)
    write('comparisons.json', comparisons)
    write('correlations.json', correlations(records))
    write('errors.json', errors)
    if getattr(args, 'consumer_report', None):
        consumer_report(args.consumer_report, records, out)
    for sid, schema in schemas.items():
        write('schemas/' + sid + '.json', schema)
    if args.vsp:
        if not (Path(args.vsp) / 'pkg/adt').is_dir():
            raise ValueError('--vsp must contain pkg/adt')
        vsp = scan_vsp(Path(args.vsp), resources)
        write('vsp.json', vsp)
        lines = ['# VSP source inventory', '', vsp['method'], '',
                 '| Function context | URL literal | Capture operations | Source |', '| --- | --- | --- | --- |']
        for entry in vsp['url_literals']:
            if not entry['test'] and not entry['comment']:
                lines.append('| ' + ' | '.join(map(markdown_cell, [entry['function_context'], entry['literal'],
                             ', '.join(entry['observed_resources']) or 'not observed', entry['ref']])) + ' |')
        (out / 'VSP.md').write_text('\n'.join(lines) + '\n')
    lines = ['# ADT observed corpus', '',
             'Private generated data. Observations are not XSD or proof of client compatibility.', '',
             f'{len(records)} exchanges; {len(resources)} operations; {len(schemas)} observed shapes; {len(errors)} rejected rows.', '',
             'Comparisons use all reference variants and the latest matching target observation. Request mismatch is explicit.',
             'Query values, MIME versions, failures and history remain in records.json. No network requests were sent.', '',
             '| Operation | Samples by side | Variants | Details |', '| --- | --- | ---: | --- |']
    for key, resource in resources.items():
        rid = digest(key)[:16]
        lines.append('| ' + ' | '.join(map(markdown_cell, [key, resource['counts'], len(resource['variants']),
                     f'[resource](resources/{rid}.md)'])) + ' |')
        detail = ['# ' + key, '', 'Observed request/response variants; counts do not imply required cardinality.', '',
                  '| Side | Status | Kind / MIME | Shape | Body | Capture row |', '| --- | ---: | --- | --- | --- | --- |']
        for ids in resource['variants'].values():
            for i in (ids[:1] if len(ids) == 1 else [ids[0], ids[-1]]):
                r = records[i]; p = r['response']; sid = p['schema_id']
                detail.append('| ' + ' | '.join(map(markdown_cell, [r['side'], p['status'], p['kind'] + ' / ' + p['mime'],
                              f'[schema](../schemas/{sid}.json)', '[body](../' + p['body_file'] + ')' if 'body_file' in p else 'not exported', r['ref']])) + ' |')
        for comp in (c for c in comparisons if c['resource'] == key):
            detail += ['', '## ' + comp['result'], '', 'Reference: ' + records[comp['reference']]['ref']]
            if comp['target'] is not None:
                detail += ['', 'Target: ' + records[comp['target']]['ref'], '',
                           f"Same request signature: {comp['comparable_request']}; same URL: {comp['same_url']}; identical decoded body: {comp['body_identical']}.", '',
                           'Observed structural differences (all entries in comparisons.json):', '']
                detail += ['- ' + json.dumps(d, ensure_ascii=False) for d in comp['differences'][:35]]
                detail += ['', f"Value/example differences: {len(comp['value_differences'])}; not silently ignored, see comparisons.json."]
        (out / 'resources' / (rid + '.md')).write_text('\n'.join(detail) + '\n')
    lines += ['', '## Files', '',
              '- manifest.json: inputs and checksums.',
              '- records.json: every exchange, decoded profiles, values, links and source row.',
              '- bodies/: decoded XML/JSON/text/binary bodies when --export-bodies is supplied.',
              '- schemas/: namespace-aware paths, counts and value forms with provenance.',
              '- comparisons.json: structural AND value differences, candidate selection and uncertainty.',
              '- correlations.json: hashed candidate values reused across headers/query/body; no causal inference.',
              '- errors.json: rejected rows. Unreadable bodies remain in records.json.',
              '- VSP.md / vsp.json: lexical source inventory when --vsp is supplied.', '']
    if getattr(args, 'consumer_report', None):
        lines += ['[Actual VSP consumer checks](VSP-CONSUMER.md)', '']
    (out / 'README.md').write_text('\n'.join(lines))
    summary = {'records': len(records), 'resources': len(resources), 'schemas': len(schemas),
               'rejected_rows': len(errors), 'unreadable_bodies': sum(r[d]['kind'] == 'unreadable' for r in records for d in ('request', 'response')),
               'comparisons': dict(Counter(c['result'] for c in comparisons)), 'out': str(out.resolve())}
    write('summary.json', summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 2 if errors or summary['unreadable_bodies'] else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='append', required=True, metavar='SIDE=FILE')
    parser.add_argument('--reference', default='a4h')
    parser.add_argument('--target', default='osd')
    parser.add_argument('--out', required=True)
    parser.add_argument('--vsp', help='VSP checkout root (optional, read only)')
    parser.add_argument('--consumer-report', help='JSON from adt-vsp-consume.go, optional')
    parser.add_argument('--export-bodies', action='store_true', help='export decoded bodies beside profiles (private data)')
    args = parser.parse_args()
    try:
        return build(args)
    except (OSError, ValueError) as exc:
        parser.exit(2, str(exc) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
