import {expect} from 'chai';
import {connect} from 'node:net';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {runtimeRootFixture} from './helpers/runtime-root.mjs';
import {ServingRuntime} from '../tools/osd-runtime.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {StoreDestination} from '../tools/osd-store-destination.mjs';
import {ActivationJournal} from '../tools/osd-activation-journal.mjs';
import {WarmCompilerProcess} from '../tools/osd-warm-process.mjs';
import {closeWarm} from '../tools/osd-store-warm.mjs';
import {frame, unframe} from '../tools/osd-apc.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 60000;
  while (!predicate() && Date.now() < deadline) await pause(5);
  expect(predicate(), 'condition did not complete').to.equal(true);
}
async function channel(runtime) {
  const socket = connect(new URL(runtime.url).port, '127.0.0.1');
  const messages = [];
  let buffer = Buffer.alloc(0), upgraded = false;
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      expect(buffer.subarray(0, end).toString()).to.include('101 Switching Protocols');
      buffer = buffer.subarray(end + 4); upgraded = true;
    }
    for (;;) {
      const parsed = unframe(buffer);
      if (!parsed) break;
      buffer = parsed.rest;
      if (parsed.opcode === 1) messages.push(parsed.payload.toString());
    }
  });
  await once(socket, 'connect');
  socket.write('GET /store-step HTTP/1.1\r\nHost: probe\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  await until(() => messages.length === 1);
  expect(messages).to.deep.equal(['ready']);
  return {socket, messages, send(text) {
    const bytes = frame(text), mask = randomBytes(4), body = Buffer.from(bytes.subarray(2));
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    socket.write(Buffer.concat([Buffer.from([bytes[0], bytes[1] | 128]), mask, body]));
  }};
}

describe('APC publication in a real ServingRuntime', function () {
  this.timeout(180000);
  const fixture = runtimeRootFixture();
  let store, runtime, client, release;
  const source = value => `CLASS zcl_apc_store_target DEFINITION PUBLIC CREATE PUBLIC.
PUBLIC SECTION. CLASS-METHODS answer RETURNING VALUE(rv) TYPE i. ENDCLASS.
CLASS zcl_apc_store_target IMPLEMENTATION. METHOD answer. rv = ${value}. ENDMETHOD. ENDCLASS.\n`;
  before(async () => {
    const root = fixture.root;
    writeFileSync(join(root, 'src/zcl_apc_store_target.clas.abap'), source(1));
    writeFileSync(join(root, 'src/zstore_step.sapc.xml'), '<SAPC><APPLICATION_ID>ZSTORE_STEP</APPLICATION_ID><PATH>/store-step</PATH><CLASS_NAME>ZCL_OSD_APC_STORE_PROBE</CLASS_NAME><STATEFUL>X</STATEFUL></SAPC>');
    store = new ObjectStore({root});
    store.activationJournal = new ActivationJournal(root, {host: 'serving-apc-probe'});
    store.warmState = {on: false};
    expect((await store.publish()).ok).to.equal(true);
  });
  afterEach(async () => {
    release?.(); release = undefined;
    client?.socket.destroy(); client = undefined;
    await closeWarm(store); await store.warmState?.verifying;
    await runtime?.stop(); runtime = undefined; store.served = undefined;
  });
  for (const fallback of [false, true]) {
    it(`${fallback ? 'refused warm swap' : 'cold build'} recycles after transport closure and exposes the committed journal on reconnect`, async () => {
      runtime = new ServingRuntime({root: fixture.root, env: {STG_DB: 'sqlite', STG_DB_PATH: '', OSD_ADT_ONE_RUNTIME: '1', OSD_WARM: '0'}});
      runtime.storeDestination = new StoreDestination({store});
      await runtime.start(); store.served = runtime;
      const epoch = runtime.epoch;
      let refused = 0;
      if (fallback) {
        store.warmState = {on: true, compiler: new WarmCompilerProcess({root: fixture.root,
          overlay: set => store.overlay(set), keyOf: file => store.objectKeyOf(file), inactiveSources: set => store.inactiveSources(set)})};
        expect(await store.warmUp()).not.to.equal(undefined);
        runtime.hot = async () => { refused++; throw new Error('regression: warm swap refused'); };
      } else store.warmState = {on: false};
      await store.write('CLAS', 'ZCL_APC_STORE_TARGET', source(fallback ? 3 : 2));
      let enter;
      const entered = new Promise(resolve => { enter = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const publish = store.publish.bind(store);
      store.publish = async options => { enter(); await gate; return publish(options); };
      try {
        client = await channel(runtime);
        client.send('activate'); client.send('activate');
        await entered;
        const operation = Object.values(store.activationJournal.entries).at(-1);
        expect(operation.state).to.equal('pending');
        const count = Object.keys(store.activationJournal.entries).length;
        const disconnected = once(client.socket, 'close');
        client.socket.destroy(); await disconnected;
        // Let the child observe transport closure before releasing publication.
        await pause(50); release();
        await until(() => store.activationJournal.lookup(operation.op_id).state !== 'pending');
        const published = store.activationJournal.lookup(operation.op_id);
        expect(published).to.include({state: 'published', active: true, live: true});
        expect(runtime.epoch).to.equal(epoch + 1);
        expect(refused).to.equal(fallback ? 1 : 0);
        expect(Object.keys(store.activationJournal.entries)).to.have.length(count);
        client = await channel(runtime);
        client.send('lookup:' + operation.op_id);
        await until(() => client.messages.length === 2);
        expect(JSON.parse(client.messages[1])).to.deep.equal(published);
      } finally { release(); store.publish = publish; }
    });
  }
});
