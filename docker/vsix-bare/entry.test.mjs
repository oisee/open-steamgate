import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Execute the real entry script with isolated paths and process stand-ins.
// The CLI returns immediately; only the Electron executable runs the harness.
async function exercise(mode = 'pass') {
  const root = await mkdtemp(join(tmpdir(), 'vsix-entry-'));
  try {
    const bin = join(root, 'bin');
    await mkdir(bin);
    for (const tool of ['mkdir', 'find', 'tail', 'cp', 'timeout', 'cat', 'tee', 'sleep']) {
      await symlink(`/usr/bin/${tool}`, join(bin, tool));
    }
    const paths = {'/smoke': join(root, 'smoke'), '/input': join(root, 'input'),
      '/opt/smoke': join(root, 'harness'), '/opt/code/code': join(bin, 'electron')};
    let script = await readFile(new URL('./entry.sh', import.meta.url), 'utf8');
    script = script.replace(/\/opt\/code\/code|\/opt\/smoke|\/smoke|\/input/g, path => paths[path]);
    await mkdir(paths['/opt/smoke']);
    await writeFile(join(paths['/opt/smoke'], 'harness.cjs'),
      await readFile(new URL('./harness.cjs', import.meta.url)));
    await writeFile(join(bin, 'code'), `#!/bin/bash
[[ "$*" == *--install-extension* ]] || exit 0
mkdir -p '${paths['/smoke']}/extensions/oisee.open-steamgate-1'
`, {mode: 0o755});
    await writeFile(join(bin, 'xvfb-run'), `#!/bin/bash
[[ "$1" == -a ]] || exit 98
shift
if [[ "$1" == -e ]]; then echo 'Xvfb diagnostic' > "$2"; shift 2; fi
if [[ "$ENTRY_MODE" == display ]]; then echo 'Xvfb failed to start' >&2; exit 17; fi
export DISPLAY=:99
exec "$@"
`, {mode: 0o755});
    await writeFile(join(bin, 'electron'), `#!/bin/bash
[[ -z "\${ELECTRON_RUN_AS_NODE+x}" && "$DISPLAY" == :99 ]] || exit 97
[[ "$*" == *--no-sandbox* && "$*" == *--disable-gpu* ]] || exit 96
[[ "$*" == *"--extensionDevelopmentPath=$SMOKE_EXTENSION"* ]] || exit 95
[[ "$*" == *"--extensionTestsPath=$SMOKE_EXTENSION/.bare-smoke-harness.cjs"* ]] || exit 94
[[ -s "$SMOKE_EXTENSION/.bare-smoke-harness.cjs" ]] || exit 93
sleep 0.1
if [[ "$ENTRY_MODE" == fail ]]; then
  mkdir -p '${paths['/smoke']}/user/logs/session/window1/exthost' '${paths['/smoke']}/user/logs/session/window1/renderer'
  echo 'extension host diagnostic' > '${paths['/smoke']}/user/logs/session/window1/exthost/exthost.log'
  echo 'renderer diagnostic' > '${paths['/smoke']}/user/logs/session/window1/renderer/renderer.log'
  echo 'output channel diagnostic' > '${paths['/smoke']}/user/logs/session/window1/channel.txt'
  echo 'Electron startup reason' >&2
  exit 23
fi
if [[ "$ENTRY_MODE" == pass ]]; then echo 'vsix-bare: PASS' > '${paths['/smoke']}/PASS'; fi
`, {mode: 0o755});
    const result = spawnSync('/bin/bash', ['-c', script], {
      env: {...process.env, PATH: bin, ENTRY_MODE: mode, ELECTRON_RUN_AS_NODE: '1'},
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    return {status: result.status, output: result.stdout + result.stderr};
  } finally { await rm(root, {recursive: true, force: true}); }
}

test('entry waits for Electron rather than the detached CLI and validates harness paths', async () => {
  const result = await exercise();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /VS Code test process exit code 0/);
  assert.match(result.output, /vsix-bare: PASS/);
});

test('Electron failure preserves its status and prints stderr plus nested logs', async () => {
  const result = await exercise('fail');
  assert.equal(result.status, 23, result.output);
  for (const message of ['exit code 23', 'Electron startup reason', 'extension host diagnostic',
    'renderer diagnostic', 'output channel diagnostic', 'Xvfb diagnostic']) {
    assert.ok(result.output.includes(message), result.output);
  }
});

test('Xvfb startup failure is reported with its status and server diagnostic', async () => {
  const result = await exercise('display');
  assert.equal(result.status, 17, result.output);
  assert.match(result.output, /Xvfb failed to start/);
  assert.match(result.output, /Xvfb diagnostic/);
});

test('successful Electron exit without running the harness still fails explicitly', async () => {
  const result = await exercise('no-marker');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /VS Code test process exit code 0/);
  assert.match(result.output, /exited without the harness PASS marker/);
});
