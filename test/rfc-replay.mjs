import {expect} from "chai";
import {ABAP, MemoryConsole} from "@abaplint/runtime";
import {RfcReplayClient, installRfcDestinations, loadCaptures, pickCapture, toJson} from "../tools/rfc-replay.mjs";

const FOLDER = "test/fixtures/rfc";
const table = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
  primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
const flightRow = () => new abap.types.Structure({
  airlineid: new abap.types.Character(3),
  connectid: new abap.types.Character(4),
  flightdate: new abap.types.Character(8),
  airportfr: new abap.types.Character(3),
  airportto: new abap.types.Character(3),
  price: new abap.types.Integer(),
  curr: new abap.types.Character(5),
});
const returnRow = () => new abap.types.Structure({
  type: new abap.types.Character(1),
  id: new abap.types.Character(20),
  number: new abap.types.Character(3),
  message: new abap.types.Character(220),
});

describe("tools/rfc-replay: CALL FUNCTION DESTINATION from captured calls", () => {
  before(() => {
    globalThis.abap = new ABAP({console: new MemoryConsole()});
  });

  it("picks the capture whose input matches, padding ignored, and fills the tables", async () => {
    const client = new RfcReplayClient({folder: FOLDER, destination: "SYNTHETIC"});
    const flights = table(flightRow());
    const ret = table(returnRow());
    await client.call("BAPI_FLIGHT_GETLIST", {
      exporting: {airline: new abap.types.Character(3).set("AA")},
      tables: {flight_list: flights, return: ret},
      exceptions: {},
    });
    expect(flights.array()).to.have.length(1);
    expect(toJson(flights)[0]).to.include({AIRLINEID: "AA ", CONNECTID: "0017", AIRPORTTO: "SFO", PRICE: 444});
    expect(toJson(ret)[0].MESSAGE.trimEnd()).to.equal("one flight");
    expect(abap.builtin.sy.get().subrc.get()).to.equal(0);

    await client.call("BAPI_FLIGHT_GETLIST", {
      exporting: {airline: new abap.types.Character(3).set("LH")},
      tables: {flight_list: flights, return: ret},
    });
    expect(flights.array()).to.have.length(2);
    expect(toJson(flights).map((r) => r.CONNECTID)).to.deep.equal(["0400", "0402"]);
    expect(ret.array()).to.have.length(0);
  });

  it("falls back to the scalar parameters, then to the first capture", () => {
    const captures = loadCaptures(FOLDER, "bapi_flight_getlist");
    expect(captures.map((c) => c.file.split("/").pop())).to.deep.equal(["1.json", "2.json"]);
    // same scalars, an extra table in the input: matched on the scalars
    expect(pickCapture(captures, {AIRLINE: "AA", DATE_RANGE: [{SIGN: "I"}]}).file).to.contain("2.json");
    // nothing matches: the first one
    expect(pickCapture(captures, {AIRLINE: "XX"}).file).to.contain("1.json");
  });

  it("replays a classic exception as sy-subrc of the caller", async () => {
    const client = new RfcReplayClient({folder: FOLDER, destination: "SYNTHETIC"});
    const value = new abap.types.Character(10);
    await client.call("Z_STG_RFC_PROBE", {
      exporting: {key: new abap.types.Character(10).set("missing")},
      importing: {value},
      exceptions: {not_found: 4, others: 8},
    });
    expect(abap.builtin.sy.get().subrc.get()).to.equal(4);
  });

  it("names the function module and the folder when there is no capture", async () => {
    const client = new RfcReplayClient({folder: FOLDER, destination: "SYNTHETIC"});
    let message = "";
    try {
      await client.call("BAPI_USER_GET_DETAIL", {exporting: {}});
    } catch (e) {
      message = e.message;
    }
    expect(message).to.contain("BAPI_USER_GET_DETAIL");
    expect(message).to.contain("SYNTHETIC");
    expect(message).to.contain("rfc call BAPI_USER_GET_DETAIL");
  });

  it("installs NONE and '' as local, every other name as replay", async () => {
    const destinations = installRfcDestinations(abap, {folder: FOLDER});
    abap.FunctionModules["Z_LOCAL_PING"] = async (input) => {
      input.importing.echo.set("pong");
    };
    const echo = new abap.types.Character(4);
    await destinations["NONE"].call("Z_LOCAL_PING", {importing: {echo}});
    expect(echo.get()).to.equal("pong");
    await destinations[""].call("Z_LOCAL_PING", {importing: {echo}});
    expect(destinations["A4H"]).to.be.instanceOf(RfcReplayClient);
    expect(destinations["A4H"]).to.equal(destinations["A4H"]);
    const flights = table(flightRow());
    await destinations["A4H"].call("BAPI_FLIGHT_GETLIST", {
      exporting: {airline: new abap.types.Character(3).set("LH")},
      tables: {flight_list: flights},
    });
    expect(flights.array()).to.have.length(2);
  });
});
