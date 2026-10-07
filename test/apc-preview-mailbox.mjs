import {execFileSync} from 'node:child_process';
import {expect} from 'chai';

describe('preview APC completion mailbox', function () {
  this.timeout(60000);
  before(() => {
    execFileSync(process.execPath, ['scripts/build-preview.mjs'], {
      env: {...process.env, OSD_PREVIEW_GENERATE_ONLY: '1'}, stdio: 'pipe', timeout: 30000,
    });
  });
  it('fences worker open, messages and close through gated backend after-step work', () => {
    // A separate runtime: importing the preview installs sql.js and its seed
    // globals. Exercise the actual worker listener and backend, not a mock
    // mailbox or a call to dialogStep that bypasses the channel entry points.
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const b = await import('./web/preview-backend.mjs');
      const {onAfterStep, exclusive, workProcess} = await import('./tools/osd-dialog-step.mjs');
      const {zcl_apc_host: Host} = await import('./output/zcl_apc_host.clas.mjs');
      const {channels} = await import('./web/generated/services.mjs');
      const channel = channels.find(c => c.handler === 'ZCL_STG_APC_DEMO');
      assert.ok(channel);
      let release, enter, held;
      function gate() {
        const entered = new Promise(r => { enter = r; });
        held = new Promise(r => { release = r; });
        return entered;
      }
      let openGate = true, messageGate = false;
      const handled = [], finished = [], closed = [];
      const originalOpen = Host.prototype.open;
      Host.prototype.open = async function(...args) {
        const answer = await originalOpen.apply(this, args);
        if (openGate) onAfterStep(async () => { enter(); await held; finished.push('open'); });
        return answer;
      };
      const originalMessage = Host.prototype.message;
      Host.prototype.message = async function(input) {
        const text = input.iv_text.get(); handled.push(text);
        await originalMessage.call(this, input);
        if (messageGate) onAfterStep(async () => { enter(); await held; finished.push(text); });
      };
      const originalClose = Host.prototype.close;
      Host.prototype.close = async function(...args) {
        closed.push('close'); return originalClose.apply(this, args);
      };
      const listeners = {};
      globalThis.self = {location: new URL('http://preview/'),
        addEventListener: (name, fn) => { listeners[name] = fn; }};
      await import('./web/preview-worker.mjs');
      const sent = [];
      const port = {postMessage: value => sent.push(value)};
      const openEntered = gate();
      listeners.message({data: {apc: 'open', id: 'gated', path: channel.path}, ports: [port]});
      port.onmessage({data: {apc: 'message', text: 'A'}});
      await openEntered;
      await exclusive(async () => {}); // competing FIFO work can proceed
      await new Promise(r => setTimeout(r, 20));
      assert.deepEqual(handled, []); assert.deepEqual(sent, []);
      release(); openGate = false;
      const until = async predicate => {
        for (let i = 0; !predicate() && i < 1000; i++) await new Promise(r => setTimeout(r, 2));
        assert.ok(predicate(), JSON.stringify({sent, handled, finished, closed}));
      };
      await until(() => sent.length === 3);
      assert.equal(sent[0].apc, 'open');
      assert.equal(JSON.parse(sent[1].text).type, 'hello');
      assert.deepEqual(handled, ['A']);
      messageGate = true;
      const messageEntered = gate();
      port.onmessage({data: {apc: 'message', text: 'B'}});
      await messageEntered;
      port.onmessage({data: {apc: 'message', text: 'C'}});
      await exclusive(async () => {});
      await new Promise(r => setTimeout(r, 20));
      assert.deepEqual(handled, ['A', 'B']);
      messageGate = false; release();
      await until(() => handled.length === 3 && sent.length === 5);
      assert.deepEqual(finished, ['open', 'B']);
      messageGate = true;
      const closingEntered = gate();
      port.onmessage({data: {apc: 'message', text: 'D'}});
      await closingEntered;
      port.onmessage({data: {apc: 'message', text: 'discard'}});
      port.onmessage({data: {apc: 'close'}});
      await new Promise(r => setTimeout(r, 20));
      assert.deepEqual(closed, []);
      release();
      await until(() => closed.length === 1);
      assert.deepEqual(handled, ['A', 'B', 'C', 'D']);
      assert.deepEqual(finished, ['open', 'B', 'D']);
      assert.equal(workProcess().held, false);
      console.log('preview-mailbox-ok'); process.exit(0);
    `], {encoding: 'utf8', timeout: 50000});
    expect(result).to.include('preview-mailbox-ok');
  });
});
