// Merging one-row INSERTs, and the one claim that matters: the rows that end
// up in the database are the same ones.
//
// The seed learnt this first (test/seed.mjs, e088c4d). This is the same
// trick on the statements the TRANSPILER hands `setup()` -- the object
// directory and the sources, which arrive one row at a time and interleaved.
// Measured over a real `npm run unit`, with the seed fix already in:
//
//   6793 statements, 1563 ms   before either
//   4315 statements,  976 ms   after the seed was batched
//   1711 statements,  441 ms   after this
//
// Every other test here guards a way of getting that wrong.
import {expect} from "chai";
import {batchInserts} from "../tools/osd-batch-inserts.mjs";

describe("merging inserts keeps the database the same", () => {
  // The claim, checked against real engines rather than against the text:
  // one database gets the statements as written, another gets them merged,
  // and the tables must agree.
  it("the same rows arrive, on a real engine, in the same order per table", async function () {
    this.timeout(30000);
    const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
    const ddl = [`CREATE TABLE a (x INTEGER, s VARCHAR)`, `CREATE TABLE b (y VARCHAR)`];
    const written = [
      `INSERT INTO a (x, s) VALUES (1, 'one');`,
      `INSERT INTO b (y) VALUES ('first');`,
      `INSERT INTO a (x, s) VALUES (2, 'two, with a comma');`,
      `INSERT INTO b (y) VALUES ('second');`,
      `INSERT INTO a (x, s) VALUES (3, 'three (with a bracket)');`,
    ];
    const read = async (statements) => {
      const client = new DuckDBDatabaseClient({path: ":memory:"});
      await client.connect();
      try {
        for (const one of [...ddl, ...statements]) await client.native({sql: one, expect: "none"});
        const a = await client.native({sql: "SELECT x, s FROM a ORDER BY x"});
        const b = await client.native({sql: "SELECT y FROM b ORDER BY y"});
        return {a: a.rows, b: b.rows};
      } finally {
        await client.disconnect?.();
      }
    };
    const plain = await read(written);
    const merged = await read(batchInserts(written));
    expect(merged, JSON.stringify({plain, merged})).to.deep.equal(plain);
    expect(batchInserts(written), "and it really did merge, or this proved nothing")
      .to.have.lengthOf(2);
  });
});

describe("what it will not do, which is where a batcher goes wrong", () => {
  it("a statement it cannot read passes through unchanged AND in place", () => {
    const given = [`INSERT INTO a (x) VALUES (1);`, `CREATE INDEX i ON a (x);`, `INSERT INTO a (x) VALUES (2);`];
    const out = batchInserts(given);
    // a batcher that dropped what it could not read would be silent data
    // loss, which is worse than the cost it saves
    expect(out[1]).to.equal(`CREATE INDEX i ON a (x);`);
    expect(out).to.have.lengthOf(3);
  });

  it("anything that is not an INSERT is a barrier, because it may depend on what came before", () => {
    const given = [
      `INSERT INTO a (x) VALUES (1);`,
      `DELETE FROM a;`,
      `INSERT INTO a (x) VALUES (2);`,
    ];
    const out = batchInserts(given);
    expect(out.map((s) => s.slice(0, 11))).to.deep.equal(["INSERT INTO", "DELETE FROM", "INSERT INTO"]);
    expect(out[0], "the first row must be inserted BEFORE the delete, not merged past it").to.contain("(1)");
  });

  it("two shapes are never merged into one, however alike they look", () => {
    const given = [`INSERT INTO a (x) VALUES (1);`, `INSERT INTO a (x, y) VALUES (2, 3);`];
    expect(batchInserts(given)).to.have.lengthOf(2);
  });

  // The defect the seed's own test had, one level along: splitting a
  // five-column row on commas finds seven parts when a value contains one.
  it("never looks inside the values, so a comma or a bracket in a string is safe", () => {
    const given = [
      `INSERT INTO a (s) VALUES ('one, two');`,
      `INSERT INTO a (s) VALUES ('three) four');`,
    ];
    const out = batchInserts(given);
    expect(out).to.have.lengthOf(1);
    expect(out[0]).to.contain(`('one, two'), ('three) four')`);
  });

  it("order within one shape is kept, which is what a unique key could depend on", () => {
    const given = [1, 2, 3, 4].map((n) => `INSERT INTO a (x) VALUES (${n});`);
    expect(batchInserts(given)[0]).to.equal(`INSERT INTO a (x) VALUES (1), (2), (3), (4);`);
  });

  it("a very long run becomes several statements rather than one enormous one", () => {
    const given = Array.from({length: 450}, (_, n) => `INSERT INTO a (x) VALUES (${n});`);
    const out = batchInserts(given, {rows: 200});
    expect(out).to.have.lengthOf(3);
    expect(out.join("").match(/VALUES/g)).to.have.lengthOf(3);
  });

  it("every statement ends in a semicolon, including one that was alone", () => {
    for (const one of batchInserts([`INSERT INTO a (x) VALUES (1)`, `INSERT INTO b (y) VALUES (2);`])) {
      expect(one.endsWith(";"), one).to.equal(true);
    }
  });
});
