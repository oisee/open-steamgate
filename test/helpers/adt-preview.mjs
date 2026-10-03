import {previewSQL} from '../../tools/adt-preview-sql.mjs';
import {currentSystemAnswers, withSystem} from '../../tools/osd-store-destination.mjs';
import {expect} from 'chai';
import express from 'express';
import '../start.mjs';
import {ObjectStore} from '../../tools/osd-store.mjs';
import {adtRouter} from '../../tools/adt-facade.mjs';
import {Data} from '../../tools/osd-data.mjs';
import {abapRunner} from '../../tools/adt-abap-front.mjs';
import {dialogStep, lockedClient} from '../../tools/osd-dialog-step.mjs';

export async function previewPair({store} = {}) {
  const previousProfile = process.env.OSD_ADT_ONE_RUNTIME;
  process.env.OSD_ADT_ONE_RUNTIME = "1";
  // Enable the same binding key as StoreIPCClient. The test answers SQL
  // on its one raw connection, while source commands keep the shared store.
  const destination = abap.context.RFCDestinations.STORE;
  const previousLocal = destination.localSystem;
  destination.localSystem = {};
  const shared = store ?? new ObjectStore({root: process.cwd()});
  const {zcl_osd_adt_handler: handler} = await import('../../output/zcl_osd_adt_handler.clas.mjs');
  const served = [], servers = [], headers = [];
  const step = work => {
    const previous = currentSystemAnswers();
    const answers = (kind, name, json) => ["SQL", "SQLCHECK"].includes(kind)
      ? previewSQL(abap.context.databaseConnections.DEFAULT, kind, JSON.parse(json))
      : previous?.(kind, name, json);
    return withSystem(answers, () => dialogStep(work), {oneRuntime:true});
  };
  for (const ported of [false, true]) {
    const app = express(); app.set('etag', false);
    app.use(adtRouter({store: shared, data: new Data({client: lockedClient(abap.context.databaseConnections.DEFAULT, "the ADT facade's data preview")}),
      watch: false, logMisses: false, ...(ported ? {abap: abapRunner({handler, step}), abapServed: by => served.push(by)} : {})}).router);
    const server = await new Promise(resolve => {const s = app.listen(0, '127.0.0.1', () => resolve(s));});
    servers.push(server);
    const warm = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/unknown`, {headers: {'x-csrf-token': 'fetch'}});
    await warm.text();
    headers.push({'x-csrf-token': warm.headers.get('x-csrf-token'), cookie: warm.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')});
  }
  async function request(i, method, path, body) {
    const res = await fetch(`http://127.0.0.1:${servers[i].address().port}${path}`, {method, headers: headers[i], ...(method === 'POST' ? {body} : {})});
    const raw = await res.text();
    expect(res.headers.get('etag')).to.equal(null);
    if(method !== 'HEAD') expect(Number(res.headers.get('content-length'))).to.equal(Buffer.byteLength(raw));
    const text = method === 'POST' ? raw.replace(/(<dataPreview:queryExecutionTime>)\d+(<)/g, '$1TIME$2') : raw;
    return {status: res.status, type: res.headers.get('content-type'), body: text,
      length: method === 'HEAD' ? res.headers.get('content-length') : Buffer.byteLength(text)};
  }
  return {shared, served, request, async diff(method, path, body = '') {
    const expected = await request(0, method, path, body); served.length = 0;
    const actual = await request(1, method, path, body);
    expect(served).to.deep.equal(['ABAP']); expect(actual, `${method} ${path}: ${body}`).to.deep.equal(expected); return actual;
  }, async close() {
    destination.localSystem = previousLocal;
    for(const s of servers) await new Promise(r => s.close(r));
    if (previousProfile === undefined) delete process.env.OSD_ADT_ONE_RUNTIME;
    else process.env.OSD_ADT_ONE_RUNTIME = previousProfile;
  }};
}
