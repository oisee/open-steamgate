import {expect} from 'chai';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const mocha = require.resolve('mocha/bin/mocha.js');
const plugin = resolve('tools/osd-test-isolation.cjs');
// Installed only by run()'s child preload, before the hook requires its JSON.
// These synthetic rules retain the removed allowance's bounds/phase/kinds.
const genAllowancePatch = `allowances['test/gen-allowance-fixture.mjs']=${JSON.stringify({
  gen: {
    reason: 'Fixture import removes generated output and rewrites retained output',
    owner: 'test fixture',
    backlog: 'test/osd-test-isolation.mjs',
    files: [
      {prefix: 'gen/stg/zvdb_100/', maxCount: 10, phase: 'import', kinds: ['removed']},
      {prefix: 'gen/stg/zstg_demo/', maxCount: 2, phase: 'import', kinds: ['changed']},
    ],
  },
})};`;
function run(files, options = [], allowancePatch, preload, hook = true) {
  const root = mkdtempSync(join(tmpdir(), 'isolation-proof-'));
  try {
    const entries = Array.isArray(files) ? files.map((source, index) => [`${index}.cjs`, source]) : Object.entries(files);
    const paths = entries.map(([name, source]) => {
      const path = join(root, name);
      mkdirSync(dirname(path), {recursive: true});
      writeFileSync(path, source);
      return path;
    });
    const requires = [];
    if (preload) {
      const setup = join(root, 'preload.cjs');
      writeFileSync(setup, preload);
      requires.push('--require', setup);
    }
    if (allowancePatch) {
      const patch = join(root, 'allowance-patch.cjs');
      writeFileSync(patch, `const allowances = require(${JSON.stringify(resolve('tools/osd-test-isolation-allow.json'))}); ${allowancePatch}`);
      requires.push('--require', patch);
    }
    const result = spawnSync(process.execPath, [mocha, ...requires, ...(hook ? ['--require', plugin] : []), '--reporter', 'spec', ...options, ...paths], {cwd: root, encoding: 'utf8', timeout: 15000});
    return {status: result.status, output: result.stdout + result.stderr, filesAfterExit: readdirSync(root, {recursive: true})};
  } finally { rmSync(root, {recursive: true, force: true}); }
}
describe('per-file process isolation detector', function () {
  this.timeout(30000);

  it('names a deleted gen file, leaves it deleted and does not blame downstream files', () => {
    const result = run([
      "it('leaves gen alone',()=>{});",
      "it('sweeps generated output',()=>require('node:fs').rmSync('gen/pack/probe.clas.abap'));",
      "it('inherits missing generated output',()=>{});",
    ], [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen/pack',{recursive:true});fs.writeFileSync('gen/pack/probe.clas.abap','generated');");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('1.cjs: gen:').and.include('gen/pack/probe.clas.abap').and.include('"removed"');
    expect(result.output).not.to.include('0.cjs: gen:').and.not.to.include('2.cjs: gen:');
    expect(result.filesAfterExit).not.to.include('gen/pack/probe.clas.abap');
  });
  it('passes when gen is untouched, including a stale run start', () => {
    const result = run(["it('unchanged',()=>{});"], [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/pre-existing.abap','stale output');");
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('checked 0.cjs');
    expect(result.output).not.to.include('0.cjs: gen:');
  });
  for (const phase of ['import', 'execution']) {
    for (const mutation of ['identical', 'different', 'new-path']) {
      it(`${phase}: ${mutation === 'identical' ? 'reports restoration' : 'rejects ' + mutation} after an allowed gen removal`, () => {
        const path = mutation === 'new-path' ? 'gen/stg/zvdb_100/new.abap' : 'gen/stg/zvdb_100/output.abap';
        const content = mutation === 'different' ? 'different' : 'original';
        const regenerate = `fs.writeFileSync('${path}','${content}');`;
        const result = run({
          'test/gen-allowance-fixture.mjs': "import fs from 'node:fs';fs.rmSync('gen/stg/zvdb_100/output.abap');it('removes output',()=>{});",
          'test/regenerate.mjs': `import fs from 'node:fs';${phase === 'import' ? regenerate : ''}it('regenerates',()=>{${phase === 'execution' ? regenerate : ''}});`,
        }, [], genAllowancePatch,
        "const fs=require('node:fs');fs.mkdirSync('gen/stg/zvdb_100',{recursive:true});fs.writeFileSync('gen/stg/zvdb_100/output.abap','original');");
        expect(result.output).to.include('test/gen-allowance-fixture.mjs: gen:').and.include('TEMPORARY ALLOW');
        if (mutation === 'identical') {
          expect(result.status, result.output).to.equal(0);
          expect(result.output).to.include('test/regenerate.mjs: gen restoration:').and.include(`"phase":"${phase}"`);
          expect(result.output).not.to.include('test/regenerate.mjs: gen:');
        } else {
          expect(result.status, result.output).to.be.greaterThan(0);
          expect(result.output).to.include('test/regenerate.mjs: gen:').and.include(path);
          expect(result.output).not.to.include('test/regenerate.mjs: gen restoration:');
        }
      });
    }
    for (const mutation of ['rewrite', 'remove-added']) {
      it(`${phase}: reports a ${mutation} back to the run-start gen state without excusing the origin`, () => {
        const path = 'gen/probe.abap';
        const edit = `fs.writeFileSync('${path}','changed');`;
        const restore = mutation === 'rewrite' ? `fs.writeFileSync('${path}','original');` : `fs.rmSync('${path}');`;
        const source = (action) => `const fs=require('node:fs');${phase === 'import' ? action : ''}it('works',()=>{${phase === 'execution' ? action : ''}});`;
        const result = run([source(edit), source(restore)], [], undefined,
          `const fs=require('node:fs');fs.mkdirSync('gen');${mutation === 'rewrite' ? "fs.writeFileSync('gen/probe.abap','original');" : ''}`);
        expect(result.status, result.output).to.be.greaterThan(0);
        expect(result.output).to.include('0.cjs: gen:');
        expect(result.output).to.include('1.cjs: gen restoration:').and.include(`"phase":"${phase}"`);
        expect(result.output).not.to.include('1.cjs: gen:');
      });
    }
  }
  it('keeps unrelated additions red alongside a gen restoration', () => {
    const result = run([
      "require('node:fs').rmSync('gen/probe.abap');it('removes',()=>{});",
      "it('restores and leaks',()=>{const fs=require('node:fs');fs.writeFileSync('gen/probe.abap','original');fs.writeFileSync('gen/new.abap','new');});",
    ], [], "allowances['0.cjs']={gen:{reason:'fixture removal',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:[{path:'gen/probe.abap',maxCount:1,phase:'import',kinds:['removed']}]}};",
    "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','original');");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('1.cjs: gen restoration:').and.include('1.cjs: gen:');
    const changes = JSON.parse(result.output.match(/test-isolation: 1.cjs: gen: (.*)/)[1]);
    expect(changes.map(({path}) => path)).to.deep.equal(['gen/new.abap']);
  });
  it('reports an import restoration when every test is excluded', () => {
    const result = run([
      "require('node:fs').rmSync('gen/probe.abap');it('unselected',()=>{});",
      "require('node:fs').writeFileSync('gen/probe.abap','original');it('unselected',()=>{});",
    ], ['--grep', ' selected$'], "allowances['0.cjs']={gen:{reason:'fixture removal',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:[{path:'gen/probe.abap',maxCount:1,phase:'import',kinds:['removed']}]}};",
    "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','original');");
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('0 passing').and.include('1.cjs: gen restoration:');
    expect(result.output).not.to.include('1.cjs: gen:');
  });
  for (const phase of ['import', 'execution']) {
    for (const timestamp of ['newer', 'restored']) {
      for (const content of ['original', 'changed!']) {
        it(`${phase}: ${content === 'original' ? 'accepts identical bytes' : 'rejects same-size different bytes'} with a ${timestamp} gen mtime`, () => {
          const rewrite = `const fs=require('node:fs');const path='gen/probe.abap';const stat=fs.statSync(path);const stamp=stat.mtimeMs${timestamp === 'newer' ? '+10000' : ''};fs.writeFileSync(path,'${content}');fs.utimesSync(path,stat.atimeMs/1000,stamp/1000);`;
          const source = phase === 'import' ? `${rewrite}it('rewrites',()=>{});` : `it('rewrites',()=>{${rewrite}});`;
          const result = run([source, "it('inherits output',()=>{});"], [], undefined,
            "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','original');fs.utimesSync('gen/probe.abap',2000,2000);");
          if (content === 'original') {
            expect(result.status, result.output).to.equal(0);
            expect(result.output).not.to.include('0.cjs: gen:');
          } else {
            expect(result.status, result.output).to.be.greaterThan(0);
            const changes = JSON.parse(result.output.match(/test-isolation: 0.cjs: gen: (.*)/)[1]);
            expect(changes).to.have.length(1);
            expect(changes[0]).to.include({path: 'gen/probe.abap', kind: 'changed', phase});
            expect(changes[0].before.size).to.equal(changes[0].after.size);
            if (timestamp === 'newer') expect(changes[0].after.mtimeMs).to.be.greaterThan(changes[0].before.mtimeMs);
            else {
              expect(changes[0].after.mtimeMs).to.equal(changes[0].before.mtimeMs);
              expect(changes[0].after.ctimeMs).to.be.greaterThan(changes[0].before.ctimeMs);
              expect(changes[0].after.ino).to.equal(changes[0].before.ino);
            }
          }
          expect(result.output).not.to.include('1.cjs: gen:');
        });
      }
    }
  }
  it('attributes an import-time sweep even when the file has no selected tests', () => {
    const result = run([
      "require('node:fs').rmSync('gen/probe.abap');it('unselected',()=>{});",
      "it('selected',()=>{});",
    ], ['--grep', ' selected$'], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','generated');");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: gen:').and.include('gen/probe.abap');
    expect(result.output).not.to.include('1.cjs: gen:');
  });
  for (const exitOptions of [[], ['--exit']]) it(`rejects an import-time sweep when every imported test is excluded ${exitOptions.join(' ')}`, () => {
    const result = run(["require('node:fs').rmSync('gen/probe.abap');it('unselected',()=>{});"], ['--grep', ' selected$', ...exitOptions], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','generated');");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0 passing').and.include('0.cjs: gen:').and.include('gen/probe.abap');
    expect(result.filesAfterExit).not.to.include('gen/probe.abap');
  });
  it('rejects execution corruption under the fixture gen allowance', () => {
    const result = run({'test/gen-allowance-fixture.mjs': "import fs from 'node:fs';it('corrupts base',()=>fs.writeFileSync('gen/stg/zvdb_100/zcl_zvdb_100_dpc.clas.abap','unrelated corruption'));"}, [], genAllowancePatch,
      "const fs=require('node:fs');fs.mkdirSync('gen/stg/zvdb_100',{recursive:true});fs.writeFileSync('gen/stg/zvdb_100/zcl_zvdb_100_dpc.clas.abap','original');");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('test/gen-allowance-fixture.mjs: gen:').and.include('gen/stg/zvdb_100/zcl_zvdb_100_dpc.clas.abap');
    expect(result.output).not.to.include('TEMPORARY ALLOW');
  });
  for (const mutation of ['import-removal', 'import-retained-rewrite', 'import-rewrite', 'execution-removal', 'import-and-execution']) {
    it(`scopes the fixture gen allowance by phase and kind: ${mutation}`, () => {
      const folder = mutation === 'import-retained-rewrite' ? 'zstg_demo' : 'zvdb_100';
      const path = `gen/stg/${folder}/probe.clas.abap`;
      const edit = mutation.includes('rewrite') ? `fs.writeFileSync('${path}','unrelated corruption');` : `fs.rmSync('${path}');`;
      const execution = mutation === 'execution-removal' ? edit : mutation === 'import-and-execution' ? `fs.writeFileSync('${path}','added in execution');` : '';
      const source = `import fs from 'node:fs';${mutation === 'execution-removal' ? '' : edit}it('unselected',()=>{${execution}});`;
      const options = execution ? [] : ['--grep', ' selected$'];
      const result = run({'test/gen-allowance-fixture.mjs': source}, options, genAllowancePatch,
        `const fs=require('node:fs');fs.mkdirSync('gen/stg/${folder}',{recursive:true});fs.writeFileSync('${path}','original');`);
      const allowed = ['import-removal', 'import-retained-rewrite'].includes(mutation);
      expect(result.status, result.output).to.equal(allowed ? 0 : 1);
      expect(result.output).to.include('test/gen-allowance-fixture.mjs: gen:').and.include(`"phase":"${mutation === 'execution-removal' ? 'execution' : 'import'}"`);
      if (allowed) expect(result.output).to.include('TEMPORARY ALLOW');
      else expect(result.output).not.to.include('TEMPORARY ALLOW');
    });
  }
  it('reports added and same-size changed files with content hashes, after cleanup', () => {
    const result = run(["const fs=require('node:fs');it('edits output',()=>{});after(()=>{fs.writeFileSync('gen/added.abap','new');fs.writeFileSync('gen/probe.abap','changed!');fs.utimesSync('gen/probe.abap',new Date(),new Date(2000))});"], [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','original');");
    expect(result.status, result.output).to.be.greaterThan(0);
    const changes = JSON.parse(result.output.match(/test-isolation: 0.cjs: gen: (.*)/)[1]);
    expect(changes.map(({path, kind}) => ({path, kind}))).to.deep.equal([
      {path: 'gen/added.abap', kind: 'added'}, {path: 'gen/probe.abap', kind: 'changed'},
    ]);
    for (const change of changes) expect(change.after.sha256).to.match(/^[0-9a-f]{64}$/);
  });
  it('hashes gen once at baseline and does no further content reads when metadata agrees', () => {
    const setup = "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/untouched.abap','same');const read=fs.readFileSync;let reads=0;fs.readFileSync=function(path,...args){if(String(path).includes('untouched.abap')&&++reads>1)throw Error('read unchanged gen content');return read.call(this,path,...args)};";
    const unchanged = run(["it('unchanged',()=>{});", "it('still unchanged',()=>{});"], [], undefined, setup);
    expect(unchanged.status, unchanged.output).to.equal(0);
    const changed = run(["it('adds output',()=>require('node:fs').writeFileSync('gen/added.abap','new'));"], [], undefined, setup);
    expect(changed.status, changed.output).to.be.greaterThan(0);
    expect(changed.output).to.include('gen/added.abap').and.include('"sha256"');
    expect(changed.output).not.to.include('read unchanged gen content');
  });
  it('caches an identical rewrite and retains its digest for a later corruption', () => {
    const result = run([
      "it('rewrites identical bytes',()=>{const fs=require('node:fs');const stamp=fs.statSync('gen/probe.abap').mtimeMs+10000;fs.writeFileSync('gen/probe.abap','original');fs.utimesSync('gen/probe.abap',stamp/1000,stamp/1000);});",
      "it('uses the new cache entry',()=>{if(global.genReads!==2)throw Error('rehashed unchanged output');});",
      "it('corrupts the rewritten file',()=>{const fs=require('node:fs');const stamp=fs.statSync('gen/probe.abap').mtimeMs+10000;fs.writeFileSync('gen/probe.abap','changed!');fs.utimesSync('gen/probe.abap',stamp/1000,stamp/1000);});",
      "it('inherits corruption',()=>{if(global.genReads!==3)throw Error('rehashed corruption');});",
    ], [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('gen');fs.writeFileSync('gen/probe.abap','original');const read=fs.readFileSync;global.genReads=0;fs.readFileSync=function(path,...args){if(String(path).endsWith('gen/probe.abap'))global.genReads++;return read.call(this,path,...args)};");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('4 passing').and.include('2.cjs: gen:').and.include('gen/probe.abap').and.include('"changed"');
    for (const file of ['0.cjs', '1.cjs', '3.cjs']) expect(result.output).not.to.include(`${file}: gen:`);
    expect(result.output).not.to.include('rehashed');
  });
  it('keeps a gen hash error red even with a matching allowance', () => {
    const result = run(["it('adds output',()=>require('node:fs').writeFileSync('gen/probe.abap','new'));"], [],
      "allowances['0.cjs']={gen:{reason:'fixture',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:[{path:'gen/probe.abap',maxCount:1,phase:'execution',kinds:['added']}]}};",
      "const fs=require('node:fs');fs.mkdirSync('gen');const read=fs.readFileSync;fs.readFileSync=function(path,...args){if(String(path).endsWith('gen/probe.abap'))throw Error('cannot hash generated output');return read.call(this,path,...args)};");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: gen:').and.include('gen/probe.abap').and.include('cannot hash generated output');
    expect(result.output).not.to.include('TEMPORARY ALLOW');
  });
  for (const mutation of ['known', 'extra', 'other']) {
    it(`bounds gen allowances by prefix and count: ${mutation}`, () => {
      const edit = mutation === 'extra' ? "fs.writeFileSync('gen/pack/extra.abap','new');" : mutation === 'other' ? "fs.writeFileSync('gen/other.abap','new');" : '';
      const result = run([`const fs=require('node:fs');it('sweeps',()=>{fs.rmSync('gen/pack/probe.abap');${edit}});`], [],
        "allowances['0.cjs']={gen:{reason:'measured fixture',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:[{prefix:'gen/pack/',maxCount:1,phase:'execution',kinds:['removed','added']}]}};",
        "const fs=require('node:fs');fs.mkdirSync('gen/pack',{recursive:true});fs.writeFileSync('gen/pack/probe.abap','generated');");
      if (mutation === 'known') expect(result.status, result.output).to.equal(0);
      else expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('0.cjs: gen:');
      if (mutation === 'known') expect(result.output).to.include('TEMPORARY ALLOW');
      else expect(result.output).not.to.include('TEMPORARY ALLOW');
    });
  }
  for (const files of [[], [{prefix: 'gen/', maxCount: 1}], [{prefix: 'gen/pack/'}], [{path: 'gen/../probe', maxCount: 1}], [{path: 'gen/probe', maxCount: 2}]]) {
    it(`rejects unbounded or invalid gen allowances: ${JSON.stringify(files)}`, () => {
      const scopedFiles = files.map((entry) => ({...entry, phase: 'import', kinds: ['removed']}));
      const result = run(["it('works',()=>{});"], [], `allowances['0.cjs']={gen:{reason:'fixture',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:${JSON.stringify(scopedFiles)}}};`);
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('invalid gen path/prefix/count');
    });
  }
  for (const scope of [{kinds: ['removed']}, {phase: 'import'}, {phase: 'any', kinds: ['removed']}, {phase: 'import', kinds: []}, {phase: 'import', kinds: ['any']}, {phase: 'import', kinds: 'removed'}]) {
    it(`rejects a malformed gen phase/kinds even without selected tests: ${JSON.stringify(scope)}`, () => {
      const files = [{prefix: 'gen/pack/', maxCount: 1, ...scope}];
      const result = run(["it('unselected',()=>{});"], ['--grep', ' selected$'], `allowances['0.cjs']={gen:{reason:'fixture',owner:'stoker',backlog:'docs/backlog/misc.md#fixture',files:${JSON.stringify(files)}}};`);
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('invalid gen path/prefix/count/phase/kinds');
    });
  }

  for (const file of ['test/adt-facade.mjs', 'test/unknown.cjs']) {
    it(`critic unknown-root: rejects a new root identity in ${file}`, () => {
      const result = run({[file]: "it('leaves root',()=>require('node:fs').mkdtempSync('completely-new-leak-'));".replace("require('node:fs')", file.endsWith('.mjs') ? "fs" : "require('node:fs')") + (file.endsWith('.mjs') ? " import fs from 'node:fs';" : '')});
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include(`${file}: temporary-roots`);
    });
  }
  it('critic unknown-generation: rejects a fresh drift in a previously downstream file', () => {
    const result = run({'test/webgui.mjs': "import fs from 'node:fs'; before(()=>{fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/completely-new-stale','build/live')});it('passes',()=>{});"});
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('test/webgui.mjs: generation');
  });
  it('uses an already stale live generation as the run baseline without blaming unchanged files', () => {
    const result = run([
      "it('does not mutate the tree',()=>{});",
      "it('also leaves the tree unchanged',()=>{});",
      "describe.skip('pending',()=>it('unchanged',()=>{}));",
    ], [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/pre-existing-stale','build/live');");
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('2 passing').and.include('checked 0.cjs').and.include('checked 1.cjs').and.include('checked 2.cjs');
    expect(result.output.match(/test-isolation: run-setup: generation: /g)).to.have.length(1);
    const start = JSON.parse(result.output.match(/test-isolation: run-setup: generation: (.*)/)[1]);
    expect(start.live).to.equal('pre-existing-stale').and.not.equal(start.tree);
    for (const file of ['0.cjs', '1.cjs', '2.cjs']) expect(result.output).not.to.include(`${file}: generation:`);
  });
  it('does not blame proof metadata changes when the stale live/tree pair stays unchanged', () => {
    const result = run({'test/vscode-warm.mjs': "import fs from 'node:fs';it('changes only metadata',()=>{fs.mkdirSync('build/inactive');fs.writeFileSync('build/inactive/inactive.json',JSON.stringify({inactive:{}}))});"}, [], undefined,
      "const fs=require('node:fs');fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/pre-existing-stale','build/live');");
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('run-setup: generation:').and.include('checked test/vscode-warm.mjs');
    expect(result.output).not.to.include('test/vscode-warm.mjs: generation:');
  });
  for (const mutation of ['live', 'tree', 'delete', 'hash-error']) {
    it(`rejects a fresh ${mutation} change from a stale run baseline`, () => {
      const edit = mutation === 'live' ? "fs.unlinkSync('build/live');fs.symlinkSync('by-input/new-stale','build/live')"
        : mutation === 'tree' ? "fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[],output_folder:'changed'}))"
        : mutation === 'delete' ? "fs.unlinkSync('build/live')" : "fs.unlinkSync('abap_transpile.json')";
      const result = run([
        "it('inherits setup state',()=>{});",
        `const fs=require('node:fs');it('changes generation',()=>{${edit}});`,
        "it('inherits the reported drift',()=>{});",
      ], [], undefined,
        "const fs=require('node:fs');fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/pre-existing-stale','build/live');");
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output.match(/test-isolation: run-setup: generation: /g)).to.have.length(1);
      expect(result.output).not.to.include('0.cjs: generation:');
      expect(result.output).to.include('1.cjs: generation:');
      // An unreadable hash remains an error rather than a usable baseline.
      if (mutation !== 'hash-error') expect(result.output).not.to.include('2.cjs: generation:');
    });
  }
  it('critic environment-import-red-green: rejects restoration of contaminated import values', () => {
    const result = run([
      "process.env.CRITIC_IMPORT='a';after(()=>delete process.env.CRITIC_IMPORT);it('a',()=>{});",
      "const old=process.env.CRITIC_IMPORT;process.env.CRITIC_IMPORT='b';after(()=>{process.env.CRITIC_IMPORT=old});it('b',()=>{});",
      "it('sees contamination',()=>{if(process.env.CRITIC_IMPORT!=='a')throw Error('expected a')});",
    ]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('1.cjs: environment').and.include('run-end: environment');
  });
  it('critic environment-import-false-red: reconciles cancellation during later imports', () => {
    const result = run([
      "process.env.CRITIC_IMPORT='a';after(()=>delete process.env.CRITIC_IMPORT);it('a',()=>{});",
      "delete process.env.CRITIC_IMPORT;it('b',()=>{if(process.env.CRITIC_IMPORT!==undefined)throw Error('dirty')});",
    ]);
    expect(result.status, result.output).to.equal(0);
  });
  for (const method of ['sync', 'callback', 'promise']) {
    it(`critic relative-root-missed: observes ${method} roots at their creation cwd`, () => {
      const create = method === 'sync' ? "fs.mkdtempSync('new-leak-'); process.chdir(cwd);" : method === 'callback' ? "const ready=new Promise((resolve,reject)=>fs.mkdtemp('new-leak-',(e,p)=>e?reject(e):resolve(p))); await ready; process.chdir(cwd);" : "const ready=fs.promises.mkdtemp('new-leak-'); await ready; process.chdir(cwd);";
      const result = run([`const fs=require('node:fs');fs.mkdirSync('fixture');it('leaks relative root',async()=>{const cwd=process.cwd();process.chdir('fixture');${create}});after(()=>{if(!fs.readdirSync('fixture').some(x=>x.startsWith('new-leak-')))throw Error('lost proof')});`]);
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('0.cjs: temporary-roots').and.include('fixture/new-leak-');
    });
  }
  it('critic double-done: retains Mocha multiple completion errors', () => {
    const source = "after(done=>{done();done();});it('passes',()=>{});";
    const plain = run([source], [], undefined, undefined, false);
    // Preserve the critic's plain-Mocha control, which exits green.
    expect(plain.status, plain.output).to.equal(0);
    const result = run([source]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('done() called multiple times');
  });
  it('critic hook-error: retains explicitly signalled hook errors', () => {
    const source = "after(function(){this.test.error(new Error('hook signalled failure'));});it('passes',()=>{});";
    const plain = run([source], [], undefined, undefined, false);
    expect(plain.status, plain.output).to.equal(0);
    const result = run([source]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('hook signalled failure');
  });
  it('critic after-order: audits after both failing cleanup hooks', () => {
    const result = run(["after(()=>{throw Error('first cleanup failed')});after(()=>{throw Error('second cleanup failed')});it('passes',()=>{});"]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('first cleanup failed').and.include('second cleanup failed').and.include('checked 0.cjs');
  });
  it('accepts the measured root prefix/count and rejects one extra root', () => {
    const fixture = (count) => ({'test/adt-facade.mjs': `import fs from 'node:fs';it('roots',()=>{for(let i=0;i<${count};i++)fs.mkdtempSync('osd-parts-')});`});
    const known = run(fixture(1));
    expect(known.status, known.output).to.equal(0);
    expect(known.output).to.include('TEMPORARY ALLOW');
    const extra = run(fixture(2));
    expect(extra.status, extra.output).to.be.greaterThan(0);
    expect(extra.output).not.to.include('TEMPORARY ALLOW');
  });
  for (const field of ['owner', 'backlog']) {
    it(`rejects an exception missing ${field}`, () => {
      const result = run(["it('works',()=>{});"], [], `delete allowances['test/adt-facade.mjs']['temporary-roots'].${field};`);
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('allowance requires reason, owner and backlog');
    });
  }
  it('reports an originating generation drift once and re-baselines downstream observation', () => {
    const result = run({
      "0.cjs": "before(()=>{const fs=require('node:fs');fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/stale','build/live')});it('origin',()=>{});",
      "test/vscode-warm.mjs": "it('downstream',()=>{});",
      "2.cjs": "it('another downstream',()=>{});",
    });
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: generation');
    expect(result.output).not.to.include('test/vscode-warm.mjs: generation').and.not.to.include('2.cjs: generation');
    expect(result.output).to.include('checked test/vscode-warm.mjs').and.include('checked 2.cjs');
  });
  for (const hook of ['finally', 'after']) {
    it(`preserves a body failure before the intended edit in ${hook}`, () => {
      const builder = new URL('../tools/osd-build.mjs', import.meta.url).href;
      // Exercise each caller's actual proof gate, so removing it makes this
      // regression red without running a server or inducing a database flake.
      const caller = hook === 'finally' ? 'vscode-job-worker-integration.mjs' : 'vscode-warm.mjs';
      const source = readFileSync(new URL(caller, import.meta.url), 'utf8');
      const proof = source.match(/(?:if \(intendedDrift\) )?await isolation\?\.observeGenerationDrift/)[0].replace('?.', '.') + '();';
      const body = `fs.unlinkSync('build/live');fs.symlinkSync('by-input/unexpected','build/live');
        throw Error('BODY failed before edit');`;
      const result = run({'test/vscode-warm.mjs': `import fs from 'node:fs';import {hashOf} from ${JSON.stringify(builder)};import isolation from ${JSON.stringify(plugin)};
        fs.mkdirSync('src/demo',{recursive:true});fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));
        const file='src/demo/zcl_zstg_demo_dpc_ext.clas.abap';const original='* The hand-written part a developer owns on a real system. Reads the\\n';
        fs.writeFileSync(file,original);fs.symlinkSync('by-input/'+hashOf(process.cwd()),'build/live');
        let intendedDrift = false;
        ${hook === 'finally'
          ? `it('fails before edit',async()=>{try{${body}intendedDrift=true;}finally{try{${proof}}finally{fs.writeFileSync(file,original)}}});`
          : `it('fails before edit',async()=>{${body}intendedDrift=true;});after(async()=>{try{${proof}}finally{fs.writeFileSync(file,original)}});`}`});
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('BODY failed before edit').and.include('test/vscode-warm.mjs: generation');
      expect(result.output).to.include('2 failing'); // Body and after-all invariant fail separately.
      expect(result.output).not.to.include('unrecognized originating generation drift').and.not.to.include('TEMPORARY ALLOW');
    });
  }
  for (const mutation of ['fresh', 'delete', 'hash-error']) {
    it(`rejects ${mutation} generation drift after an originating leak`, () => {
      const edit = mutation === 'fresh' ? "fs.unlinkSync('build/live');fs.symlinkSync('by-input/new-stale','build/live')" : mutation === 'delete' ? "fs.unlinkSync('build/live')" : "fs.unlinkSync('abap_transpile.json')";
      const result = run({'test/vscode-warm.mjs': "import fs from 'node:fs';before(()=>{fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));fs.symlinkSync('by-input/stale','build/live')});it('origin',()=>{});", 'test/webgui.mjs': `import fs from 'node:fs';it('mutates',()=>{${edit}});${mutation === 'delete' ? `import isolation from ${JSON.stringify(plugin)};after(()=>isolation.allowGenerationMismatch('cannot excuse deletion'));` : ''}`});
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('test/vscode-warm.mjs: generation').and.include('test/webgui.mjs: generation');
    });
  }
  it('critic minus-facade mutant: removing the measured exception makes its root red', () => {
    const result = run({'test/adt-facade.mjs': "import fs from 'node:fs';it('known leak',()=>fs.mkdtempSync('osd-parts-'));"}, [], "delete allowances['test/adt-facade.mjs'];");
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('test/adt-facade.mjs: temporary-roots');
    expect(result.output).not.to.include('TEMPORARY ALLOW');
  });
  it('critic leaves-temp mutant: leaves the observed root present after the detector exits', () => {
    const result = run(["it('leaves root',()=>require('node:fs').mkdtempSync('left-by-mutant-'));"]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: temporary-roots');
    expect(result.filesAfterExit.some((path) => path.startsWith('left-by-mutant-'))).to.equal(true);
  });
  for (const method of ['callback', 'promise']) {
    it(`resolves ${method} roots using invocation cwd when completion sees another cwd`, () => {
      // Resolve the native operation up front so its worker cannot race chdir.
      // Return the native relative-result shape after switching cwd, to make
      // the observer's call/completion boundary deterministic.
      const setup = "const fs=require('node:fs');const {resolve,relative}=require('node:path');const base=process.cwd();" + (method === 'callback'
        ? "const original=fs.mkdtemp;fs.mkdtemp=function(prefix,...args){const cwd=process.cwd();const callback=args.pop();return original.call(this,resolve(cwd,prefix),...args,(error,path)=>{process.chdir(base);callback(error,path&&relative(cwd,String(path)))});};"
        : "const original=fs.promises.mkdtemp;fs.promises.mkdtemp=async function(prefix,...args){const cwd=process.cwd();const path=await original.call(this,resolve(cwd,prefix),...args);process.chdir(base);return relative(cwd,String(path));};");
      const create = method === 'callback' ? "await new Promise((resolve,reject)=>fs.mkdtemp('delayed-leak-',(error,path)=>error?reject(error):resolve(path)));" : "await fs.promises.mkdtemp('delayed-leak-');";
      const result = run([`const fs=require('node:fs');fs.mkdirSync('fixture');it('leaks',async()=>{process.chdir('fixture');${create}});after(()=>{if(!fs.readdirSync('fixture').some(path=>path.startsWith('delayed-leak-')))throw Error('lost proof')});`], [], undefined, setup);
      expect(result.status, result.output).to.be.greaterThan(0);
      expect(result.output).to.include('0.cjs: temporary-roots').and.include('fixture/delayed-leak-');
      expect(result.output).not.to.include('lost proof');
    });
  }
  for (const mutation of ['known', 'fresh-live', 'other-content', 'other-input', 'inactive-view', 'inactive-drift', 'inactive-before']) {
    it(`enforces the originating warm input proof: ${mutation}`, () => {
      const builder = new URL('../tools/osd-build.mjs', import.meta.url).href;
      const original = '* The hand-written part a developer owns on a real system. Reads the\n';
      // The real T7 warm fixture writes a fresh random UUID here; the allowance matches that shape.
      const edited = `* The hand-written part a developer owns on a real system (T7 warm test ${randomUUID()}). Reads the\n`;
      const extra = mutation === 'other-input' ? "fs.writeFileSync('src/unrelated.clas.abap','unrelated');" : '';
      const inactive = mutation.startsWith('inactive-');
      const inactiveSetup = inactive ? "fs.writeFileSync('src/other.clas.abap','saved');fs.mkdirSync('build/inactive/active/src',{recursive:true});fs.writeFileSync('build/inactive/active/src/other.clas.abap','active');fs.writeFileSync('build/inactive/inactive.json',JSON.stringify({inactive:{OTHER:{files:['src/other.clas.abap']}}}));" : '';
      const beforeProof = mutation === 'inactive-before' ? "fs.writeFileSync('build/inactive/active/src/other.clas.abap','unrelated active edit');" : '';
      const afterProof = mutation === 'fresh-live' ? "fs.unlinkSync('build/live');fs.symlinkSync('by-input/fresh-corruption','build/live');" : mutation === 'inactive-drift' ? "fs.writeFileSync('build/inactive/active/src/other.clas.abap','unrelated active edit');" : '';
      const proofRejected = ['other-content', 'other-input', 'inactive-before'].includes(mutation);
      const reached = `console.log('mutation reached: warm ${mutation}');`;
      const checkMutation = mutation === 'other-input' ? "assert.equal(fs.readFileSync('src/unrelated.clas.abap','utf8'),'unrelated');"
        : mutation === 'fresh-live' ? "assert.equal(fs.readlinkSync('build/live'),'by-input/fresh-corruption');"
        : ['inactive-before', 'inactive-drift'].includes(mutation) ? "assert.equal(fs.readFileSync('build/inactive/active/src/other.clas.abap','utf8'),'unrelated active edit');" : '';
      const viewOptions = inactive ? ",undefined,{overlay:{exclude:[process.cwd()+'/src/other.clas.abap'],folder:'build/inactive/active'}}" : '';
      // The proof loads real warm/store modules asynchronously. Give this
      // child its own timeout; the outer mocha timeout does not reach it.
      const result = run({'test/vscode-warm.mjs': `import fs from 'node:fs';import assert from 'node:assert/strict';import {hashOf} from ${JSON.stringify(builder)};import isolation from ${JSON.stringify(plugin)};
        fs.mkdirSync('src/demo',{recursive:true});fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));
        const file='src/demo/zcl_zstg_demo_dpc_ext.clas.abap';const original=${JSON.stringify(original)};fs.writeFileSync(file,original);${inactiveSetup}fs.symlinkSync('by-input/'+hashOf(process.cwd()),'build/live');
        it('activates',async()=>{const edited=${JSON.stringify(mutation === 'other-content' ? 'unrelated replacement' : edited)};fs.writeFileSync(file,edited);${extra}${beforeProof}
          assert.equal(fs.readFileSync(file,'utf8'),edited);
          fs.unlinkSync('build/live');const activated='by-input/'+hashOf(process.cwd()${viewOptions});fs.symlinkSync(activated,'build/live');assert.equal(fs.readlinkSync('build/live'),activated);
          ${proofRejected ? checkMutation + reached : ''}
          try{await isolation.observeGenerationDrift()}finally{fs.writeFileSync(file,original)}
          assert.equal(fs.readFileSync(file,'utf8'),original);${afterProof}${proofRejected ? '' : checkMutation + reached}});`}, ['--timeout', '10000']);
      expect(result.output).to.include(`mutation reached: warm ${mutation}`);
      if (mutation === 'known' || mutation === 'inactive-view') {
        expect(result.status, result.output).to.equal(0);
        expect(result.output).to.include('TEMPORARY ALLOW');
      } else {
        expect(result.status, result.output).to.be.greaterThan(0);
        expect(result.output).not.to.include('TEMPORARY ALLOW');
        if (proofRejected) expect(result.output).to.include('unrecognized originating generation drift');
        else expect(result.output).to.include('1 passing').and.include('test/vscode-warm.mjs: generation');
      }
    });
  }
  for (const mutation of ['known', 'unknown-sidecar', 'source-drift', 'config-drift']) {
    it(`ignores navigation metadata but detects real generation drift: ${mutation}`, () => {
      const builder = new URL('../tools/osd-build.mjs', import.meta.url).href;
      const sidecar = mutation === 'unknown-sidecar' ? 'src/l2demo/unrelated.trace.meta.json' : 'src/l2demo/zcl_l2_recent_voyage.clas.trace.meta.json';
      const extra = mutation === 'config-drift' ? "fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[],output_folder:'new-output'}));"
        : mutation === 'source-drift' ? "fs.writeFileSync('src/base.clas.abap','changed source');" : '';
      const result = run({'test/dsl-l2.mjs': `import fs from 'node:fs';import assert from 'node:assert/strict';import {hashOf} from ${JSON.stringify(builder)};
        fs.mkdirSync('src/l2demo',{recursive:true});fs.mkdirSync('build');fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]}));
        fs.writeFileSync('src/base.clas.abap','baseline');fs.symlinkSync('by-input/'+hashOf(process.cwd()),'build/live');
        it('renders',()=>{fs.writeFileSync(${JSON.stringify(sidecar)},'{}');${extra}
          assert.equal(fs.readFileSync(${JSON.stringify(sidecar)},'utf8'),'{}');
          ${mutation === 'config-drift' ? "assert.equal(JSON.parse(fs.readFileSync('abap_transpile.json','utf8')).output_folder,'new-output');" : ''}
          console.log('mutation reached: added-input ${mutation}');});`});
      expect(result.output).to.include(`mutation reached: added-input ${mutation}`).and.include('1 passing');
      expect(result.output).not.to.include('TEMPORARY ALLOW');
      if (mutation === 'known' || mutation === 'unknown-sidecar') {
        expect(result.status, result.output).to.equal(0);
      } else {
        expect(result.status, result.output).to.be.greaterThan(0);
      }
    });
  }
  it('refuses parallel workers rather than sharing serial attribution state', () => {
    const result = run(["describe('worker',()=>it('works',()=>{}));"], ['--parallel', '--jobs', '2']);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('osd-test-isolation requires serial mocha');
  });
  it('checks after file hooks, all top-level suites, pending files and the final file', () => {
    const result = run([
      "before(() => {process.env.ISOLATION_PROOF='yes'}); after(() => {delete process.env.ISOLATION_PROOF}); describe('first', () => it('one', () => {})); describe('second', () => it('two', () => {}));",
      "describe.skip('pending', () => it('skip', () => {}));",
      "describe('last', () => it('leaks', () => {process.env.ISOLATION_PROOF='bad'}));",
    ]);
    expect(result.status).to.be.greaterThan(0);
    expect(result.output).to.include('2.cjs: environment');
    expect(result.output).to.include('checked 0.cjs').and.include('checked 1.cjs').and.include('checked 2.cjs');
    expect(result.output).not.to.include('0.cjs: environment');
  });
  it('names live children and temporary roots, including registration-time roots', () => {
    const result = run(["const fs=require('node:fs'); fs.mkdtempSync('leaked-'); describe('resources', () => it('child', () => {const p=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); p.unref(); process.on('exit',()=>p.kill());}));"]);
    expect(result.status).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: children').and.include('0.cjs: temporary-roots').and.include('pid');
  });
  it('checks even when the file after hook fails and detects import-time environment changes', () => {
    const result = run(["process.env.ISOLATION_PROOF='import'; after(() => {throw Error('cleanup broke')}); describe('failure',()=>it('works',()=>{}));"]);
    expect(result.status).to.be.greaterThan(0);
    expect(result.output).to.include('cleanup broke').and.include('0.cjs: environment');
  });
  it('rejects stale generations and permits only a documented file-local opt-out', () => {
    const create = "before(()=>{const fs=require('node:fs'); fs.mkdirSync('build'); fs.writeFileSync('abap_transpile.json',JSON.stringify({input_folder:'src',libs:[]})); fs.symlinkSync('by-input/stale','build/live');}); describe('generation',()=>it('works',()=>{}));";
    const failed = run([create]);
    expect(failed.status).to.be.greaterThan(0);
    expect(failed.output).to.include('0.cjs: generation').and.include('stale');
    const allowed = run([create + `after(()=>require(${JSON.stringify(plugin)}).allowGenerationMismatch('inactive save fixture'));`]);
    expect(allowed.status, allowed.output).to.equal(0);
    expect(allowed.output).to.include('intentional generation mismatch: inactive save fixture');
  });
  it('audits import-only files and files filtered out by only, without running their cleanup', () => {
    const empty = run(["process.env.ISOLATION_PROOF='empty';", "describe('selected',()=>it('works',()=>{}));"]);
    expect(empty.status, empty.output).to.be.greaterThan(0);
    expect(empty.output).to.include('0.cjs: environment').and.include('checked 0.cjs');
    const filtered = run([
      "process.env.ISOLATION_PROOF='filtered'; after(()=>{throw Error('unexecuted cleanup must stay unexecuted')}); describe('ignored',()=>it('ignored',()=>{}));",
      "describe.only('selected',()=>it('works',()=>{}));",
    ]);
    expect(filtered.status, filtered.output).to.be.greaterThan(0);
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
  it('observes an open step rolled out in WAIT while the work process is free', () => {
    const url = new URL('../tools/osd-dialog-step.mjs', import.meta.url).href;
    const result = run([`describe('rolled out',()=>it('leaks',async()=>{
      const {exclusive,setWaitClock,workProcess}=await import(${JSON.stringify(url)});
      globalThis.abap={context:{databaseConnections:{DEFAULT:{commit:async()=>{}}}},statements:{wait:async()=>{}},builtin:{sy:{get:()=>({subrc:{set:()=>{}}})}}};
      setWaitClock({now:()=>0,setTimer:()=>0,clearTimer:()=>{}},{ceilingMs:60000});
      void exclusive(()=>abap.statements.wait({seconds:{get:()=>60}}),'rolled-out');
      await new Promise(setImmediate);
      if(workProcess().held)throw Error('did not roll out');
    }));`]);
    expect(result.status, result.output).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: dialog').and.include('rolled-out').and.include('"held":false');
  });
  it('detects a rolled-out or held dialog step', () => {
    const url = new URL('../tools/osd-dialog-step.mjs', import.meta.url).href;
    const result = run([`describe('dialog',()=>it('leaks',async()=>{const {exclusive}=await import(${JSON.stringify(url)}); void exclusive(()=>new Promise(()=>{}),'unfinished');}));`]);
    expect(result.status).to.be.greaterThan(0);
    expect(result.output).to.include('0.cjs: dialog').and.include('unfinished');
  });
});
