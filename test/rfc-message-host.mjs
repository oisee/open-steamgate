import {expect} from 'chai';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repo = resolve('.');
const url = (p) => pathToFileURL(p).href;
const source = `CLASS zcl_message_host DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS call.
ENDCLASS.
CLASS zcl_message_host IMPLEMENTATION.
  METHOD call.
    DATA lv_msg TYPE string.
    DATA lv_fm TYPE string.
    lv_fm = 'Z_MESSAGE_HOST'.
    CALL FUNCTION lv_fm DESTINATION 'NONE'
      EXCEPTIONS system_failure = 1 MESSAGE lv_msg
                 communication_failure = 2 MESSAGE lv_msg.
  ENDMETHOD.
ENDCLASS.
`;
const config = {input_folder: 'src', input_filter: [], output_folder: 'output', libs: [],
  write_unit_tests: true, write_source_map: true,
  options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: 'compileError'}};

// Fresh processes are essential: modulesOf() in another test must not install
// on the prototype before the host path under test gets to choose its modules.
describe('RFC MESSAGE on selected host modules', function () {
  this.timeout(180000);
  for (const mode of ['cold', 'warm']) for (const mutant of [false, true]) {
    it(`${mode} host ${mutant ? 'kills a copied missing-install mutant' : 'emits each MESSAGE assignment once'}`, () => {
      const root = mkdtempSync(join(tmpdir(), 'rfc-message-host-'));
      try {
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src/zcl_message_host.clas.abap'), source);
        writeFileSync(join(root, 'abap_transpile.json'), JSON.stringify(config));
        writeFileSync(join(root, 'package.json'), '{}');
        symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
        let transpileFile = join(repo, 'tools/osd-transpile.mjs');
        let warmFile = join(repo, 'tools/osd-warm.mjs');
        if (mutant) {
          const absoluteImports = (s) => s.replace(/from (["'])(\.\/[^"']+)\1/g,
            (_, q, p) => `from ${q}${url(resolve(repo, 'tools', p))}${q}`);
          const original = readFileSync(transpileFile, 'utf8');
          const copied = original.replace('  installRfcMessage(modules.CallFunctionTranspiler, modules.Chunk, modules.core);', '  // mutant: omit adapter installation');
          expect(copied).not.to.equal(original);
          transpileFile = join(root, 'transpile-mutant.mjs');
          writeFileSync(transpileFile, absoluteImports(copied));
          warmFile = join(root, 'warm-mutant.mjs');
          writeFileSync(warmFile, absoluteImports(readFileSync(join(repo, 'tools/osd-warm.mjs'), 'utf8'))
            .replace(url(join(repo, 'tools/osd-transpile.mjs')), url(transpileFile)));
        }
        if (mode === 'warm') {
          // Seed in a different process, leaving this host's prototypes pristine.
          execFileSync(process.execPath, ['--input-type=module', '-e',
            `import {build} from ${JSON.stringify(url(join(repo, 'tools/osd-build.mjs')))};
             await build({root:${JSON.stringify(root)}, generators:false});`], {cwd: repo, stdio: 'pipe'});
        }
        const script = `
          import assert from 'node:assert/strict';
          import {createRequire} from 'node:module';
          import {readFileSync, writeFileSync} from 'node:fs';
          import {setHostModules} from ${JSON.stringify(url(join(repo, 'tools/osd-host.mjs')))};
          const require = createRequire(${JSON.stringify(join(repo, 'package.json'))});
          const {Transpiler, Chunk} = require('@abaplint/transpiler');
          const core = createRequire(require.resolve('@abaplint/transpiler'))('@abaplint/core');
          const {CallFunctionTranspiler} = require('@abaplint/transpiler/build/src/statements/call_function.js');
          setHostModules({Transpiler, Chunk, core, CallFunctionTranspiler});
          const root = ${JSON.stringify(root)};
          const check = () => {
            const code = readFileSync(root + '/output/zcl_message_host.clas.mjs', 'utf8');
            assert.equal((code.match(/lv_msg.set\\(e.message \\?\\? ""\\);/g) ?? []).length, 2, 'MESSAGE assignments');
          };
          if (${JSON.stringify(mode)} === 'cold') {
            const {transpile} = await import(${JSON.stringify(url(transpileFile))});
            const config = ${JSON.stringify(config)};
            await transpile({root, config}); check();
            await transpile({root, config}); check();
          } else {
            const {WarmCompiler} = await import(${JSON.stringify(url(warmFile))});
            const warm = new WarmCompiler({root});
            try {
              await warm.prime();
              const path = root + '/src/zcl_message_host.clas.abap';
              writeFileSync(path, readFileSync(path, 'utf8').replace("lv_fm = 'Z_MESSAGE_HOST'.", "lv_fm = 'Z_MESSAGE_EDIT'."));
              const result = await warm.build();
              assert.equal(result.warm, true); check();
            } finally { warm.drop(); }
          }
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd: repo, encoding: 'utf8'});
        if (mutant) {
          expect(result.status, result.stderr).not.to.equal(0);
          expect(result.stderr).to.match(mode === 'cold' ? /MESSAGE assignments/ : /full run of the kept registry differs/);
        } else expect(result.status, result.stderr).to.equal(0);
      } finally { rmSync(root, {recursive: true, force: true}); }
    });
  }
});
