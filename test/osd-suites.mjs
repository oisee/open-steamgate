// The reporter that says what a run could not look at. Both branches, because
// the branch that matters is the one a runner takes and a workstation never
// does -- and a reporter checked only where everything is present reports on
// the specimen made for it.
import {expect} from "chai";
import {OPTIONAL, reportSkips} from "../tools/osd-suites.mjs";

describe("tools/osd-suites: a run says what it could not see", () => {
  it("names every absent input and why it mattered", () => {
    const said = [];
    const absent = reportSkips([["/nowhere/corpus", "the oracle"], ["/nowhere/two", "the other one"]], (l) => said.push(l));
    expect(absent.map(([p]) => p)).to.deep.equal(["/nowhere/corpus", "/nowhere/two"]);
    expect(said.join("\n")).to.contain("NOT looked at");
    expect(said.join("\n")).to.contain("/nowhere/corpus");
    expect(said.join("\n"), "the reason travels with the path").to.contain("the oracle");
  });

  it("and says so plainly when it saw everything", () => {
    const said = [];
    expect(reportSkips([[".", "this directory, which exists"]], (l) => said.push(l))).to.deep.equal([]);
    expect(said.join("\n")).to.contain("the wide one");
  });

  it("the real list names paths that are not in this repository", () => {
    expect(OPTIONAL.map(([p]) => p)).to.include.members([".local/corpus", ".local/lars"]);
    for (const [, why] of OPTIONAL) {
      expect(why, "every entry says what is lost without it").to.have.length.greaterThan(10);
    }
  });
});
