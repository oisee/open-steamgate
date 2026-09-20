import assert from "node:assert/strict";
import {get} from "node:https";
import {createConnection} from "node:net";
const base = 'http://127.0.0.1:3030';
const service = `${base}/sap/opu/odata/sap/ZSTG_DEMO_SRV`;
const request = (url, options = {}) => fetch(url, {...options, signal: AbortSignal.timeout(10000)});
await import('./healthcheck.mjs');
const response = await request(`${base}/sap/opu/odata/sap/ZOSD_STATUS_SRV/DatabaseSet?$format=json`);
assert.equal(response.status, 200);
const facts = (await response.json()).d.results;
const engine = process.env.STG_DB === 'hana' ? 'HDB' : process.env.STG_DB === 'duckdb' ? 'duckdb' : process.env.STG_DB === 'postgres' ? 'postgres' : 'sqlite';
assert.ok(facts.some(row => row.Name === 'Engine' && row.Value === engine && row.Note === 'connected backend'));
assert.ok(facts.some(row => row.Name === 'Storage' && row.Value === (['HDB', 'postgres'].includes(engine) ? 'server' : 'file')));
const mode = process.argv[2] ?? 'create';
if (mode === 'create') {
  const res = await request(`${service}/TravelSet`, {method: 'POST',
    headers: {'content-type': 'application/json', 'x-csrf-token': 'open-steamgate'},
    body: JSON.stringify({TravelId: 'TIMG0001', Description: 'Image persistence probe', Status: 'A', Seats: 1})});
  assert.equal(res.status, 201, await res.text());
} else {
  const res = await request(`${service}/TravelSet('TIMG0001')?$format=json`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).d.Description, 'Image persistence probe');
}
await new Promise((resolve, reject) => {
  const req = get('https://127.0.0.1:44300/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata', {rejectUnauthorized: false}, res => {
    res.resume();
    res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(`HTTPS ${res.statusCode}`)));
  });
  req.setTimeout(10000, () => req.destroy(new Error('HTTPS timeout')));
  req.on('error', reject);
});
if (process.env.PROTOCOL_HOST) {
  const instance = process.env.INSTANCE ?? '06';
  assert.match(instance, /^\d{2}$/);
  for (const port of [Number(`32${instance}`), Number(`33${instance}`)]) await new Promise((resolve, reject) => {
    const socket = createConnection({host: process.env.PROTOCOL_HOST, port});
    socket.setTimeout(5000, () => socket.destroy(new Error('protocol timeout')));
    socket.on('error', reject);
    socket.on('connect', () => { socket.end(); resolve(); });
  });
}
console.log(`PASS ${engine}: ${mode}, connected identity, OData, HTTPS, protocol listeners when configured`);
