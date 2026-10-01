// The corpus oracle's schema discipline (tools/amdp-corpus-oracle.mjs): a
// schema per run, the refusal of a user schema in the family, and the sweep's
// choice of what to drop. No HANA here: the catalogue is a list.
import {expect} from "chai";
import {newRunId, schemaName, refuseSchema, inFamily, sweepSelection, createStatement, ownership, RUN_ID_SHAPE, SCHEMA_PREFIX} from "../tools/amdp-corpus-oracle.mjs";

describe("the corpus oracle: a schema per run", () => {
  it("makes run ids of one fixed shape, R + 17 of [0-9A-Z]", () => {
    expect(newRunId(Date.UTC(2026, 9, 1), () => 35)).to.match(RUN_ID_SHAPE);
    expect(newRunId(0, () => 0)).to.equal("R000000000" + "00000000");
    for (let i = 0; i < 200; i += 1) expect(newRunId()).to.match(RUN_ID_SHAPE);
  });

  it("makes ids that differ by time and by the random tail", () => {
    const base = newRunId(1e12, () => 1);
    expect(newRunId(1e12 + 1, () => 1)).to.not.equal(base);
    expect(newRunId(1e12, () => 2)).to.not.equal(base);
    const many = new Set(Array.from({length: 2000}, () => newRunId(1e12)));
    expect(many.size).to.equal(2000);
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
  const h = 3600;
  const run = (n) => schemaName(newRunId(1e12 + n, () => n % 36));
  const OLD = run(1), NEW = run(2), EDGE = run(3), UNMARKED = run(4), NOAGE = run(5);
  const catalogue = [
    {SCHEMA_NAME: OLD, AGE_SECONDS: 10 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: NEW, AGE_SECONDS: 1 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: EDGE, AGE_SECONDS: 6 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: UNMARKED, AGE_SECONDS: 100 * h, MARKED: 0, LIVE: 0},
    {SCHEMA_NAME: NOAGE, AGE_SECONDS: null, MARKED: 1, LIVE: 0},
    // a run older than any limit whose connection is still open, and one whose liveness was not read
    {SCHEMA_NAME: run(6), AGE_SECONDS: 1000 * h, MARKED: 1, LIVE: 1},
    {SCHEMA_NAME: run(7), AGE_SECONDS: 1000 * h, MARKED: 1},
    // lookalikes of the family that newRunId cannot make, marked or not
    {SCHEMA_NAME: "OSD_CORPUS_BACKUP", AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: "OSD_CORPUS_X_Y", AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: `${OLD}_COPY`, AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: OLD.toLowerCase(), AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: "OSD_CORPUS", AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: "OSD_CORPUSX", AGE_SECONDS: 100 * h, MARKED: 1, LIVE: 0},
    {SCHEMA_NAME: "SYS", AGE_SECONDS: 1000 * h, MARKED: 0, LIVE: 0},
  ];

  it("takes only a marked run schema older than the limit, by HANA's own age", () => {
    expect(sweepSelection(catalogue, 6)).to.deep.equal([OLD]);
  });

  it("follows --older-than", () => {
    expect(sweepSelection(catalogue, 0.5)).to.have.members([OLD, NEW, EDGE]);
    expect(sweepSelection(catalogue, 24)).to.deep.equal([]);
  });

  it("never takes a run still connected, or one whose liveness is unknown, however old", () => {
    for (const hours of [0, 6, 100]) expect(sweepSelection(catalogue, hours)).to.not.include.members([run(6), run(7)]);
  });

  it("never takes a lookalike, an unmarked schema or one without an age, whatever the limit", () => {
    for (const hours of [0, 1, 6, 1e6]) {
      for (const name of sweepSelection(catalogue, hours)) expect([OLD, NEW, EDGE]).to.include(name);
    }
  });
});

describe("the corpus oracle: dropping only what this run created", () => {
  it("drops nothing before created(), so a failed CREATE (the name exists) or an early signal drops nothing", async () => {
    let drops = 0;
    const own = ownership(() => { drops += 1; });
    expect(await own.drop()).to.equal(false);
    expect(drops).to.equal(0);
  });

  it("drops once after created(), even when the signal and finally both ask", async () => {
    let drops = 0;
    const own = ownership(() => { drops += 1; });
    own.created();
    await Promise.all([own.drop(), own.drop()]);
    await own.drop();
    expect(drops).to.equal(1);
  });

  it("a failing drop does not throw out of cleanup", async () => {
    const own = ownership(() => { throw new Error("gone"); });
    own.created();
    expect(await own.drop()).to.equal(true);
  });
});
