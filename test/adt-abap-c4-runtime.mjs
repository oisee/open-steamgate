import {expect} from 'chai';
import express from 'express';
import {ServingRuntime} from '../tools/osd-runtime.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {StoreDestination} from '../tools/osd-store-destination.mjs';
import {Data} from '../tools/osd-data.mjs';
import {adtRouter} from '../tools/adt-facade.mjs';
import {abapRunner} from '../tools/adt-abap-front.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';
import {previewSQL} from '../tools/adt-preview-sql.mjs';
import {OsdPostgresClient} from '../tools/postgres-client.mjs';
import './start.mjs';
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";

const runtimeFixture = runtimeRootFixture();

describe('C4 serving database and switch-off compatibility', function () {
  this.timeout(120000);
  let runtime, store, servers = [], previous, previousLocal;
  before(async () => {
    previous = process.env.OSD_ADT_ONE_RUNTIME;
    previousLocal = abap.context.RFCDestinations.STORE.localSystem;
    store = new ObjectStore({root: runtimeFixture.root});
    runtime = new ServingRuntime({root: runtimeFixture.root, env: {OSD_ADT_ONE_RUNTIME: '1', STG_DB:'sqlite', STG_DB_PATH:'', STG_TLS:'0'}});
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
  });
  afterEach(() => {
    abap.context.RFCDestinations.STORE.localSystem = previousLocal;
    if (previous === undefined) delete process.env.OSD_ADT_ONE_RUNTIME; else process.env.OSD_ADT_ONE_RUNTIME = previous;
  });
  after(async () => {
    for (const s of servers) await new Promise(r => s.close(r));
    await runtime?.stop();
    if (previous === undefined) delete process.env.OSD_ADT_ONE_RUNTIME; else process.env.OSD_ADT_ONE_RUNTIME = previous;
  });
  async function mount(runner) {
    const served = [];
    const app = express(); app.set('etag', false);
    app.use(adtRouter({store, data:new Data({runtime}), watch:false, logMisses:false, abap:runner,
      abapServed:(by, req) => served.push(`${by} ${req.originalUrl.replace(/\?$/, '')}`)}).router);
    const server = await new Promise(r => {const s = app.listen(0, '127.0.0.1', () => r(s));}); servers.push(server);
    const url = `http://127.0.0.1:${server.address().port}`;
    const warm = await fetch(url+'/sap/bc/adt/core/discovery', {headers:{'x-csrf-token':'fetch'}}); await warm.text();
    const headers = {'x-csrf-token':warm.headers.get('x-csrf-token'), cookie:warm.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')};
    return {served, async preview(method = "POST", path = "/sap/bc/adt/datapreview/freestyle?", body = "SELECT * FROM zstg_demo") {
      served.length = 0;
      const res = await fetch(url+path, {method, headers, ...(method === 'POST' ? {body} : {})});
      return {status:res.status, body:(await res.text()).replace(/(<dataPreview:queryExecutionTime>)\d+(<)/g, '$1TIME$2'), type:res.headers.get('content-type')};
    }};
  }
  it('OSD_ADT_ONE_RUNTIME=1 gets application rows from the serving child', async () => {
    const node = await mount(undefined);
    const child = await mount(abapRunner({remote:runtime}));
    const raw = abap.context.databaseConnections.DEFAULT;
    const original = raw.select;
    raw.select = function (input) {
      if (/zstg_demo/i.test(input.select)) throw new Error('parent database must not serve preview');
      return original.call(this, input);
    };
    try {
      const actual = await child.preview();
      expect(actual).to.deep.equal(await node.preview());
      expect(actual.status,actual.body).to.equal(200);
      expect(actual.body).to.match(/<dataPreview:totalRows>[1-9][0-9]*</);
      const rows = await new Data({runtime}).query('SELECT * FROM zstg_demo');
      expect(rows.rows.length).to.be.greaterThan(0);
      expect(child.served).to.deep.equal(['ABAP /sap/bc/adt/datapreview/freestyle']);
      for (const [method, path, body] of [
        ['GET','/sap/bc/adt/datapreview/ddic/zstg_demo/metadata',''],
        ['POST','/sap/bc/adt/datapreview/ddic?ddicEntityName=zstg_demo',''],
        ['GET','/sap/bc/adt/datapreview/cds/zc_stg_travel/metadata',''],
        ['POST','/sap/bc/adt/datapreview/cds?ddlSourceName=zc_stg_travel','']]) {
        const result = await child.preview(method,path,body);
        expect(result).to.deep.equal(await node.preview(method,path,body));
        expect(result.status,result.body).to.equal(200);
        expect(child.served).to.deep.equal([`ABAP ${path.replace(/\?$/, '')}`]);
      }
    } finally { raw.select = original; }
  });
  it('switch off keeps the Node preview through Data /osd/sql', async () => {
    process.env.OSD_ADT_ONE_RUNTIME = '0';
    const node = await mount(undefined);
    const inline = await mount(abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER, step:dialogStep}));
    expect(await inline.preview()).to.deep.equal(await node.preview());
    expect(inline.served).to.deep.equal(['HOST /sap/bc/adt/datapreview/freestyle']);
  });
});

