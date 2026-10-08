import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {responseElements} from '../xml.mjs';

// Same-user cross-session handles work on A4H; local hosts intentionally bind
// handles to sessions, so that policy is outside these shared cases.
const collection = '/oo/classes';
const create = (ctx, name) => ctx.session.request({method: 'POST', path: collection,
  headers: {'content-type': 'application/vnd.sap.adt.oo.classes.v4+xml'},
  body: `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="CLAS/OO"><adtcore:packageRef adtcore:name="${ctx.writePackage}"/></class:abapClass>`});
const lock = ctx => ({method: 'POST', path: ctx.path, query: {_action: 'LOCK', accessMode: 'MODIFY'},
  headers: {accept: 'application/vnd.sap.as+xml;dataname=com.sap.adt.lock.Result'}});
const handleOf = res => /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(res.body)?.[1];
const source = name => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\n\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\nENDCLASS.\n`;
const put = (ctx, text, handle = ctx.handle) => ({method: 'PUT', path: `${ctx.path}/source/main`,
  query: {lockHandle: handle}, headers: {'content-type': 'text/plain'}, body: text});
const check = ctx => ({method: 'POST', path: '/checkruns', query: {reporters: 'abapCheckRun'},
  headers: {'content-type': 'application/vnd.sap.adt.checkobjects+xml'}, body: `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core"><chkrun:checkObject adtcore:uri="/sap/bc/adt${ctx.path}" chkrun:version="inactive"/></chkrun:checkObjectList>`});
