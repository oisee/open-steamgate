import {expect} from 'chai';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runtimeRootFixture} from './helpers/runtime-root.mjs';
import {zipInProcess} from '../tools/osd-abapgit-zip.mjs';
import {liveHash} from '../tools/osd-build.mjs';

const {Osd} = createRequire(import.meta.url)('../editors/vscode/lib.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = value => `CLASS zcl_zip_start_target DEFINITION PUBLIC CREATE PUBLIC.
PUBLIC SECTION. CLASS-METHODS answer RETURNING VALUE(rv) TYPE i. ENDCLASS.
CLASS zcl_zip_start_target IMPLEMENTATION. METHOD answer. rv = ${value}. ENDMETHOD. ENDCLASS.\n`;

describe('fresh osd up with a ZIP layer', function () {
  this.timeout(240000);
  const fixture = runtimeRootFixture();
  let child, socket;
  const log = [];
  afterEach(async () => {
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped;
    }
  });
  it('first STORE WRITE + ACTIVATE is warm, does not recycle, and preserves an open APC connection', async () => {
    const root = fixture.root, repository = join(root, 'zip-fixture');
    // No prebuilt generation, extracted base or overlay may hide startup ordering.
    rmSync(join(root, 'build'), {recursive: true, force: true}); rmSync(join(root, 'output'), {force: true});
    mkdirSync(join(repository, 'src'), {recursive: true});
    writeFileSync(join(repository, '.abapgit.xml'), '<STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>FULL</FOLDER_LOGIC>');
    writeFileSync(join(repository, 'src/package.devc.xml'), '<DEVC><DEVCLASS>$ZZIPSTART</DEVCLASS><CTEXT>fixture</CTEXT></DEVC>');
    writeFileSync(join(repository, 'src/zcl_zip_start_target.clas.abap'), source(1));
    writeFileSync(join(repository, 'src/zcl_zip_start_target.clas.xml'), '<VSEOCLASS><CLSNAME>ZCL_ZIP_START_TARGET</CLSNAME><STATE>1</STATE></VSEOCLASS>');
    // The real ABAP STORE destination, across the serving child's IPC seam.
    const probe = readFileSync('test/unit/zcl_osd_apc_store_probe.clas.abap', 'utf8')
      .replaceAll('zcl_osd_apc_store_probe', 'zcl_zip_start_probe').replaceAll('ZCL_APC_STORE_TARGET', 'ZCL_ZIP_START_TARGET')
      .replace("lv_command = i_message->get_text( ).", `DATA lv_source TYPE string.
    lv_command = i_message->get_text( ).
    IF strlen( lv_command ) > 6.
      IF lv_command(6) = 'write:'.
        lv_source = lv_command+6.
        ls_answer = zcl_osd_adt_host=>store( iv_command = 'WRITE'
          iv_type = 'CLAS' iv_name = 'ZCL_ZIP_START_TARGET' iv_source = lv_source ).
        send( io_manager = i_message_manager iv_text = ls_answer-json ).
        RETURN.
      ENDIF.
    ENDIF.`)
      .replace(/  METHOD if_apc_wsp_extension~on_close\.[\s\S]*?  ENDMETHOD\./, '  METHOD if_apc_wsp_extension~on_close.\n  ENDMETHOD.');
    writeFileSync(join(repository, 'src/zcl_zip_start_probe.clas.abap'), probe);
    writeFileSync(join(repository, 'src/zzip_start.sapc.xml'), '<SAPC><APPLICATION_ID>ZZIP_START</APPLICATION_ID><PATH>/zip-start</PATH><CLASS_NAME>ZCL_ZIP_START_PROBE</CLASS_NAME><STATEFUL>X</STATEFUL></SAPC>');
    const archive = join(root, 'fixture.zip'); writeFileSync(archive, zipInProcess(repository));
    const env = {...process.env, OSD_ROOT: root, OSD_WARM: '1', STG_TLS: '0', STG_DB: 'sqlite', STG_SERVE: 'child'};
    delete env.OSD_LAYERS; delete env.OSD_SELF;
    child = spawn(process.execPath, ['bin/osd.mjs', 'up', '--layer', archive], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => log.push(String(data)));
    const base = `http://localhost:${process.env.STG_PORT ?? 8099}`;
    let serving;
    for (let i = 0; i < 300; i++) {
      expect(child.exitCode, log.join('')).to.equal(null);
      serving = await fetch(base + '/osd/serving').then(r => r.json()).catch(() => undefined);
      if (serving?.ready) break;
      await pause(500);
    }
    console.log(log.join('').split('\n').filter(line => line.startsWith('warm:')).join('\n'));
    expect(serving?.ready, log.join('')).to.equal(true);
    const before = liveHash(root);
    const noEditBuild = generation => {
      const check = spawnSync(process.execPath, ['tools/osd-build.mjs'], {cwd: root,
        env: {...env, OSD_LAYERS: archive}, encoding: 'utf8', timeout: 60000});
      expect(check.status, check.stdout + check.stderr).to.equal(0);
      expect(check.stdout).to.include('reused ' + generation);
      expect(liveHash(root)).to.equal(generation);
    };
    // Exactly the issue's Check, before any edits on this fresh system.
    noEditBuild(before);
    const messages = [];
    socket = new WebSocket(base.replace('http:', 'ws:') + '/zip-start');
    socket.addEventListener('message', event => messages.push(event.data));
    const message = async index => {
      for (let i = 0; i < 1200 && messages.length <= index && socket.readyState !== WebSocket.CLOSED; i++) await pause(50);
      expect(messages.length, log.join('')).to.be.greaterThan(index); return messages[index];
    };
    expect(await message(0)).to.equal('ready');
    const editLog = log.length;
    let generation;
    if (process.env.OSD_ADT_ONE_RUNTIME === '1') {
      socket.send('write:' + source(7));
      expect(JSON.parse(await message(1))).to.have.property('revision');
      socket.send('activate');
      const operation = JSON.parse(await message(2));
      expect(operation.state).to.equal('pending');
      let status;
      for (let i = 0; i < 120; i++) {
        socket.send('status'); status = JSON.parse(await message(3 + i));
        if (status.state === 'published' || status.state === 'failed') break;
        await pause(100);
      }
      expect(status, log.join('')).to.include({state: 'published', active: true, live: true, verified: false});
      generation = status.generation_id;
    } else {
      // The old topology binds application STORE to the child's own store,
      // not the publishing host. Its ADT kernel invokes the host's STORE
      // WRITE/ACTIVATE; keep the application APC connection open as witness.
      const adt = new Osd(base), uri = '/sap/bc/adt/oo/classes/zcl_zip_start_target';
      const headers = {'x-sap-adt-sessiontype': 'stateful', 'sap-contextid-accept': 'header'};
      const lock = await adt.request(uri + '?_action=LOCK&accessMode=MODIFY', {method: 'POST', headers});
      const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(await lock.text())?.[1];
      expect(handle).to.be.a('string');
      const put = await adt.request(uri + '/source/main?lockHandle=' + encodeURIComponent(handle), {method: 'PUT', headers, body: source(7)});
      expect(put.status, await put.text()).to.equal(200);
      const result = await adt.activate({type: 'CLAS', name: 'ZCL_ZIP_START_TARGET', base: 'zcl_zip_start_target'});
      expect(result.ok, JSON.stringify(result)).to.equal(true);
      expect(result.build).to.equal('warm');
      generation = result.generation.split(' ')[0];
    }
    const after = await fetch(base + '/osd/serving').then(r => r.json());
    expect(after.pid).to.equal(serving.pid);
    expect(after.hot.swaps).to.equal(1);
    expect(after.generation).not.to.equal(before);
    expect(socket.readyState).to.equal(WebSocket.OPEN);
    expect(log.slice(editLog).join('')).not.to.include('osd-build: transpile');
    const response = await fetch(base + '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata');
    expect(response.headers.get('x-osd-generation')).to.include(generation);
    expect(after.hot.unverified).to.equal(true);
    expect(log.join('')).not.to.include('builds stay cold');
    // Verification is still mandatory and must finish on the same process.
    let verified;
    for (let i = 0; i < 240; i++) {
      verified = await fetch(base + '/osd/serving').then(r => r.json());
      if (!verified.hot.unverified) break;
      await pause(500);
    }
    expect(verified.hot.unverified, log.join('')).to.equal(false);
    expect(verified.pid).to.equal(serving.pid);
    expect(socket.readyState).to.equal(WebSocket.OPEN);
    noEditBuild(generation);
  });
});
