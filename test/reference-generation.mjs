import {expect} from "chai";
import {existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {launchReferenceServer, runReference, stopReferenceServer} from "../tools/osd-reference-generation.mjs";
import {withAbapCase} from "../tools/osd-case-determinism.mjs";

const root = process.cwd();
const fixture = join(root, "test/fixtures/http-cases/clock-read.http");
const live = join(root, "build/live");
function generation() {
  if (!existsSync(live)) throw new Error("reference acceptance requires a built generation");
  return basename(resolve(root, "build", readlinkSync(live)));
}
function abapClock() {
  const fields = {datum: "", datlo: "", uzeit: "", timlo: ""};
  const settable = Object.fromEntries(Object.keys(fields).map((key) =>
    [key, {set(value) { fields[key] = value; }}]));
  const sy = {get: () => settable};
  const abap = {builtin: {sy}, statements: {getTime({sy: target = sy} = {}) {
    const date = new Date().toISOString();
    target.get().datum.set(date.slice(0, 10).replaceAll("-", ""));
    target.get().datlo.set(date.slice(0, 10).replaceAll("-", ""));
    target.get().uzeit.set(date.slice(11, 19).replaceAll(":", ""));
    target.get().timlo.set(date.slice(11, 19).replaceAll(":", ""));
  }}};
  return {abap, fields};
}
async function wireGet(server, caseId, path = "/sap/opu/odata/sap/ZOSD_REF_SRV/ClockSet('CLOCK')") {
  const headers = {host: "reference.local", accept: "application/json"};
  if (caseId) headers["x-osd-case"] = caseId;
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {headers});
  expect(response.status).to.equal(200);
  return {headers: response.headers, body: await response.json()};
}
describe("reference generation", function () {
  this.timeout(180000);
  it("same pinned generation and unmasked golden agree on the wire", async () => {
    const hash = generation();
    const result = await runReference(fixture, hash, hash, {root});
    expect(result).to.deep.equal({code: 0, differences: []});
  });
  it("a one-second golden timestamp change fails at its JSON pointer", async () => {
    const hash = generation();
    const dir = mkdtempSync(join(root, ".osd-reference-test-"));
    try {
      const file = join(dir, "clock-read.http");
      writeFileSync(file, readFileSync(fixture));
      const golden = JSON.parse(readFileSync(join(root, "test/fixtures/http-cases/clock-read.golden.json")));
      golden.body.d.ObservedAt = "2026-09-21T10:00:01Z";
      writeFileSync(join(dir, "clock-read.golden.json"), JSON.stringify(golden));
      const result = await runReference(file, hash, hash, {root});
      expect(result.code).to.equal(1);
      expect(result.differences.join("\n")).to.contain("/d/ObservedAt");
      const cli = spawnSync(process.execPath, ["tools/osd-reference-generation.mjs", file, hash, hash],
        {cwd: root, encoding: "utf8", timeout: 60000});
      expect(cli.status).to.equal(1);
      expect(cli.stdout).to.contain("/d/ObservedAt");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it("a changed golden UUID fails at its JSON pointer", async () => {
    const hash = generation();
    const dir = mkdtempSync(join(root, ".osd-reference-test-"));
    try {
      const file = join(dir, "clock-read.http");
      writeFileSync(file, readFileSync(fixture));
      const golden = JSON.parse(readFileSync(join(root, "test/fixtures/http-cases/clock-read.golden.json")));
      golden.body.d.Token = "B" + golden.body.d.Token.slice(1);
      writeFileSync(join(dir, "clock-read.golden.json"), JSON.stringify(golden));
      const result = await runReference(file, hash, hash, {root});
      expect(result.code).to.equal(1);
      expect(result.differences.join("\n")).to.contain("/d/Token");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it("a missing generation is a configuration error", async () => {
    const hash = generation();
    let caught;
    try {
      await runReference(fixture, hash, "0000000000000000", {root});
    } catch (error) {
      caught = error;
    }
    expect(caught?.message).to.contain("missing generation 0000000000000000");
    const cli = spawnSync(process.execPath, ["tools/osd-reference-generation.mjs", fixture,
      hash, "0000000000000000"], {cwd: root, encoding: "utf8"});
    expect(cli.status).to.equal(2);
  });
  it("isolates sequential and overlapping HTTP cases in one server, then restores real ABAP time", async () => {
    const hash = generation();
    const dir = mkdtempSync(join(root, ".osd-reference-test-"));
    const firstUuid = ["11111111", "1111", "4111", "8111", "111111111111"].join("-");
    const secondUuid = ["22222222", "2222", "4222", "8222", "222222222222"].join("-");
    const cases = {
      first: {clock: "2026-09-21T10:00:00.000Z", uuid: [firstUuid], probeDelayMs: 100},
      second: {clock: "2026-09-22T11:00:00.000Z", uuid: [secondUuid]},
    };
    let server;
    try {
      server = await launchReferenceServer(root, hash, cases, dir);
      const start = Date.now();
      const first = await wireGet(server, "first");
      const second = await wireGet(server, "second");
      expect(first.body.d.ObservedAt).to.equal("2026-09-21T10:00:00Z");
      expect(second.body.d.ObservedAt).to.equal("2026-09-22T11:00:00Z");
      expect(first.body.d.Token).to.equal(firstUuid.toUpperCase());
      expect(second.body.d.Token).to.equal(secondUuid.toUpperCase());
      expect(first.headers.get("x-osd-uuid-used")).to.equal("1");
      expect(second.headers.get("x-osd-uuid-used")).to.equal("1");
      const set = await wireGet(server, "first", "/sap/opu/odata/sap/ZOSD_REF_SRV/ClockSet");
      expect(set.body.d.results).to.have.lengthOf(1);
      expect(set.body.d.results[0]).to.include({Id: "CLOCK", ObservedAt: "2026-09-21T10:00:00Z",
        Token: firstUuid.toUpperCase()});
      const pending = wireGet(server, "first");
      await new Promise((done) => setTimeout(done, 15));
      const [overlapFirst, overlapSecond] = await Promise.all([pending, wireGet(server, "second")]);
      expect(overlapFirst.body.d.ObservedAt).to.equal("2026-09-21T10:00:00Z");
      expect(overlapSecond.body.d.ObservedAt).to.equal("2026-09-22T11:00:00Z");
      expect(overlapFirst.body.d.Token).to.equal(firstUuid.toUpperCase());
      expect(overlapSecond.body.d.Token).to.equal(secondUuid.toUpperCase());
      const unscoped = await wireGet(server);
      const observed = Date.parse(unscoped.body.d.ObservedAt);
      expect(observed).to.be.within(Date.now() - 10000, Date.now() + 1000);
      expect(unscoped.body.d.Token).to.match(/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/);
      expect(unscoped.body.d.Token).to.not.equal(firstUuid.toUpperCase());
      expect(unscoped.body.d.Token).to.not.equal(secondUuid.toUpperCase());
      expect(Date.now() - start).to.be.at.least(200);
    } finally {
      await stopReferenceServer(server);
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it("case time and ordered UUIDs do not leak into the next case or host clock", async () => {
    const {abap, fields} = abapClock();
    const uuidClass = {};
    const realTime = abap.statements.getTime;
    const start = Date.now();
    const startMono = performance.now();
    const a = ["11111111", "1111", "4111", "8111", "111111111111"].join("-");
    const b = ["22222222", "2222", "4222", "8222", "222222222222"].join("-");
    await withAbapCase(abap, uuidClass, {clock: "2026-09-21T10:00:00.000Z", uuid: [a]}, async () => {
      expect(fields.datum + fields.uzeit).to.equal("20260921100000");
      expect(uuidClass.CRYPTO.randomUUID()).to.equal(a);
    });
    await withAbapCase(abap, uuidClass, {clock: "2026-09-22T11:00:00.000Z", uuid: [b]}, async () => {
      expect(fields.datum + fields.uzeit).to.equal("20260922110000");
      expect(uuidClass.CRYPTO.randomUUID()).to.equal(b);
    });
    expect(abap.statements.getTime).to.equal(realTime);
    expect(uuidClass.CRYPTO).to.equal(undefined);
    abap.statements.getTime();
    expect(fields.datum).to.equal(new Date().toISOString().slice(0, 10).replaceAll("-", ""));
    // the host clock still moves after the cases (a frozen Date.now would be
    // the leak); a timer may fire a millisecond early (14 ms for setTimeout
    // 15 on CI), so ask for movement rather than the exact delay, on the wall
    // clock and on the monotonic one
    await new Promise((done) => setTimeout(done, 15));
    expect(Date.now() - start).to.be.at.least(10);
    expect(performance.now() - startMono).to.be.at.least(10);
  });
  it("UUID exhaustion and unused values fail the case", async () => {
    const {abap} = abapClock();
    const uuidClass = {};
    const uuid = ["11111111", "1111", "4111", "8111", "111111111111"].join("-");
    try {
      await withAbapCase(abap, uuidClass, {uuid: []}, () => uuidClass.CRYPTO.randomUUID());
      throw new Error("exhaustion was accepted");
    } catch (error) { expect(error.message).to.contain("exhausted"); }
    try {
      await withAbapCase(abap, uuidClass, {uuid: [uuid]}, async () => {});
      throw new Error("unused UUID was accepted");
    } catch (error) { expect(error.message).to.contain("unused"); }
  });
});