async function made(ctx, point) {
  ctx.name = `ZCL_ADT_${point}_${randomBytes(8).toString('hex').toUpperCase()}`;
  assert.match(ctx.writePackage ?? '', /^[A-Z0-9_$/]+$/, 'configure --write-package for write cases');
  ctx.attemptedPath = `${collection}/${ctx.name.toLowerCase()}`;
  const before = await ctx.session.request({path: ctx.attemptedPath});
  assert.equal(before.status, 404, 'setup GET confirms absence before CREATE');
  ctx.absentBeforeAttempt = true;
  ctx.createAttempted = true;
  const response = await create(ctx, ctx.name);
  if (response.status === 400 && /ExceptionResourceAlreadyExists/.test(response.body)) {
    ctx.duplicateRefused = true;
  }
  if (response.status === 200 || response.status === 201) ctx.path = ctx.attemptedPath;
  assert.equal(response.status, 200, 'setup CREATE');
  assert.equal(response.body, '', 'CREATE empty body');
}
function retainLock(ctx, response, label) {
  if (response?.status === 200) ctx.handle = handleOf(response);
  assert.equal(response?.status, 200, label);
  assert.match(ctx.handle ?? '', /^[0-9a-f]{40}$/, `${label} handle`);
}
async function held(ctx, point) {
  await made(ctx, point);
  retainLock(ctx, await ctx.session.request(lock(ctx)), 'setup LOCK');
}
async function remove(ctx) {
  if (!ctx.createAttempted || !ctx.absentBeforeAttempt || ctx.duplicateRefused) return;
  try {
  const present = await ctx.session.request({path: ctx.attemptedPath});
  if (present.status === 404) {ctx.path = undefined; ctx.handle = undefined; return;}
  assert.equal(present.status, 200, 'cleanup GET reconciles attempted CREATE');
  ctx.path = ctx.attemptedPath;
  if (!ctx.handle) retainLock(ctx, await ctx.session.request(lock(ctx)), 'cleanup LOCK');
  const deleted = await ctx.session.request({method: 'DELETE', path: ctx.path, query: {lockHandle: ctx.handle}});
  assert.equal(deleted.status, 200, `cleanup DELETE HTTP ${deleted.status}: ${(deleted.body ?? '').replace(/\s+/g, ' ')}`);
  assert.equal((await ctx.session.request({path: ctx.path})).status, 404, 'cleanup GET after DELETE');
  ctx.path = undefined; ctx.handle = undefined;
  } catch (error) {error.cleanupFailure = true; throw error;}
}
const refused = {status: 423, body: /ExceptionResourceInvalidLockHandle/};
function report(ctx, response, errors) {
  assert.equal(response.status, 200, 'CHECK status');
  const ns = 'http://www.sap.com/adt/checkrun', elements = responseElements(response.body);
  const attr = (e, name) => e.attributes.find(a => a.uri === ns && a.local === name)?.value;
  const reports = elements.filter(e => e.uri === ns && e.local === 'checkReport' && attr(e, 'triggeringUri') === `/sap/bc/adt${ctx.path}`);
  assert.equal(reports.length, 1, 'CHECK report for object');
  assert.equal(attr(reports[0], 'status'), 'processed', 'CHECK processed');
  const reportId = elements.indexOf(reports[0]) + 1;
  const belongs = e => e.parent === reportId || (e.parent && belongs(elements[e.parent - 1]));
  const messages = elements.filter(e => e.uri === ns && e.local === 'checkMessage' && belongs(e) && attr(e, 'type') === 'E');
  if (!errors) assert.equal(messages.length, 0, 'clean source has zero E messages');
  else assert.ok(messages.some(e => attr(e, 'uri')?.startsWith(`/sap/bc/adt${ctx.path}/source/main#start=`)
    && /#start=\d+,\d+$/.test(attr(e, 'uri'))), 'error message has source location');
}

export default [
  {id: 'W1-write-inactive', point: 'W1', title: 'PUT under lock changes inactive source and preserves active source', setup: async ctx => {
    await held(ctx, 'W1');
    const active = await ctx.session.request({path: `${ctx.path}/source/main`, query: {version: 'active'}});
    assert.equal(active.status, 200, 'GET active before PUT'); ctx.active = active.body;
  }, request: ctx => put(ctx, source(ctx.name) + '* inactive\n'), expect: {status: 200, bodyBytes: ''},
  after: async ctx => {try {
    if (!ctx.path || ctx.active === undefined) return;
    const inactive = await ctx.session.request({path: `${ctx.path}/source/main`, query: {version: 'inactive'}});
    const active = await ctx.session.request({path: `${ctx.path}/source/main`, query: {version: 'active'}});
    assert.equal(inactive.status, 200, 'GET inactive'); assert.equal(inactive.body, source(ctx.name) + '* inactive\n');
    assert.equal(active.status, 200, 'GET active after PUT'); assert.equal(active.body, ctx.active, 'active source unchanged');
  } finally {await remove(ctx);}}},
  {id: 'W2-write-unlocked', point: 'W2', title: 'PUT without a lock handle is refused', setup: ctx => held(ctx, 'W2'),
    request: ctx => ({...put(ctx, source(ctx.name)), query: {}}), expect: refused, after: remove},
  {id: 'W3-write-foreign', point: 'W3', title: 'PUT with a bogus well-formed handle is refused (423)', setup: ctx => held(ctx, 'W3'),
    request: ctx => put(ctx, source(ctx.name), '0'.repeat(40)), expect: refused, after: remove},
  {id: 'W4-create-delete', point: 'W4', title: 'CREATE rejects duplicates and DELETE requires its lock handle', setup: ctx => made(ctx, 'W4'),
    request: ctx => lock(ctx), expect: {status: 200, xml: [{xpath: '/asx:abap/asx:values/DATA/LOCK_HANDLE', regexp: /^[0-9a-f]{40}$/}]},
    after: async (ctx, response) => {try {
      if (!ctx.path) return;
      if (response) retainLock(ctx, response, 'LOCK');
      const duplicate = await create(ctx, ctx.name);
      assert.equal(duplicate.status, 400, 'duplicate CREATE'); assert.match(duplicate.body, /ExceptionResourceAlreadyExists/);
      const denied = await ctx.session.request({method: 'DELETE', path: ctx.path});
      assert.equal(denied.status, 423, 'DELETE without handle'); assert.match(denied.body, /ExceptionResourceInvalidLockHandle/);
    } finally {await remove(ctx);}}},
  {id: 'W5-check-inactive', point: 'W5', title: 'CHECK reports an inactive syntax error and accepts a clean source', setup: async ctx => {
    await held(ctx, 'W5');
    const bad = source(ctx.name).replace('  PUBLIC SECTION.\n', '  PUBLIC SECTION.\n    METHODS broken.\n').replace('IMPLEMENTATION.\nENDCLASS.', 'IMPLEMENTATION.\n  METHOD broken.\n    lv_not_declared = 1.\n  ENDMETHOD.\nENDCLASS.');
    assert.equal((await ctx.session.request(put(ctx, bad))).status, 200, 'setup PUT invalid source');
  }, request: ctx => check(ctx), expect: {status: 200},
  after: async (ctx, response) => {try {
    if (!ctx.path || !response) return;
    report(ctx, response, true);
    assert.equal((await ctx.session.request(put(ctx, source(ctx.name)))).status, 200, 'PUT clean source');
    report(ctx, await ctx.session.request(check(ctx)), false);
  } finally {await remove(ctx);}}},
];
