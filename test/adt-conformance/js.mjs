import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, delimiter, resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {files} from './fixtures/source.mjs';
import {run} from './run.mjs';
export async function runJS(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'adt-conformance-'));
  const oldLayers = process.env.OSD_LAYERS;
  const oldOutput = process.env.OSD_OUTPUT;
  const oldCwd = process.cwd();
  const statusBefore = execFileSync('git', ['status', '--porcelain'], {cwd: oldCwd, encoding: 'utf8'});
  let server;
  try {
    // Give the server a disposable repository view and active-source snapshot.
    // The built runtime stays pinned; only parser fixtures are added to this
    // test view, never to the repository's immutable published generation.
    for (const entry of readdirSync(oldCwd)) {
      if (entry !== 'build' && entry !== '.local') symlinkSync(join(oldCwd, entry), join(root, entry));
    }
    // Runtime state (especially activation ownership) is disposable too.
    mkdirSync(join(root, '.local'));
    symlinkSync(join(oldCwd, '.local/lars'), join(root, '.local/lars'));
    const built = realpathSync(join(oldCwd, 'build/live'));
    const generation = join(root, 'build/by-input', basename(built));
    mkdirSync(join(generation, 'source'), {recursive: true});
    for (const entry of readdirSync(built)) {
      if (entry !== 'source') symlinkSync(join(built, entry), join(generation, entry));
    }
    for (const entry of readdirSync(join(built, 'source'))) {
      symlinkSync(join(built, 'source', entry), join(generation, 'source', entry));
    }
    symlinkSync(generation, join(root, 'build/live'));
    const layer = join(root, 'conformance-fixture/src'); mkdirSync(layer, {recursive: true});
    for (const [name, source] of Object.entries(files)) writeFileSync(join(layer, name), source);
    const active = join(generation, 'source/conformance-fixture/src'); mkdirSync(active, {recursive: true});
    for (const [name, source] of Object.entries(files)) writeFileSync(join(active, name), source);
    const writes = join(root, 'adt-writes'); mkdirSync(writes);
    writeFileSync(join(writes, 'package.devc.xml'), '<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DEVC><DEVCLASS>$ADT_WRITES</DEVCLASS><CTEXT>Disposable write cases</CTEXT></DEVC></asx:values></asx:abap></abapGit>');
    process.env.OSD_LAYERS = [oldLayers, layer, writes].filter(Boolean).join(delimiter);
    // Pin the transpiled artifact verified before this run. The synthetic
    // outline is parser input, so importing the server must not rebuild/publish it.
    process.env.OSD_OUTPUT = realpathSync(join(oldCwd, 'output'));
    process.chdir(root);
    const {startServer} = await import('../start.mjs');
    server = startServer(true);
    if (!server.listening) await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
    return await run({target: 'js', base: `http://127.0.0.1:${process.env.STG_PORT ?? 3030}`,
      output: join(oldCwd, '.local/suite-results'), ...options, writePackage: '$ADT_WRITES'});
  } finally {
    if (server) await server.close();
    process.chdir(oldCwd);
    if (oldOutput === undefined) delete process.env.OSD_OUTPUT; else process.env.OSD_OUTPUT = oldOutput;
    if (oldLayers === undefined) delete process.env.OSD_LAYERS; else process.env.OSD_LAYERS = oldLayers;
    rmSync(root, {recursive: true, force: true});
    assert.equal(execFileSync('git', ['status', '--porcelain'], {cwd: oldCwd, encoding: 'utf8'}), statusBefore, 'JS conformance leaves worktree status unchanged');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {process.exitCode = (await runJS()).exitCode;} catch (e) {console.error(e); process.exitCode = 2;}
}
