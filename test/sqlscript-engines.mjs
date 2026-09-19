// One `sqlite` dialect, two SQLite engines: the guard that says when that
// stops being true.
//
// The conformance table had a column called `sqljs` and an argument for why
// the other SQLite was excluded: "the column must describe the engine that
// really executes the code". The argument is right and it only ever covered
// the browser. The deployed showcase runs `STG_DB=file` (test/run.mjs), which
// is tools/sqlite-file-client.mjs over `node:sqlite` -- so the engine left
// out of the table was the one serving users, and the exclusion had the
// reason exactly backwards (Alice, 2026-09-19).
//
// Both are measured now, and on the fixture they agree everywhere but LOG.
// That makes ONE `sqlite` dialect in tools/sqlscript-lower.mjs a measured
// fact rather than an assumption -- and a fact with a date on it, because
// three SQLite versions are in this product at once (3.49.1 in the browser,
// 3.53.4 under Node, 3.53.2 under Bun) and they move independently. This
// suite is what notices the day they part.
import {expect} from "chai";
import {CASES, COLUMNS, measureEngines, agree, normalise, rowsMatchColumns, ddlFor} from "../tools/sqlscript-conformance.mjs";
import {isInvalid} from "../tools/sqlscript-eager.mjs";

describe("the two SQLite builds this product ships", function () {
  this.timeout(60000);
  let engines;
  let builds;

  before(async () => {
    ({engines, builds} = await measureEngines());
  });

  // The "at least one engine" guard let DuckDB be silently absent for eight
  // green tests, so each engine is demanded BY NAME.
  it("both answer, and each says which build it was", () => {
    for (const name of ["sqljs", "sqlite_node"]) {
      expect(engines[name], `${name} did not answer, so this suite measured nothing`).to.be.an("object");
      expect(builds[name], `${name} did not record its build`).to.match(/^sqlite \d+\.\d+\.\d+/);
    }
  });

  // If these ever became the same build the suite would still pass while
  // proving nothing, so the difference itself is asserted.
  it("and they really are different builds, or this compares one engine with itself", () => {
    expect(builds.sqljs).to.not.equal(builds.sqlite_node);
  });

  // The one that keeps the suite honest: a case where they DO differ, so a
  // green run is a measurement and not an empty loop.
  it("differs where a difference is known, which is what makes the silence elsewhere mean something", () => {
    expect(agree(engines.sqljs.fn_log, engines.sqlite_node.fn_log),
      "LOG(10): 1 on the server build, 2.302585092994046 in the browser's").to.equal(false);
  });

  it("agrees everywhere else, which is what one shared dialect rests on", () => {
    const known = new Set(["fn_log"]);
    const parted = CASES
      .filter((one) => !known.has(one.id))
      .filter((one) => normalise(engines.sqljs[one.id]).kind !== "missing")
      .filter((one) => !agree(engines.sqljs[one.id], engines.sqlite_node[one.id]))
      .map((one) => `${one.id}: browser ${JSON.stringify(engines.sqljs[one.id])} vs server ${JSON.stringify(engines.sqlite_node[one.id])}`);
    expect(parted, "the lowering has ONE sqlite dialect for both of these engines. If this " +
      "list is not empty, that dialect is now a claim about two different programs: either " +
      "split the dialect, or add the row to `known` with the measurement that justifies it")
      .to.deep.equal([]);
  });
});

// The fixture is shared by every column, and the column that drifted was the
// one on another machine - so it drifted silently for three sessions.
describe("one fixture, three engines, and the drift that hid on the far side of it", () => {
  it("every fixture row names exactly as many values as there are columns", () => {
    expect(rowsMatchColumns(), "a row and the column list have parted").to.deep.equal([]);
  });

  it("and the check goes red on the drift it was written for", () => {
    // exactly what happened: two columns added for two new cases, and one
    // engine's table left with the old count. It did not fail here - it
    // failed on the INSERT, on another machine, and took the whole HANA
    // column with it.
    const short = "INSERT INTO t VALUES ('r1', 'abc', 1)";
    expect(rowsMatchColumns([short])).to.have.lengthOf(1);
    expect(rowsMatchColumns([short])[0].expected).to.equal(COLUMNS.length);
  });

  it("and all three DDLs name the same columns, because one list writes them", () => {
    // Two text tricks were tried before this and both were wrong about a
    // type rather than a column: commas count differently because
    // `DECIMAL(15,2)` carries one, and a word boundary matches inside a type
    // name. So the DDL is read the way an engine reads it - the outermost
    // parentheses, split at commas that are not nested, first token of each.
    const declared = (sql) => {
      const inner = sql.slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"));
      const parts = [];
      let depth = 0;
      let current = "";
      for (const ch of inner) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
        current += ch;
      }
      parts.push(current);
      return parts.map((one) => one.trim().split(/\s+/)[0].replace(/"/g, "").toLowerCase());
    };
    const wanted = COLUMNS.map((c) => c.name);
    for (const dialect of ["duckdb", "sqlite", "hana"]) {
      expect(declared(ddlFor(dialect)), `${dialect} declares different columns`).to.deep.equal(wanted);
    }
  });
});

// Two paths to one answer need a test that runs both, or they are two answers.
describe("the table and the comparison use ONE definition of a refused statement", () => {
  it("HANA's own refusals are classified as refusals, not as the data being rejected", () => {
    for (const message of ["wrong number of arguments in function invocation: line 1 col 8",
                           "invalid table name: Could not find table/view T in schema OSD",
                           "invalid identifier: NOPE: line 1 col 8"]) {
      expect(isInvalid(message), message).to.equal(true);
      expect(normalise({error: message}).kind, `${message} must not read as a raise`).to.equal("refused");
    }
  });

  it("and a real data error still reads as a raise, on HANA's wording too", () => {
    for (const message of ["division by zero undefined: SQL Error",
                           "Conversion Error: Could not convert string 'oops' to INT32"]) {
      expect(isInvalid(message), message).to.equal(false);
      expect(normalise({error: message}).kind).to.equal("raised");
    }
  });
});
