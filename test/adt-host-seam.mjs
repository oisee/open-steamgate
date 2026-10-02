import {expect} from "chai";
import {StoreDestination, withSystem, COMMANDS, CAPABILITIES} from "../tools/osd-store-destination.mjs";
import {NotFound, Conflict, ReadOnly, NotSupported, InvalidName} from "../tools/osd-store.mjs";
import {box, rows, answerOf} from "./helpers/destination.mjs";

async function call(destination, command, input = {}) {
  const signature = {
    exporting: Object.fromEntries(Object.entries({iv_command: command, iv_type: "CLAS", iv_name: "ZCL_SEAM", ...input}).map(([k, v]) => [k, box(v)])),
    importing: Object.fromEntries(["EV_JSON", "EV_ERROR", "EV_SOURCE", "EV_NOTE", "EV_FILE", "EV_VERSION", "EV_ACTIVE"].map((k) => [k, box("stale")])),
    tables: {ET_OBJECT: rows(["TYPE", "NAME", "FILE", "VERSION"]), ET_ISSUE: rows(["MESSAGE"]), ET_TYPE: rows(["TYPE", "COUNT"])},
  };
  await destination.call("ZOSD_STORE", signature);
  return answerOf(signature);
}

// Two distinguishable stores catch accidentally consulting the global default.
function store(marker) {
  const entry = {type: "CLAS", name: "ZCL_SEAM", file: marker, package: "$SEAM", packages: ["$TOP", "$SEAM"], changedBy: "DEV"};
  return {
    root: marker,
    list: () => [entry], find: () => entry,
    stateOf: () => ({version: "active", changedAt: "2000-01-01T00:00:00Z"}),
    classIncludes: () => ["testclasses"],
    read: () => ({...entry, source: marker, empty: false}),
    write: () => ({...entry, version: "inactive"}),
    check: () => ({issues: [{message: marker}]}),
    activate: () => ({active: false, issues: [{message: marker}]}),
  };
}

describe("ADT host seam", () => {
  for (const command of ["LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "OBJECT"]) {
    it(`${command} uses each request's bound store without opening the default`, async () => {
      let opens = 0;
      const destination = new StoreDestination({store: () => { opens++; return store("default"); }});
      const answers = await Promise.all(["one", "two"].map((marker) => withSystem(() => ({}), async () => {
        await new Promise((resolve) => setImmediate(resolve));
        const answer = await call(destination, command, {iv_source: "source"});
        expect(answer.EV_ERROR).to.equal("");
        if (command === "OBJECT") expect(JSON.parse(answer.EV_JSON).includes).to.deep.equal(["testclasses"]);
        else if (["CHECK", "ACTIVATE"].includes(command)) expect(answer.ET_ISSUE[0].MESSAGE).to.equal(marker);
        else if (command === "LIST") expect(answer.ET_OBJECT[0].FILE).to.equal(marker);
        else expect(answer.EV_FILE).to.equal(marker);
        return answer;
      }, {store: store(marker)})));
      expect(opens).to.equal(0);
      expect(answers).to.have.length(2);
    });
  }

  it("nested withSystem without a store retains the outer store", async () => {
    const destination = new StoreDestination({store: store("default")});
    await withSystem(() => ({outer: true}), async () => {
      const nested = await withSystem(() => ({inner: true}), async () => {
        const read = await call(destination, "READ");
        expect(read.EV_SOURCE).to.equal("outer");
        return call(destination, "SYSTEM", {iv_type: "IDENTITY"});
      });
      expect(JSON.parse(nested.EV_JSON)).to.deep.equal({inner: true});
      expect(JSON.parse((await call(destination, "SYSTEM", {iv_type: "IDENTITY"})).EV_JSON)).to.deep.equal({outer: true});
    }, {store: store("outer")});
  });

  it("successful ACTIVATE publishes and completes on the bound store too", async () => {
    const bound = store(".local/seam-bound-unused");
    const calls = [];
    bound.activate = () => ({active: true, issues: []});
    bound.publish = async (options) => { calls.push(options); return {ok: true, recycled: false, transpile: {built: {}}}; };
    bound.completeActivation = (verdict, built) => { calls.push([verdict.active, built]); return true; };
    const destination = new StoreDestination({store: store(".local/seam-default-unused")});
    const answer = await withSystem(() => ({}), () => call(destination, "ACTIVATE"), {store: bound});
    expect(answer.EV_ERROR).to.equal("");
    expect(answer.EV_ACTIVE).to.equal("X");
    expect(calls).to.deep.equal([{activate: [{type: "CLAS", name: "ZCL_SEAM"}]}, [true, {}]]);
  });

  it("READ and OBJECT carry full metadata without truncated table names", async () => {
    const destination = new StoreDestination({store: store("tree")});
    expect(JSON.parse((await call(destination, "READ")).EV_JSON)).to.deep.equal({name: "ZCL_SEAM", changedBy: "DEV", empty: false});
    expect(JSON.parse((await call(destination, "OBJECT")).EV_JSON)).to.deep.equal({found: true, type: "CLAS", name: "ZCL_SEAM", writable: true,
      package: "$SEAM", packages: ["$TOP", "$SEAM"], version: "active", changedAt: "2000-01-01T00:00:00Z", changedBy: "DEV", includes: ["testclasses"]});
  });

  it("COMMANDS works without a tree; CAPABILITIES remains the screen button list", async () => {
    const destination = new StoreDestination();
    expect(JSON.parse((await call(destination, "COMMANDS")).EV_JSON)).to.deep.equal({commands: COMMANDS});
    expect((await call(destination, "CAPABILITIES")).EV_NOTE).to.equal(CAPABILITIES.join(" "));
    const refused = await call(destination, "PARSE");
    expect(JSON.parse(refused.EV_JSON)).to.deep.equal({error: {code: "NOT_SUPPORTED", message: "unknown store command PARSE"}});
  });

  it("SYSTEM passes raw bodies untouched and forwards optional IV_JSON", async () => {
    const raw = ' {"z":1,"a":"\\u0061"} \r\n';
    const destination = new StoreDestination();
    const answer = await withSystem((kind, name, json) => {
      expect([kind, name, json]).to.deep.equal(["IDENTITY", "ZCL_SEAM", '{"kind":"probe"}']);
      return {raw};
    }, () => call(destination, "SYSTEM", {iv_type: "IDENTITY", iv_json: ' {"kind":"probe"} '}));
    expect(answer.EV_SOURCE).to.equal(raw);
    expect(answer.EV_JSON).to.equal("");
    expect(answer.EV_ERROR).to.equal("");
  });

  for (const error of [new NotFound("CLAS", "ZCL_MISSING"), new Conflict("exists"), new ReadOnly("CLAS", "ZCL_RO"), new NotSupported("parse"), new InvalidName("bad"), new Error("host failure")]) {
    it(`carries ${error.code ?? "INTERNAL"} and the raw message through the envelope`, async () => {
      const destination = new StoreDestination({store: {...store("tree"), read: () => { throw error; }}});
      const answer = await call(destination, "READ");
      expect(JSON.parse(answer.EV_JSON)).to.deep.equal({error: {code: error.code ?? "INTERNAL", message: error.message}});
      expect(answer.EV_ERROR).to.equal(error.message);
      expect(answer.EV_SOURCE).to.equal("");
    });
  }
});
