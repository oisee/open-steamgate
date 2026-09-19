// Every name the lowering calls portable has been measured on the engines.
//
// `PORTABLE` in tools/sqlscript-lower.mjs is a list of functions whose
// **meaning** is the same on all three engines - not a list of functions that
// exist, which is the distinction the corpus run paid for. A name in that
// list that nobody has measured is a claim wider than its evidence, which is
// the defect this project has spent two days finding in other people's
// reasoning and once, here, in its own: twelve of the thirteen names were
// beliefs until the conformance table grew a case for each.
//
// So this suite holds the two together. It does not measure anything itself -
// tools/sqlscript-conformance.mjs does that, and it needs engines - it
// asserts that nothing can be declared portable without a row in the table.
import {readFileSync} from "node:fs";
import {expect} from "chai";

const lowerSource = readFileSync(new URL("../tools/sqlscript-lower.mjs", import.meta.url), "utf8");
const conformanceSource = readFileSync(new URL("../tools/sqlscript-conformance.mjs", import.meta.url), "utf8");

/** the names between `const PORTABLE = new Set([` and `])` */
function portableNames() {
  const at = lowerSource.indexOf("const PORTABLE = new Set([");
  expect(at, "the list must still be findable, or this suite is asserting nothing").to.be.greaterThan(-1);
  const block = lowerSource.slice(at, lowerSource.indexOf("]);", at));
  return [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

describe("nothing is portable without a measurement", () => {
  const names = portableNames();

  it("the list is not empty, or this suite would pass by measuring nothing", () => {
    expect(names.length).to.be.greaterThan(5);
  });

  for (const name of names) {
    it(`${name} has a case in the conformance table`, () => {
      // either its own fn_ case, or it appears in a case's statement - LENGTH
      // is measured by length_padded, which is a better case than a bare one
      const hasCase = conformanceSource.includes(`${name}(`);
      expect(hasCase, `${name} is declared portable and nothing measures it`).to.equal(true);
    });
  }

  it("and a name that is not measured would fail this suite", () => {
    // the guard against the guard: if the check could not fail, it would be
    // as empty as the claim it is meant to police
    const invented = "NOSUCHFUNCTION";
    expect(conformanceSource.includes(`${invented}(`)).to.equal(false);
  });
});
