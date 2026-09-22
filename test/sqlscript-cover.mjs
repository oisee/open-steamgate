// The grammar against the binder, and the two refusals the allowance list
// claims without being able to show.
//
// `tools/sqlscript/grammar-cover.mjs` compares two sets of node names read
// out of the source. That catches the shape it was built for -- a construct
// nobody decided about, which the expression fallback unwraps instead of
// refusing -- and it cannot see a refusal that happens through a `default`
// branch, because no literal in the source names it. Two entries of
// `NOT_NAMED` rest on exactly that, so they are pinned by running the
// constructs rather than by the sentence beside them.
//
// The defect this came out of, measured 2026-09-20: `FROM my_func(:p)`
// parsed into a `TableFunctionCall`, a name the binder mentioned nowhere,
// and lowered to `FROM "MY_FUNC"` -- the call read as a table, its argument
// dropped, no refusal and no warning.
import {expect} from "chai";
import {cover, grammarNames, binderNames, NOT_NAMED} from "../tools/sqlscript/grammar-cover.mjs";
import {compile, CATALOGUE} from "../tools/sqlscript/end-to-end.mjs";

const refusal = (body) => {
  try {
    compile(body, "sqlite", CATALOGUE);
    return undefined;
  } catch (error) {
    return error.message;
  }
};

describe("every construct the grammar parses has been decided about", () => {
  it("reads both sides, and says so rather than passing when it cannot", () => {
    // the rule the leak scan had to learn: reading nothing is not a pass
    expect(grammarNames().size, "grammar classes").to.be.greaterThan(20);
    expect(binderNames().size, "names the binder dispatches on").to.be.greaterThan(20);
  });

  it("leaves nothing for the unwrapping fallback to swallow", () => {
    const {undecided} = cover();
    expect(undecided, `parsed and never decided about: ${undecided.join(", ")}`).to.deep.equal([]);
  });

  it("complains in the other direction too: a dispatch nothing can reach", () => {
    const {unreachable, stale} = cover();
    expect(unreachable, `dispatched on, unproducible: ${unreachable.join(", ")}`).to.deep.equal([]);
    expect(stale, `allowed as unnamed, no longer a class: ${stale.join(", ")}`).to.deep.equal([]);
  });

  it("finds a construct the binder does not name", () => {
    // the check itself, against a grammar it has never seen: a name in one
    // set and not the other is the whole mechanism, and a checker that
    // cannot go red on a made-up input measures nothing
    const found = cover(new Set(["Select", "Somethingnew"]), new Set(["Select"]), {});
    expect(found.undecided).to.deep.equal(["Somethingnew"]);
    expect(cover(new Set(["Select"]), new Set(["Select", "Ghost"]), {}).unreachable).to.deep.equal(["Ghost"]);
    expect(cover(new Set(["Select"]), new Set(["Select"]), {Gone: "a reason"}).stale).to.deep.equal(["Gone"]);
  });
});

describe("what the binder refuses, it refuses by name", () => {
  it("a table function call in FROM, which used to become a table read", () => {
    // Before: `SELECT "K" AS "K" FROM "MY_FUNC"`, the argument gone. The
    // body would have run against a table of that name if one existed.
    const message = refusal("lt = SELECT k, n FROM my_func(:p);\nRETURN :lt;");
    expect(message, "it is refused at all").to.be.a("string");
    expect(message).to.contain("table function call");
    // and the ordinary FROM still works, or the refusal is too wide
    expect(refusal("lt = SELECT k, n FROM src;\nRETURN :lt;"), "a plain table still binds").to.equal(undefined);
  });

  it("DECLARE and IF are refused until their procedural lowering owns them", () => {
    // The allowance says so and the source cannot show it, so it is run.
    for (const [construct, body] of [
      ["Declare", "DECLARE x INT;\nlt = SELECT k, n FROM src;\nRETURN :lt;"],
      ["If", "IF 1 = 1 THEN\n  lt = SELECT k, n FROM src;\nEND IF;\nRETURN :lt;"],
    ]) {
      expect(NOT_NAMED[construct], `${construct} is on the allowance list`).to.be.a("string");
      const message = refusal(body);
      expect(message, `${construct} is refused`).to.be.a("string");
      expect(message, `${construct} is refused BY NAME`).to.contain(construct);
    }
  });

  it("WHILE is refused explicitly by the relational binder", () => {
    const message = refusal("WHILE 1 = 1 DO\n  lt = SELECT k, n FROM src;\nEND WHILE;\nRETURN :lt;");
    expect(message).to.contain("While").and.to.contain("procedural IR");
  });
});
