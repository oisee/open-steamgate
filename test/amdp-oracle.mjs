// The AMDP oracle: what it must see, and what it must refuse to call a pass.
//
// The important test here is not "two identical recordings compare equal" --
// that is true of an instrument that compares nothing at all. It is the pair:
// an instrument that sees a planted difference, and one that refuses to sign
// "no divergence" for a run where nothing was comparable. Backlog 8.4 is the
// standing reason: a green that cannot go red measures nothing.
import {expect} from "chai";
import {compare, report, fromNdjson, toNdjson} from "../tools/amdp-oracle.mjs";

const row = (target, name, result, extra = {}) =>
  ({case: name, method: "squares", target, outcome: "ok", result, ...extra});

const skipped = (target, name, reason) =>
  ({case: name, method: "squares", target, outcome: "skipped", reason});

describe("the AMDP oracle: three systems, one method", () => {

  it("two recordings of the same answer agree, and nothing is masked", () => {
    const a = [row("hxe", "squares/2", {et: [{ID: 1}, {ID: 2}]})];
    const b = [row("a4h", "squares/2", {et: [{ID: 1}, {ID: 2}]})];
    const r = compare(a, b);
    expect(r.same).to.equal(1);
    expect(r.divergences).to.have.length(0);
    expect(r.fired).to.have.length(0);
    expect(report(r)).to.include("No divergence found across 1");
  });

  it("sees a difference in one cell, and names the case it is in", () => {
    // Planted: HANA Express squared the third row wrong. If this passes, the
    // instrument is comparing something; if it does not, every clean run the
    // oracle ever prints is worthless.
    const a = [row("hxe", "squares/3", {et: [{ID: 3, SQUARE: 9}]})];
    const b = [row("a4h", "squares/3", {et: [{ID: 3, SQUARE: 8}]})];
    const r = compare(a, b);
    expect(r.same).to.equal(0);
    expect(r.divergences).to.have.length(1);
    expect(r.divergences[0].case).to.equal("squares/3");
    expect(report(r)).to.include("squares/3");
  });

  it("one side refusing and the other answering IS a divergence, not an error of the run", () => {
    const a = [row("hxe", "squares/-1", {et: []})];
    const b = [{case: "squares/-1", method: "squares", target: "a4h",
      outcome: "error", error: "invalid argument"}];
    const r = compare(a, b);
    expect(r.divergences).to.have.length(1);
    expect(r.divergences[0].a4h).to.deep.equal({refused: "invalid argument"});
  });

  it("a case never asked of one target is not comparable, and keeps its reason", () => {
    const a = [row("hxe", "squares/3", {et: []})];
    const b = [skipped("abap", "squares/3", "no ABAP twin for this method")];
    const r = compare(a, b);
    expect(r.divergences).to.have.length(0);
    expect(r.notComparable).to.have.length(1);
    expect(r.notComparable[0].abap).to.equal("no ABAP twin for this method");
  });

  it("and a run where NOTHING was comparable does not print a clean tick", () => {
    // The third value earning its keep: all-skipped is not agreement. A
    // reader handed "0 diverged" for an empty run would draw the opposite
    // conclusion from the true one.
    const a = [row("hxe", "squares/3", {et: []})];
    const b = [skipped("a4h", "squares/3", "A4H not connected in this run")];
    const text = report(compare(a, b));
    expect(text).to.include("Nothing was comparable, so nothing agreed. This is not a pass.");
    expect(text).to.not.include("No divergence found");
  });

  it("a case present in one file only is counted apart: that is our defect, not theirs", () => {
    const r = compare([row("hxe", "squares/1", {et: []})], [row("a4h", "squares/2", {et: []})]);
    expect(r.missing).to.have.length(2);
    expect(r.divergences).to.have.length(0);
  });

  it("a masking rule that fires is reported by name, so 'identical' stays honest", () => {
    const rule = {name: "row-order", why: "test only", on: false,
      apply: (v) => (Array.isArray(v?.et) ? {...v, et: [...v.et].sort((x, y) => x.ID - y.ID)} : v)};
    const a = [row("hxe", "s", {et: [{ID: 2}, {ID: 1}]})];
    const b = [row("a4h", "s", {et: [{ID: 1}, {ID: 2}]})];
    expect(compare(a, b).divergences).to.have.length(1);          // without it
    const r = compare(a, b, [rule]);                              // with it
    expect(r.divergences).to.have.length(0);
    expect(r.fired).to.deep.equal(["row-order"]);
    expect(report(r)).to.include("masked by rule: row-order");
  });

  it("ndjson survives the round trip, because that is the file the report is built from", () => {
    const lines = [row("hxe", "squares/1", {et: [{ID: 1}]}), skipped("a4h", "squares/1", "why")];
    expect(fromNdjson(toNdjson(lines))).to.deep.equal(lines);
  });
});
