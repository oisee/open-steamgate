// The corpus oracle's schema discipline (tools/amdp-corpus-oracle.mjs): a
// schema per run, the refusal of a user schema in the family, and the sweep's
// choice of what to drop. No HANA here: the catalogue is a list.
import {expect} from "chai";
import {newRunId, schemaName, refuseSchema, inFamily, sweepSelection, createStatement, SCHEMA_PREFIX} from "../tools/amdp-corpus-oracle.mjs";

describe("the corpus oracle: a schema per run", () => {
  it("makes a short upper-case run id of [A-Z0-9]", () => {
    const id = newRunId(Date.UTC(2026, 9, 1), 4242, () => 0.5);
    expect(id).to.match(/^[A-Z0-9]+$/);
    expect(id.length).to.be.within(8, 24);
    expect(newRunId()).to.match(/^[A-Z0-9]+$/);
  });

  it("makes ids that differ by time, by pid and by the random tail", () => {
    const base = newRunId(1e12, 100, () => 0.1);
    expect(newRunId(1e12 + 1, 100, () => 0.1)).to.not.equal(base);
    expect(newRunId(1e12, 101, () => 0.1)).to.not.equal(base);
    expect(newRunId(1e12, 100, () => 0.9)).to.not.equal(base);
    const many = new Set(Array.from({length: 500}, () => newRunId()));
    expect(many.size).to.be.greaterThan(1);
  });

  it("builds OSD_CORPUS_<runid> within HANA's limit and alphabet", () => {
    const name = schemaName(newRunId());
    expect(name).to.match(/^OSD_CORPUS_[A-Z0-9]+$/);
    expect(name.length).to.be.at.most(127);
    expect(schemaName("abc1")).to.equal("OSD_CORPUS_ABC1");
    expect(() => schemaName("a-b")).to.throw(/not/);
    expect(() => schemaName("")).to.throw(/not/);
    expect(() => schemaName("X".repeat(200))).to.throw(/127/);
  });

  it("never names the bare fixed schema", () => {
    expect(schemaName(newRunId())).to.not.equal(SCHEMA_PREFIX);
  });

  it("writes the routine into the run's schema", () => {
    const body = {className: "ZCL_X", types: new Map(), signature: {name: "RUN", language: "SQLSCRIPT", parameters: [], body: "x"}, body: "x"};
    expect(createStatement(body, undefined, "OSD_CORPUS_Q1").split("\n")[0]).to.contain('"OSD_CORPUS_Q1"."ZCL_X=>RUN"');
  });
});

describe("the corpus oracle: the refusal of a user schema", () => {
  it("refuses the bare name, a run's schema and any lower-case spelling of them", () => {
    for (const s of ["OSD_CORPUS", "osd_corpus", " OSD_CORPUS_AB12 ", "OSD_CORPUS_"]) {
      expect(() => refuseSchema(s), s).to.throw(/refused/);
    }
  });

  it("lets other schemas through", () => {
    for (const s of ["", undefined, "OSD", "OSD_CORPUSX", "MY_OSD_CORPUS", "OSD_CONFORMANCE"]) {
      expect(() => refuseSchema(s), String(s)).to.not.throw();
    }
    expect(inFamily("OSD_CORPUSX")).to.equal(false);
  });
});

describe("the corpus oracle: the sweep's selection", () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const ago = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const catalogue = [
    {SCHEMA_NAME: "OSD_CORPUS_OLD1", CREATE_TIME: ago(10)},
    {SCHEMA_NAME: "OSD_CORPUS_NEW1", CREATE_TIME: ago(1)},
    {SCHEMA_NAME: "OSD_CORPUS_EDGE", CREATE_TIME: ago(6)},
    {SCHEMA_NAME: "OSD_CORPUS", CREATE_TIME: ago(100)},
    {SCHEMA_NAME: "OSD_CORPUSX", CREATE_TIME: ago(100)},
    {SCHEMA_NAME: "OSD", CREATE_TIME: ago(100)},
    {SCHEMA_NAME: "SYS", CREATE_TIME: ago(1000)},
    {SCHEMA_NAME: "osd_corpus_lower", CREATE_TIME: ago(100)},
    {SCHEMA_NAME: "OSD_CORPUS_NOTIME", CREATE_TIME: null},
  ];

  it("takes only OSD_CORPUS_<id> older than the limit", () => {
    expect(sweepSelection(catalogue, now, 6)).to.deep.equal(["OSD_CORPUS_OLD1"]);
  });

  it("follows --older-than", () => {
    expect(sweepSelection(catalogue, now, 0.5)).to.have.members(["OSD_CORPUS_OLD1", "OSD_CORPUS_NEW1", "OSD_CORPUS_EDGE"]);
    expect(sweepSelection(catalogue, now, 24)).to.deep.equal([]);
  });

  it("never takes a schema outside the prefix, whatever its age", () => {
    for (const hours of [0, 1, 6, 1e6]) {
      for (const name of sweepSelection(catalogue, now, hours)) expect(name).to.match(/^OSD_CORPUS_[A-Z0-9_]+$/);
    }
    expect(sweepSelection(catalogue, now, 0)).to.not.include.members(["OSD_CORPUS", "OSD_CORPUSX", "OSD", "SYS"]);
  });
});
