import {expect} from "chai";
import {ABAP} from "@abaplint/runtime";
import {binaryLiterals, hanaSchema, multiRowInsert} from "../tools/hana-client.mjs";
import {binaryDdIC} from "../tools/osd-ddic-binary.mjs";

// The rewrite HANA needs, guarded by a test that needs no HANA.
//
// That is the whole point of this file. The defect it covers -- a multi-row
// `INSERT ... VALUES (a),(b)`, which HANA refuses with `incorrect syntax
// near ","` -- was introduced by batching the seed (6793 statements down to
// 1711, a large win on SQLite) and sat undetected because the HANA suite
// needs a container and does not run in CI. A pair that must agree, with
// the disagreement deferred to whoever next asked for HANA.
//
// So the rewrite is a pure function and is tested as one: every host runs
// this, container or no container. Measured on HANA Express 2026-09-19 --
// the multi-row form is refused, `SELECT ... FROM DUMMY UNION ALL ...` is
// accepted and the rows land.
describe("the HANA dialect rewrite", () => {
  it("turns a multi-row VALUES into UNION ALL over DUMMY", () => {
    expect(multiRowInsert(`INSERT INTO "T" ("A","B") VALUES (1,2), (3,4)`))
      .to.equal(`INSERT INTO "T" ("A","B") SELECT 1,2 FROM DUMMY UNION ALL SELECT 3,4 FROM DUMMY`);
  });

  it("leaves a single-row INSERT exactly as it was", () => {
    // the ordinary path, which every other caller uses: no rewrite, no risk
    const one = `INSERT INTO "T" ("A") VALUES ('x')`;
    expect(multiRowInsert(one)).to.equal(one);
  });

  it("does not split on a `),(` that is inside a string literal", () => {
    // the reason this is a scanner and not a regular expression. A value
    // containing the tuple separator is data, and a regex over the joined
    // statement cannot tell -- which is items 7 and 8 of the list in
    // docs/db-backends.md, made twice already in this client
    const one = `INSERT INTO "T" ("A") VALUES ('x),(y')`;
    expect(multiRowInsert(one)).to.equal(one);
  });

  it("keeps an escaped quote whole", () => {
    const two = `INSERT INTO "T" ("A") VALUES ('it''s'),('so')`;
    expect(multiRowInsert(two))
      .to.equal(`INSERT INTO "T" ("A") SELECT 'it''s' FROM DUMMY UNION ALL SELECT 'so' FROM DUMMY`);
  });

  it("keeps what follows the last tuple", () => {
    expect(multiRowInsert(`INSERT INTO "T" ("A") VALUES (1),(2);`))
      .to.equal(`INSERT INTO "T" ("A") SELECT 1 FROM DUMMY UNION ALL SELECT 2 FROM DUMMY;`);
  });

  it("leaves a statement that is not an INSERT alone", () => {
    for (const sql of [`SELECT 1 FROM DUMMY`, `UPDATE "T" SET "A" = 1`, `INSERT INTO "T" SELECT * FROM "U"`]) {
      expect(multiRowInsert(sql), sql).to.equal(sql);
    }
  });

  it("does not mistake the word VALUES inside a literal for the keyword", () => {
    // `VALUES` is a plausible thing for a row to contain -- a description,
    // a source line, a TADIR object name -- and finding the keyword by text
    // rather than by position would rewrite the statement around it
    const one = `INSERT INTO "T" ("A") VALUES ('VALUES (1),(2)')`;
    expect(multiRowInsert(one)).to.equal(one);
  });
});

