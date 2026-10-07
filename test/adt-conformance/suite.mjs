import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runJS} from './js.mjs';
import {normalize} from './normalize.mjs';
import {xpath, assertResponse} from './assertions.mjs';
import {Session} from './session.mjs';
import {loadCases, classify, validateExpected, run, recordUnavailable} from './run.mjs';
import {mergeSquare} from './square.mjs';

describe('shared ADT conformance runner contracts', function () {
  this.timeout(180000);
  it('normalizes volatile identity without destroying protocol coordinates or handle lengths', () => {
    const json = normalize({userName: 'synthetic', client: '123', lockHandle: 'abc123', generation_id: 'abcdef', name: 'ZCL_FIX'});
    assert.deepEqual(json, {userName: '{username}', client: '{client}', lockHandle: '******', generation_id: '******', name: 'ZCL_FIX'});
    const xml = normalize('<LOCK_HANDLE>012345</LOCK_HANDLE><x href="http://example.invalid/a#start=2,6;end=2,28" etag="abcd" changedBy="synthetic"/>', {host: 'http://example.invalid'});
    assert.equal(normalize("<x session-id='abc123' client='123'><a:changedBy xmlns:a='urn:x'>synthetic</a:changedBy></x>"),
      "<x session-id='******' client='{client}'><a:changedBy xmlns:a='urn:x'>{changedby}</a:changedBy></x>");
    assert.equal(xml, '<LOCK_HANDLE>******</LOCK_HANDLE><x href="{host}/a#start=2,6;end=2,28" etag="****" changedBy="{changedby}"/>');
  });
  it('selects namespace-aware XML paths and rejects unsupported XPath', () => {
    const xml = '<q:root xmlns:q="urn:fixture"><q:item id="1">a&amp;b</q:item><q:item id="2">other</q:item></q:root>';
    assert.deepEqual(xpath(xml, '/p:root/p:item[@id="1"]/text()', {p: 'urn:fixture'}), ['a&b']);
    assert.deepEqual(xpath(xml, '//p:item/@id', {p: 'urn:fixture'}), ['1', '2']);
    assert.deepEqual(xpath('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:content src="fixture"/></atom:entry></atom:feed>',
      '/atom:feed/atom:entry/atom:content/@src'), ['fixture']);
    assert.throws(() => xpath('<r xmlns:a="urn:x" xmlns:b="urn:x" a:id="1" b:id="2"/>', '/r'), /duplicate expanded attribute/);
    assert.throws(() => xpath('<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>', '/r'), /declarations/);
    assert.throws(() => xpath(xml, '//p:item[2]', {p: 'urn:fixture'}), /unsupported XPath/);
    assert.throws(() => assertResponse({status: 200, headers: new Headers(), body: xml, bytes: Buffer.from(xml)},
      {status: 200, xml: [{xpath: '//p:missing', value: 'x'}], namespaces: {p: 'urn:fixture'}}), /selected nothing/);
  });
  it('makes unexpected improvements fail and rejects stale/missing expected entries', async () => {
    assert.equal(classify(true, 'known-gap: route 404'), 'fail');
    assert.equal(classify(false, 'known-gap: route 404'), 'known-gap');
    assert.equal(classify(false), 'fail');
    assert.equal(classify(true, 'n/a: unsupported object kind'), 'not-applicable');
    const cases = await loadCases();
    validateExpected(JSON.parse(readFileSync(new URL('./expected/osgo.json', import.meta.url), 'utf8')), cases);
    assert.throws(() => validateExpected({}, cases), /missing expectation/);
    assert.throws(() => validateExpected({obsolete: 'pass'}, cases), /unknown expected case/);
  });
  it('keeps repeated cookies and refreshed cookie values across requests', async () => {
    const app = express();
    app.head('/sap/bc/adt/core/discovery', (req, res) => {
      res.setHeader('set-cookie', ['first=old; Path=/', 'second=two; Path=/']);
      res.setHeader('x-csrf-token', 'synthetic-token'); res.end();
    });
    app.get('/sap/bc/adt/probe', (req, res) => {
      assert.match(req.headers.cookie, /first=old/); assert.match(req.headers.cookie, /second=two/);
      assert.equal(req.headers['x-csrf-token'], 'synthetic-token');
      res.setHeader('set-cookie', 'first=new; Path=/'); res.end('ok');
    });
    const server = await new Promise(resolve => {const s = app.listen(0, '127.0.0.1', () => resolve(s));});
    try {const session = await new Session(`http://127.0.0.1:${server.address().port}`).login();
      assert.equal((await session.request({path: '/probe'})).body, 'ok'); assert.equal(session.cookies.get('first'), 'new');}
    finally {await new Promise(resolve => server.close(resolve));}
  });
  it('reports failed login as failure rather than a known gap', async () => {
    const app = express(); app.use((req, res) => res.sendStatus(404));
    const server = await new Promise(resolve => {const s = app.listen(0, '127.0.0.1', () => resolve(s));});
    const output = mkdtempSync(join(tmpdir(), 'adt-report-'));
    try {
      const result = await run({target: 'osgo', base: `http://127.0.0.1:${server.address().port}`,
        expectedFile: new URL('./expected/osgo.json', import.meta.url), only: ['C3-head'], output, say: () => {}});
      assert.equal(result.exitCode, 1); assert.equal(result.cases[0].status, 'fail');
      assert.match(result.cases[0].detail, /login/);
      const unavailable = await recordUnavailable({expectedFile: new URL('./expected/osgo.json', import.meta.url), output,
        reason: 'osgo: not mountable on this main'});
      assert.ok(unavailable.cases.every(c => c.observed === false && c.status === 'known-gap'));
    } finally {await new Promise(resolve => server.close(resolve)); rmSync(output, {recursive: true, force: true});}
  });
  it('merges latest evidence without inventing A4H observations', () => {
    const cases = [{id: 'C1', point: 'C1', title: 'discovery'}];
    const report = (createdAt, status) => ({schema: 1, target: 'js', createdAt, cases: [{id: 'C1', status, observed: true}]});
    const square = mergeSquare(cases, [report('2026-01-02', 'pass'), report('2026-01-01', 'fail'), {target: 'irrelevant'}]);
    assert.equal(square[0].js.status, 'pass'); assert.equal(square[0].a4h.status, 'not-measured');
    assert.throws(() => mergeSquare(cases, [report('2026-01-02', 'pass'), report('2026-01-02', 'fail')]), /conflicting/);
  });
  it('runs every read and lock case through the existing JS server helper', async () => {
    const result = await runJS();
    assert.equal(result.exitCode, 0, JSON.stringify(result.summary));
  });
});
