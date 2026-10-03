import assert from "node:assert/strict";
import {SQLiteDatabaseClient} from "../tools/sqlite-heap-client.mjs";
import {installTrim} from "../tools/sql-literals.mjs";

describe("sql.js setup SQL uses the heap", function () {
  this.timeout(10000);
  let db, previous;
  beforeEach(async () => {
    previous = globalThis.abap;
    globalThis.abap ??= {Classes: {}, context: {databaseConnections: {}}};
    db = installTrim(new SQLiteDatabaseClient());
    await db.connect();
  });
  afterEach(async () => {
    try { await db.disconnect(); }
    finally { globalThis.abap = previous; }
  });

  it("loads a source INSERT larger than the WASM stack and preserves its contents", async () => {
    const source = "a; 'quoted'\n\u03bb".repeat(450000);
    assert.ok(new TextEncoder().encode(source).length > 6 * 1024 * 1024);
    await db.execute([
      'CREATE TABLE reposrc (source TEXT);',
      `INSERT INTO reposrc (source) VALUES ('${source.replaceAll("'", "''")}');`,
    ]);
    const {rows} = await db.select({select: 'SELECT source FROM reposrc'});
    assert.equal(rows[0].source, source);
    await db.execute('INSERT INTO reposrc (source) VALUES (\'after\');');
    assert.equal((await db.select({select: 'SELECT COUNT(*) AS n FROM reposrc'})).rows[0].n, 2);
  });

  it("keeps multiple statements, array order, empty SQL and errors", async () => {
    await db.execute("");
    await db.execute(['CREATE TABLE ordered (n INTEGER); INSERT INTO ordered VALUES (1);',
      'UPDATE ordered SET n = n + 1;']);
    assert.equal((await db.select({select: 'SELECT n FROM ordered'})).rows[0].n, 2);
    await assert.rejects(db.execute(['INSERT INTO ordered VALUES (3);', 'INVALID SQL;',
      'INSERT INTO ordered VALUES (4);']));
    assert.deepEqual((await db.select({select: 'SELECT n FROM ordered ORDER BY n'})).rows.map(r => r.n), [2, 3]);
    await db.execute("INSERT INTO ordered VALUES (5);");
  });
});
