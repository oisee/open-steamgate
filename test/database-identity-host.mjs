import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {snapshot, childDatabaseFacts} from "../tools/osd-status.mjs";

describe("connected database identity across the child boundary", function () {
  this.timeout(90000);
  for (const [backend, engine] of [["file", "sqlite"], ["duckdb", "duckdb"]]) {
    it(`${backend}: child facts override facade configuration`, async () => {
      const root = mkdtempSync(join(tmpdir(), "osd-db-host-"));
      const database = join(root, "isolated.db");
      const runtime = new ServingRuntime({database, env: {STG_DB: backend, STG_TLS: "0"}});
      try {
        expect(await childDatabaseFacts(runtime)).to.equal(undefined);
        await runtime.ensure();
        const res = await fetch(`${runtime.url}/osd/serving`);
        expect(res.status).to.equal(200);
        const body = await res.json();
        expect(body.databaseIdentity).to.deep.equal({engine, storage: "file", connected: true});
        const state = await snapshot(process.cwd(), {runtime, env: {STG_DB: "hana"}});
        const facts = state.database;
        expect(facts[0]).to.include({value: engine, note: "connected backend"});
        expect(facts[1].value).to.equal("file");
        expect(JSON.stringify(facts)).not.to.include(root);
        const posted = await fetch(`${runtime.url}/sap/bc/osd/status/`, {
          method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(state),
        });
        expect(posted.status, await posted.text()).to.equal(200);
        for (const path of ["DatabaseSet?$format=json", "SystemSet?$expand=to_Database&$format=json"]) {
          const response = await fetch(`${runtime.url}/sap/opu/odata/sap/ZOSD_STATUS_SRV/${path}`);
          const text = await response.text();
          expect(response.status, text).to.equal(200);
          expect(text).to.include(engine).and.include("connected backend");
          expect(text).not.to.include(root);
        }
      } finally {
        await runtime.stop();
        rmSync(root, {recursive: true, force: true});
      }
    });
  }
});
