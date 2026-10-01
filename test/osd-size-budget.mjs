// The size budget's rules (tools/osd-size-budget.mjs) on made-up sizes: a
// breach, a new file in go/abap, an oversize file, a package without a
// README or importing go/abap, a raise without a reason, and --update
// lowering budgets but never recording what needs a reason. And the tree as
// it is passes its own budget.
import {expect} from "chai";
import {check, measure, update} from "../tools/osd-size-budget.mjs";
import {readFileSync} from "node:fs";

const base = () => ({
  fileLimits: {go: 800, mjs: 1000},
  watched: ["tools/big.mjs"],
  budgets: {
    "go:abap": {lines: 100, reason: "b"},
    "tools/gogen/go/abap/a.go": {lines: 100, reason: "b"},
    "tools/big.mjs": {lines: 2000, reason: "b"},
    "go:enq": {lines: 50, reason: "b"},
  },
  readmeMissing: [],
  importsAbap: {},
});

describe("the size budget", function () {
  it("passes what is within", () => {
    expect(check(base(), {"go:abap": 100, "tools/gogen/go/abap/a.go": 100, "tools/big.mjs": 1999})).to.deep.equal([]);
  });

  it("fails a file or package over its budget, naming both numbers", () => {
    const errors = check(base(), {"go:abap": 101, "tools/big.mjs": 2001});
    expect(errors).to.have.length(2);
    expect(errors[0]).to.match(/go:abap: 101 lines, budget 100 -- carve it/);
  });

  it("gives a new file in go/abap budget 0", () => {
    const errors = check(base(), {"tools/gogen/go/abap/new.go": 3});
    expect(errors[0]).to.match(/a new file in go\/abap \(budget 0\)/);
  });

  it("wants a budget for an oversize file and for a new package", () => {
    const errors = check(base(), {"tools/gogen/go/x/y.go": 801, "tools/z.mjs": 1001, "go:x": 801});
    expect(errors.join("\n")).to.match(/y\.go: 801 lines, over 800/).and.match(/z\.mjs: 1001 lines, over 1000/).and.match(/go:x: a package without a budget/);
  });

  it("refuses a raise without a new reason against the base", () => {
    const now = base();
    now.budgets["go:abap"] = {lines: 120, reason: "b"};
    expect(check(now, {"go:abap": 110}, {base: base()})[0]).to.match(/budget raised 100 -> 120 without a new reason/);
    now.budgets["go:abap"].reason = "the SQL layer moved in from cmd/osgo (#999)";
    expect(check(now, {"go:abap": 110}, {base: base()})).to.deep.equal([]);
  });

  it("wants a reason for a big new budget the base did not have (a renamed package that grew)", () => {
    const now = base();
    now.budgets["go:cmd/osgo2"] = {lines: 1879, reason: "recorded by --update"};
    expect(check(now, {"go:cmd/osgo2": 1879}, {base: base()}).join("\n")).to.match(/a new budget of 1879 lines without a reason/);
    now.budgets["go:cmd/osgo2"].reason = "cmd/osgo renamed and given the gateway's routes (#999)";
    expect(check(now, {"go:cmd/osgo2": 1879}, {base: base()})).to.deep.equal([]);
  });

  it("lets the exemption lists and the limits only shrink against the base", () => {
    const now = base();
    now.readmeMissing = ["enq"];
    now.importsAbap = {enq: "why not"};
    now.fileLimits = {go: 900, mjs: 1000};
    now.watched = [];
    const errors = check(now, {}, {base: base()}).join("\n");
    expect(errors).to.match(/readmeMissing: enq added/).and.match(/importsAbap: enq added/).and.match(/fileLimits.go raised/);
  });

  it("refuses a dependency on go/abap unless the package is exempt", () => {
    const deps = new Map([["enq", true]]);
    expect(check(base(), {"go:enq": 10}, {deps}).join("\n")).to.match(/enq: depends on osg\/gogen\/abap/);
    const b = base();
    b.importsAbap.enq = "baseline";
    expect(check(b, {"go:enq": 10}, {deps}).join("\n")).to.not.match(/depends on/);
  });

  it("lowers budgets on --update and records new packages, never a go/abap file", () => {
    const b = update(base(), {"go:abap": 90, "tools/gogen/go/abap/a.go": 90, "tools/gogen/go/abap/new.go": 5, "go:fresh": 20, "tools/big.mjs": 1500, "go:enq": 50});
    expect(b.budgets["go:abap"].lines).to.equal(90);
    expect(b.budgets["tools/big.mjs"].lines).to.equal(1500);
    expect(b.budgets["go:fresh"]).to.include({lines: 20});
    expect(b.budgets["tools/gogen/go/abap/new.go"]).to.equal(undefined);
  });

  it("holds for the tree as it is", () => {
    const budget = JSON.parse(readFileSync(new URL("../tools/osd-size-budget.json", import.meta.url), "utf8"));
    expect(check(budget, measure(budget))).to.deep.equal([]);
  });
});
