import {expect} from "chai";
import {readFileSync} from "node:fs";
import {buildDemoReport, renderDemoHtml, terminalSummary} from "../tools/amdp-demo.mjs";

describe("the Portable AMDP progress demo", function () {
  this.timeout(30000);

  it("derives its progress from the real compiler and DuckDB runtime", async () => {
    const report = await buildDemoReport();
    const byMethod = new Map(report.cases.map((one) => [one.method, one]));
    expect(report.schema).to.equal("osg-amdp-demo/v1");
    expect(report.cases).to.have.length(11);
    expect(byMethod.get("squares").portable.status).to.equal("executed");
    expect(byMethod.get("squares").portable.runs[0].rows).to.have.length(4);
    expect(byMethod.get("squares").portable.runs[0].trace).to.include({engine: "duckdb", fallback: false});
    expect(byMethod.get("transform").portable.status).to.equal("executed");
    expect(byMethod.get("identity_cells").portable.status).to.equal("executed");
    expect(byMethod.get("expand_values").portable.status).to.equal("executed");
    expect(byMethod.get("expand_values").portable.runs[0].rows).to.deep.equal([
      {ELEMENT_VALUE: 2, POSITION_VALUE: 1},
      {ELEMENT_VALUE: 2, POSITION_VALUE: 2},
      {ELEMENT_VALUE: null, POSITION_VALUE: 3},
      {ELEMENT_VALUE: 5, POSITION_VALUE: 4},
    ]);
    expect(byMethod.get("search_cells").portable.status).to.equal("executed");
    expect(byMethod.get("search_cells").portable.runs[0].rows).to.deep.include.members([
      {CELL_ID: 10, SCORE_VALUE: 1000, LABEL_TEXT: "AMBER", MAPPED_TEXT: "group-one"},
      {CELL_ID: 11, SCORE_VALUE: 700, LABEL_TEXT: "amber field", MAPPED_TEXT: "group-two"},
      {CELL_ID: 13, SCORE_VALUE: 0, LABEL_TEXT: "none", MAPPED_TEXT: "fallback"},
    ]);
    expect(report.counts.executed + report.counts.partial + report.counts.refused).to.equal(11);
  });

  it("renders one self-contained master-detail report", async () => {
    const report = await buildDemoReport();
    const html = renderDemoHtml(report);
    expect(html).to.include("Portable AMDP progress");
    expect(html).to.include("Original SQLScript body");
    expect(html).to.include("ZCL_OSD_AMDP_DEMO=>squares");
    expect(html).to.not.include("<script src=");
    expect(terminalSummary(report)).to.include("executed CL_NEUTRAL_FLOW=>transform");
  });

  it("keeps the illustrated story as a separate, committed report", () => {
    const story = readFileSync(new URL("../docs/portable-amdp-report.html", import.meta.url), "utf8");
    expect(story).to.include("Глубина уже сильная. Ширина пока ранняя.");
    expect(story).to.include("17 / 101");
    expect(story).to.include("16 / 364");
    expect(story).to.include("npm run amdp:demo");
    expect(story).to.not.match(/<script\b/i);
  });
});
