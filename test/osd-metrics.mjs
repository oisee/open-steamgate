// The trend metrics (tools/osd-metrics.mjs, tools/osd-metrics-page.mjs): the
// McCabe count of a JS function, the summary per module, what counts as a
// jump between two snapshots, and the page carrying its data.
import {expect} from "chai";
import {compare, jsFunctions, summarize} from "../tools/osd-metrics.mjs";
import {page} from "../tools/osd-metrics-page.mjs";

describe("the trend metrics", function () {
  it("counts 1 plus each branch per function, a closure on its own", () => {
    const fns = jsFunctions(`
      export function a(x) { if (x) { return x && 1; } for (const y of x) {} return x ? 1 : 2; }
      const b = (s) => { switch (s) { case 1: return 1; case 2: return 2; default: return 0; } };
      function c() { try { return [1].map((v) => v || 0); } catch { return null; } }`);
    const by = Object.fromEntries(fns.map((f) => [f.name, f.complexity]));
    expect(by.a).to.equal(5); // if, &&, for-of, ?:
    expect(by.b).to.equal(3); // two cases with a test
    expect(by.c).to.equal(2); // catch; the arrow inside is its own
    expect(fns.some((f) => f.complexity === 2 && f.name !== "c")).to.equal(true); // v || 0
  });

  it("summarizes a module", () => {
    expect(summarize([{name: "x", line: 1, complexity: 20}, {name: "y", line: 2, complexity: 3}]))
      .to.include({functions: 2, sum: 23, max: 20, over15: 1});
  });

  it("names a jump in max, a rise of a fifth in the sum, and a coverage drop", () => {
    const before = {go: {a: {sum: 100, max: 10, coverage: 80}, b: {sum: 100, max: 10}, c: {sum: 100, max: 10}}, js: {}};
    const after = {go: {a: {sum: 101, max: 14, coverage: 80}, b: {sum: 130, max: 10}, c: {sum: 100, max: 10, coverage: 70}}, js: {}};
    before.go.c.coverage = 80;
    const rows = compare(before, after);
    expect(rows.map((r) => r.name)).to.have.members(["a", "b", "c"]);
    expect(rows[0]).to.include({name: "a", dMax: 4});
    expect(compare(before, before)).to.deep.equal([]);
  });

  it("puts the history into the page, with no closing script tag in the data", () => {
    const snap = {commit: "abc", date: "2026-10-01T00:00:00Z", go: {abap: {lines: 1, budget: 1, functions: 1, sum: 1, max: 1, over15: 0, top: [{name: "</script>", line: 1, complexity: 1}]}}, js: {}};
    const html = page([snap]);
    expect(html).to.match(/^<title>OSD Code Gauge<\/title>/);
    expect(html.split("</script>")).to.have.length(2);
  });
});
