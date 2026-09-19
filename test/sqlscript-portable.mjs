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

/** **The cases, not the whole file.**
 *
 *  The check used to read the file, and the file also contains the harness's
 *  own dialect rewrites -- one of them is `.replace(/GROUP_CONCAT\(/g,
 *  "STRING_AGG(")`. So `STRING_AGG` passed this suite the moment it was
 *  added to the lowering, on the strength of a line of translation code that
 *  measures nothing. A guard that can pass for the wrong reason is the thing
 *  it was written to catch, one level up. */
const casesBlock = (() => {
  const at = conformanceSource.indexOf("const CASES = [");
  expect(at, "the case list must still be findable").to.be.greaterThan(-1);
  return conformanceSource.slice(at, conformanceSource.indexOf("\n];", at));
})();

/** the names in one `new Set([...])` in the lowering */
function namesIn(listName) {
  const at = lowerSource.indexOf(`const ${listName} = new Set([`);
  expect(at, `${listName} must still be findable, or this suite is asserting nothing`).to.be.greaterThan(-1);
  const block = lowerSource.slice(at, lowerSource.indexOf("]);", at));
  return [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

/** Every name the lowering **renders**, not only those it calls portable.
 *
 *  `AGGREGATES` was added after this suite and would have escaped it: a
 *  second list is a second claim, and a guard that knows about one list only
 *  is a guard that goes quiet the moment somebody adds the next one. The
 *  fix is to read every list the lowering renders from, and this comment is
 *  the note to the next person adding a third. */
function portableNames() {
  return [...new Set([...namesIn("PORTABLE"), ...namesIn("AGGREGATES")])];
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
      // One function under two names: the table writes GROUP_CONCAT and the
      // harness rewrites it to STRING_AGG for the engines that spell it so,
      // which is how one case measures both. Written as data rather than as
      // a clever lookup, because the next alias should be an entry here and
      // not another rule.
      const ALIASES = {STRING_AGG: "GROUP_CONCAT", GROUP_CONCAT: "GROUP_CONCAT"};
      const spelt = ALIASES[name] ?? name;
      const hasCase = casesBlock.includes(`${spelt}(`);
      expect(hasCase, `${name} is declared portable and nothing measures it`).to.equal(true);
    });
  }

  it("and a name that is not measured would fail this suite", () => {
    // the guard against the guard: if the check could not fail, it would be
    // as empty as the claim it is meant to police
    const invented = "NOSUCHFUNCTION";
    expect(casesBlock.includes(`${invented}(`)).to.equal(false);
  });
});
