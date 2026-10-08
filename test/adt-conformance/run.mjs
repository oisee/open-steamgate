import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Session} from './session.mjs';
import {assertResponse} from './assertions.mjs';

export async function loadCases() {
  const all = [];
  for (const file of readdirSync(new URL('./cases/', import.meta.url)).filter(f => f.endsWith('.mjs')).sort()) {
    all.push(...(await import(new URL('./cases/' + file, import.meta.url))).default);
  }
  const ids = new Set();
  for (const c of all) {
    assert.ok(c.id && c.point && c.title && c.request && Number.isInteger(c.expect?.status), 'invalid case');
    assert.ok(!ids.has(c.id), `duplicate case ${c.id}`); ids.add(c.id);
  }
  return all;
}
export function classify(passed, expected = 'pass') {
  if (expected.startsWith('n/a: ')) return 'not-applicable';
  if (expected.startsWith('known-gap: ')) return passed ? 'fail' : 'known-gap';
  assert.equal(expected, 'pass', 'invalid expectation');
  return passed ? 'pass' : 'fail';
}
export function validateExpected(expected, cases) {
  const ids = new Set(cases.map(c => c.id));
  for (const [id, value] of Object.entries(expected)) {
    assert.ok(ids.has(id), `unknown expected case ${id}`);
    assert.ok(value === 'pass' || /^(known-gap|n\/a): .+/.test(value), `invalid expectation for ${id}`);
  }
  for (const id of ids) assert.ok(Object.hasOwn(expected, id), `missing expectation ${id}`);
}
function writeReport(target, results, output, extra = {}) {
  const summary = Object.fromEntries(['pass', 'fail', 'known-gap', 'not-applicable'].map(s => [s, results.filter(r => r.status === s).length]));
  const report = {schema: 1, target, createdAt: new Date().toISOString(), ...extra, summary, cases: results};
  mkdirSync(output, {recursive: true});
  writeFileSync(join(output, `adt-conformance-${target}.json`), JSON.stringify(report, null, 2) + '\n');
  return {...report, exitCode: summary.fail || (extra.runErrors?.length && !extra.missingEvidenceAdvisory) ? 1 : 0};
}
export async function run({target, base, expectedFile, only, output = 'suite-results', writePackage = process.env.ADT_WRITE_PACKAGE, say = console.log}) {
  assert.ok(['js', 'osgo', 'a4h'].includes(target), 'unknown target');
  assert.ok(base, '--base is required');
  assert.ok(target !== 'js' || !expectedFile, 'JS cannot use an expected-gap file');
  const all = await loadCases();
  const expected = expectedFile ? JSON.parse(readFileSync(expectedFile, 'utf8')) : {};
  if (expectedFile) validateExpected(expected, all);
  const selected = only ? new Set(only) : undefined;
  if (selected) for (const id of selected) assert.ok(all.some(c => c.id === id), `unknown --only id ${id}`);
  const cases = all.filter(c => !selected || selected.has(c.id));
  assert.ok(cases.length, 'no cases selected');
  const results = [];
  let discoverySucceeded = false, executedCases = 0, targetAnswered = false, handshakeStatus;
  for (const c of cases) {
    const wants = expected[c.id] ?? 'pass';
    let status, detail, actual, stage = 'login';
    const sessions = [];
    const ctx = {writePackage, newSession: async () => {
      const s = new Session(base); sessions.push(s);
      try {return await s.login();}
      finally {
        targetAnswered ||= !!s.handshakeResponse;
        handshakeStatus ??= s.handshakeResponse?.status;
      }
    }};
    let response;
    let targetResponse;
    if (wants.startsWith('n/a: ')) {status = 'not-applicable'; detail = wants.slice(5);}
    else {
      let error;
      try {
        ctx.session = await ctx.newSession();
        stage = 'discovery';
        if (!discoverySucceeded) {
          const discovery = await ctx.session.request({path: '/core/discovery'});
          targetResponse = discovery;
          assert.equal(discovery.status, 200, 'discovery status');
          discoverySucceeded = true;
          targetResponse = undefined;
        }
        stage = 'setup'; await c.setup?.(ctx);
        stage = 'request';
        const request = typeof c.request === 'function' ? await c.request(ctx) : c.request;
        response = await (request.session ? ctx[request.session] : ctx.session).request(request);
        targetResponse = response;
        executedCases++;
        actual = {status: response.status, contentType: response.headers.get('content-type'), bodyBytes: response.bytes.length};
        stage = 'assert'; assertResponse(response, c.expect);
      } catch (e) {error = e;}
      let cleanupError;
      // An assertion inside after() checks the case's own contract (a lock
      // reacquired, a lock surviving a read): it is case evidence like the
      // request's assertions. Anything else there is cleanup.
      try {if (ctx.session) await c.after?.(ctx, response);} catch (e) {
        if (e.code === 'ERR_ASSERTION' && !e.cleanupFailure) {if (!error) {error = e; stage = 'after';}} else cleanupError = e;
      }
      for (const s of sessions.reverse()) try {await s.close();} catch (e) {cleanupError ??= e;}
      if (!ctx.session && sessions.length) targetResponse ??= sessions.at(-1).handshakeResponse;
      if (targetResponse) targetAnswered = true;
      // A complete HTTP response is target evidence; transport and cleanup failures are not.
      const eligible = !cleanupError && (!!targetResponse || !error || stage === 'assert' || (stage === 'setup' && error.code === 'ERR_ASSERTION'));
      status = eligible ? classify(!error, wants) : 'fail';
      detail = cleanupError ? `cleanup: ${cleanupError.message.split('\n')[0]}` : error
        ? `${stage}: ${error.message.split('\n')[0]}` : wants.startsWith('known-gap: ') ? 'unexpected pass: update the expected file' : undefined;
      if (targetResponse && targetResponse !== response) actual = {status: targetResponse.status,
        contentType: targetResponse.headers.get('content-type'), bodyBytes: targetResponse.bytes.length};
    }
    const row = {id: c.id, point: c.point, title: c.title, status, observed: !!actual,
      ...(wants !== 'pass' ? {expected: wants} : {}), ...(actual ? {actual} : {}), ...(detail ? {detail} : {})};
    results.push(row); say(`${status.padEnd(14)} ${c.id}${detail ? ': ' + detail : ''}`);
  }
  const runErrors = [];
  if (!executedCases) runErrors.push('no executed cases');
  if (!discoverySucceeded) runErrors.push('no successful discovery request');
  const hasExpectedPass = target === 'js' || Object.values(expected).includes('pass');
  const observedAllEligible = cases.filter(c => !(expected[c.id] ?? 'pass').startsWith('n/a: ')).length
    === results.filter(r => r.observed).length;
  const missingEvidenceAdvisory = targetAnswered && !hasExpectedPass && observedAllEligible;
  const report = writeReport(target, results, output, {executedCases, discoverySucceeded, targetAnswered,
    ...(handshakeStatus !== undefined ? {handshakeStatus} : {}), missingEvidenceAdvisory, runErrors});
  for (const error of runErrors) say(`run failure: ${error}`);
  say(`${target}: ${Object.entries(report.summary).map(([s, n]) => `${n} ${s}`).join(', ')}`);
  return report;
}
// Explicitly unobserved inventory for a tree whose host has no ADT mounting flag.
// This must never be confused with an HTTP run or manufacture passing evidence.
export async function recordUnavailable({target = 'osgo', expectedFile, output = 'suite-results', reason}) {
  const cases = await loadCases(), expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  validateExpected(expected, cases);
  assert.ok(reason, 'unavailable reason is required');
  for (const c of cases) assert.ok(expected[c.id].startsWith('known-gap: '), `${c.id} is not a known gap`);
  return writeReport(target, cases.map(c => ({id: c.id, point: c.point, title: c.title,
    status: 'known-gap', observed: false, expected: expected[c.id], detail: reason})), output, {availability: reason});
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), opts = {};
    while (args.length) {
      const key = args.shift(); assert.ok(['--target', '--base', '--expected', '--only', '--output', '--unavailable', '--write-package'].includes(key), `unknown option ${key}`);
      const value = args.shift(); assert.ok(value && !value.startsWith('--'), `${key} needs a value`);
      opts[{'--target': 'target', '--base': 'base', '--expected': 'expectedFile', '--only': 'only', '--output': 'output', '--unavailable': 'reason', '--write-package': 'writePackage'}[key]] = value;
    }
    if (opts.only) opts.only = opts.only.split(',');
    opts.expectedFile ??= opts.target === 'osgo' ? new URL('./expected/osgo.json', import.meta.url) : undefined;
    if (opts.reason) {assert.equal(opts.target, 'osgo'); assert.ok(!opts.base && !opts.only);}
    const report = await (opts.reason ? recordUnavailable(opts) : run(opts));
    if (opts.reason) console.log(report.availability);
    process.exitCode = report.exitCode;
  } catch (error) {console.error(error.message); process.exitCode = 2;}
}
