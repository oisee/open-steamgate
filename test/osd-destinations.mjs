// One registry for systems, one for who uses them here.
//
// Every case runs against files written for the test, because the real ones
// are gitignored and carry a logon -- a suite that can only pass on the
// machine that has them tests that machine.
import {expect} from "chai";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {bindings, destinationOf, destinations, remoteServices} from "../tools/osd-destinations.mjs";

describe("tools/osd-destinations: a destination is a system, a binding is who uses it", () => {
  let dir;
  const file = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };
  before(() => { dir = mkdtempSync(join(tmpdir(), "osd-dest-")); });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("reads the unified file and keeps rfc's mode out of the transport", () => {
    const f = file("unified.json", {
      destinations: {
        A4H: {type: "http", url: "http://x", user: "u", password: "p", client: "001"},
        A4H_RFC: {type: "rfc", mode: "live", connection: "~/.rfc.json#A4H"},
      },
      services: {ZOSD_006_DEMO_SRV: "A4H"},
    });
    const all = destinations({file: f});
    expect(all.A4H.type).to.equal("http");
    // the old `kind` meant *how to satisfy an RFC call* and must not be read
    // as a transport; it is `mode` now and `type` is the transport
    expect(all.A4H_RFC).to.include({type: "rfc", mode: "live"});
    expect(bindings({file: f})).to.deep.equal({ZOSD_006_DEMO_SRV: "A4H"});
  });

  it("without it, reads both legacy files and says which", () => {
    const rfcFile = file("rfc.json", {NONE: {kind: "local"}, ERP: {kind: "replay", capture: "x"}});
    const httpFile = file("http.json", {ZSRV: {url: "http://y", user: "u", password: "p"}});
    const said = [];
    const all = destinations({file: join(dir, "absent.json"), rfcFile, httpFile, say: (l) => said.push(l)});
    expect(all.NONE).to.deep.equal({type: "rfc", mode: "local"});
    expect(all.ERP).to.include({type: "rfc", mode: "replay", capture: "x"});
    // the legacy http file was keyed by SERVICE, which is the defect it was
    // written with; the system gets a name and the binding is synthesised
    expect(all["ZSRV@legacy"]).to.include({type: "http", url: "http://y"});
    expect(bindings({file: join(dir, "absent.json"), httpFile})).to.deep.equal({ZSRV: "ZSRV@legacy"});
    expect(said.join(" "), "a tool that quietly reads another file loses somebody an evening")
      .to.contain("is absent; read");
  });

  it("a binding to a destination that is not there is named, not dropped", () => {
    const f = file("dangling.json", {destinations: {A: {type: "http", url: "http://z"}}, services: {S1: "A", S2: "B"}});
    const said = [];
    const out = remoteServices({file: f, say: (l) => said.push(l)});
    expect(out.map((r) => r.service)).to.deep.equal(["S1"]);
    expect(said.join(" ")).to.contain("S2");
    expect(said.join(" ")).to.contain("not a destination");
  });

  it("a binding to an RFC destination cannot answer HTTP, and is told so", () => {
    const f = file("wrongtype.json", {destinations: {R: {type: "rfc", mode: "live"}}, services: {S: "R"}});
    const said = [];
    expect(remoteServices({file: f, say: (l) => said.push(l)})).to.deep.equal([]);
    expect(said.join(" ")).to.contain("cannot answer HTTP");
  });

  it("asking for a system by name is what a preflight does, and a miss lists what there is", () => {
    const f = file("byname.json", {destinations: {A4H: {type: "http", url: "http://x", user: "u", password: "p"}}});
    expect(destinationOf("A4H", {file: f}).url).to.equal("http://x");
    expect(() => destinationOf("NOPE", {file: f})).to.throw(/no destination NOPE.*A4H/);
  });

  it("no files at all is an empty registry and not a crash", () => {
    const absent = {file: join(dir, "a.json"), rfcFile: join(dir, "b.json"), httpFile: join(dir, "c.json"), say: () => {}};
    expect(destinations(absent)).to.deep.equal({});
    expect(remoteServices(absent)).to.deep.equal([]);
  });

  it("a file that is not JSON is reported and treated as absent", () => {
    const p = join(dir, "broken.json");
    writeFileSync(p, "{not json");
    const said = [];
    const errors = [];
    const original = console.error;
    console.error = (l) => errors.push(String(l));
    try {
      expect(destinations({file: p, rfcFile: join(dir, "b.json"), httpFile: join(dir, "c.json"), say: (l) => said.push(l)})).to.deep.equal({});
    } finally {
      console.error = original;
    }
    expect(errors.join(" ")).to.contain("treated as absent");
  });
});

// The two shapes an adversarial review found, both of which the first
// version answered wrongly and quietly.
describe("tools/osd-destinations: the shapes a first file actually has", () => {
  let dir;
  const write = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };
  before(() => { dir = mkdtempSync(join(tmpdir(), "osd-dest2-")); });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("a unified file with services and no destinations yet invents nothing", () => {
    // `unified.destinations ?? unified` used to fall through to the bare map
    // and produce a destination literally named `services`
    const f = write("half.json", {services: {ZOSD_006_DEMO_SRV: "A4H"}});
    const all = destinations({file: f, say: () => {}});
    expect(Object.keys(all), "no phantom destination").to.deep.equal([]);
    expect(bindings({file: f, say: () => {}})).to.deep.equal({ZOSD_006_DEMO_SRV: "A4H"});
    const said = [];
    expect(remoteServices({file: f, say: (l) => said.push(l)})).to.deep.equal([]);
    expect(said.join(" "), "the dangling binding is named").to.contain("A4H");
  });

  it("a bare destination map says it carries no bindings instead of returning nothing", () => {
    const f = write("bare.json", {A4H: {type: "http", url: "http://x", user: "u", password: "p"}});
    expect(destinations({file: f, say: () => {}}).A4H.url).to.equal("http://x");
    const said = [];
    expect(bindings({file: f, say: (l) => said.push(l)})).to.deep.equal({});
    expect(said.join(" "), "silence would make 'none bound' and 'cannot say' look the same")
      .to.contain("nothing is bound");
  });
});
