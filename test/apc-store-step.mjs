import {expect} from 'chai';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {serveChannel, frame} from '../tools/osd-apc.mjs';
import {StoreIPCClient, attachStoreIPC} from '../tools/osd-store-ipc.mjs';
import {StoreDestination} from '../tools/osd-store-destination.mjs';
import {ActivationJournal} from '../tools/osd-activation-journal.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {WarmCompilerProcess} from '../tools/osd-warm-process.mjs';
import {closeWarm} from '../tools/osd-store-warm.mjs';
import {HotLoader, applyRuntimeHotSwap} from '../tools/osd-hot.mjs';
import {exclusive, workProcess} from '../tools/osd-dialog-step.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = 'ZCL_APC_STORE_TARGET';
const source = value => `CLASS zcl_apc_store_target DEFINITION PUBLIC CREATE PUBLIC.
PUBLIC SECTION. CLASS-METHODS answer RETURNING VALUE(rv) TYPE i. ENDCLASS.
CLASS zcl_apc_store_target IMPLEMENTATION. METHOD answer. rv = ${value}. ENDMETHOD. ENDCLASS.\n`;

// Same wire fixture as apc-timers.mjs: the real channel host and ABAP
// callbacks, with socket bytes and async IPC delivery, without a fixed port.
class Socket extends EventEmitter {
  writes = [];
  write(bytes) { this.writes.push(bytes); }
  end(bytes) { if (bytes) this.write(bytes); this.emit('close'); }
  messages() {
    return this.writes.filter(Buffer.isBuffer).filter(bytes => (bytes[0] & 15) === 1).map(bytes => {
      const length = bytes[1] & 127;
      return bytes.subarray(length < 126 ? 2 : length === 126 ? 4 : 10).toString();
    });
  }
  send(text, opcode = 1) {
    const bytes = frame(text, opcode), mask = randomBytes(4);
    const body = Buffer.from(bytes.subarray(2));
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.emit('data', Buffer.concat([Buffer.from([bytes[0], bytes[1] | 128]), mask, body]));
  }
  async until(count) {
    const deadline = Date.now() + 20000;
    while (this.messages().length < count && Date.now() < deadline) await sleep(5);
    expect(this.messages().length, JSON.stringify(this.messages())).to.be.at.least(count);
    return this.messages();
  }
}

