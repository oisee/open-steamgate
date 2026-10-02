import {expect} from "chai";
import {readFileSync} from "node:fs";
import {PIN, SCENARIOS, STATUSES, parseArgs} from "../tools/abapfs-conformance.mjs";

// The conformance run itself is on demand (npm run conformance:abapfs); this
// suite only keeps its expectations file and its command line honest, and
// needs neither the ADT client nor a server.
const expected = JSON.parse(readFileSync(new URL("./fixtures/abapfs-conformance/expected.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../tools/abapfs-conformance/package-lock.json", import.meta.url), "utf8"));

describe("tools/abapfs-conformance: expectations and arguments", () => {
  it("expects every scenario exactly once, with a known status", () => {
    const ids = SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).to.equal(ids.length);
    expect(Object.keys(expected.scenarios).sort()).to.deep.equal([...ids].sort());
    for (const [id, e] of Object.entries(expected.scenarios)) {
      expect(STATUSES, id).to.include(e.status);
      expect(e.feature, id).to.be.a("string").and.not.empty;
    }
  });

  it("pins the client ABAP-FS ships, in the file and in the lock", () => {
    expect(expected.client).to.deep.equal({name: PIN.name, version: PIN.version, integrity: PIN.integrity});
    const entry = lock.packages[`node_modules/${PIN.name}`];
    expect(entry.version).to.equal(PIN.version);
    expect(entry.integrity).to.equal(PIN.integrity);
    expect(entry.license).to.equal("MIT");
  });

  it("gives every scenario a group and an impact from 1 to 5", () => {
    for (const s of SCENARIOS) {
      expect(s.group, s.id).to.be.a("string").and.not.empty;
      expect(s.impact, s.id).to.be.within(1, 5);
    }
  });

  it("defaults to a running system on 3030", () => {
    const o = parseArgs([]);
    expect(o.url).to.equal("http://localhost:3030");
    expect(o.start).to.equal(false);
  });

  it("starts its own system on --port", () => {
    const o = parseArgs(["--start", "--port", "4123"]);
    expect(o.start).to.equal(true);
    expect(o.url).to.equal("http://localhost:4123");
  });

  it("takes --url, --only and --update-expected", () => {
    const o = parseArgs(["--url", "http://127.0.0.1:9000/", "--only", "tree,write", "--update-expected"]);
    expect(o.url).to.equal("http://127.0.0.1:9000");
    expect(o.only).to.deep.equal(["tree", "write"]);
    expect(o.updateExpected).to.equal(true);
  });

  it("refuses what it cannot mean", () => {
    expect(() => parseArgs(["--start", "--url", "http://x:1"])).to.throw(/exclude/);
    expect(() => parseArgs(["--port", "99999", "--start"])).to.throw(/not a port/);
    expect(() => parseArgs(["--only", "nosuchgroup"])).to.throw(/unknown group/);
    expect(() => parseArgs(["--url"])).to.throw(/needs a value/);
    expect(() => parseArgs(["--url", "localhost:3030"])).to.throw(/scheme/);
    expect(() => parseArgs(["--frobnicate"])).to.throw(/unknown argument/);
  });
});
