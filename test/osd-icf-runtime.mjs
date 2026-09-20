import {expect} from "chai";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Exercise both real hosts against a private database. No source object
// declares these nodes, so falling back to files cannot pass this test.
describe("ICF database routing in both Node hosts", function () {
  this.timeout(60000);
  for (const mode of ["inline", "child"]) {
    it(`${mode} serves row-only nodes, respects handler order and blocks inactive subtrees`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-icf-runtime-"));
      const env = {...process.env, STG_DB: "file", STG_DB_PATH: join(dir, "test.sqlite"),
        STG_SERVE: mode, STG_TLS: "0", STG_PORT: "0"};
      let child;
      try {
        execFileSync(process.execPath, ["--input-type=module", "-e", `
          import {initializeABAP} from './output/init.mjs';
          import {applyTo, markEdited} from './tools/osd-icf-apply.mjs';
          import {icfRows} from './tools/osd-icf-rows.mjs';
          await initializeABAP();
          const db = abap.context.databaseConnections.DEFAULT;
          const rows = icfRows('.');
          const fixtures = [
            ['AUDIT_ROOT', '/sap/bc/audit-root/', 'X'],
            ['AUDIT_OFF', '/sap/bc/audit-root/off/', ''],
            ['AUDIT_LEAF', '/sap/bc/audit-root/off/leaf/', 'X'],
            ['AUDIT_ONLY', '/sap/bc/audit-only/', 'X'],
          ];
          for (const [name, url, active] of fixtures) {
            rows.ICFSERVICE.push({ICF_NAME: name, ICFPARGUID: 'AUDIT',
              ICFNODGUID: name, ICFALTNME: '', ORIG_NAME: name, URL: url, ICFACTIVE: active});
            if (name !== 'AUDIT_OFF') {
              for (const [order, handler] of [['02', 'ZCL_STG_ICF_DEMO'], ['01', 'ZCL_OSD_SICF']]) {
                rows.ICFHANDLER.push({ICF_NAME: name, ICFPARGUID: 'AUDIT',
                  ICFORDER: order, ICFTYP: 'A', ICFHANDLER: handler});
              }
            }
          }
          await applyTo(db, rows);
          for (const [name] of fixtures) await markEdited(db, name, 'AUDIT');
          await db.commit();
          await db.disconnect();
        `], {env, stdio: "pipe", timeout: 30000});
        const args = mode === "child" ? ["tools/osd-serve.mjs", "0"]
          : ["--input-type=module", "-e", `
            const {startServer} = await import('./test/start.mjs');
            const server = startServer(true);
            server.on('listening', () => process.send({type: 'ready', port: server.address().port}));
          `];
        child = spawn(process.execPath, args, {env, stdio: ["ignore", "pipe", "pipe", "ipc"]});
        let log = "";
        child.stdout.on("data", (d) => { log += d; });
        child.stderr.on("data", (d) => { log += d; });
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`host did not start: ${log}`)), 30000);
          child.once("error", (error) => { clearTimeout(timer); reject(error); });
          child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`host exited ${code}: ${log}`)); });
          child.on("message", (message) => {
            if (message.type === "ready") { clearTimeout(timer); resolve(message.port); }
          });
        });
        const base = `http://127.0.0.1:${port}`;
        for (const path of ["/sap/bc/audit-only/", "/sap/bc/audit-root/sibling/"]) {
          const res = await fetch(base + path);
          expect(res.status, path).to.equal(200);
          expect((await res.json()).service, "ICFORDER 02 must win, not the last inserted row")
            .to.equal("ZSTG_ICF_DEMO");
        }
        for (const path of ["/sap/bc/audit-root/off", "/sap/bc/audit-root/off/leaf/"]) {
          expect((await fetch(base + path)).status, path).to.equal(404);
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const stopped = new Promise((resolve) => child.once("exit", resolve));
          child.kill("SIGTERM");
          await stopped;
        }
        rmSync(dir, {recursive: true, force: true});
      }
    });
  }
});
