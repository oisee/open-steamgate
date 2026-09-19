import {expect} from "chai";
import {multiRowInsert} from "../tools/hana-client.mjs";

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
