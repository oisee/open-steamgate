import {expect} from "chai";
import {spawn, execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const BASE = "/sap/bc/adt";
const OBJECT = BASE + "/ddic/ddl/sources/zosd_ddls_recovery";
const VALID = "define view entity ZOSD_DDLS_RECOVERY as select from zstg_demo { key travel_id, description }\n";

describe("ADT DDLS recovery after a failed generation", function () {
  this.timeout(240000);
  let root, child, origin, headers, handle, log = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-ddls-recovery-"));
    // An independent system: saves, gen/, builds and the database all belong
    // to this tree. The same child-mode HTTP front used by the workbench
    // exercises OSD_ADT_ONE_RUNTIME as selected by the suite invocation.
    for (const dir of ["src", "test", "packs", "data"]) cpSync(dir, join(root, dir), {recursive: true});
    for (const file of ["abap_transpile.json", "abaplint.jsonc", "libs.lock.json", "package.json", "osd.json"]) {
      if (existsSync(file)) cpSync(file, join(root, file));
    }
    mkdirSync(join(root, ".local"));
    symlinkSync(resolve(".local/lars"), join(root, ".local/lars"), "dir");
    for (const dir of ["node_modules", "tools", "webapp", "web"]) symlinkSync(resolve(dir), join(root, dir), "dir");
    const env = {...process.env, OSD_ROOT: root, STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0", OSD_WARM: "0"};
    execFileSync(process.execPath, [resolve("tools/osd-build.mjs")], {cwd: root, env, stdio: "pipe", timeout: 120000});
    child = spawn(process.execPath, ["test/run.mjs"], {cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"]});
    child.stdout.on("data", chunk => { log += chunk; });
    child.stderr.on("data", chunk => { log += chunk; });
    origin = `http://127.0.0.1:${process.env.STG_PORT}`;
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw new Error(`local server exited: ${log}`);
      try {
        const response = await fetch(origin + BASE + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
        if (response.status === 200) {
          headers = {"x-csrf-token": response.headers.get("x-csrf-token"), "x-sap-adt-sessiontype": "stateful", cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")};
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`local server never became ready: ${log}`);
  });
  after(async () => {
    if (child) {
      try {process.kill(-child.pid, "SIGTERM");} catch {}
      if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once("exit", r));
    }
    if (root) rmSync(root, {recursive: true, force: true});
  });
  const request = async (method, path, body = undefined) => {
    const response = await fetch(origin + path, {method, headers: {...headers, "content-type": "application/xml"}, body});
    return {status: response.status, text: await response.text()};
  };
  const activate = (object = OBJECT, name = "ZOSD_DDLS_RECOVERY") => request("POST", BASE + "/activation?method=activate", `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${object}" adtcore:name="${name}"/></adtcore:objectReferences>`);
  const save = async source => {
    const answer = await request("PUT", OBJECT + `/source/main?lockHandle=${encodeURIComponent(handle)}`, source);
    expect(answer.status, answer.text).to.equal(200);
  };
  const success = answer => {
    expect(answer.status, answer.text).to.equal(200);
    expect(answer.text, answer.text).to.contain('activationExecuted="true"');
    expect(answer.text).to.contain('generationExecuted="true"');
  };
  const preview = async () => {
    const metadata = await request("GET", BASE + "/datapreview/cds/ZOSD_DDLS_RECOVERY/metadata");
    expect(metadata.status, metadata.text).to.equal(200);
    expect(metadata.text).to.contain("TRAVEL_ID").and.contain("DESCRIPTION");
    expect(metadata.text).not.to.contain("OSD_MISSING_COLUMN");
    const rows = await request("POST", BASE + "/datapreview/cds?ddlSourceName=ZOSD_DDLS_RECOVERY&rowNumber=2", "");
    expect(rows.status, rows.text).to.equal(200);
    expect(rows.text).to.contain("TRAVEL_ID").and.contain("DESCRIPTION");
    expect(rows.text).not.to.contain("OSD_MISSING_COLUMN");
    expect(rows.text).to.contain("<dataPreview:totalRows>2</dataPreview:totalRows>");
    return rows.text.replace(/(<dataPreview:queryExecutionTime>)\d+(<)/g, "$1TIME$2");
  };

  it("activates valid source, fails on a missing column, then activates and previews the restored definition", async () => {
    const created = await request("POST", BASE + "/ddic/ddl/sources", '<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZOSD_DDLS_RECOVERY" adtcore:type="DDLS/DF" adtcore:description="Recovery fixture"><adtcore:packageRef adtcore:name="$TMP"/></ddl:ddlSource>');
    expect(created.status, created.text).to.equal(201);
    const locked = await request("POST", OBJECT + "?_action=LOCK&accessMode=MODIFY");
    expect(locked.status, locked.text).to.equal(200);
    handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.text)?.[1];
    expect(handle, locked.text).to.be.a("string");
    await save(VALID);
    success(await activate());
    const baseline = await preview();
    for (const unrelated of [false, true]) {
      await save(VALID.replace("description }", "description, OSD_MISSING_COLUMN }"));
      const failed = await activate();
      expect(failed.text).to.contain('activationExecuted="false"');
      expect(failed.text).to.contain('generationExecuted="false"');
      expect(failed.text).to.contain("ZCL_STG_CDS_ZOSD_DDLS_RECOVERY");
      expect(failed.text.toUpperCase()).to.contain("OSD_MISSING_COLUMN");
      expect(readFileSync(join(root, "gen/cds/zosd_ddls_recovery.view.xml"), "utf8")).to.contain("OSD_MISSING_COLUMN");
      await save(VALID);
      if (unrelated) {
        const other = await request("POST", BASE + "/oo/classes", '<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_OSD_DDLS_OTHER" adtcore:type="CLAS/OC" adtcore:description="Unrelated fixture"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>');
        expect(other.status, other.text).to.equal(201);
        success(await activate(BASE + "/oo/classes/zcl_osd_ddls_other", "ZCL_OSD_DDLS_OTHER"));
      }
      success(await activate());
      expect(await preview()).to.equal(baseline);
    }
    const active = await request("GET", OBJECT + "/source/main?version=active");
    expect(active.text).to.equal(VALID);
    const inactive = await request("GET", BASE + "/activation/inactiveobjects");
    expect(inactive.text).not.to.contain("ZOSD_DDLS_RECOVERY");
  });
});
