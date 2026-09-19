// Our hand-written DDIC against what every real one carries.
//
// Four findings in a row had one shape: a DDIC file that describes enough
// for this runtime and not enough for a system. Our dispatcher reads DD30V
// and DD32P and builds a value provider; it never looks at a parameter's
// data element, so a search help with none worked here and would not
// activate there. The same for a table asking to be buffered without saying
// how.
//
// Both were hand-written files in src/ddic that nothing compared with
// anything -- and the corpus answers each question in a second:
//
//   181 real tables, 33 DD09L blocks, buffering without a type:  0
//   4 real search helps, 8 parameters, without a data element:   0
//
// So the rules below are measured, not chosen, and the suite says so where
// the corpus is absent rather than passing on nothing.
import {expect} from "chai";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const ROOTS = [".local/corpus-sap", ".local/corpus"].filter(existsSync);
const DDIC = "src/ddic";

const walk = (dir, ext, out = []) => {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
};

const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);

describe("our DDIC carries what every real one carries", () => {
  it("a table that allows buffering says which kind", () => {
    // DD09L: BUFALLOW=X turns buffering on, PUFFERUNG says single record,
    // generic or full. X with no type is a state no real table is in, and
    // A4H refuses it: "Buffering activated ... specify buffering type".
    const offenders = [];
    for (const f of walk(DDIC, ".tabl.xml")) {
      for (const b of blocks(readFileSync(f, "utf8"), "DD09L")) {
        if (b.includes("<BUFALLOW>X</BUFALLOW>") && !b.includes("<PUFFERUNG>")) offenders.push(f);
      }
    }
    expect(offenders, `buffering on with no type: ${offenders.join(", ")}`).to.deep.equal([]);
  });

  it("every search help parameter has a data element", () => {
    // A parameter with no ROLLNAME has no type, so "types of search help
    // parameter and selection method field incompatible" follows from
    // "was not assigned a data element" -- two messages, one cause.
    const offenders = [];
    for (const f of walk(DDIC, ".shlp.xml")) {
      for (const b of blocks(readFileSync(f, "utf8"), "DD32P")) {
        if (!b.includes("<ROLLNAME>")) {
          offenders.push(`${f}: ${/<FIELDNAME>([^<]+)</.exec(b)?.[1] ?? "?"}`);
        }
      }
    }
    expect(offenders, `parameters with no data element: ${offenders.join(", ")}`).to.deep.equal([]);
  });

  if (ROOTS.length === 0) {
    it("and the corpus these rules come from is not here", function () { this.skip(); });
    return;
  }

  it("and the corpus still says so, so the rules are not stale", () => {
    let params = 0;
    let withoutElement = 0;
    for (const root of ROOTS) {
      for (const f of walk(root, ".shlp.xml")) {
        for (const b of blocks(readFileSync(f, "utf8"), "DD32P")) {
          params += 1;
          if (!b.includes("<ROLLNAME>")) withoutElement += 1;
        }
      }
    }
    expect(params, "no real search help parameter read: this would pass on nothing")
      .to.be.greaterThan(0);
    expect(withoutElement, "a real search help parameter with no data element -- the rule above is wrong")
      .to.equal(0);
  });
});
