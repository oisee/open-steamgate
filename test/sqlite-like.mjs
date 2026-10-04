import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import runtime from '@abaplint/runtime';
import {Transpiler} from '@abaplint/transpiler';
import {setupSqliteConnection} from '../tools/sqlite-connection.mjs';
import {DatabaseSync} from 'node:sqlite';
import {installNative} from '../tools/sqljs-native.mjs';
import {SQLiteDatabaseClient} from '../tools/sqlite-heap-client.mjs';
import {FileSqliteClient} from '../tools/sqlite-file-client.mjs';
import {DuckDBDatabaseClient} from '../tools/duckdb-client.mjs';
import {OsdPostgresClient} from '../tools/postgres-client.mjs';

const cases = [
  ["'A' LIKE 'a'", 0], ["'A' LIKE 'A'", 1], ["'abc' LIKE 'a%'", 1],
  ["'abc' LIKE 'a_c'", 1], ["'a%c' LIKE 'a!%c' ESCAPE '!'", 1],
  ["'a_c' LIKE 'a!_c' ESCAPE '!'", 1], ["'a!c' LIKE 'a!!c' ESCAPE '!'", 1],
  ["'abc' NOT LIKE 'A%'", 1], ["NULL LIKE 'a%'", null],
  ["'λ😀' LIKE 'λ_'", 1], ["'a\nc' LIKE 'a_c'", 1],
  ["'abc' LIKE '%b%'", 1], ["'abc' LIKE 'abc%'", 1],
  ["'abc' LIKE 'ab'", 0],
];

