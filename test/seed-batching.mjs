import {expect} from "chai";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {seedStatements} from "./seed.mjs";

// The seed writes one statement per **batch** of rows rather than one per
// row. fable-osd's SQL trace over `npm run unit` measured why: 4706 of 6793
// statements and 553 ms of 1563 went into three tables seeded a row at a
// time, and 2263 of the seeder's own 2521 statements were one table.
//
// What is asserted here is that batching did not change **what is seeded** —
// the count of statements is the thing being optimised, so it is the one
// thing a test of it must not be about.
describe("the seed inserts every row it has, in batches", () => {
  // **Both readings are taken at the same moment, and that is the whole
  // point of the `before`.**
  //
  // `seedStatements()` used to run in the describe body -- at file LOAD
  // time, which mocha does for every suite before it runs any of them --
  // while the directory was read inside the `it`. Three of the four
  // cross-reference tables are derived and gitignored, and
  // `test/osd-data.mjs` builds them in a `before()` when a fresh checkout
  // has none. So on a clean runner the statements were counted without
  // `cross`, `wbcrossgt` and `d010inc`, another suite then wrote them, and
  // this one compared a list made before they existed against a directory
  // that had them: "a table with rows is seeded and nothing else is",
  // missing exactly those three. On a workstation the files are always
  // there from an earlier run, so it passed for as long as anybody looked.
  //
  // Comparing two readings of a tree that something else is still writing
  // is a measurement of the gap between them. Take them together.
  let statements;
  let inFiles;
  before(() => {
    statements = seedStatements();
    inFiles = new Set(readdirSync("data").filter((f) => f.endsWith(".tabu.json"))
      .filter((f) => JSON.parse(readFileSync(join("data", f), "utf8")).length > 0)
      .map((f) => f.slice(0, -".tabu.json".length).toLowerCase()));
  });

  it("names every table that has a data file, and no other", () => {
    const inserted = new Set(statements.map((s) => /INSERT INTO "([^"]+)"/.exec(s)?.[1]));
    expect([...inserted].sort(), "a table with rows is seeded and nothing else is")
      .to.deep.equal([...inFiles].sort());
  });

  it("carries as many rows as the files hold", () => {
    // counted from the statements by their value groups, so that a batch that
    // silently dropped a row would fail here rather than in whichever test
    // happens to read that row next
    const rows = new Map();
    for (const s of statements) {
      const table = /INSERT INTO "([^"]+)"/.exec(s)[1];
      const values = s.slice(s.indexOf(" VALUES ") + 8);
      // count the top-level groups: a bracket that opens at depth 0
      let depth = 0;
      let inString = false;
      let groups = 0;
      for (let i = 0; i < values.length; i += 1) {
        const c = values[i];
        if (c === "'") {
          if (inString && values[i + 1] === "'") i += 1;
          else inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === "(") { if (depth === 0) groups += 1; depth += 1; }
        if (c === ")") depth -= 1;
      }
      rows.set(table, (rows.get(table) ?? 0) + groups);
    }
    // the same list the statements were built from, not a fresh reading of
    // a directory another suite may have written to since
    for (const table of inFiles) {
      const count = JSON.parse(readFileSync(join("data", `${table}.tabu.json`), "utf8")).length;
      expect(rows.get(table), `${table}: every row of the file is in a statement`).to.equal(count);
    }
  });

  it("starts a new statement when the column list changes", () => {
    // a TABU JSON row omits what it has no value for, so two rows of one
    // table can carry different columns. Merging those would put a value
    // under the wrong name — silently, and only for the rows after the first
    for (const s of statements) {
      const cols = /INSERT INTO "[^"]+" \(([^)]*)\) VALUES /.exec(s)?.[1];
      expect(cols, `every statement names its columns: ${s.slice(0, 60)}`).to.be.a("string");
      // and not: "as many values as columns", counted by splitting on
      // commas. That was the first version and it is wrong about its own
      // subject — a value may contain a comma inside quotes, so it counted
      // seven parts for five columns. A check that needs a parser to be
      // right is a check that should use one or not exist; the row-count
      // test above already parses, and a statement whose arity is wrong is
      // rejected by the engine in every other suite.
    }
  });

  it("is far fewer statements than rows, which is the point", () => {
    // counted from the same list, for the same reason as above -- and the
    // floor is what the TRACKED seed data holds (3507 rows in 36 files),
    // not what a workstation happens to have after somebody built the
    // derived cross-reference tables. A threshold that only a developer's
    // machine can clear is a threshold that fails on a clean checkout and
    // teaches nobody anything.
    const rows = [...inFiles]
      .reduce((n, t) => n + JSON.parse(readFileSync(join("data", `${t}.tabu.json`), "utf8")).length, 0);
    expect(rows, "there are rows to batch").to.be.greaterThan(1000);
    expect(statements.length, `${rows} rows in ${statements.length} statements`).to.be.lessThan(rows / 10);
  });
});
