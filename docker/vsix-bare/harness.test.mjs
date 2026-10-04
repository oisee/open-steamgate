import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";

const source = await readFile(new URL("./harness.cjs", import.meta.url), "utf8");
const require = createRequire(import.meta.url);

async function exercise({startResult = true, generation = "generation-a", status = 200,
  identity = "launch-a", stopBehavior = "close"} = {}) {
  const logs = [];
  const markers = [];
  const commands = [];
  let stopped = false;
  const server = createServer((req, res) => {
    if (stopped) {
      if (stopBehavior === 'reset') req.socket.destroy();
      return; // A listener that accepts but never answers must fail Stop too.
    }
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
    server.closeAllConnections();
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
      stopped = true;
      if (stopBehavior === 'close') await close();
    }},
  };
  const exports = {};
  runInNewContext(source, {
    require: name => name === 'vscode' ? vscode : name === 'node:fs' ? {
      realpathSync: path => path, writeFileSync: (path, text) => markers.push({path, text}),
    } : require(name),
    exports, Buffer, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 5000 ? 80 : ms),
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

for (const stopBehavior of ['hang', 'reset']) {
  test(`Stop cannot create a PASS marker when the listener still accepts (${stopBehavior})`, async () => {
    const result = await exercise({stopBehavior});
    assert.ok(result.error, result.logs);
    assert.equal(result.markers.length, 0);
    assert.deepEqual(result.commands, ['osd.start', 'osd.stop', 'osd.stop']);
  });
}

// Expose the real helpers only inside this test's VM; the extension protocol
// continues to export just run().
const helpers = {};
runInNewContext(source + '\nexports.get = get; exports.waitForServing = waitForServing;', {
  require, exports: helpers, Buffer, setTimeout, clearTimeout,
});

async function withServer(handler, check) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('absolute HTTP deadline destroys a response that keeps trickling data', async () => {
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  await withServer((req, res) => {
    res.write('first');
    const timer = setInterval(() => res.write('more'), 10);
    const end = setTimeout(() => res.end('late'), 500);
    res.on('close', () => { clearInterval(timer); clearTimeout(end); disconnected(); });
  }, async url => {
    await assert.rejects(helpers.get(url, 80), {code: 'HTTP_DEADLINE'});
    await closed;
  });
});

test('first-answer polling caps a hanging request to the remaining budget', async () => {
  await withServer(() => {}, async url => {
    const started = Date.now();
    await assert.rejects(helpers.waitForServing(url, 80), {code: 'HTTP_DEADLINE'});
    assert.ok(Date.now() - started < 1000, 'poll exceeded its budget by a full retry delay');
  });
});

test('first-answer polling caps the retry delay to the remaining budget', async () => {
  let responses = 0;
  await withServer((req, res) => { responses++; res.writeHead(503); res.end(); }, async url => {
    const started = Date.now();
    // A timer can wake just before the deadline, allowing one last short
    // request; either a non-200 or its deadline is a valid final diagnostic.
    await assert.rejects(helpers.waitForServing(url, 80));
    assert.ok(Date.now() - started < 1000, 'poll exceeded its budget by a full retry delay');
    assert.ok(responses > 0, 'server must answer before exercising the retry delay');
  });
});