describe('C4 PostgreSQL SELECT fence', () => {
  it('a failed SELECT rolls back its savepoint and leaves the pending session usable', async () => {
    const client = new OsdPostgresClient({host:'unused'});
    const calls = []; let aborted = false;
    client.client = {query:async sql => {
      calls.push(sql);
      sql = sql.text ?? sql;
      if (sql.startsWith('ROLLBACK TO')) aborted = false;
      else if (aborted) throw new Error('current transaction is aborted');
      if (sql.includes('broken')) {aborted = true; throw new Error('unknown column');}
      return {rows:[{id:'pending-session'}]};
    }};
    const answer = await previewSQL(client, 'SQL', {statement:'SELECT broken FROM zstg_demo'});
    expect(answer).to.have.property('error');
    // selectOne fences itself too (the switch-off Data path has no outer fence)
    expect(calls).to.deep.equal(['SAVEPOINT osd_adt_preview','SAVEPOINT osd_select',{text:'SELECT broken FROM zstg_demo LIMIT 100', values:[], queryMode:'extended'},
      'ROLLBACK TO SAVEPOINT osd_select; RELEASE SAVEPOINT osd_select;',
      'ROLLBACK TO SAVEPOINT osd_adt_preview','RELEASE SAVEPOINT osd_adt_preview']);
    expect((await client.select({select:'SELECT id FROM zosd_adt_sess'})).rows).to.deep.equal([{id:'pending-session'}]);
  });
  it('selectOne alone (the switch-off Data path) keeps an open LUW usable after a failed SELECT', async () => {
    const client = new OsdPostgresClient({host:'unused'});
    let aborted = false;
    client.client = {query:async sql => {
      sql = sql.text ?? sql;
      if (sql.startsWith('ROLLBACK TO')) aborted = false;
      else if (aborted) throw new Error('current transaction is aborted');
      if (sql.includes('broken')) {aborted = true; throw new Error('unknown column');}
      return {rows:[{id:'pending-session'}]};
    }};
    let failed;
    try { await client.selectOne('SELECT broken FROM zstg_demo'); } catch (error) { failed = error; }
    expect(failed?.message).to.equal('unknown column');
    expect((await client.select({select:'SELECT id FROM zosd_adt_sess'})).rows).to.deep.equal([{id:'pending-session'}]);
  });

  for (const middle of ['DELETE FROM t', 'COMMIT']) it(`refuses ${middle} before PostgreSQL SAVEPOINT`, async () => {
    const client = new OsdPostgresClient({host:'unused'});
    const calls = [];
    client.client = {query:async sql => {calls.push(sql); throw new Error('must not execute');}};
    for (const kind of ['SQL', 'SQLCHECK']) {
      expect((await previewSQL(client, kind, {statement:`SELECT 1; ${middle}; SELECT 2`})).code).to.equal('NOT_ALLOWED');
    }
    expect(calls).to.deep.equal([]);
  });
  for (const broken of ['RELEASE SAVEPOINT', 'ROLLBACK TO SAVEPOINT', 'SAVEPOINT osd_adt_preview']) {
    it(`reports PostgreSQL ${broken} failure without throwing`, async () => {
      const client = new OsdPostgresClient({host:'unused'});
      client.client = {query:async sql => {
        const text = sql.text ?? sql;
        if (text.startsWith(broken) || (broken.startsWith('ROLLBACK') && text.startsWith('SELECT'))) throw new Error('fence refused');
        return {rows:[{n:1}]};
      }};
      expect((await previewSQL(client, 'SQL', {statement:'SELECT 1 AS n'})).rawMessage).to.equal('fence refused');
    });
  }
  it('SQLCHECK uses the PostgreSQL prepare session and releases it after refusal', async () => {
    const client = new OsdPostgresClient({host:'unused'});
    let released = false; const calls = [];
    client.pool = {connect:async () => ({query:async sql => {calls.push(sql); if((sql.text ?? sql).startsWith('PREPARE')) throw new Error('bad SELECT');}, release:() => {released=true;}})};
    expect(await previewSQL(client,'SQLCHECK',{statement:'SELECT broken FROM zstg_demo'})).to.have.property('error');
    expect(released).to.equal(true); expect(calls[0].text).to.match(/^PREPARE .* AS SELECT broken/); expect(calls[1]).to.match(/^DEALLOCATE /);
  });
});
