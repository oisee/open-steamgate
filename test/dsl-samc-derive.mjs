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

  it("keeps method-local constants separate (critic c1)", () => {
    const model = deriveSamc(["test/fixtures/samc-derive-repro/c1"], "APP",
      {channels: {"/a": {scope: "C"}, "/b": {scope: "C"}}});
    expect(model.authorities.map((row) => [row.channelId, row.activity, row.source[0].line]))
      .to.deep.equal([["/a", "S", 10], ["/b", "S", 15]]);
  });

  it("resolves qualified global constants despite a local class shadow (critic c5)", () => {
    const model = deriveSamc(["test/fixtures/samc-derive-repro/c5"], "APP", {channels: {"/global": {scope: "C"}}});
    expect(model.authorities.map((row) => [row.channelId, row.activity, row.source[0].line]))
      .to.deep.equal([["/global", "S", 9]]);
  });

  it("returns to report constants after a local class (critic c7)", () => {
    const model = deriveSamc(["test/fixtures/samc-derive-repro/c7"], "APP", {channels: {"/y": {scope: "C"}}});
    expect(model.authorities.map((row) => [row.channelId, row.activity, row.program_id]))
      .to.deep.equal([["/y", "S", "ZT_AMC7"]]);
    const source = readFileSync("test/fixtures/samc-derive-repro/c7/zt_amc7.prog.abap", "utf8");
    const {dir} = fixture(source.replace("i_channel_id = co_ch", "i_channel_id = iv_ch"), "zt_amc7.prog.abap");
    const viaSite = deriveSamc([dir], "APP", {channels: {"/y": {scope: "C"}},
      callSites: {"zt_amc7.": {channelIds: ["/y"]}}});
    expect(viaSite.authorities[0]).to.include({channelId: "/y", program_id: "ZT_AMC7"});
  });

  it("uses a callSites type for a generic producer (critic c2)", () => {
    const {dir, file} = fixture(cls("  DATA lo_generic TYPE REF TO if_amc_message_producer.\n  lo_generic = cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' )."));
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}},
      callSites: {[`${file}:12`]: {messageType: "TEXT"}}});
    expect(model.authorities[0]).to.include({activity: "S", channelId: "/literal"});
  });

  it("resolves named i_receiver = me from its class interface (critic c3)", () => {
    const {dir} = fixture(cls(`  DATA(lo_c) = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_c->start_message_delivery( i_receiver = me ).`));
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}}});
    expect(model.authorities[0]).to.include({activity: "R", channelId: "/literal"});
  });

  it("refuses an unresolved consumer until the overlay explicitly grants R (critic c4)", () => {
    const dir = "test/fixtures/samc-derive-repro/c4";
    const channels = {"/a": {scope: "C"}};
    const key = "zcl_t_amc.clas.abap:10";
    expect(() => deriveSamc([dir], "APP", {channels, callSites: {[key]: {messageType: "TEXT"}}}))
      .to.throw(/zcl_t_amc.clas.abap:10: consumer delivery cannot be resolved.*deliveryProgram.*authority: "R"/);
    const model = deriveSamc([dir], "APP", {channels,
      callSites: {[key]: {messageType: "TEXT", deliveryProgram: "ZCL_T_AMC", authority: "R"}}});
    expect(model.authorities.map((row) => [row.channelId, row.activity, row.program]))
      .to.deep.equal([["/a", "R", "ZCL_T_AMC"]]);
  });

  it("uses the delivery program's overlay kind for its authority", () => {
    const dir = "test/fixtures/samc-derive-repro/c4";
    const key = "zcl_t_amc.clas.abap:10";
    for (const [kind, program, programId] of [["report", "ZT_DELIVERY", "ZT_DELIVERY"],
      ["function_group", "ZT_DELIVERY", "SAPLZT_DELIVERY"]]) {
      const model = deriveSamc([dir], "APP", {channels: {"/a": {scope: "C"}},
        callSites: {[key]: {messageType: "TEXT", deliveryProgram: program, kind, authority: "R"}}});
      expect(model.authorities[0]).to.include({kind, program, program_id: programId});
    }
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
    const authorityLine = rendered.text.split("\n").findIndex((line) => line.includes("<ACTIVITY>S</ACTIVITY>"));
    expect(rendered.trace[authorityLine].node).to.equal(first.authorities[0]["@id"]);
    expect(rendered.text.split("\n")[authorityLine]).to.equal("      <ACTIVITY>S</ACTIVITY>");
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

  it("keeps positive test calls and exposes capture authority drift", async () => {
    const model = deriveSamc([probe], "ZOSD_T_AMC", decl);
    const driver = model.authorities.filter((row) => row.program === "ZCL_OSD_T_DDRV");
    expect(driver.some((row) => row.activity === "S" && row.channelId === "/pc"
      && row.source.some((source) => source.file.endsWith(".clas.p8b.testclasses.abap")))).to.equal(true);
    expect(driver.some((row) => row.activity === "S" && row.channelId === "/pu"
      && row.source.some((source) => source.file.endsWith(".clas.p8a.testclasses.abap")))).to.equal(true);
    const rendered = await renderDaemonModel(model);
    expect(firstDifference(rendered.text, readFileSync(capture, "utf8"))).to.be.greaterThan(0);
    expect(model.authorities).to.have.length(12);
    expect(model.authorities.some((row) => row.program === "ZCL_OSD_T_DMN" && row.channelId === "/pu" && row.activity === "S"
      && row.source.some((source) => source.line === 300))).to.equal(true);
    expect(model.authorities.filter((row) => row.source.length === 0).map((row) => `${row.program}:${row.channelId}:${row.activity}`))
      .to.deep.equal(["ZOSD_T_DSUB:/pc:S", "ZCL_OSD_T_DDRV:/pu:R"]);
  });

  it("check reports the drifting XML node and ABAP source", async () => {
    const result = await checkDerived([probe], "ZOSD_T_AMC", decl, capture);
    expect(result.line).to.be.greaterThan(0);
    expect(result.node).to.match(/^samc\/ZOSD_T_AMC\/auth\/\d+$/);
    expect(result.source[0].file).to.include("test/fixtures/samc-derive/");
  });

  it("requires a reason and a real call site for authority none", () => {
    const {dir, file} = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' )."));
    const key = `${file}:11`;
    expect(() => deriveSamc([dir], "TEST_APP", {...baseDecl, callSites: {[key]: {authority: "none"}}}))
      .to.throw(/authority none requires a reason/);
    expect(() => deriveSamc([dir], "TEST_APP", {...baseDecl, callSites: {[`${file}:12`]: {authority: "none", reason: "negative probe"}}}))
      .to.throw(/does not match an AMC call/);
    const model = deriveSamc([dir], "TEST_APP", {channels: {"/literal": {scope: "C"}}, callSites: {[key]: {authority: "none", reason: "expects cx_amc_error"}}});
    expect(model.authorities).to.have.length(0);
  });

  it("refuses authority none on a call for another application (critic c6)", () => {
    const {dir, file} = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'OTHER' i_channel_id = '/literal' )."));
    expect(() => deriveSamc([dir], "TEST_APP", {channels: {},
      callSites: {[`${file}:11`]: {authority: "none", reason: "negative test"}}}))
      .to.throw(/authority none application ID does not match TEST_APP/);
  });

  it("requires reasons on extra authorities and reports unexplained target grants", async () => {
    const {dir} = fixture(cls("  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' )."));
    const channels = {"/literal": {scope: "C"}};
    const extra = {channelId: "/literal", kind: "report", program: "ZT_EXTRA", activity: "S"};
    expect(() => deriveSamc([dir], "TEST_APP", {channels, extraAuthorities: [extra]})).to.throw(/reason is required/);
    const model = deriveSamc([dir], "TEST_APP", {channels, extraAuthorities: [{...extra, reason: "manual grant"}]});
    const xml = fixture((await renderDaemonModel(model)).text, "target.samc.xml");
    const checked = await checkDerived([dir], "TEST_APP", {channels}, xml.file);
    expect(checked.grantWithoutUse).to.deep.equal([{nr: 2, key: `/literal|ZT_EXTRA|S`, node: "samc/TEST_APP/auth/2"}]);
  });

  it("derives dell's ZSTG_AMC_TEST XML byte for byte", async () => {
    const overlay = JSON.parse(readFileSync("src/amc/zstg_amc_test.samc.decl.json", "utf8"));
    const paths = ["test/unit/zcl_osd_amc_test.clas.abap", "test/unit/zcl_osd_amc_test.clas.testclasses.abap",
      "test/unit/zcl_osd_amc_socket.clas.abap"];
    const checked = await checkDerived(paths, "ZOSD_AMC_TEST", overlay, "src/amc/zstg_amc_test.samc.xml");
    expect(checked).to.deep.equal({line: 0, grantWithoutUse: []});
    const changed = structuredClone(overlay);
    changed.channels["/text"].scope = "S";
    const drift = await checkDerived(paths, "ZOSD_AMC_TEST", changed, "src/amc/zstg_amc_test.samc.xml");
    expect(drift.line).to.be.greaterThan(0);
    expect(drift.node).to.equal("samc/ZOSD_AMC_TEST/ch/text");
    const unreasoned = structuredClone(overlay);
    delete unreasoned.extraAuthorities[0].reason;
    expect(() => deriveSamc(paths, "ZOSD_AMC_TEST", unreasoned)).to.throw(/reason is required/);
  });

  it("keeps historical NRs, appends new authorities, and reports removed ones", async () => {
    const a = fixture(cls(`  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/literal' ).
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/constant' ).`));
    const initial = deriveSamc([a.file], "TEST_APP", baseDecl);
    const rendered = await renderDaemonModel(initial);
    const historical = fixture(rendered.text.replace("<NR>1</NR>", "<NR>X</NR>").replace("<NR>2</NR>", "<NR>1</NR>").replace("<NR>X</NR>", "<NR>2</NR>"), "history.samc.xml");
    const reordered = deriveSamc([a.file], "TEST_APP", baseDecl, historical.file);
    expect(reordered.authorities.map((row) => [row.channelId, row.nr])).to.deep.equal([["/literal", 1], ["/constant", 2]]);
    const b = fixture("REPORT zt_amc.\nDATA lo_p TYPE REF TO if_amc_message_producer_text.\nlo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'TEST_APP' i_channel_id = '/new' ).\n", "zt_amc.prog.abap");
    const expanded = deriveSamc([a.file, b.file], "TEST_APP", {...baseDecl, channels: {...baseDecl.channels, "/new": {scope: "C"}}}, historical.file);
    expect(expanded.authorities.map((row) => [row.channelId, row.nr])).to.deep.equal([["/literal", 1], ["/constant", 2], ["/new", 3]]);
    const gapped = fixture(readFileSync(historical.file, "utf8").replace("<NR>2</NR>", "<NR>4</NR>"), "gapped.samc.xml");
    const withGap = deriveSamc([a.file, b.file], "TEST_APP", {...baseDecl, channels: {...baseDecl.channels, "/new": {scope: "C"}}}, gapped.file);
    expect(withGap.authorities.map((row) => row.nr)).to.deep.equal([1, 4, 5]);
    expect(() => deriveSamc([b.file], "TEST_APP", {channels: {"/new": {scope: "C"}}}, historical.file))
      .to.throw(/authority drift: NR/);
  });
});
