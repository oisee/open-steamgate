// The sXML reader contract's fixtures (test/fixtures/sxml-contract/cases.json)
// and the three ABAP files generated from them. The contract itself runs as
// ABAP Unit (test/unit/zcl_osd_sxml_contract_test, zcl_osd_sxml_recorder_test);
// this checks what only the host can: the generated files are current and the
// A4H recorder is a snippet execute_abap takes.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {CASES, RECORDER, bytesOf, loadCases, outputs, parseReport, recorder, validate} from "../tools/osd-sxml-contract.mjs";

describe("sXML contract fixtures", function () {
  const cases = loadCases();

  it("every fixture is well formed: a name, a known status, expected events in the normal form", function () {
    expect(validate(cases)).to.deep.equal([]);
    expect(cases.fixtures.length).to.be.at.least(50);
  });

  it("the generated ABAP is current (node tools/osd-sxml-contract.mjs)", function () {
    for (const [path, content] of Object.entries(outputs(cases))) {
      expect(readFileSync(path, "utf8"), path).to.equal(content);
    }
  });

  it("the cases file and the recorder are 7-bit ASCII, the recorder's lines fit ABAP's 255", function () {
    expect(/^[\x00-\x7f]*$/.test(readFileSync(CASES, "utf8"))).to.equal(true);
    const text = readFileSync(RECORDER, "utf8");
    expect(/^[\x00-\x7f]*$/.test(text)).to.equal(true);
    for (const line of text.split("\n")) expect(line.length, line.slice(0, 40)).to.be.at.most(255);
    expect(text.trimEnd().endsWith("cl_abap_unit_assert=>fail( msg = lv_out ).")).to.equal(true);
  });

  it("a recorder for a subset carries only that subset", function () {
    const text = recorder(cases, ["xml_simple", "utf8_overlong"]);
    expect(text).to.include("`xml_simple`").and.to.include("`utf8_overlong`");
    expect(text).not.to.include("`xml_bom`");
    expect(() => recorder(cases, ["no_such_fixture"])).to.throw(/no fixture/);
  });

  it("input parts: strings are UTF-8, hex parts are raw", function () {
    const overlong = cases.fixtures.find((f) => f.name === "utf8_overlong");
    expect(bytesOf(overlong).toString("hex")).to.equal("3c613ec0af613c2f613e");
    const astral = cases.fixtures.find((f) => f.name === "xml_astral_text");
    expect(bytesOf(astral).toString("hex")).to.equal("3c613ef09f98803c2f613e");
  });

  it("a recorder report reads back per fixture, and a cut report is refused", function () {
    const got = parseReport("noise SXML<<@a|OPEN \"a\" \"\"|FINAL|@b|ERROR CX_SXML_PARSE_ERROR 6>>SXML noise");
    expect([...got.keys()]).to.deep.equal(["a", "b"]);
    expect(got.get("a")).to.deep.equal(["OPEN \"a\" \"\"", "FINAL"]);
    expect(() => parseReport("SXML<<@a|FINAL")).to.throw(/end marker/);
  });
});
