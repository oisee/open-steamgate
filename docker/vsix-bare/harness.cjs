// VS Code's extensionTestsPath protocol: exports.run(), no test framework.
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  })]).finally(() => clearTimeout(timer));
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {timeout: 5000}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString()}));
    });
    req.on('timeout', () => req.destroy(new Error(`HTTP timeout: ${url}`)));
    req.on('error', reject);
  });
}

exports.run = async () => {
  const vscode = require('vscode');
  const started = Date.now();
  const output = [];
  const originals = new Map();
  function replace(name, fn) {
    originals.set(name, vscode.window[name]);
    vscode.window[name] = fn;
  }
  // Drive only the first-start choice; report errors without choosing a retry.
  replace('showInformationMessage', async (message, ...items) => {
    console.log(`vsix-bare: prompt: ${message}`);
    return items.find(item => typeof item === 'string' && /use the bundled copy/i.test(item));
  });
  replace('showWarningMessage', async message => { console.log(`vsix-bare: warning: ${message}`); });
  replace('showErrorMessage', async message => { output.push(message); console.error(message); });
  const create = vscode.window.createOutputChannel;
  replace('createOutputChannel', (...args) => {
    const channel = create.apply(vscode.window, args);
    for (const method of ['append', 'appendLine']) {
      const original = channel[method].bind(channel);
      channel[method] = text => {
        output.push(`[${args[0]}] ${text}`);
        process.stdout.write(`[${args[0]}] ${text}${method === 'appendLine' ? '\n' : ''}`);
        original(text);
      };
    }
    return channel;
  });
  try {
    const extension = vscode.extensions.getExtension('oisee.open-steamgate');
    assert.ok(extension, 'installed extension missing');
    assert.equal(fs.realpathSync(extension.extensionPath), fs.realpathSync(process.env.SMOKE_EXTENSION));
    await bounded(extension.activate(), 60000, 'extension activation');
    const command = extension.packageJSON.contributes.commands.find(
      item => item.title === 'osd: Start (build + run this system)');
    assert.ok(command, 'Start command missing from installed package');
    const result = await bounded(vscode.commands.executeCommand(command.command), 540000, 'Start');
    assert.equal(result, true, 'Start failed; see extension output and build error lines above');
    const url = vscode.workspace.getConfiguration('osd').get('url');
    // Start resolves when the system reports ready; the first answer can still lag
    // (e.g. while the warm cache primes). Poll, and print how long it took, so a
    // slow first answer is visible as a number instead of a flaky failure.
    const askedAt = Date.now();
    let serving, lastError;
    while (Date.now() - askedAt < 120000) {
      try { serving = await get(`${url}/osd/serving`); if (serving.status === 200) break; }
      catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!serving || serving.status !== 200) throw lastError || new Error(`no 200 from ${url}/osd/serving within 120 s`);
    console.log(`vsix-bare: first /osd/serving answer ${((Date.now() - askedAt) / 1000).toFixed(2)} s after Start resolved`);
    const identity = JSON.parse(serving.body);
    assert.equal(identity.ready, true);
    assert.ok(identity.launcherPid > 0 && identity.launcherIdentity, 'missing serving identity');
    assert.ok(identity.generation, 'missing serving generation');
    const metadata = await get(`${url}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
    assert.equal(metadata.status, 200, metadata.body.slice(0, 1000));
    assert.equal(metadata.headers['x-osd-generation'], String(identity.generation));
    assert.match(metadata.body, /<.*Edmx/);
    await bounded(vscode.commands.executeCommand('osd.stop'), 90000, 'Stop');
    await assert.rejects(get(`${url}/osd/serving`), 'system still answers after Stop');
    fs.writeFileSync('/smoke/PASS', `vsix-bare: PASS in ${((Date.now() - started) / 1000).toFixed(2)} s; ${url}; identity=${identity.launcherIdentity}; generation=${identity.generation}\n`);
  } catch (error) {
    console.error(`vsix-bare: FAIL after ${((Date.now() - started) / 1000).toFixed(2)} s: ${error.stack}`);
    console.error('--- captured extension output / osd log ---\n' + output.join('\n'));
    throw error;
  } finally {
    try { await bounded(vscode.commands.executeCommand('osd.stop'), 90000, 'cleanup Stop'); }
    finally { for (const [name, fn] of originals) vscode.window[name] = fn; }
  }
};