describe("DDIC byte strings in the HANA dialect", () => {
  it("discovers pack RAW columns before runtime DDIC exists", () => {
    expect(binaryDdIC(process.cwd()).ZVDB_100_VEC).to.deep.equal({QBITS: "VARBINARY(192)"});
  });

  it("maps RAW and RAWSTRING like a real ABAP system", () => {
    const abap = new ABAP();
    const ddic = {
      ZBIN: {
        objectType: "TABL",
        type: () => new abap.types.Structure({
          id: new abap.types.Character(8),
          raw: new abap.types.Hex({length: 192}),
          stream: new abap.types.XString(),
        }),
      },
    };
    const [ddl] = hanaSchema({pg: [
      `CREATE TABLE "zbin" ("id" NCHAR(8), "raw" NCHAR(384), "stream" TEXT, PRIMARY KEY("id"));`,
    ]}, ddic);
    expect(ddl).to.include(`"RAW" VARBINARY(192)`);
    expect(ddl).to.include(`"STREAM" BLOB`);
    expect(ddl).to.include(`"ID" NCHAR(8)`);
  });

  it("turns hex into bytes only for binary INSERT columns", () => {
    const binary = new Set(["ZBIN.RAW"]);
    expect(binaryLiterals(
      `INSERT INTO "ZBIN" ("ID","RAW") VALUES ('CAFE','00ff'),('BEEF','aa55')`, binary))
      .to.equal(`INSERT INTO "ZBIN" ("ID","RAW") VALUES ('CAFE',X'00FF'),('BEEF',X'AA55')`);
  });

  it("turns hex into bytes only for binary UPDATE assignments", () => {
    const binary = new Set(["ZBIN.RAW"]);
    expect(binaryLiterals(
      `UPDATE "ZBIN" SET "ID" = 'CAFE', "RAW" = '00ff' WHERE "ID" = 'A'`, binary))
      .to.equal(`UPDATE "ZBIN" SET "ID" = 'CAFE', "RAW" =X'00FF' WHERE "ID" = 'A'`);
  });

  it("knows persisted RAW columns after restart without seeing their DDL", async () => {
    const {HanaDatabaseClient} = await import("../tools/hana-client.mjs");
    const statements = [];
    const db = new HanaDatabaseClient({ddicBinary: {ZBIN: {RAW: "VARBINARY(2)"}}});
    db.client = {exec: (sql, cb) => { statements.push(sql); cb(undefined, 1); }};
    await db.insert({table: "ZBIN", columns: ["ID", "RAW"], values: ["'A'", "'00ff'"]});
    expect(statements).to.deep.equal([`INSERT INTO ZBIN (ID,RAW) VALUES ('A',X'00FF')`]);
  });

  it("returns VARBINARY bytes as the hex representation ABAP expects", async () => {
    const {HanaDatabaseClient} = await import("../tools/hana-client.mjs");
    const db = new HanaDatabaseClient({});
    db.client = {exec: (_sql, cb) => cb(undefined, [{RAW: Buffer.from([0, 255, 0x80])}])};
    expect(await db.query(`SELECT "RAW" FROM "ZBIN"`)).to.deep.equal([{raw: "00FF80"}]);
  });
});

// A position without its text is a measurement of nothing.
//
// HANA answers `incorrect syntax near ",": line 2 col 88 (at pos 223)` and
// names a position in a statement it does not show. On 2026-09-19 that cost
// a whole diagnosis: the seed failed in a container, `STG_DB_TRACE=1` did not
// reach the serving child process, `STG_SERVE=inline` is broken in the
// compiled binary, and the statement was never seen. So the statement now
// travels with the error, and this is the test that it does.
describe("a HANA failure carries the statement that caused it", () => {
  // the private #explain is reached the way every caller reaches it: through
  // a client whose connection is a stub. Testing the real path rather than a
  // copy of it is the point (backlog 8.4).
  const explainedBy = async (sql, message) => {
    const {HanaDatabaseClient} = await import("../tools/hana-client.mjs");
    const db = new HanaDatabaseClient({});
    db.client = {exec: (_s, cb) => cb(Object.assign(new Error(message), {code: 257}))};
    try {
      await db.execute(sql);
      return undefined;
    } catch (e) {
      return e.message;
    }
  };

  it("puts the statement text into the message", async () => {
    const m = await explainedBy(`INSERT INTO "T" ("A") VALUES ('x')`, "sql syntax error: bad");
    expect(m).to.include("statement:");
    expect(m).to.include(`INSERT INTO "T"`);
  });

  it("marks the line and column HANA named, so the position points at something", async () => {
    const m = await explainedBy(`INSERT INTO "T"\n  ("A") VALUES ('x')`,
      `sql syntax error: incorrect syntax near ",": line 2 col 8 (at pos 24)`);
    expect(m).to.include("line 2:");
    expect(m).to.include("^ col 8");
  });

  it("truncates a long statement rather than printing a batch of megabytes", async () => {
    const long = `INSERT INTO "T" ("A") VALUES ` + Array.from({length: 500}, () => "('x')").join(", ");
    const m = await explainedBy(long, "sql syntax error: bad");
    expect(m).to.include("chars)");
    expect(m.length).to.be.below(1200);
  });

  it("leaves a successful statement alone", async () => {
    const {HanaDatabaseClient} = await import("../tools/hana-client.mjs");
    const db = new HanaDatabaseClient({});
    let seen;
    db.client = {exec: (s, cb) => { seen = s; cb(undefined, 1); }};
    await db.execute(`INSERT INTO "T" ("A") VALUES ('x')`);
    expect(seen).to.include(`INSERT INTO`);
  });
});
