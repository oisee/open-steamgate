import {expect} from 'chai';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const mocha = require.resolve('mocha/bin/mocha.js');
const plugin = resolve('tools/osd-test-isolation.cjs');
function run(files, options = []) {
  const root = mkdtempSync(join(tmpdir(), 'isolation-proof-'));
  try {
    const paths = files.map((source, index) => {
      const path = join(root, `${index}.cjs`);
      writeFileSync(path, source);
      return path;
    });
    const result = spawnSync(process.execPath, [mocha, '--require', plugin, '--reporter', 'spec', ...options, ...paths], {cwd: root, encoding: 'utf8', timeout: 15000});
    return {status: result.status, output: result.stdout + result.stderr};
  } finally { rmSync(root, {recursive: true, force: true}); }
}
describe('per-file process isolation detector', function () {
  this.timeout(30000);
  it('refuses parallel workers rather than sharing serial attribution state', () => {
    const result = run(["describe('worker',()=>it('works',()=>{}));"], ['--parallel', '--jobs', '2']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('osd-test-isolation requires serial mocha');
  });
  it('checks after file hooks, all top-level suites, pending files and the final file', () => {
    const result = run([
      "before(() => {process.env.ISOLATION_PROOF='yes'}); after(() => {delete process.env.ISOLATION_PROOF}); describe('first', () => it('one', () => {})); describe('second', () => it('two', () => {}));",
      "describe.skip('pending', () => it('skip', () => {}));",
      "describe('last', () => it('leaks', () => {process.env.ISOLATION_PROOF='bad'}));",
    ]);
    expect(result.status).to.equal(1);
    expect(result.output).to.include('2.cjs: environment');
    expect(result.output).to.include('checked 0.cjs').and.include('checked 1.cjs').and.include('checked 2.cjs');
    expect(result.output).not.to.include('0.cjs: environment');
  });
  it('names live children and temporary roots, including registration-time roots', () => {
    const result = run(["const fs=require('node:fs'); fs.mkdtempSync('leaked-'); describe('resources', () => it('child', () => {const p=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); p.unref(); process.on('exit',()=>p.kill());}));"]);
    expect(result.status).to.equal(1);
    expect(result.output).to.include('0.cjs: children').and.include('0.cjs: temporary-roots').and.include('pid');
  });
  it('checks even when the file after hook fails and detects import-time environment changes', () => {
    const result = run(["process.env.ISOLATION_PROOF='import'; after(() => {throw Error('cleanup broke')}); describe('failure',()=>it('works',()=>{}));"]);
    expect(result.status).to.equal(1);
    expect(result.output).to.include('cleanup broke').and.include('0.cjs: environment');
  });
  it('rejects stale generations and permits only a documented file-local opt-out', () => {
    const create = "before(()=>{const fs=require('node:fs'); fs.mkdirSync('build'); fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]})); fs.symlinkSync('by-input/stale','build/live');}); describe('generation',()=>it('works',()=>{}));";
    const failed = run([create]);
    expect(failed.status).to.equal(1);
    expect(failed.output).to.include('0.cjs: generation').and.include('stale');
    const allowed = run([create + `after(()=>require(${JSON.stringify(plugin)}).allowGenerationMismatch('inactive save fixture'));`]);
    expect(allowed.status, allowed.output).to.equal(0);
    expect(allowed.output).to.include('intentional generation mismatch: inactive save fixture');
  });
  it('audits import-only files and files filtered out by only, without running their cleanup', () => {
    const empty = run(["process.env.ISOLATION_PROOF='empty';", "describe('selected',()=>it('works',()=>{}));"]);
    expect(empty.status, empty.output).to.equal(1);
    expect(empty.output).to.include('0.cjs: environment').and.include('checked 0.cjs');
    const filtered = run([
      "process.env.ISOLATION_PROOF='filtered'; after(()=>{throw Error('unexecuted cleanup must stay unexecuted')}); describe('ignored',()=>it('ignored',()=>{}));",
      "describe.only('selected',()=>it('works',()=>{}));",
    ]);
    expect(filtered.status, filtered.output).to.equal(1);
    expect(filtered.output).to.include('0.cjs: environment');
    expect(filtered.output).not.to.include('unexecuted cleanup must stay unexecuted');
  });
  it('preserves promisified execFile stdout/stderr and the child handle', () => {
    const result = run(["describe('promisify',()=>it('contract',async()=>{const {promisify}=require('node:util'); const exec=promisify(require('node:child_process').execFile); const promise=exec(process.execPath,['-e',\"process.stdout.write('out');process.stderr.write('err')\"]); if(!promise.child?.pid)throw Error('lost child'); const value=await promise; if(value.stdout!=='out'||value.stderr!=='err')throw Error('lost output shape');}));"]);
    expect(result.status, result.output).to.equal(0);
  });
  it('preserves file-local hook context', () => {
    const result = run([
      "before(function(){this.proof=42}); describe('first',()=>it('context',function(){if(this.proof!==42)throw Error('lost context')}));",
      "describe('second',()=>it('context',function(){if(this.proof!==undefined)throw Error('context leaked')}));",
    ]);
    expect(result.status, result.output).to.equal(0);
  });
  it('detects a rolled-out or held dialog step', () => {
    const url = new URL('../tools/osd-dialog-step.mjs', import.meta.url).href;
    const result = run([`describe('dialog',()=>it('leaks',async()=>{const {exclusive}=await import(${JSON.stringify(url)}); void exclusive(()=>new Promise(()=>{}),'unfinished');}));`]);
    expect(result.status).to.equal(1);
    expect(result.output).to.include('0.cjs: dialog').and.include('unfinished');
  });
});
