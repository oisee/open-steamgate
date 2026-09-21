import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {upsertGeneratedMetadata} from "./setup.mjs";

describe("persistent DuckDB generated metadata", () => {
  it("adds new BSP rows and updates existing ones without deleting unrelated rows", async () => {
    const db = new DuckDBDatabaseClient({path: ":memory:"});
    await db.connect();
    try {
      await db.execute('CREATE TABLE "tadir" ("pgmid" VARCHAR, "object" VARCHAR, "obj_name" VARCHAR, "devclass" VARCHAR, PRIMARY KEY ("pgmid", "object", "obj_name"))');
      await db.execute('CREATE TABLE "wwwparams" ("relid" VARCHAR, "objid" VARCHAR, "name" VARCHAR, "value" VARCHAR, PRIMARY KEY ("relid", "objid", "name"))');
      await db.execute("INSERT INTO \"wwwparams\" VALUES ('MI', 'USER/FILE', 'filename', 'keep-me')");
      await db.execute("INSERT INTO \"wwwparams\" VALUES ('MI', 'TAXI/MANIFEST', 'filename', 'old')");
      const generated = [
        "INSERT INTO \"tadir\" VALUES ('R3TR', 'W3MI', 'TAXI/MANIFEST', '$TMP')",
        "INSERT INTO \"wwwparams\" VALUES ('MI', 'TAXI/MANIFEST', 'filename', 'manifest.json')",
        "INSERT INTO \"wwwparams\" VALUES ('MI', 'TAXI/COMPONENT', 'filename', 'Component.js')",
        "INSERT INTO \"business\" VALUES ('should', 'not', 'run')",
      ];
      await upsertGeneratedMetadata(db, generated);
      expect(await db.query('SELECT "objid", "value" FROM "wwwparams" ORDER BY "objid"')).to.deep.equal([
        {objid: "TAXI/COMPONENT", value: "Component.js"},
        {objid: "TAXI/MANIFEST", value: "manifest.json"},
        {objid: "USER/FILE", value: "keep-me"},
      ]);
      expect(await db.query('SELECT "obj_name" FROM "tadir"')).to.deep.equal([{obj_name: "TAXI/MANIFEST"}]);
    } finally {
      await db.disconnect();
    }
  });
});