describe('case-sensitive Open SQL LIKE across backends', function () {
  this.timeout(30000);
  let previous, root, code;
  before(async () => {
    previous = globalThis.abap;
    root = mkdtempSync('.local/like-test-');
    const table = `<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values>
      <DD02V><TABNAME>ZLIKE</TABNAME><TABCLASS>TRANSP</TABCLASS></DD02V>
      <DD03P_TABLE><DD03P><FIELDNAME>CARRID</FIELDNAME><KEYFLAG>X</KEYFLAG><INTTYPE>C</INTTYPE><DATATYPE>CHAR</DATATYPE><LENG>000003</LENG></DD03P></DD03P_TABLE>
      </asx:values></asx:abap></abapGit>`;
    const output = await new Transpiler({ignoreSyntaxCheck:true}).runRaw([
      {filename:'zlike.tabl.xml',contents:table},
      {filename:'zlike.prog.abap',contents:`REPORT zlike.
        DATA n TYPE i.
        SELECT COUNT( * ) FROM zlike INTO n WHERE carrid LIKE 'l%'.
        ASSERT n = 0.
        SELECT COUNT( * ) FROM zlike INTO n WHERE carrid LIKE 'L%'.
        ASSERT n = 32.`},
    ]);
    code = output.objects.find(o => o.filename === 'zlike.prog.mjs').chunk.getCode();
  });
  after(() => { globalThis.abap = previous; if (root) rmSync(root,{recursive:true,force:true}); });
  it('raw sql.js native setup uses SQLite LIKE', async () => {
    const {default: init} = await import('sql.js');
    const SQL = await init();
    const sqlite = new SQL.Database();
    try {
      const db = installNative({sqlite});
      for (const [expression, expected] of cases) {
        const {value} = await db.native({sql:`SELECT ${expression}`, expect:'scalar'});
        assert.equal(value,expected,expression);
      }
    } finally { sqlite.close(); }
  });
  it('fails explicitly if either SQLite build ignores the pragma', async () => {
    const {default: init} = await import('sql.js');
    const SQL = await init();
    for (const db of [new SQL.Database(), new DatabaseSync(':memory:')]) {
      const exec = db.exec;
      db.exec = function (sql, ...args) {
        if (/case_sensitive_like/i.test(sql)) return;
        return exec.call(this, sql, ...args);
      };
      try { assert.throws(() => setupSqliteConnection(db), /requires working PRAGMA case_sensitive_like/); }
      finally { db.close(); }
    }
  });
  const backends = [
    ['sql.js', () => new SQLiteDatabaseClient()],
    ['file SQLite', () => new FileSqliteClient({path:join(root,'like.sqlite')})],
    ['DuckDB', () => new DuckDBDatabaseClient()],
  ];
  for (const [name, make] of backends.slice(0, 2)) {
    it(`${name}: LIKE keeps the indexed prefix range search`, async () => {
      globalThis.abap = new runtime.ABAP();
      const db = make(); await db.connect();
      try {
        await db.execute('CREATE TABLE prefix_probe (value TEXT)');
        await db.execute('CREATE INDEX prefix_value ON prefix_probe(value)');
        const {rows} = await db.select({select:"EXPLAIN QUERY PLAN SELECT value FROM prefix_probe WHERE value LIKE 'ABC%'"});
        console.log(`${name} LIKE plan: ${rows.map(row => row.detail).join('; ')}`);
        assert.match(rows[0].detail, /SEARCH .*USING COVERING INDEX prefix_value .*value>\? AND value<\?/);
      } finally { await db.disconnect(); }
    });
    it(`${name}: LIKE preserves SQLite REAL conversion`, async () => {
      globalThis.abap = new runtime.ABAP();
      const db = make(); await db.connect();
      try {
        assert.equal((await db.select({select:"SELECT 1.0 LIKE '1.0' AS matches"})).rows[0].matches, 1);
      } finally { await db.disconnect(); }
    });
  }
  // Optional local PostgreSQL service; no configured/live identifiers in fixtures.
  if (process.env.OSD_TEST_POSTGRES === '1') backends.push(['Postgres', () => new OsdPostgresClient()]);
  for (const [name, make] of backends) {
    it(`${name}: SQL patterns and transpiled ABAP mirror the A4H row counts`, async () => {
      globalThis.abap = new runtime.ABAP();
      const db = make();
      abap.context.databaseConnections.DEFAULT = db;
      await db.connect();
      try {
        for (const [expression, expected] of cases) {
          const {rows} = await db.select({select:`SELECT ${expression} AS matches`});
          assert.equal(rows[0].matches === null ? null : Number(rows[0].matches), expected, expression);
        }
        if (name !== 'DuckDB' && name !== 'Postgres') {
          for (const expression of ["'abc' LIKE 'a!' ESCAPE '!'", "'x' LIKE 'x%' ESCAPE '%'", "'x' LIKE 'x_' ESCAPE '_'"]) {
            assert.equal((await db.select({select:`SELECT ${expression} AS matches`})).rows[0].matches, 0);
          }
          assert.equal((await db.select({select:"SELECT 'a%c' LIKE 'a1%c' ESCAPE 1 AS matches"})).rows[0].matches, 1);
          assert.equal((await db.select({select:"SELECT ('a'||char(0)||'b') LIKE ('a'||char(0)||'c') AS matches"})).rows[0].matches, 1);
          assert.equal((await db.select({select:"SELECT 'a%c' LIKE 'a!%c' ESCAPE x'21' AS matches"})).rows[0].matches, 1);
          await assert.rejects(db.select({select:`SELECT 'x' LIKE '${'λ'.repeat(25001)}'`}));
          await assert.rejects(db.select({select:"SELECT 'abc' LIKE 'a%' ESCAPE 'xx'"}));
          const cursor = await db.openCursor({select:"SELECT 'A' AS value WHERE 'A' LIKE 'a'"});
          try { assert.deepEqual((await cursor.fetchNextCursor(1)).rows, []); }
          finally { await cursor.closeCursor(); }
        }
        await db.execute('CREATE TABLE zlike (carrid TEXT)');
        for (let i=0;i<32;i++) await db.execute(`INSERT INTO zlike VALUES ('L${String(i).padStart(2,'0')}')`);
        await new (Object.getPrototypeOf(async function(){}).constructor)(code)();
        if (name === 'sql.js') {
          const data = db.export();
          assert.equal((await db.select({select:"SELECT 'A' LIKE 'a' AS matches"})).rows[0].matches, 0);
          await db.disconnect();
          await db.connect(data);
          assert.equal((await db.select({select:"SELECT 'A' LIKE 'a' AS matches"})).rows[0].matches, 0);
        }
      } finally { await db.disconnect(); }
    });
  }
});
