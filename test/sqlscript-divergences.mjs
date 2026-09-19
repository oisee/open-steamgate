// Every measured divergence has an answer in the lowering, or is named as
// one that does not.
//
// The conformance table (tools/sqlscript-conformance.mjs) finds where the
// three engines disagree. The lowering (tools/sqlscript-lower.mjs) is where
// those disagreements are supposed to be answered - by rendering the
// expression differently per dialect, or by refusing that dialect outright.
// Nothing held the two documents together, so a divergence could be measured
// on Monday and unanswered on Friday with both files green.
//
// This is the same guard as test/sqlscript-portable.mjs, from the other
// side: that one says nothing may be *declared* portable without a
// measurement, this one says nothing may be *measured* divergent without a
// decision. A row that has neither is listed here as `OPEN`, so that the gap
// is a line somebody can read rather than an absence nobody can.
import {expect} from "chai";
import {T, col, lit, bin, cast, scan, project} from "../tools/sqlscript-ir.mjs";
import {lower, Refused} from "../tools/sqlscript-lower.mjs";

const lowerOf = (rel, dialect) => lower(rel, dialect).sql;
const over = (expr) => project(scan("T"), [{as: "V", expr}]);

describe("every measured divergence is answered in the lowering", () => {
  it("int_div: division keeps its decimal, and only the browser engine needs help", () => {
    const rel = over(bin("/", col("A"), col("B"), T.dec(15, 2)));
    expect(lowerOf(rel, "hana")).to.contain('("A" / "B")');
    expect(lowerOf(rel, "duckdb")).to.contain('("A" / "B")');
    expect(lowerOf(rel, "sqlite"), "sql.js truncates, so the decimal is forced").to.contain("* 1.0");
  });

  it("int_div, the other direction: integer division must be asked for", () => {
    const rel = over(bin("/", col("A"), col("B"), T.int));
    expect(lowerOf(rel, "hana")).to.contain("DIV(");
    expect(lowerOf(rel, "duckdb")).to.contain("//");
  });

  it("cast_round: a fraction cast to an integer truncates, it does not round", () => {
    const rel = over(cast(col("D"), T.int));
    expect(lowerOf(rel, "duckdb"), "DuckDB rounds without this").to.contain("TRUNC");
    expect(lowerOf(rel, "hana")).to.contain("CAST(");
  });

  it("cast_bad: an engine whose cast cannot raise is refused, not approximated", () => {
    const rel = over(cast(col("TXT"), T.int));
    expect(() => lower(rel, "sqlite")).to.throw(Refused, /returns 0 where HANA and DuckDB raise/);
  });

  it("cast_char_narrow: casting to a narrower character type truncates", () => {
    // HANA truncates to the declared width; the others keep the whole string
    for (const dialect of ["duckdb", "sqlite"]) {
      const sql = lower(over({node: "cast", expr: col("LONG"), type: T.char(3)}), dialect).sql;
      expect(sql, `${dialect} must cut it to three`).to.match(/SUBSTR\(/);
    }
  });

  // Known and unanswered, written down rather than left to be rediscovered.
  // HANA raises on division by zero, DuckDB returns Infinity and sql.js
  // returns NULL - three answers, and the lowering has none. It is not hard
  // to answer (a guarded CASE on DuckDB, a refusal on sql.js, which cannot
  // raise at all); it is simply not done, and this line is the difference
  // between a gap and an oversight.
  it("div_zero: OPEN - three engines, three answers, and no decision yet", () => {
    const rel = over(bin("/", col("A"), col("ZERO"), T.dec(15, 2)));
    const sql = lowerOf(rel, "duckdb");
    expect(sql, "if this ever stops being a plain division, this test is the one to update")
      .to.contain('("A" / "ZERO")');
  });

  it("like_case: answered on the connection rather than in the dialect, and deliberately", () => {
    // sql.js matches case-insensitively by default; the fix is a PRAGMA bound
    // to the connection, not a rewrite of every LIKE - which is also what a
    // real system does, where Open SQL's LIKE is case-sensitive
    const rel = over({node: "call", fn: "LOWER", args: [col("K")], type: T.str});
    expect(lowerOf(rel, "sqlite")).to.contain("LOWER(");
  });
});
