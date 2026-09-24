import {expect} from "chai";
import {spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

describe("ICF object pages expose the APC implementation separately from HTTP", function () {
  this.timeout(40000);
  let server, directory, base;
  before(async () => {
    // Other suites share and mutate the in-process ABAP database. Verify
    // real startup inventory in its own process, not their residual state.
    directory = mkdtempSync(join(tmpdir(), "osd-apc-inventory-"));
    server = spawn(process.execPath, ["--input-type=module", "-e", `
      const {startServer} = await import('./test/start.mjs');
      const server = startServer(true);
      server.on('listening', () => process.send({port: server.address().port}));
    `], {env: {...process.env, STG_SERVE: "inline", STG_PORT: "0", STG_TLS: "0",
      STG_DB: "file", STG_DB_PATH: join(directory, "test.sqlite")},
      stdio: ["ignore", "pipe", "pipe", "ipc"]});
    let log = "";
    server.stdout.on("data", (data) => { log += data; });
    server.stderr.on("data", (data) => { log += data; });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`APC host startup timed out: ${log}`)), 30000);
      server.once("error", (error) => { clearTimeout(timer); reject(error); });
      server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`APC host exited ${code}: ${log}`)); });
      server.once("message", (message) => { clearTimeout(timer); resolve(message.port); });
    });
    base = `http://127.0.0.1:${port}/sap/opu/odata/sap/ZOSD_ICF_SRV`;
  });
  after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await stopped;
    }
    if (directory) rmSync(directory, {recursive: true, force: true});
  });

  for (const [path, application, handler] of [
    ["/sap/bc/apc/sap/zstg_apc_demo/", "ZSTG_APC_DEMO", "ZCL_STG_APC_DEMO"],
    ["/sap/bc/apc/sap/zo4d_demo/", "ZO4D_DEMO", "ZCL_O4D_APC_HANDLER"],
    ["/sap/bc/apc/sap/zapc_zork/", "ZAPC_ZORK", "ZCL_APC_ZORK"],
  ]) {
    it(`${application} exposes its WebSocket class through node navigation`, async () => {
      const query = `$filter=${encodeURIComponent(`Url eq '${path}'`)}&$expand=to_Apc,to_Handlers`;
      const res = await fetch(`${base}/NodeSet?${query}`);
      expect(res.status).to.equal(200);
      const nodes = (await res.json()).d.results;
      expect(nodes).to.have.length(1);
      expect(nodes[0].to_Apc.results).to.have.length(1);
      expect(nodes[0].to_Apc.results[0]).to.include({ApplicationId: application, ClassName: handler});
      expect(nodes[0].to_Handlers.results, "an APC class must not masquerade as an HTTP handler").to.deep.equal([]);
    });
  }
});
