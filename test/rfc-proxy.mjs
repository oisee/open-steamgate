import {expect} from "chai";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ABAP, MemoryConsole} from "@abaplint/runtime";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {RfcFallbackClient} from "../tools/rfc-live.mjs";
import {isLocal, localClient, localFunctionModules} from "../tools/rfc-replay.mjs";
import {allowMatcher, installFunctionProxy, proxyJournal} from "../tools/rfc-proxy.mjs";

const FOLDER = "test/fixtures/rfc";
const CONNECTION = {ashost: "h", client: "001", user: "U", passwd: "p"};
const PROBE = "test/fixtures/rfc-proxy/zcl_proxy_probe.clas.abap";

// what an open-rfc Client looks like from here, as in test/rfc-live.mjs
function fakeOpenRfc(script) {
  const log = [];
  const factory = async () => ({
    async open() { log.push("open"); },
    async close() { log.push("close"); },
    async call(fm, input) {
      log.push({fm, input});
      return script(fm, input);
    },
  });
  return {factory, log};
}

describe("tools/rfc-proxy: CALL FUNCTION without DESTINATION for a module that is not transpiled", () => {
  let saved;
  let probe;
  let illegal;

  before(async () => {
    saved = globalThis.abap;
    globalThis.abap = new ABAP({console: new MemoryConsole()});
    // the dump the transpiled call raises when nothing answers
    illegal = class CxIllegal {
      async constructor_() { return this; }
    };
    abap.Classes["CX_SY_DYN_CALL_ILLEGAL_FUNC"] = illegal;
    // the real transpiler on a small class: a static and a dynamic CALL FUNCTION
    const {Transpiler, core} = modulesOf(process.cwd());
    const reg = new core.Registry();
    reg.addFile(new core.MemoryFile("zcl_proxy_probe.clas.abap", readFileSync(PROBE, "utf8")));
    const out = await new Transpiler({ignoreSourceMap: true}).run(reg);
    const code = out.objects.map((o) => o.chunk.getCode()).join("\n");
    probe = new Function(`${code}\nreturn zcl_proxy_probe;`)();
  });

  after(() => {
    globalThis.abap = saved;
  });

  let installed;
  afterEach(() => {
    installed?.uninstall();
    installed = undefined;
    delete abap.FunctionModules["Z_PROXY_PROBE_FM"];
  });

  const key = (v) => new abap.types.Character(2).set(v);
  const dump = async (call) => {
    try {
      await call();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it("matches the allow list by exact name and PREFIX*, case-insensitively", () => {
    const m = allowMatcher("z_one, Z_PRE*");
    expect(m("Z_ONE")).to.equal(true);
    expect(m("Z_PREFIXED")).to.equal(true);
    expect(m("Z_ONES")).to.equal(false);
    expect(m("OTHER")).to.equal(false);
    expect(allowMatcher("")("ANY")).to.equal(false);
  });

  it("answers an allowed, non-transpiled module from a replay capture", async () => {
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_PROXY_PROBE_FM", mode: "replay", folder: FOLDER});
    const text = await probe.run_static({iv_key: key("A1")});
    expect(text.get()).to.equal("0:hello");
    expect(proxyJournal()).to.deep.equal([{name: "Z_PROXY_PROBE_FM", source: "replay", destination: "SYN"}]);
  });

  it("a classic exception of the capture reaches the caller's EXCEPTIONS as sy-subrc", async () => {
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_PROXY_*", mode: "replay", folder: FOLDER});
    const text = await probe.run_static({iv_key: key("ZZ")});
    expect(text.get()).to.equal("4:");
  });

  it("a dynamic CALL FUNCTION lv_name reaches the forwarder too", async () => {
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_PROXY_*", mode: "replay", folder: FOLDER});
    const text = await probe.run_dynamic({iv_name: new abap.types.String().set("Z_PROXY_PROBE_FM"), iv_key: key("A1")});
    expect(text.get()).to.equal("0:hello");
    expect(proxyJournal()).to.have.length(1);
  });

  it("record writes a capture from a fake live system; replay without live gives the same answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-proxy-"));
    try {
      const {factory, log} = fakeOpenRfc((fm, input) => ({EV_TEXT: `live ${input.IV_KEY}`}));
      installed = await installFunctionProxy(abap, {destination: "LIVE", allow: "Z_PROXY_PROBE_FM", mode: "record", folder: dir, clientFactory: factory, connection: CONNECTION});
      const first = await probe.run_static({iv_key: key("Q9")});
      expect(first.get()).to.equal("0:live Q9");
      expect(proxyJournal()[0].source).to.equal("record");
      expect(readdirSync(join(dir, "Z_PROXY_PROBE_FM"))).to.deep.equal(["1.json"]);
      const capture = JSON.parse(readFileSync(join(dir, "Z_PROXY_PROBE_FM", "1.json"), "utf8"));
      expect(capture).to.include({name: "Z_PROXY_PROBE_FM", destination: "LIVE"});
      installed.uninstall();

      const live = log.length;
      installed = await installFunctionProxy(abap, {
        destination: "LIVE", allow: "Z_PROXY_PROBE_FM", mode: "replay", folder: dir,
        clientFactory: () => { throw new Error("no live client in replay"); },
      });
      const second = await probe.run_static({iv_key: key("Q9")});
      expect(second.get()).to.equal(first.get());
      expect(proxyJournal()[0].source).to.equal("replay");
      expect(log.length).to.equal(live);
    } finally {
      rmSync(dir, {recursive: true});
    }
  });

  it("a recorded classic exception comes back as the caller's exception", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-proxy-"));
    try {
      const {factory} = fakeOpenRfc(() => {
        const e = new Error("not found");
        e.name = "ABAPError";
        e.key = "NOT_FOUND";
        throw e;
      });
      installed = await installFunctionProxy(abap, {destination: "LIVE", allow: "Z_PROXY_PROBE_FM", mode: "record", folder: dir, clientFactory: factory, connection: CONNECTION});
      expect((await probe.run_static({iv_key: key("X1")})).get()).to.equal("4:");
      installed.uninstall();
      installed = await installFunctionProxy(abap, {destination: "LIVE", allow: "Z_PROXY_PROBE_FM", mode: "replay", folder: dir});
      expect((await probe.run_static({iv_key: key("X1")})).get()).to.equal("4:");
    } finally {
      rmSync(dir, {recursive: true});
    }
  });

  it("noLive and no capture: an error naming the module and the capture path, not an empty answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-proxy-"));
    try {
      installed = await installFunctionProxy(abap, {
        destination: "LIVE", allow: "Z_PROXY_PROBE_FM", mode: "live", folder: dir, noLive: true,
        clientFactory: () => { throw new Error("must not be reached"); },
      });
      const error = await dump(() => probe.run_static({iv_key: key("A1")}));
      expect(error?.message).to.contain("Z_PROXY_PROBE_FM");
      expect(error.message).to.contain(join(dir, "Z_PROXY_PROBE_FM"));
    } finally {
      rmSync(dir, {recursive: true});
    }
  });

  it("a name outside the allow list still dumps with CX_SY_DYN_CALL_ILLEGAL_FUNC", async () => {
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_OTHER_ONLY", mode: "replay", folder: FOLDER});
    const error = await dump(() => probe.run_static({iv_key: key("A1")}));
    expect(error).to.be.instanceOf(illegal);
    const dynamic = await dump(() => probe.run_dynamic({iv_name: new abap.types.String().set("Z_PROXY_PROBE_FM"), iv_key: key("A1")}));
    expect(dynamic).to.be.instanceOf(illegal);
    expect(proxyJournal()).to.have.length(0);
  });

  it("a transpiled module is never proxied", async () => {
    abap.FunctionModules["Z_PROXY_PROBE_FM"] = async (input) => { input.importing.ev_text.set("local"); };
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_PROXY_*", mode: "replay", folder: FOLDER});
    const text = await probe.run_static({iv_key: key("A1")});
    expect(text.get()).to.equal("0:local");
    expect(proxyJournal()).to.have.length(0);
    expect(isLocal("Z_PROXY_PROBE_FM")).to.equal(true);
  });

  it("local-ness does not lie: fallback runs a transpiled module locally and goes live for an absent one", async () => {
    const {factory, log} = fakeOpenRfc(() => ({EV_TEXT: "live"}));
    const {RfcLiveClient} = await import("../tools/rfc-live.mjs");
    const live = new RfcLiveClient({destination: "LIVE", connection: CONNECTION, clientFactory: factory});
    const fallback = new RfcFallbackClient(localClient(), live);
    abap.FunctionModules["Z_LOCAL_ONE"] = async (input) => { input.importing.ev_text.set("local"); };
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_*", mode: "replay", folder: FOLDER});
    // the proxy would answer for both names; only one is really here
    expect(abap.FunctionModules["Z_PROXY_PROBE_FM"]).to.be.a("function");
    expect(isLocal("Z_PROXY_PROBE_FM")).to.equal(false);
    expect(localFunctionModules()["Z_PROXY_PROBE_FM"]).to.equal(undefined);
    const text = new abap.types.Character(5);
    await fallback.call("Z_LOCAL_ONE", {importing: {ev_text: text}});
    expect(text.get()).to.equal("local");
    expect(log).to.have.length(0);
    await fallback.call("Z_PROXY_PROBE_FM", {exporting: {iv_key: key("A1")}, importing: {ev_text: text}});
    expect(text.get()).to.equal("live ");
    expect(log.some((l) => l.fm === "Z_PROXY_PROBE_FM")).to.equal(true);
    delete abap.FunctionModules["Z_LOCAL_ONE"];
  });

  it("uninstall puts the plain table back", async () => {
    const before = abap.FunctionModules;
    installed = await installFunctionProxy(abap, {destination: "SYN", allow: "Z_*", mode: "replay", folder: FOLDER});
    expect(abap.FunctionModules).to.not.equal(before);
    installed.uninstall();
    installed = undefined;
    expect(abap.FunctionModules).to.equal(before);
    expect(abap.FunctionModules["Z_PROXY_PROBE_FM"]).to.equal(undefined);
  });
});
