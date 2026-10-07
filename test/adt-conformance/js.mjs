import {mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, delimiter, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {files} from './fixtures/source.mjs';
import {run} from './run.mjs';
export async function runJS(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'adt-conformance-'));
  const oldLayers = process.env.OSD_LAYERS;
  const oldOutput = process.env.OSD_OUTPUT;
  let server;
  try {
    const layer = join(root, 'src'); mkdirSync(layer);
    for (const [name, source] of Object.entries(files)) writeFileSync(join(layer, name), source);
    process.env.OSD_LAYERS = [oldLayers, layer].filter(Boolean).join(delimiter);
    // Pin the transpiled artifact verified before this run. The synthetic
    // outline is parser input, so importing the server must not rebuild/publish it.
    process.env.OSD_OUTPUT = realpathSync('output');
    const {startServer} = await import('../start.mjs');
    server = startServer(true);
    if (!server.listening) await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
    return await run({target: 'js', base: `http://127.0.0.1:${process.env.STG_PORT ?? 3030}`, ...options});
  } finally {
    if (server) await server.close();
    if (oldOutput === undefined) delete process.env.OSD_OUTPUT; else process.env.OSD_OUTPUT = oldOutput;
    if (oldLayers === undefined) delete process.env.OSD_LAYERS; else process.env.OSD_LAYERS = oldLayers;
    rmSync(root, {recursive: true, force: true});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {process.exitCode = (await runJS()).exitCode;} catch (e) {console.error(e); process.exitCode = 2;}
}