describe('APC STORE activation ends at the message step boundary', function () {
  this.timeout(120000);
  let Host, root, store, ipc, parent, peer, socket, saved, hot, publishes, dump, failBuild, publicationGate, handled;
  before(async () => {
    await import('./start.mjs');
    Host = (await import('../output/zcl_apc_host.clas.mjs')).zcl_apc_host;
  });
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'apc-store-step-'));
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    mkdirSync(join(root, '.local/lars'), {recursive: true});
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    symlinkSync(resolve('.local/lars/open-abap-core'), join(root, '.local/lars/open-abap-core'));
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'abaplint.jsonc'), JSON.stringify({syntax: {version: 'OpenABAP'}}));
    writeFileSync(join(root, 'abap_transpile.json'), JSON.stringify({input_folder: ['src'], output_folder: 'output',
      libs: [{folder: '/.local/lars/open-abap-core', exclude_filter: ['/src/tcp/']}], write_unit_tests: true,
      options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: 'compileError',
        setup: {filename: '../test/setup.mjs', preFunction: 'setup'}}}));
    writeFileSync(join(root, 'test/setup.mjs'), `import {SQLiteDatabaseClient} from '@abaplint/database-sqlite';
export async function setup(abap, schemas, insert) {
 const db = new SQLiteDatabaseClient(); abap.context.databaseConnections.DEFAULT = db;
 await db.connect(); await db.execute(schemas.sqlite); await db.execute(insert);
}`);
    writeFileSync(join(root, 'src/zcl_apc_store_target.clas.abap'), source(1));
    writeFileSync(join(root, 'src/zcl_apc_store_target.clas.testclasses.abap'), `CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION. METHOD check.
cl_abap_unit_assert=>assert_equals( act = zcl_apc_store_target=>answer( ) exp = 2 ). ENDMETHOD. ENDCLASS.\n`);
    store = new ObjectStore({root, libs: ['.local/lars/open-abap-core/src'], build: {generators: false}});
    store.activationJournal = new ActivationJournal(root, {host: 'apc-step-probe'});
    store.warmState = {on: false};
    expect((await store.publish()).ok).to.equal(true);
    hot = new HotLoader(root);
    const abap = globalThis.abap;
    saved = {store: abap.context.RFCDestinations.STORE, generation: abap.context.osdGeneration,
      jobs: abap.context.RFCDestinations.JOBS?.generation, classes: {...abap.Classes}};
    const runtime = store.served = {running: true, epoch: 1, generation: hot.generation, swaps: 0,
      hot: swap => exclusive(async () => {
        const result = await applyRuntimeHotSwap(hot, {generation: swap.generation, modules: swap.modules, only: swap.only});
        runtime.generation = swap.generation; runtime.swaps = result.swaps; return result;
      }, 'APC regression warm swap'),
      recycle: () => { throw new Error('this existing content edit must stay warm'); }, verified() {},
    };
    store.warmState = {on: true, compiler: new WarmCompilerProcess({root,
      overlay: set => store.overlay(set), keyOf: file => store.objectKeyOf(file), inactiveSources: set => store.inactiveSources(set)})};
    expect(await store.warmUp(), store.warmState.reason).not.to.equal(undefined);
    await store.write('CLAS', target, source(2));
    publishes = 0; failBuild = false; dump = []; publicationGate = undefined; handled = [];
    const publish = store.publish.bind(store);
    store.publish = async options => {
      publishes++;
      if (publicationGate) { publicationGate.enter(); await publicationGate.wait; }
      // Deterministically let message #2 overtake the old fire-and-forget
      // notification. Publication must run outside the work-process lock.
      await sleep(50);
      if (failBuild) throw new Error('APC publication failed');
      return publish(options);
    };
    parent = new EventEmitter(); peer = new EventEmitter();
    parent.connected = peer.connected = true;
    parent.send = (message, callback) => { setImmediate(() => { if (peer.connected) peer.emit('message', message); }); callback?.(); return true; };
    peer.send = (message, callback) => { setImmediate(() => { if (parent.connected) parent.emit('message', message); }); callback?.(); return true; };
    attachStoreIPC(parent, {storeDestination: new StoreDestination({store})});
    ipc = new StoreIPCClient(peer);
    abap.context.RFCDestinations.STORE = ipc;
    socket = new Socket();
    class TrackedHost extends Host {
      async message(input) { handled.push(input.iv_text.get()); return super.message(input); }
    }
    await serveChannel({req: {headers: {'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='}, url: '/store'},
      socket, head: Buffer.alloc(0), host: TrackedHost,
      channel: {path: '/store', name: 'STORE', handler: 'ZCL_OSD_APC_STORE_PROBE', stateful: true},
      log: text => dump.push(text)});
    expect(socket.writes[0]).to.include('101 Switching Protocols');
    expect(socket.messages()).to.deep.equal(['ready']);
  });
  afterEach(async () => {
    publicationGate?.release();
    // Wait for both the mailbox and any old asynchronous publication, even
    // on the failing-first run, before removing the private source tree.
    const deadline = Date.now() + 30000;
    while ((workProcess().held || workProcess().waiting || Object.values(store?.activationJournal.entries ?? {}).some(e => e.state === 'pending')) && Date.now() < deadline) await sleep(10);
    socket?.end(); ipc?.close();
    if (parent) { parent.connected = peer.connected = false; parent.emit('disconnect'); peer.emit('disconnect'); parent.emit('exit'); }
    await closeWarm(store); await store?.warmState?.verifying;
    if (saved) {
      const abap = globalThis.abap;
      abap.context.RFCDestinations.STORE = saved.store;
      abap.context.osdGeneration = saved.generation;
      if (abap.context.RFCDestinations.JOBS) abap.context.RFCDestinations.JOBS.generation = saved.jobs;
      // The miniature generation also imports its own core definitions.
      // Restore their identities as well as the target: later suites cast
      // against the original CX_ROOT and assertion classes.
      for (const key of Object.keys(abap.Classes)) if (!(key in saved.classes)) delete abap.Classes[key];
      Object.assign(abap.Classes, saved.classes);
    }
    if (root) rmSync(root, {recursive: true, force: true});
    expect(workProcess()).to.include({held: false, waiting: 0});
  });
  function gatePublication() {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    publicationGate = {enter, release, wait};
    return {entered, release};
  }
  it('startup activation publishes before its immediately due timer queries status', async () => {
    // A warm swap intentionally cancels old-generation timers. Publish cold
    // with no serving child so this test measures the startup mailbox itself.
    await closeWarm(store); store.warmState.on = false; store.served = undefined;
    socket.end(); socket = new Socket();
    const gate = gatePublication();
    const opening = serveChannel({req: {headers: {'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='}, url: '/store'},
      socket, head: Buffer.alloc(0), host: Host,
      channel: {path: '/store', name: 'STORE', handler: 'ZCL_OSD_APC_START_PROBE', stateful: true},
      log: text => dump.push(text)});
    try {
      await gate.entered;
      await sleep(30); // the zero-delay timer has expired while publication waits
      expect(socket.writes).to.have.length(0);
      expect(Object.values(store.activationJournal.entries)[0].state).to.equal('pending');
    } finally { gate.release(); }
    await opening;
    const [pending, status] = (await socket.until(2)).map(JSON.parse);
    expect(socket.writes[0]).to.include('101 Switching Protocols');
    expect(status).to.include({state: 'published', op_id: pending.op_id});
    expect(store.activationJournal.lookup(pending.op_id)).to.deep.equal(status);
    expect(publishes).to.equal(1); expect(dump).to.deep.equal([]);
  });
  it('drops queued messages on transport close but completes committed publication', async () => {
    const gate = gatePublication();
    socket.send('activate'); socket.send('tests');
    try {
      await gate.entered;
      expect(handled).to.deep.equal(['activate']);
      const pending = JSON.parse((await socket.until(2))[1]);
      const writes = socket.writes.length;
      socket.end();
      gate.release();
      const deadline = Date.now() + 20000;
      while (store.activationJournal.lookup(pending.op_id).state === 'pending' && Date.now() < deadline) await sleep(5);
      // An independent FIFO step can proceed during publication and is a
      // deterministic checkpoint after the gated event gives up its lock.
      await exclusive(async () => {});
      await sleep(30);
      expect(store.activationJournal.lookup(pending.op_id)).to.include({state: 'published', active: true});
      expect(handled).to.deep.equal(['activate']);
      expect(socket.writes).to.have.length(writes + 1); // transport close frame only
      expect(publishes).to.equal(1); expect(dump).to.deep.equal([]);
    } finally { gate.release(); }
  });
  it('publishes before the next on_message on the same socket and runs tests on that generation', async () => {
    socket.send('activate'); socket.send('tests');
    const messages = await socket.until(4);
    const [pending, status, tests] = messages.slice(1).map(JSON.parse);
    expect(pending).to.include({state: 'pending'});
    expect(status).to.include({state: 'published', op_id: pending.op_id});
    expect(tests).to.include({state: 'ran', generation_id: status.generation_id});
    expect(tests.counts).to.include({pass: 1, fail: 0, error: 0});
    expect(publishes).to.equal(1); expect(dump).to.deep.equal([]);
  });
  it('records a failed APC publication in the journal before the next message', async () => {
    failBuild = true;
    socket.send('activate'); socket.send('status');
    const messages = await socket.until(3);
    const [pending, status] = messages.slice(1).map(JSON.parse);
    expect(pending.state).to.equal('pending');
    expect(status).to.include({state: 'failed', op_id: pending.op_id, failure_stage: 'build'});
    expect(store.activationJournal.lookup(pending.op_id)).to.deep.equal(status);
    expect(publishes).to.equal(1);
  });
  it('uses the same completion rule for a direct Node STORE destination', async () => {
    ipc.close();
    globalThis.abap.context.RFCDestinations.STORE = new StoreDestination({store});
    socket.send('activate'); socket.send('tests');
    const [pending, status, tests] = (await socket.until(4)).slice(1).map(JSON.parse);
    expect(pending.state).to.equal('pending');
    expect(status).to.include({state: 'published', op_id: pending.op_id});
    expect(tests).to.include({state: 'ran', generation_id: status.generation_id});
    expect(tests.counts.pass).to.equal(1);
  });
  it('rolls back a dumping on_message and fails its activation without publishing', async () => {
    const db = globalThis.abap.context.databaseConnections.DEFAULT;
    await db.insert({table: 'zosd_job_seen', columns: ['mandt', 'run_id', 'row_no', 'kind'], values: ["'123'", "'APC_STEP_PROBE'", '0', "'A'"]});
    await db.commit();
    const sql = 'SELECT "run_id" FROM "zosd_job_seen" WHERE "run_id" = \'APC_STEP_PROBE\'';
    const before = (await db.select({select: sql})).rows;
    socket.send('dump'); socket.send('activate');
    const deadline = Date.now() + 20000;
    while (!dump.length && Date.now() < deadline) await sleep(5);
    expect(dump).to.have.length(1);
    const [operation] = Object.values(store.activationJournal.entries);
    expect(operation).to.include({state: 'failed', failure_stage: 'step', active: false});
    expect(publishes).to.equal(0);
    await sleep(30);
    expect(handled).to.deep.equal(['dump']);
    expect((await db.select({select: sql})).rows).to.deep.equal(before);
    await db.execute('DELETE FROM "zosd_job_seen" WHERE "run_id" = \'APC_STEP_PROBE\'');
    await db.commit();
  });
  it('finishes an activation from on_close without waiting for socket teardown', async () => {
    socket.send('', 8);
    const deadline = Date.now() + 20000;
    while (!socket.writes.some(bytes => Buffer.isBuffer(bytes) && (bytes[0] & 15) === 8) && Date.now() < deadline) await sleep(5);
    expect(Object.values(store.activationJournal.entries)).to.have.length(1);
    expect(Object.values(store.activationJournal.entries)[0]).to.include({state: 'published'});
    expect(publishes).to.equal(1);
  });
});
