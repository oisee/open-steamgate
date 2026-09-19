import {expect} from "chai";
import {startServer} from "./start.mjs";
import {callClass, functionModules, parseFunctionGroup, registryClass} from "../tools/osd-fm-registry.mjs";

// the port of the gateway under test: STG_PORT, as test/start.mjs reads it,
// so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/osd/rfc`;

describe("tools/osd-fm-registry: function groups -> what may be called", () => {
  it("reads the demo group, and the remote flag is the gate", () => {
    const modules = functionModules(["src"]);
    const byName = Object.fromEntries(modules.map((fm) => [fm.name, fm]));

    expect(byName.Z_OSD_TEST_STATUS_TEXT).to.include({group: "ZOSD_TEST_FG", remote: true, implemented: true, exposed: true});
    expect(byName.Z_OSD_TEST_ITEM_LIST).to.include({remote: true, exposed: true});
    // implemented, and still nobody's to call
    expect(byName.Z_OSD_TEST_LOCAL_ONLY).to.include({remote: false, implemented: true, exposed: false});

    const list = byName.Z_OSD_TEST_ITEM_LIST;
    expect(list.parameters.map((p) => `${p.kind} ${p.name}`)).to.deep.equal([
      "IMPORTING IV_STATUS", "EXPORTING EV_COUNT", "TABLES ET_ITEM",
    ]);
    // a TABLES parameter names a line type, a scalar names its own
    expect(list.parameters[2]).to.include({type: "ZOSD_TEST_ITEM_S", lineType: "ZOSD_TEST_ITEM_S"});
    expect(list.parameters[0]).to.include({type: "ZOSD_TEST_STATUS", optional: true});
    expect(list.exceptions).to.deep.equal(["UNKNOWN_STATUS"]);
  });

  it("a module declared but not implemented, and one with nothing to marshal, are refused with a reason", () => {
    // the shape of a group whose modules this tree does not carry: the
    // fixture under test/fixtures/segw is exactly that, two RFC-enabled
    // modules and no bodies
    const declared = parseFunctionGroup(`<FUNCTIONS>
      <item><FUNCNAME>Z_NOT_HERE</FUNCNAME><REMOTE_CALL>R</REMOTE_CALL></item>
      <item><FUNCNAME>Z_UNTYPED</FUNCNAME><REMOTE_CALL>R</REMOTE_CALL>
        <IMPORT><RSIMP><PARAMETER>ANY</PARAMETER></RSIMP></IMPORT></item>
      </FUNCTIONS>`, "zdemo.fugr.xml");
    expect(declared.map((fm) => fm.name)).to.deep.equal(["Z_NOT_HERE", "Z_UNTYPED"]);
    expect(declared[0].group).to.equal("ZDEMO");

    const abap = registryClass(declared.map((fm) => ({...fm, implemented: fm.name === "Z_UNTYPED", exposed: false,
      reason: fm.name === "Z_UNTYPED" ? "parameter ANY is untyped, nothing to marshal it as" : "declared in the group but not implemented in this tree"})));
    expect(abap).to.contain("ls_function-reason      = 'parameter ANY is untyped, nothing to marshal it as'.");
    expect(abap).to.contain("ls_function-exposed     = abap_false.");
  });

  it("the generated dispatcher has a method for an exposed module and none for a local one", () => {
    const abap = callClass(functionModules(["src"]));
    expect(abap).to.contain("WHEN 'Z_OSD_TEST_STATUS_TEXT'.");
    expect(abap).to.contain("CALL FUNCTION 'Z_OSD_TEST_ITEM_LIST'");
    // the typed locals: the whole reason this is generated rather than reflected
    expect(abap).to.contain("iv_status TYPE zosd_test_status,");
    expect(abap).to.contain("et_item TYPE STANDARD TABLE OF zosd_test_item_s WITH DEFAULT KEY,");
    expect(abap).to.contain("unknown_status = 1");
    // the gate, in the generator rather than only in the channel
    expect(abap).not.to.contain("CALL FUNCTION 'Z_OSD_TEST_LOCAL_ONLY'");
    expect(abap).to.contain("* Z_OSD_TEST_LOCAL_ONLY: not remote-enabled, no method here");
  });
});

