// The oracle column, checked as a thing that can go stale.
//
// It is the one column in the conformance table nobody here can re-measure:
// HANA Express lives on another machine, so the file in the tree is the
// measurement. That makes it a fixture, and this repository's own lesson
// about fixtures is that they drift **by standing still** -- the list of
// cases moves and the stored answers do not, and the instrument goes on
// printing a number.
//
// So the two directions are asked separately, because they mean different
// things:
//
//   a case the oracle never answered   the list grew; that row is unmeasured
//                                      and the table already says so
//   an answer for a case nobody asks   the list was RENAMED or cut, and the
//                                      oracle is older than it looks
//
// The first is a normal state of affairs and must not fail a build. The
// second is a defect: it means somebody changed the question and left the
// answer.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {CASES, ORACLE, oracleFrom, oracleSource} from "../tools/sqlscript-conformance.mjs";

const file = JSON.parse(readFileSync(ORACLE, "utf8"));
const ids = CASES.map((c) => c.id);

describe("the tracked HANA oracle", () => {
  it("is measured on the fixture the default run uses", () => {
    // `--padded` is the other question and the seven rows between them are
    // the size of a finding; a column merged across that line compares two
    // different experiments and answers confidently.
    expect(file.fixture).to.equal("unpadded");
  });

  it("answers no case this list has stopped asking", () => {
    const use = oracleFrom(file, "unpadded", ids);
    expect(use.refused, "the tracked oracle is usable by the default run").to.equal(undefined);
    expect(use.stale, `stale answers: ${use.stale?.join(", ")}`).to.deep.equal([]);
  });

  it("says which cases it has not answered, rather than leaving them to look equal", () => {
    const use = oracleFrom(file, "unpadded", [...ids, "a_case_added_after_the_measurement"]);
    expect(use.missing).to.include("a_case_added_after_the_measurement");
    expect(use.refused, "a case it never saw does not make the column unusable").to.equal(undefined);
  });

  it("carries its provenance, and says so where it does not have any", () => {
    expect(file.measuredAt, "when it was measured").to.be.a("string");
    // The run that produced it did not record an engine version. That is
    // stated rather than invented: a build string nobody measured would make
    // the column look more checked than it is.
    expect(file.builds).to.have.property("hana");
    expect(oracleSource(ORACLE, file.measuredAt, file.builds.hana))
      .to.contain("build not recorded").and.to.contain(file.measuredAt);
  });
});

describe("what makes a stored column usable at all", () => {
  it("refuses one measured on the other fixture, by name", () => {
    const use = oracleFrom({fixture: "padded", hana: {}}, "unpadded", ids);
    expect(use.refused).to.contain("padded").and.to.contain("unpadded");
    expect(use.hana, "and hands back nothing to compare against").to.equal(undefined);
  });

  it("refuses one with no column in it, rather than merging an empty answer", () => {
    // An absent value taking the place of a real one is the failure this
    // tree has counted all week; here it would read as "HANA agrees with
    // everything", which is the most flattering wrong answer available.
    expect(oracleFrom({fixture: "unpadded"}, "unpadded", ids).refused).to.contain("no hana column");
  });

  it("takes a file with no fixture field at the caller's word", () => {
    // Written before the field existed. It says nothing about which fixture
    // it used, and refusing it would throw away a measurement over a
    // convention that postdates it.
    const use = oracleFrom({hana: {int_div: {value: "0.500000"}}}, "unpadded", ids);
    expect(use.refused).to.equal(undefined);
    expect(use.missing.length).to.equal(ids.length - 1);
  });
});
