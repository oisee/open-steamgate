import {expect} from "chai";
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ABAP, MemoryConsole} from "@abaplint/runtime";
import {RfcReplayClient, installRfcDestinations, loadDestinations, substitute, resetSequences, toJson} from "../tools/rfc-replay.mjs";
import {RfcLiveClient, RfcFallbackClient, resolveConnection, abapExceptionKey} from "../tools/rfc-live.mjs";

const table = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
  primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
const flightRow = () => new abap.types.Structure({
  airlineid: new abap.types.Character(3),
  connectid: new abap.types.Character(4),
  price: new abap.types.Integer(),
});

// what an open-rfc Client looks like from here: open, call, close
function fakeOpenRfc(script) {
  const log = [];
  const factory = async (params) => {
    log.push({params});
    return {
      opened: false,
      async open() { this.opened = true; log.push("open"); },
      async close() { this.opened = false; log.push("close"); },
      async call(fm, input) {
        log.push({fm, input});
        return script(fm, input);
      },
    };
  };
  return {factory, log};
}

describe("tools/rfc-live: destinations file, live and record clients, placeholders", () => {
  // a bare runtime for these tests; the gateway's own (test/start.mjs, loaded
  // at import time) is put back for the suites that follow
  let saved;
  before(() => {
    saved = globalThis.abap;
    globalThis.abap = new ABAP({console: new MemoryConsole()});
  });

  after(() => {
    globalThis.abap = saved;
  });

  it("reads the destinations file and refuses unknown kinds", () => {
    const config = loadDestinations("test/fixtures/rfc-destinations.json");
    expect(Object.keys(config)).to.deep.equal(["NONE", "ERP", "A4H", "A4H_REC", "MIXED"]);
    expect(loadDestinations("test/fixtures/does-not-exist.json")).to.deep.equal({});
    const dir = mkdtempSync(join(tmpdir(), "stg-rfc-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({X: {kind: "teleport"}}));
    expect(() => loadDestinations(join(dir, "bad.json"))).to.throw(/kind 'teleport'/);
    rmSync(dir, {recursive: true});
  });

  it("resolves a connection from an object, a .rfc.json with #SYSTEM, the destination name, the default", () => {
    expect(resolveConnection({ashost: "h", client: "001", user: "U", password: "p"}, "X"))
      .to.deep.equal({ashost: "h", sysnr: "00", client: "001", user: "U", passwd: "p", lang: "EN"});
    const dir = mkdtempSync(join(tmpdir(), "stg-rfc-"));
    const file = join(dir, ".rfc.json");
    writeFileSync(file, JSON.stringify({
      systems: {A4H: {ashost: "a4h", sysnr: "01", client: "001", user: "DEV", password: "x", lang: "DE"},
        ERP: {ashost: "erp", client: "100", user: "RFC", password: "y"}},
      default: "ERP",
    }));
    expect(resolveConnection(file + "#A4H", "ANY").ashost).to.equal("a4h");
    expect(resolveConnection(file, "A4H").lang).to.equal("DE");
    expect(resolveConnection(file, "SOMETHING").ashost).to.equal("erp");
    expect(() => resolveConnection(file + "#NOPE", "X")).to.throw(/system NOPE not in/);
    expect(() => resolveConnection({ashost: "h", client: "001", user: "U", ticket: "t"}, "X")).to.throw(/tickets/);
    rmSync(dir, {recursive: true});
  });

  it("installs the file's destinations: local, replay, live behind a lazy session, fallback", async () => {
    const {factory, log} = fakeOpenRfc(() => ({EV_ECHO: "live"}));
    const destinations = await installRfcDestinations(abap, {
      destinations: loadDestinations("test/fixtures/rfc-destinations.json"), clientFactory: factory,
    });
    abap.FunctionModules["Z_ECHO"] = async (input) => { input.importing.ev_echo.set("local"); };
    const echo = new abap.types.Character(5);
    await destinations["NONE"].call("Z_ECHO", {importing: {ev_echo: echo}});
    expect(echo.get()).to.equal("local");
    expect(destinations["ERP"]).to.be.instanceOf(RfcReplayClient);
    expect(destinations["A4H"]).to.be.instanceOf(RfcLiveClient);
    expect(destinations["MIXED"]).to.be.instanceOf(RfcFallbackClient);
    // nothing opened until the first live call
    expect(log).to.have.length(0);
    await destinations["MIXED"].call("Z_ECHO", {importing: {ev_echo: echo}});
    expect(echo.get()).to.equal("local");
    expect(log).to.have.length(0);
    await destinations["MIXED"].call("Z_NOT_TRANSPILED", {importing: {ev_echo: echo}});
    expect(echo.get()).to.equal("live ");
    expect(log[1]).to.equal("open");
    // the same session serves the next call
    await destinations["mixed"].call("Z_NOT_TRANSPILED", {importing: {ev_echo: echo}});
    expect(log.filter((l) => l === "open")).to.have.length(1);
    // names nobody configured still replay
    expect(destinations["UNKNOWN"]).to.be.instanceOf(RfcReplayClient);
  });

  it("live: converts the signature both ways, maps a classic exception to sy-subrc", async () => {
    const {factory, log} = fakeOpenRfc((fm, input) => {
      if (input.AIRLINE.trimEnd() === "XX") {
        const e = new Error("no such airline");
        e.name = "ABAPError";
        e.key = "NOT_FOUND";
        throw e;
      }
      return {FLIGHT_LIST: [{AIRLINEID: input.AIRLINE, CONNECTID: "0400", PRICE: 666}], RETURN: []};
    });
    const client = new RfcLiveClient({destination: "A4H", connection: {ashost: "h", client: "001", user: "U", passwd: "p"}, clientFactory: factory});
    const flights = table(flightRow());
    await client.call("BAPI_FLIGHT_GETLIST", {
      exporting: {airline: new abap.types.Character(3).set("LH")},
      tables: {flight_list: flights},
      exceptions: {not_found: 4, others: 8},
    });
    // TABLES go in with their content, the node-rfc convention
    expect(log[2].input).to.deep.equal({AIRLINE: "LH ", FLIGHT_LIST: []});
    expect(toJson(flights)).to.deep.equal([{AIRLINEID: "LH ", CONNECTID: "0400", PRICE: 666}]);
    expect(abap.builtin.sy.get().subrc.get()).to.equal(0);

    await client.call("BAPI_FLIGHT_GETLIST", {
      exporting: {airline: new abap.types.Character(3).set("XX")},
      tables: {flight_list: flights},
      exceptions: {not_found: 4, others: 8},
    });
    expect(abap.builtin.sy.get().subrc.get()).to.equal(4);

    // an exception the caller did not list is an error, as on the real thing
    let failed = "";
    try {
      await client.call("BAPI_FLIGHT_GETLIST", {exporting: {airline: new abap.types.Character(3).set("XX")}, exceptions: {}});
    } catch (e) {
      failed = e.message;
    }
    expect(failed).to.equal("no such airline");
    expect(abapExceptionKey({name: "RFCError", codeString: "RFC_COMMUNICATION_FAILURE", key: "RFC_COMMUNICATION_FAILURE"})).to.equal(undefined);
    await client.close();
    expect(log[log.length - 1]).to.equal("close");
  });

  it("record: writes the capture the replay client reads back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-rfc-cap-"));
    const {factory} = fakeOpenRfc((fm, input) => ({FLIGHT_LIST: [{AIRLINEID: input.AIRLINE, CONNECTID: "0017", PRICE: 1}], RETURN: []}));
    const recorder = new RfcLiveClient({destination: "A4H_REC", connection: {ashost: "h", client: "001", user: "U", passwd: "p"}, clientFactory: factory, record: dir});
    await recorder.call("BAPI_FLIGHT_GETLIST", {exporting: {airline: new abap.types.Character(3).set("AA")}, tables: {flight_list: table(flightRow())}});
    await recorder.call("BAPI_FLIGHT_GETLIST", {exporting: {airline: new abap.types.Character(3).set("LH")}, tables: {flight_list: table(flightRow())}});
    expect(readdirSync(join(dir, "BAPI_FLIGHT_GETLIST")).sort()).to.deep.equal(["1.json", "2.json"]);
    const capture = JSON.parse(readFileSync(join(dir, "BAPI_FLIGHT_GETLIST", "2.json"), "utf8"));
    expect(capture).to.include({name: "BAPI_FLIGHT_GETLIST", destination: "A4H_REC"});
    expect(capture.params).to.deep.equal({AIRLINE: "LH ", FLIGHT_LIST: []});
    expect(capture.result.FLIGHT_LIST[0].CONNECTID).to.equal("0017");

    const replay = new RfcReplayClient({folder: dir, destination: "ERP"});
    const again = table(flightRow());
    await replay.call("BAPI_FLIGHT_GETLIST", {exporting: {airline: new abap.types.Character(3).set("AA")}, tables: {flight_list: again}});
    expect(toJson(again)[0].AIRLINEID).to.equal("AA ");
    rmSync(dir, {recursive: true});
  });

  it("placeholders: param, now, seq, sql", async () => {
    resetSequences();
    abap.context.databaseConnections["DEFAULT"] = {
      select: async ({select}) => {
        if (select.includes("status_text")) {
          return {rows: [{status: "A", status_text: "Accepted"}, {status: "X", status_text: "Cancelled"}]};
        }
        return {rows: [{cnt: 3}]};
      },
    };
    const input = {IV_ID: "T0009   ", IS_HEAD: {DESCRIPTION: "Berlin"}};
    const filled = await substitute({
      EV_ID: "{{param:IV_ID}}",
      EV_TEXT: "{{param:IS_HEAD.DESCRIPTION}} on {{now:YYYYMMDD}}",
      EV_NEW: "{{seq:TRAVEL:8}}",
      EV_NEXT: "{{seq:TRAVEL:8}}",
      EV_OTHER: "{{seq:BOOKING}}",
      EV_COUNT: "{{sql:SELECT COUNT(*) AS cnt FROM zstg_demo}}",
      ET_STATUS: "{{sql:SELECT status, status_text FROM zstg_status}}",
      ES_ROW: {KEY: "{{param:IV_ID}}", WHEN: "{{now:HHMMSS}}"},
    }, input);
    expect(filled.EV_ID).to.equal("T0009   ");
    expect(filled.EV_TEXT).to.match(/^Berlin on \d{8}$/);
    expect(filled.EV_NEW).to.equal("00000001");
    expect(filled.EV_NEXT).to.equal("00000002");
    expect(filled.EV_OTHER).to.equal("1");
    expect(filled.EV_COUNT).to.equal(3);
    expect(filled.ET_STATUS).to.deep.equal([{STATUS: "A", STATUS_TEXT: "Accepted"}, {STATUS: "X", STATUS_TEXT: "Cancelled"}]);
    expect(filled.ES_ROW.KEY).to.equal("T0009   ");
    expect(filled.ES_ROW.WHEN).to.match(/^\d{6}$/);
    delete abap.context.databaseConnections["DEFAULT"];
  });
});
