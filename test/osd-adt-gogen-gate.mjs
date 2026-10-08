import assert from 'node:assert/strict';
import {checkGate} from '../tools/osd-adt-gogen-gate.mjs';

describe('ADT gogen compile gate', () => {
  it('allows only current ADT compile gaps', () => {
    const allowlist = [{kind: 'statement stub', entry: 'ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE', reason: 'gogen case: DELETE TABLE is not compiled'}];
    const report = {
      statementStubs: ['ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE', 'ZCL_OTHER=>SAFE: unrelated'],
      methodsNotCompiled: ['ZIF_OSD_ADT_FOO=>BAR: unsupported']
    };
    assert.deepEqual(checkGate(report, allowlist), {
      observed: ['statement stub: ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE', 'method not compiled: ZIF_OSD_ADT_FOO=>BAR: unsupported'],
      unmatched: ['method not compiled: ZIF_OSD_ADT_FOO=>BAR: unsupported'],
      obsolete: []
    });
  });

  it('fails stale allowlist entries and duplicate observations', () => {
    const allowlist = [{kind: 'statement stub', entry: 'ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE', reason: 'gogen case: DELETE TABLE is not compiled'},
      {kind: 'method not compiled', entry: 'ZCX_OSD_ADT_X=>OLD: fixed', reason: 'obsolete'}];
    const report = {statementStubs: ['ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE', 'ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE'], methodsNotCompiled: []};
    const result = checkGate(report, allowlist);
    assert.deepEqual(result.unmatched, ['statement stub: ZCL_OSD_ADT_REQUEST_XML=>RESTORE: DELETE TABLE: duplicate']);
    assert.deepEqual(result.obsolete, ['method not compiled: ZCX_OSD_ADT_X=>OLD: fixed']);
  });
});
