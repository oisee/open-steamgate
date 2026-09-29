import {expect} from "chai";
import {parseHttpCases} from "../tools/osd-http-case.mjs";

describe("bounded .http case parser", () => {
  it("reads blocks, comments, annotations, variables, headers and an opaque body", () => {
    const first = ["11111111", "1111", "4111", "8111", "111111111111"].join("-");
    const second = ["22222222", "2222", "4222", "8222", "222222222222"].join("-");
    const cases = parseHttpCases([
      "@base = http://local", "### first", "# @name named", "# @osd.id one",
      "// @osd.kind read", "# @osd.clock 2026-09-21T10:00:00.000Z",
      "# @osd.uuid " + first,
      "# @osd.uuid " + second,
      "POST {{base}}/x HTTP/1.1", "X-Test: {{base}}", "", "body {{base}}", "### second",
      "# comment", "# @name second", "GET /y", "Accept: application/json",
    ].join("\n"));
    expect(cases).to.have.length(2);
    expect(cases[0]).to.include({id: "one", method: "POST", url: "http://local/x", body: "body http://local"});
    expect(cases[0].headers["x-test"]).to.equal("http://local");
    expect(cases[0].annotations.uuid).to.deep.equal([first, second]);
    expect(cases[1].id).to.equal("second");
  });
  it("preserves leading and repeated blank body lines", () => {
    const source = "# @name blanks\nPOST /x\nContent-Type: text/plain\n\n\n\nfirst\n\n\nlast";
    expect(parseHttpCases(source)[0].body).to.equal("\n\nfirst\n\n\nlast");
  });
  for (const [title, source, match] of [
    ["unknown annotation", "# @osd.typo x\nGET /x", /unknown @osd.typo/],
    ["missing annotation value", "# @osd.clock\nGET /x", /missing @osd.clock/],
    ["unresolved URL variable", "GET {{absent}}/x", /unresolved variable/],
    ["unresolved header variable", "GET /x\nA: {{absent}}", /unresolved variable/],
    ["unresolved body variable", "GET /x\n\n{{absent}}", /unresolved variable/],
    ["duplicate id", "# @osd.id same\nGET /x\n###\n# @osd.id same\nGET /y", /duplicate case id/],
    ["unsupported request syntax", "PATCH", /unsupported syntax/],
    ["unsupported stray line", "hello world", /unsupported syntax/],
    ["unsupported annotation", "# @other x\nGET /x", /unsupported annotation/],
    ["malformed header", "GET /x\nHeader", /expected header/],
    ["annotation without request", "# @osd.id x", /annotations without a request/],
    ["empty file", "# comment", /no requests/],
  ]) {
    it("rejects " + title, () => expect(() => parseHttpCases(source)).to.throw(match));
  }
});
