import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {adtSourceHash, adtSourceNames, checkGate} from '../tools/osd-adt-gogen-gate.mjs';

const gate = fileURLToPath(new URL('../tools/osd-adt-gogen-gate.mjs', import.meta.url));
const gap = 'ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE';
const baseline = [{kind: 'statement stub', entry: gap, reason: 'DELETE TABLE is not compiled'}];
const report = (overrides = {}) => ({classes: [...adtSourceNames()], adtSourceHash: adtSourceHash(),
  statementStubs: [gap], methodsNotCompiled: [], ...overrides});

function cli(input, allowlist = baseline) {
  const dir = mkdtempSync(join(tmpdir(), 'adt-gate-'));
  try {
    const reportPath = join(dir, 'report.json');
    const allowPath = join(dir, 'allowlist.json');
    if (input !== undefined) writeFileSync(reportPath, typeof input === 'string' ? input : JSON.stringify(input));
    writeFileSync(allowPath, JSON.stringify(allowlist));
    return spawnSync(process.execPath, [gate, reportPath, allowPath], {encoding: 'utf8'});
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

function fails(input, allowlist, message, code = 1) {
  const result = cli(input, allowlist);
  assert.equal(result.status, code, result.stdout + result.stderr);
  assert.match(result.stderr, message);
  assert.doesNotMatch(result.stdout, /0 gate failures/);
}

describe('ADT gogen compile gate', () => {
  it('allows current gaps and ignores unrelated classes (CLI exit 0)', () => {
    const input = report({statementStubs: [gap, 'ZCL_OTHER=>SAFE: unrelated']});
    assert.deepEqual(checkGate(input, baseline), {observed: [`statement stub: ${gap}`], unmatched: [], obsolete: []});
    const result = cli(input);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 gate failures/);
  });

  for (const name of ['ZCX_OSD_ADT', 'ZCL_OSD_KERNEL_GUARD', 'ZCL_OSD_ENQ_KERNEL', 'ZIF_OSD_ADT_ROUTE']) {
    it(`rejects a new method stub in real covered source ${name} (CLI exit 1)`, () => {
      assert.ok(adtSourceNames().has(name));
      const entry = `${name}=>DOCUMENT: newly unsupported`;
      const input = report({methodsNotCompiled: [entry]});
      assert.deepEqual(checkGate(input, baseline).unmatched, [`method not compiled: ${entry}`]);
      fails(input, baseline, /not allowed: method not compiled:/);
    });
  }

  it('cross-checks ADT prefixes even outside source membership (CLI exit 1)', () => {
    const input = report({methodsNotCompiled: ['ZCX_OSD_ADT_NEW=>DOCUMENT: unsupported', 'ZIF_OSD_ADT_NEW=>HANDLE: unsupported']});
    assert.equal(checkGate(input, baseline).unmatched.length, 2);
    fails(input, baseline, /not allowed:/);
  });

  it('rejects a new statement stub (CLI exit 1)', () => {
    const entry = 'ZCL_OSD_KERNEL_GUARD=>CALL_CLASSRUN: new statement';
    const input = report({statementStubs: [gap, entry]});
    assert.deepEqual(checkGate(input, baseline).unmatched, [`statement stub: ${entry}`]);
    fails(input, baseline, /not allowed: statement stub:/);
  });

  it('rejects another kernel statement beyond the exact expanded baseline (CLI exit 1)', () => {
    const allowlist = JSON.parse(readFileSync(new URL('../tools/osd-adt-gogen-allowlist.json', import.meta.url), 'utf8'));
    const known = allowlist.filter(entry => entry.entry.startsWith('ZCL_OSD_KERNEL_GUARD=>'));
    assert.equal(known.length, 7);
    const input = report({statementStubs: [...allowlist.map(entry => entry.entry),
      'ZCL_OSD_KERNEL_GUARD=>CALL_CLASSRUN (zcl_osd_kernel_guard.clas.abap:39): newly unsupported']});
    fails(input, allowlist, /not allowed: statement stub: ZCL_OSD_KERNEL_GUARD.*newly unsupported/);
  });

  it('rejects stale allowlist entries (CLI exit 1)', () => {
    const allowlist = [...baseline, {kind: 'method not compiled', entry: 'ZCX_OSD_ADT=>OLD: fixed', reason: 'obsolete'}];
    assert.deepEqual(checkGate(report(), allowlist).obsolete, ['method not compiled: ZCX_OSD_ADT=>OLD: fixed']);
    fails(report(), allowlist, /allowlist entry no longer occurs:/);
  });

  it('rejects duplicate observations (CLI exit 1)', () => {
    const input = report({statementStubs: [gap, gap]});
    assert.deepEqual(checkGate(input, baseline).unmatched, [`statement stub: ${gap}: duplicate`]);
    fails(input, baseline, /not allowed: .*duplicate/);
  });

  it('rejects a missing report file distinctly (CLI exit 2)', () => {
    fails(undefined, baseline, /missing compile report file:/, 2);
  });
  it('rejects malformed JSON distinctly (CLI exit 2)', () => {
    fails('{broken', baseline, /malformed JSON in compile report:/, 2);
  });
  it('rejects a zero-byte report distinctly (CLI exit 2)', () => {
    fails('', [], /malformed JSON in compile report:/, 2);
  });
  it('rejects a report with no classes even with an empty allowlist (CLI exit 2)', () => {
    const input = report({classes: [], statementStubs: []});
    assert.throws(() => checkGate(input, []), /empty compile report: no classes compiled \(build produced nothing\)/);
    fails(input, [], /empty compile report: no classes compiled/, 2);
  });
  it('rejects a build with no covered classes (CLI exit 2)', () => {
    fails(report({classes: ['ZCL_OTHER'], statementStubs: []}), [], /empty ADT build: no covered classes compiled/, 2);
  });
  for (const field of ['classes', 'statementStubs', 'methodsNotCompiled']) {
    it(`rejects missing ${field} (CLI exit 2)`, () => {
      const input = report();
      delete input[field];
      fails(input, baseline, /invalid compile report:/, 2);
    });
  }
  it('rejects invalid report entries (CLI exit 2)', () => {
    fails(report({classes: [null]}), [], /class names must be nonempty strings/, 2);
    fails(report({statementStubs: [null]}), [], /must be an array of strings/, 2);
  });
  it('rejects a stale source fingerprint (CLI exit 2)', () => {
    fails(report({adtSourceHash: 'old build'}), baseline, /stale compile report: ADT source fingerprint/, 2);
    fails(report({adtSourceHash: undefined}), baseline, /stale compile report: ADT source fingerprint/, 2);
  });
  it('allows a nonempty, covered build with no gaps and no allowlist (CLI exit 0)', () => {
    assert.equal(cli(report({statementStubs: []}), []).status, 0);
  });
  it('reports usage errors (CLI exit 2)', () => {
    const result = spawnSync(process.execPath, [gate], {encoding: 'utf8'});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  });
});
