import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";

const source = await readFile(new URL("./harness.cjs", import.meta.url), "utf8");
const require = createRequire(import.meta.url);

async function exercise({startResult = true, generation = "generation-a", status = 200, identity = "launch-a"} = {}) {
  const logs = [];
  const markers = [];
  const commands = [];
  const server = createServer((req, res) => {
    if (req.url === '/osd/serving') {
      res.end(JSON.stringify({ready: true, launcherPid: process.pid,
        launcherIdentity: identity, generation: 'generation-a'}));
    } else {
      assert.equal(req.url, '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata');
      res.writeHead(status, {'X-OSD-Generation': generation});
      res.end('<edmx:Edmx/>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  const vscode = {
    window: {
      createOutputChannel: () => ({append() {}, appendLine() {}}),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    workspace: {getConfiguration: () => ({get: () => url})},
    extensions: {getExtension: () => ({extensionPath: '/installed',
      packageJSON: {contributes: {commands: [{command: 'osd.start', title: 'osd: Start (build + run this system)'}]}},
      activate: async () => {
        if (!startResult) vscode.window.createOutputChannel('osd system').appendLine(
          'osd-build: FAILED: check_syntax: Component SCHEDULED not found in structure BTCSELECT');
      },
    })},
    commands: {executeCommand: async command => {
      commands.push(command);
      if (command === 'osd.start') {
        const answer = await vscode.window.showInformationMessage('Run the system from this folder?',
          'Yes, use workspace', 'No, use the bundled copy (remembered)');
        assert.equal(answer, 'No, use the bundled copy (remembered)');
        return startResult;
      }
      assert.equal(command, 'osd.stop');
      await close();
    }},
  };
  const exports = {};
  runInNewContext(source, {
    require: name => name === 'vscode' ? vscode : name === 'node:fs' ? {
      realpathSync: path => path, writeFileSync: (path, text) => markers.push({path, text}),
    } : require(name),
    exports, Buffer, setTimeout, clearTimeout,
    process: {env: {SMOKE_EXTENSION: '/installed'}, stdout: {write: text => logs.push(text)}},
    console: {log: text => logs.push(text), error: text => logs.push(text)},
  });
  let error;
  try { await exports.run(); } catch (caught) { error = caught; }
  finally { await close(); }
  return {error, logs: logs.join('\n'), markers, commands};
}

test('harness requires metadata from the ready generation and stops before marking PASS', async () => {
  const result = await exercise();
  assert.equal(result.error, undefined, result.logs);
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].path, '/smoke/PASS');
  assert.match(result.markers[0].text, /identity=launch-a; generation=generation-a/);
  assert.deepEqual(result.commands, ['osd.start', 'osd.stop', 'osd.stop']);
});

test('failed Start rejects immediately, prints the build diagnostic and still stops', async () => {
  const result = await exercise({startResult: false});
  assert.match(result.error.message, /Start failed/);
  assert.match(result.logs, /osd-build: FAILED: check_syntax:.*SCHEDULED/);
  assert.equal(result.markers.length, 0);
  assert.deepEqual(result.commands, ['osd.start', 'osd.stop']);
});

test('mismatched metadata generation cannot create a PASS marker', async () => {
  const result = await exercise({generation: 'stale-generation'});
  assert.ok(result.error);
  assert.equal(result.markers.length, 0);
  assert.deepEqual(result.commands, ['osd.start', 'osd.stop']);
});

test('missing launcher identity cannot create a PASS marker', async () => {
  const result = await exercise({identity: ''});
  assert.match(result.error.message, /missing serving identity/);
  assert.equal(result.markers.length, 0);
});

test('HTTP failure cannot create a PASS marker', async () => {
  const result = await exercise({status: 500});
  assert.ok(result.error);
  assert.equal(result.markers.length, 0);
});
