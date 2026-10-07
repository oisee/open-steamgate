import assert from 'node:assert/strict';
const path = '/oo/classes/zcl_osd_adt_uri';
const lock = {method: 'POST', path, query: {_action: 'LOCK', accessMode: 'MODIFY'},
  headers: {accept: 'application/vnd.sap.as+xml;dataname=com.sap.adt.lock.Result'}};
const unlock = handle => ({method: 'POST', path, query: {_action: 'UNLOCK', lockHandle: handle}});
const handleOf = res => /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(res.body)?.[1];
async function held(ctx) {
  const response = await ctx.session.request(lock);
  ctx.handle = handleOf(response); // retain it for cleanup even if an assertion fails
  assert.equal(response.status, 200, 'setup LOCK');
  assert.match(ctx.handle ?? '', /^[0-9a-f]{40}$/);
}
async function release(ctx) {
  if (ctx.handle) {
    const response = await ctx.session.request(unlock(ctx.handle));
    assert.equal(response.status, 200, 'cleanup UNLOCK');
  }
}
const conflict = {status: 403, body: /ExceptionResourceNoAccess/};
export default [
  {id: 'L1-lock', point: 'L1', title: 'LOCK returns a 40 character handle and local flag', request: lock,
    expect: {status: 200, contentType: /application\/vnd\.sap\.as\+xml/,
      xml: [{xpath: '/asx:abap/asx:values/DATA/LOCK_HANDLE', regexp: /^[0-9a-f]{40}$/},
        {xpath: '/asx:abap/asx:values/DATA/IS_LOCAL', value: 'X'}]},
    after: async (ctx, res) => {ctx.handle = handleOf(res ?? {body: ''}); await release(ctx);}},
  {id: 'L2-repeat-lock', point: 'L2', title: 'The owner cannot acquire a second lock', setup: held, request: lock,
    expect: conflict, after: release},
  {id: 'L3-foreign-lock', point: 'L3', title: 'A second session cannot acquire an owned object',
    setup: async ctx => {await held(ctx); ctx.other = await ctx.newSession();},
    request: {...lock, session: 'other'}, expect: conflict, after: release},
  {id: 'L4-unlock', point: 'L4', title: 'UNLOCK releases ownership for another session', setup: held,
    request: ctx => unlock(ctx.handle), expect: {status: 200, bodyBytes: ''},
    after: async ctx => {ctx.handle = undefined; ctx.other = await ctx.newSession();
      const response = await ctx.other.request(lock); const handle = handleOf(response);
      try {assert.equal(response.status, 200, 'reacquire after UNLOCK'); assert.match(handle ?? '', /^[0-9a-f]{40}$/);}
      finally {if (handle) assert.equal((await ctx.other.request(unlock(handle))).status, 200);}}},
  {id: 'L5-stateless-read', point: 'L5', title: 'A stateless read preserves the stateful lock', setup: held,
    request: {path: path + '/source/main', headers: {'x-sap-adt-sessiontype': 'stateless'}},
    expect: {status: 200, body: /CLASS zcl_osd_adt_uri/i},
    after: async ctx => {try {ctx.other = await ctx.newSession();
      const response = await ctx.other.request(lock); assert.equal(response.status, 403, 'lock survives stateless read');}
      finally {await release(ctx);}}},
];
