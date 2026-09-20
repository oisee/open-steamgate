// The tool that keeps the queue honest, kept honest.
import {expect} from "chai";
import {alone, contradictions, sentenceAround, withoutNames} from "../tools/osd-queue-check.mjs";

// This tool exists because both sessions found the queue stale twice in one
// day, and it has now been wrong three times itself -- each time by
// believing something about a line rather than checking it. It had no test
// of its own until the third, which is the actual defect: a checker nobody
// checks is the thing it was built to prevent.
describe("tools/osd-queue-check: what a line claims about an issue", () => {
  const ref = (text, number, repo = "abaplint/abaplint") =>
    ({file: "docs/x.md", line: 1, text, number, repo});

  it("a line that calls a merged item open is a contradiction", () => {
    const out = contradictions([ref("abaplint #4311 is still open", 4311)], () => "merged");
    expect(out.map((o) => o.said)).to.deep.equal(["open"]);
  });

  it("**a line may say two things, and each number gets its own sentence**", () => {
    // The defect CI caught on 2026-09-20: "transpiler #1878 still open with
    // no replies. abaplint #4311 and #4312 were merged" is true, and this
    // tool called it a contradiction twice -- because it tested the state
    // word against the whole line, and #4311 was within a line of the word
    // "open" said about a different issue.
    const line = "transpiler #1878 still open with no replies. abaplint #4311 and #4312 were merged by larshp";
    const merged = contradictions([ref(line, 4311), ref(line, 4312)], () => "merged");
    expect(merged, "the merged pair is not called open").to.deep.equal([]);
    // and the one the sentence IS about is still caught
    const open = contradictions([ref(line, 1878, "abaplint/transpiler")], () => "merged");
    expect(open.map((o) => o.said)).to.deep.equal(["open"]);
  });

  it("a reference whose sentence cannot be found falls back to the line", () => {
    // the behaviour this replaced, kept where it is the only option, so the
    // change narrows what is judged rather than dropping judgements
    expect(sentenceAround("no reference here at all", 4311)).to.equal("no reference here at all");
  });

  it("splits on what ends a clause, and not on a version number", () => {
    const line = "released in 2.13.88; abaplint #4311 was merged";
    expect(sentenceAround(line, 4311)).to.equal("abaplint #4311 was merged");
    expect(sentenceAround("shipped in 2.13.88 and #4311 merged", 4311))
      .to.equal("shipped in 2.13.88 and #4311 merged");
  });

  it("a repository name is not a state word", () => {
    // `open-abap-core` contains "open" and a hyphen is a word boundary, so
    // a line naming that repository read as calling its items open. The
    // second thing this tool asserted that was not true.
    expect(withoutNames("open-abap-core #1253 merged")).to.not.contain("open");
  });

  it("knows when a line carries more than one reference", () => {
    expect(alone("#4311 alone")).to.equal(true);
    expect(alone("#4311 and #4312")).to.equal(false);
  });
});
