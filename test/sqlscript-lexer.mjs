import {expect} from "chai";
import {lex, LexError, TokenKind} from "../tools/sqlscript/lexer.mjs";

// Stage 1 of the SQLScript front end (docs/sqlscript-parser-style.md).
// What is tested is the list of things that make SQLScript lexically unlike
// ABAP -- because that list is the whole reason this stage exists rather than
// reusing something.
const kinds = (src) => lex(src).map((t) => `${t.kind}:${t.value}`);

describe("the SQLScript lexer", () => {

  it("keeps a host variable whole, colon and all", () => {
    // ABAP reads a colon as the chaining colon, which is how a SQLScript body
    // handed to an ABAP parser comes back split with its colons dropped
    // (abaplint/abaplint#4307). Here it is one token.
    expect(kinds("SELECT * FROM :lt_rows;")).to.deep.equal([
      "identifier:SELECT", "operator:*", "identifier:FROM", "host::lt_rows", "operator:;",
    ]);
  });

  it("tells a quoted identifier from a string, which is the distinction that has cost us twice", () => {
    const t = lex(`SELECT "K" FROM t WHERE v = '{"draft":"kept"}'`);
    const quoted = t.filter((x) => x.kind === TokenKind.quoted).map((x) => x.value);
    const strings = t.filter((x) => x.kind === TokenKind.string).map((x) => x.value);
    expect(quoted, "a name").to.deep.equal(["K"]);
    // the JSON inside single quotes is a value: its double quotes are content,
    // and nothing downstream may fold them
    expect(strings, "a value, whole").to.deep.equal(['{"draft":"kept"}']);
  });

  it("reads a doubled quote as one apostrophe, not as the end of the string", () => {
    expect(lex("SELECT 'it''s' FROM dummy")[1].value).to.equal("it's");
  });

  it("knows a local temporary table by its hash", () => {
    expect(kinds("INSERT INTO #scratch VALUES (1)")).to.include("temp:#scratch");
  });

  it("drops both comment forms, and keeps them when asked", () => {
    const src = "-- a line\nSELECT /* inline */ 1 FROM dummy";
    expect(kinds(src).join(" "), "dropped by default").to.not.contain("comment");
    const kept = lex(src, {comments: true}).filter((t) => t.kind === TokenKind.comment);
    expect(kept.map((t) => t.value)).to.deep.equal(["-- a line", "/* inline */"]);
  });

  it("reads numbers as numbers, including the decimal that started this whole track", () => {
    expect(kinds("SELECT 1/2, -7/2, 0.5, 1e3 FROM dummy").filter((k) => k.startsWith("number")))
      .to.deep.equal(["number:1", "number:2", "number:7", "number:2", "number:0.5", "number:1e3"]);
  });

  it("takes the longer operator when two would fit", () => {
    expect(kinds("a <= b AND c <> d AND e || f"))
      .to.include("operator:<=").and.to.include("operator:<>").and.to.include("operator:||");
  });

  it("says where it gave up, the way the engine does", () => {
    // a refusal that does not name a position is worse than no refusal: this
    // is the standard HANA sets and the one the sandbox already meets
    try {
      lex("SELECT 'unterminated FROM dummy");
      expect.fail("should have refused");
    } catch (error) {
      expect(error).to.be.instanceOf(LexError);
      expect(error.message).to.contain("line 1 col 8");
    }
  });

  it("counts lines and columns through a multi-line body", () => {
    const t = lex("SELECT 1\n  FROM dummy");
    const from = t.find((x) => x.value === "FROM");
    expect({line: from.line, col: from.col}).to.deep.equal({line: 2, col: 3});
  });
});
