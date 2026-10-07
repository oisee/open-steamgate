import {readFileSync} from 'node:fs';
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
  it('preserves the measured DDIC elements, field order and typed START value parameter', () => {
    const manager = globalThis.abap.Classes.CL_ABAP_DAEMON_CLIENT_MANAGER;
    const info = manager.METHODS.GET_DAEMON_INFO.parameters.R_INFO_TABLE.type().getRowType().get();
    expect(Object.keys(info)).to.deep.equal(['name','instance_id','creator_client','creator_user','used_dest','creation_time','application_server']);
    expect(info.instance_id.constructor.name).to.equal('String');
    expect(info.instance_id.getQualifiedName()).to.equal('ABAP_DAEMON_INSTANCE_ID');
    const xml = readFileSync('src/daemons/abap_daemon_info.tabl.xml', 'utf8');
    for (const [field, element] of Object.entries({NAME: 'ABAP_DAEMON_NAME', INSTANCE_ID: 'ABAP_DAEMON_INSTANCE_ID', USED_DEST: 'ABAP_DAEMON_DESTINATION', CREATION_TIME: 'TIMESTAMP', APPLICATION_SERVER: 'MSNAME2'})) {
      expect(xml).to.include(`<FIELDNAME>${field}</FIELDNAME><ROLLNAME>${element}</ROLLNAME>`);
    }
    const types = readFileSync('src/daemons/if_abap_daemon_types.intf.abap', 'utf8');
    for (const type of ['instance_id','name','priority']) expect(types).to.include(`TYPES ty_abap_daemon_${type} TYPE abap_daemon_${type}.`);
    expect(readFileSync('src/daemons/cl_abap_daemon_client_manager.clas.abap', 'utf8')).to.include('VALUE(i_priority) TYPE if_abap_daemon_types=>ty_abap_daemon_priority DEFAULT co_session_priority_normal');
    const params = manager.METHODS.START.parameters;
    expect(params.I_NAME.type().getLength()).to.equal(60);
    expect(params.I_PRIORITY.type().constructor.name).to.equal('Integer');
    expect(params.E_INSTANCE_ID.type().constructor.name).to.equal('String');
  });
  it('GET_DAEMON_INFO raises when both identifiers are initial', async () => {
    let error;
    try { await dialogStep(() => globalThis.abap.Classes.ZCL_OSD_DAEMON_API.initial_info()); } catch (e) { error = e; }
    expect(error).to.be.instanceOf(globalThis.abap.Classes.CX_ABAP_DAEMON_ERROR);
  });
});
