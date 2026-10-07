import {expect} from 'chai';
import {daemonHost} from '../tools/osd-daemon-host.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';
describe('A4H daemon API call shapes', function () {
  this.timeout(30000);
  before(async () => { await import('./start.mjs'); await import('../output/zcl_osd_daemon_api.clas.mjs'); });
  after(async () => { await daemonHost(globalThis.abap).close(); });
  it('START exports into LIKE LINE OF info, low priority and ACCEPT constants compile and run', async () => {
    const host = daemonHost(globalThis.abap);
    const id = await dialogStep(() => globalThis.abap.Classes.ZCL_OSD_DAEMON_API.start_low());
    expect(id.get()).not.to.equal('');
    const row = host.instances.get(id.get());
    expect(row.priority).to.equal(2);
    expect(row.destination).to.equal('NONE');
    expect(row.daemonId).to.equal('ZOSD_API');
    await host.idle();
    expect(host.instances.has(id.get())).to.equal(false);
  });
  it('GET_DAEMON_INFO raises when both identifiers are initial', async () => {
    let error;
    try { await dialogStep(() => globalThis.abap.Classes.ZCL_OSD_DAEMON_API.initial_info()); } catch (e) { error = e; }
    expect(error).to.be.instanceOf(globalThis.abap.Classes.CX_ABAP_DAEMON_ERROR);
  });
});
