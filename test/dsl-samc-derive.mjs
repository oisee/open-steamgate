import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {deriveSamc} from "../tools/dsl-samc-derive.mjs";
import {checkDerived, firstDifference, renderDaemonModel} from "../tools/dsl-samc.mjs";

const probe = "test/fixtures/samc-derive";
const capture = "docs/probes/abap-daemons/zosd_t_amc.serialized.samc.xml";
const decl = JSON.parse(readFileSync(join(probe, "zosd_t_amc.samc.decl.json"), "utf8"));
const scratch = [];
function fixture(source, name = "zcl_t_amc.clas.abap") {
  const dir = mkdtempSync(join(tmpdir(), "dsl-samc-derive-"));
  scratch.push(dir);
  const file = join(dir, name);
  writeFileSync(file, source);
  return {dir, file};
}
const cls = (body, type = "text") => `CLASS zcl_t_amc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
  INTERFACES if_amc_message_receiver_${type}.
  CONSTANTS co_app TYPE string VALUE 'TEST_APP'.
  CONSTANTS co_ch TYPE string VALUE '/constant'.
  METHODS send.
ENDCLASS.
CLASS zcl_t_amc IMPLEMENTATION.
 METHOD send.
  DATA lo_p TYPE REF TO if_amc_message_producer_${type}.
${body}
 ENDMETHOD.
ENDCLASS.
`;
const baseDecl = {channels: {"/literal": {scope: "C"}, "/constant": {scope: "S"}}};

describe("DSL SAMC derive", function () {
  this.timeout(120000);
  after(() => scratch.forEach((dir) => rmSync(dir, {recursive: true, force: true})));

  it("derives literal and class constant channels with TEXT from a producer's declared type", () => {
    const {dir} = fixture(cls(`  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = zcl_t_amc=>co_app i_channel_id = zcl_t_amc=>co_ch ).`));
    const model = deriveSamc([dir], "TEST_APP", baseDecl);
    expect(model.channels.map((row) => [row.channelId, row.messageType])).to.deep.equal([["/constant", "TEXT"], ["/literal", "TEXT"]]);
    expect(model.authorities.map((row) => row.activity)).to.deep.equal(["S", "S"]);
    expect(model.channels[1].source[0].line).to.equal(11);
  });

  it("refuses an unresolved channel at file:line and accepts an exact callSites declaration", () => {
    const {dir, file} = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = iv_ch )."));
    expect(() => deriveSamc([dir], "TEST_APP", baseDecl)).to.throw(`${file}:11: channelIds cannot be resolved`);
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}},
      callSites: {[`${file}:11`]: {channelIds: ["/literal"]}}});
    expect(model.channels[0].source).to.deep.equal([{file, line: 11}]);
  });

  it("refuses overlay values that contradict a literal call or its static message type", () => {
    const {dir, file} = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' )."));
    expect(() => deriveSamc([dir], "TEST_APP", {...baseDecl,
      callSites: {[`${file}:11`]: {channelIds: ["/constant"]}}})).to.throw(/conflicts with ABAP/);
    expect(() => deriveSamc([dir], "TEST_APP", {...baseDecl,
      callSites: {[`${file}:11`]: {messageType: "PCP"}}})).to.throw(/messageType conflicts with ABAP/);
  });

  it("gives a delivered consumer R and checks its receiver interface type", () => {
    const {dir} = fixture(cls(`  DATA(lo_c) = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_c->start_message_delivery( me ).`));
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}}});
    expect(model.authorities.map((row) => row.activity)).to.deep.equal(["R"]);
    expect(model.channels[0].messageType).to.equal("TEXT");
  });

  it("refuses conflicting producer and receiver message types on one channel", () => {
    const {dir} = fixture(cls(`  DATA lo_c TYPE REF TO if_amc_message_consumer.
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_c = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_c->start_message_delivery( me ).`, "binary").replace("INTERFACES if_amc_message_receiver_binary.", "INTERFACES if_amc_message_receiver_text."));
    expect(() => deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}}})).to.throw(/message type TEXT conflicts with BINARY/);
  });

  it("is independent of input file order and traces a rendered channel to ABAP", async () => {
    const a = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' )."));
    const b = fixture(`REPORT zt_amc.\nDATA lo_p TYPE REF TO if_amc_message_producer_text.\nlo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).\n`, "zt_amc.prog.abap");
    const overlay = {channels: {"/literal": {scope: "C"}}};
    const first = deriveSamc([a.file, b.file], "TEST_APP", overlay);
    const second = deriveSamc([b.file, a.file], "TEST_APP", overlay);
    expect(first).to.deep.equal(second);
    const rendered = await renderDaemonModel(first);
    const at = rendered.text.split("\n").findIndex((line) => line.includes("<CHANNEL_ID>/literal</CHANNEL_ID>"));
    const node = rendered.trace[at].node;
    expect(node).to.equal(first.channels[0]["@id"]);
    expect(first.channels[0].source.map((source) => source.file)).to.include(a.file);
  });

  it("attributes a function module call to its function group PROGRAM_ID", () => {
    const {dir} = fixture("FUNCTION-POOL zt_amc.\n", "zt_amc.fugr.saplzt_amc.abap");
    writeFileSync(join(dir, "zt_amc.fugr.z_t_amc.abap"), `FUNCTION z_t_amc.
 DATA lo_p TYPE REF TO if_amc_message_producer_text.
 lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
ENDFUNCTION.
`);
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}}});
    expect(model.authorities[0]).to.include({kind: "function_group", program: "ZT_AMC", program_id: "SAPLZT_AMC"});
  });

  it("includes local test class calls under their global class and exposes capture authority drift", async () => {
    const model = deriveSamc([probe], "ZOSD_T_AMC", decl);
    const driver = model.authorities.filter((row) => row.program === "ZCL_OSD_T_DDRV");
    expect(driver.some((row) => row.activity === "S" && row.channelId === "/pc"
      && row.source.some((source) => source.file.endsWith(".clas.testclasses.abap")))).to.equal(true);
    const rendered = await renderDaemonModel(model);
    expect(firstDifference(rendered.text, readFileSync(capture, "utf8"))).to.be.greaterThan(0);
    expect(model.authorities).to.have.length(10);
    expect(model.authorities.filter((row) => row.source.length === 0).map((row) => `${row.program}:${row.channelId}:${row.activity}`))
      .to.deep.equal(["ZOSD_T_DSUB:/pc:S", "ZCL_OSD_T_DDRV:/pu:R"]);
  });

  it("check reports the drifting XML node and ABAP source", async () => {
    const result = await checkDerived([probe], "ZOSD_T_AMC", decl, capture);
    expect(result.line).to.be.greaterThan(0);
    expect(result.node).to.match(/^samc\/ZOSD_T_AMC\/auth\/\d+$/);
    expect(result.source[0].file).to.include("test/fixtures/samc-derive/");
  });
});