describe("the RFC channel over HTTP", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  const get = (path) => fetch(`${BASE}${path}`);
  const post = (path, body) => fetch(`${BASE}${path}`, {method: "POST", body});

  it("says what it is, and what it will and will not carry", async () => {
    const res = await get("/");
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("application/json");
    const doc = await res.json();
    expect(doc.CHANNEL).to.equal("open-steamgate RFC channel");
    expect(doc.DECLARED).to.be.at.least(3);
    expect(doc.EXPOSED).to.be.at.least(2);

    const {FUNCTIONS} = await (await get("/functions")).json();
    const local = FUNCTIONS.find((f) => f.NAME === "Z_OSD_TEST_LOCAL_ONLY");
    expect(local).to.include({REMOTE: false, EXPOSED: false});
  });

  it("answers the signature a client needs before it can call anything", async () => {
    const res = await get("/functions/Z_OSD_TEST_ITEM_LIST");
    expect(res.status).to.equal(200);
    const {FUNCTION, PARAMETERS} = await res.json();
    expect(FUNCTION).to.include({NAME: "Z_OSD_TEST_ITEM_LIST", FGROUP: "ZOSD_TEST_FG", EXPOSED: true});
    expect(PARAMETERS.map((p) => [p.KIND, p.NAME])).to.deep.equal([
      ["IMPORTING", "IV_STATUS"], ["EXPORTING", "EV_COUNT"], ["TABLES", "ET_ITEM"], ["EXCEPTION", "UNKNOWN_STATUS"],
    ]);
    expect((await get("/functions/Z_NO_SUCH_MODULE")).status).to.equal(404);
  });

  // the end-to-end claim of backlog D.1: a real transpiled module, reached
  // from outside by name, with its parameters, answering typed
  it("calls a real transpiled module and answers what it computed", async () => {
    const res = await post("/call/Z_OSD_TEST_STATUS_TEXT", '{"IMPORTING":{"IV_STATUS":"O"}}');
    expect(res.status).to.equal(200);
    expect(await res.json()).to.deep.equal({FUNCTION: "Z_OSD_TEST_STATUS_TEXT", EXPORTING: {EV_TEXT: "Open"}});
  });

  it("carries a TABLES parameter with its DDIC row type, out of the seeded rows", async () => {
    const res = await post("/call/Z_OSD_TEST_ITEM_LIST", '{"IMPORTING":{"IV_STATUS":"N"}}');
    expect(res.status).to.equal(200);
    const answer = await res.json();
    expect(answer.EXPORTING).to.deep.equal({EV_COUNT: 2});
    expect(answer.TABLES.ET_ITEM.map((r) => r.ITEM_ID)).to.deep.equal(["I0001", "I0005"]);
    expect(answer.TABLES.ET_ITEM[0]).to.include({STATUS: "N", QUANTITY: 12});
  });

  // an exception leaves the conversation intact, which is what an RFC client
  // is told; only a system failure is a broken call
  it("reports a classic exception in a 200 answer, with no outputs", async () => {
    const res = await post("/call/Z_OSD_TEST_ITEM_LIST", '{"IMPORTING":{"IV_STATUS":"Q"}}');
    expect(res.status).to.equal(200);
    expect(await res.json()).to.deep.equal({FUNCTION: "Z_OSD_TEST_ITEM_LIST", EXCEPTION: "UNKNOWN_STATUS"});
  });

  it("refuses a module that is not remote-enabled, and says which rule it broke", async () => {
    const res = await post("/call/Z_OSD_TEST_LOCAL_ONLY", "{}");
    expect(res.status).to.equal(403);
    expect((await res.json()).ERROR).to.equal("FUNCTION_NOT_REMOTE_ENABLED");
  });

  it("tells a missing module from a wrong method from a wrong route", async () => {
    expect((await post("/call/Z_NO_SUCH_MODULE", "{}")).status).to.equal(404);
    expect((await get("/call/Z_OSD_TEST_STATUS_TEXT")).status).to.equal(405);
    expect((await post("/functions", "{}")).status).to.equal(405);
    expect((await post("/call", "{}")).status).to.equal(400);
    expect((await get("/nonsense")).status).to.equal(404);
  });
});

// D.3: the answer says what a parameter's type **is**, not only what it is
// called. A caller that has to encode a value needs the letter and the
// length, and a data element carries neither — it names a domain, and the
// domain carries them.
//
// The contract is **ours**, and that is stated rather than implied. The
// backlog said these handlers are "driven by one hand-built graph
// (ADTRestGraph)"; fable-osd read the bridge and there is no such thing in
// it, under that name or any other — what it has is `pkg/graph`, a code
// dependency graph of CALLS / REFERENCES / LOADS, which answers who
// references whom and not what a name means. So there is no foreign shape to
// match, and inventing one would be worse than declaring our own: an
// invented contract wears somebody else's name and the first reader believes
// there is a second party to it.
describe("a signature carries the closure of the types it names", function () {
  this.timeout(60000);
  let server;
  before(() => {
    server = startServer(true);
  });
  after(() => server?.close());

  const describeFm = async (name) =>
    (await (await fetch(`${BASE}/functions/${name}`)).json());

  it("resolves a data element through its domain, which is where the type lives", async () => {
    const answer = await describeFm("Z_OSD_TEST_STATUS_TEXT");
    const status = answer.TYPES.find((t) => t.NAME === "ZOSD_TEST_STATUS");
    expect(status, "the type the signature names is in the answer").to.not.equal(undefined);
    // reading the data element alone answers "": it has <DOMNAME> and no
    // <DATATYPE>, which is how a CHAR(1) reads as an empty type
    expect({type: status.DATATYPE, length: status.LENG, letter: status.LETTER})
      .to.deep.equal({type: "CHAR", length: 1, letter: "C"});
  });

  it("carries a built-in too, because a codec needs its letter as much", async () => {
    const answer = await describeFm("Z_OSD_TEST_STATUS_TEXT");
    expect(answer.TYPES.find((t) => t.NAME === "STRING"))
      .to.include({KIND: "BUILTIN", LETTER: "g"});
  });

  it("one entry per type, however many parameters share it", async () => {
    const answer = await describeFm("Z_OSD_TEST_STATUS_TEXT");
    const names = answer.TYPES.filter((t) => t.FIELD === "").map((t) => t.NAME);
    expect(names.length, "no repeats").to.equal(new Set(names).size);
  });

  it("and the parameters still say only what they are called, which is their job", async () => {
    const answer = await describeFm("Z_OSD_TEST_STATUS_TEXT");
    expect(answer.PARAMETERS.map((p) => p.NAME)).to.deep.equal(["IV_STATUS", "EV_TEXT"]);
    expect(answer.PARAMETERS[0].TYPE, "the name, resolved in TYPES").to.equal("ZOSD_TEST_STATUS");
  });
});
