// The audit that replaces asking one clause at a time.
//
// Five clauses were being read by the grammar and thrown away by the binder
// on 2026-09-19, and every one was found by a person writing a body and
// looking at the SQL. That method found the first three and missed the last
// two for a day, so it is mechanical now: three invariants that need no
// expectation written per clause, plus two that catch the shapes the first
// three cannot see.
//
// Each invariant was verified the only way that means anything -- by undoing
// the fix it stands for and watching the audit name it:
//
//   GROUP BY dropped   -> "silently dropped"
//   DISTINCT as a name -> "a keyword became an identifier"
//   HAVING as WHERE    -> "one clause read as another"
//   EXCEPT as UNION    -> "two answers, one statement"
//   s.k as "S"         -> "column lost"
import {expect} from "chai";
import {audit, sqlOf, keywordsTakenAsNames, missingColumns} from "../tools/sqlscript/clause-audit.mjs";

describe("the binder carries what the grammar reads, or refuses it by name", () => {
  it("no clause is read and then thrown away", () => {
    const findings = audit();
    expect(findings.map((f) => `${f.kind}: ${f.clause} -- ${f.why}`), "each of these is a body that would " +
      "lower and compute something else").to.deep.equal([]);
  });

  // The audit passing means nothing unless its parts can fail, and the two
  // that are pure functions are checked in both directions here.
  // **The narrowing that a real corpus paid for.**
  //
  // The first version asked "does the output contain a keyword as an
  // identifier?" and, run over 78 corpus bodies, fired once -- on
  // `cl_islm_ml_engine_int_util`, which projects a column genuinely NAMED
  // ORDER. `"ORDER" AS "IS_ORDER"` is correct SQL over a correct plan, and
  // SAP tables are full of such names: ORDER, VALUE, CLIENT, KEY. The check
  // would have cried wolf on hundreds of good bodies, and a check that cries
  // wolf stops being read -- which is in CLAUDE.md from the first week.
  //
  // What separates a column called ORDER from a leaked keyword is not the
  // statement, it is what the SOURCE said. So the question is asked from the
  // source end (osg-osd-i7 measured it and proposed the rule).
  it("a keyword read as a name is caught, from the source end", () => {
    expect(keywordsTakenAsNames('SELECT "DISTINCT" AS "K" FROM "SRC"', "RETURN SELECT DISTINCT k FROM src;"))
      .to.deep.equal(["DISTINCT"]);
  });

  it("and a column genuinely NAMED after a keyword is not a finding", () => {
    expect(keywordsTakenAsNames('SELECT "ORDER" AS "IS_ORDER", "ORDER" AS "MV_ORDER" FROM "T"',
      "RETURN SELECT order AS is_order, order AS mv_order FROM t;"),
    "the corpus body that found this: a column called ORDER is not a leaked ORDER BY").to.deep.equal([]);
  });

  it("nor is a keyword that stood in the source AND came out as itself", () => {
    expect(keywordsTakenAsNames('SELECT "ORDER" AS "O" FROM "T" ORDER BY "O" ASC',
      "RETURN SELECT order AS o FROM t ORDER BY o;"),
    "both at once: an ORDER BY that survived, beside a column of that name").to.deep.equal([]);
  });

  it("and with no source it refuses, rather than answering a question measured to be wrong", () => {
    // the wide question fires on every column SAP named ORDER, VALUE or
    // CLIENT. Keeping it as a fallback would put those findings back the
    // first time somebody called this with one argument.
    expect(() => keywordsTakenAsNames('SELECT "ORDER" AS "O" FROM "T"'))
      .to.throw(/the source body is required/);
  });

  it("a column the body named and the statement does not is caught", () => {
    expect(missingColumns('SELECT "S" AS "S" FROM "SRC"', ["K"])).to.deep.equal(["K"]);
    expect(missingColumns('SELECT "K" AS "K" FROM "SRC"', ["K"])).to.deep.equal([]);
  });

  // A refusal passes the audit on purpose: not carrying a clause is fine,
  // not SAYING so is not. Both halves of that are pinned here, and the LIST
  // moves as the IR grows -- GROUP BY and DISTINCT were refusals this
  // morning and are carried by lunchtime, which is the right direction and
  // is exactly why the audit above is written to need no such list.
  it("a clause the IR carries lowers with the clause visible in the statement", () => {
    for (const [body, must] of [["RETURN SELECT a FROM src GROUP BY a;", /GROUP BY/],
                                ["RETURN SELECT DISTINCT k FROM src;", /SELECT DISTINCT/]]) {
      const answer = sqlOf(body);
      expect(answer.refused, `${body} is carried now, so it must lower`).to.equal(undefined);
      expect(answer.sql, `${body} must show the clause it was given`).to.match(must);
    }
  });

  it("and a clause the IR does not carry refuses by name rather than lowering to something else", () => {
    for (const body of ["RETURN SELECT k FROM src EXCEPT SELECT k FROM other;",
                        "RETURN SELECT k FROM src INTERSECT SELECT k FROM other;"]) {
      const answer = sqlOf(body);
      expect(answer.sql, `${body} must not lower as a UNION`).to.equal(undefined);
      expect(answer.refused, `${body} must refuse by name`).to.be.a("string");
    }
  });

  it("and an ordinary body still lowers, so the refusals are narrow", () => {
    expect(sqlOf("RETURN SELECT k FROM src WHERE a > 1;").sql).to.contain('FROM "SRC"');
  });
});
