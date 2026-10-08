import {expect} from 'chai';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// bin/osd.mjs is also the compiled osd entry: help precedes home creation,
// layer validation, startup builds, and listener dispatch in both hosts.
describe('osd up --help', () => {
  const hosts = [[process.execPath, resolve('bin/osd.mjs')]];
  // The same assertions can exercise an actual built osd (or SEA/bundle),
  // using the host vector supported by the existing binary suites.
  if (process.env.OSD_BINARY) hosts.push(JSON.parse(process.env.OSD_BINARY));
  for (const [command, ...prefix] of hosts) for (const args of [['up', '--help'], ['up', '--help', '--layer', 'missing.zip']]) {
    it(`${[command, ...prefix].join(' ')} ${args.join(' ')} prints usage and exits without startup or filesystem writes`, () => {
      const root = mkdtempSync(join(tmpdir(), 'osd-up-help-'));
      try {
        const env = {...process.env, OSD_ROOT: root, OSD_LAYERS: join(root, 'missing-env.zip'), OSD_WARM: '1'};
        const result = spawnSync(command, [...prefix, ...args], {cwd: root, env,
          encoding: 'utf8', timeout: 10000});
        expect(result.error).to.equal(undefined);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stdout).to.include('Usage: osd up').and.include('--layer <folder|zip>').and.include('--help');
        expect(result.stdout + result.stderr).not.to.match(/osd-build:|Listening on|serving generation|system home/);
        expect(readdirSync(root)).to.deep.equal([]);
      } finally {rmSync(root, {recursive: true, force: true});}
    });
  }
});
