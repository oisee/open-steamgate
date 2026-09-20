import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {available, chooseInstance, instancePorts} from './free-instance.mjs';

test('whole instance port set includes HTTPS 443nn', () => {
  assert.deepEqual(instancePorts(57), [3057, 3257, 3357, 8057, 44357]);
});
test('skip occupied sets and wrap within 50–89', async () => {
  const seen = [];
  assert.equal(await chooseInstance(async ports => { seen.push(ports[0]); return seen.length === 3; }, 39), '51');
  assert.deepEqual(seen, [3089, 3050, 3051]);
});
test('exhaustion fails without reusing an occupied instance', async () => {
  let count = 0;
  await assert.rejects(chooseInstance(async () => { count++; return false; }, 0), /No free OSD instance/);
  assert.equal(count, 40);
});
test('actual occupied socket is rejected; successful probes release sockets', async () => {
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '0.0.0.0', resolve));
  const port = occupied.address().port;
  try { assert.equal(await available([port]), false); }
  finally { await new Promise(resolve => occupied.close(resolve)); }
  assert.equal(await available([port]), true);
  assert.equal(await available([port]), true);
});
