import {expect} from "chai";
import {spawn, execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {ObjectStore} from "../tools/osd-store.mjs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const BASE = "/sap/bc/adt";
const OBJECT = BASE + "/ddic/ddl/sources/zosd_ddls_recovery";
const VALID = "define view entity ZOSD_DDLS_RECOVERY as select from zstg_demo { key travel_id, description }\n";

describe("ADT DDLS recovery after a failed generation", function () {
  this.timeout(360000);
  let root, child, origin, headers, handle, env, log = "";
  const stop = async () => {
    if (!child) return;
    try {process.kill(-child.pid, "SIGTERM");} catch {}
    if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once("exit", r));
  };
  const start = async warm => {
    log = "";
    child = spawn(process.execPath, ["test/run.mjs"], {cwd: root, env: {...env, OSD_WARM: warm}, detached: true, stdio: ["ignore", "pipe", "pipe"]});
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
  };
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
    env = {...process.env, OSD_ROOT: root, STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0", OSD_WARM: "0"};
    execFileSync(process.execPath, [resolve("tools/osd-build.mjs")], {cwd: root, env, stdio: "pipe", timeout: 120000});
    await start("0");
  });
  after(async () => {
    await stop();
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
  const removalWarns = async () => {
    const answer = await request("POST", BASE + "/checkruns", `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core"><chkrun:checkObject adtcore:uri="${OBJECT}"><chkrun:content>${VALID.replace(", description", "")}</chkrun:content></chkrun:checkObject></chkrun:checkObjectList>`);
    expect(answer.status, answer.text).to.equal(200);
    expect(answer.text).to.contain("DESCRIPTION is in the generated view");
    expect((await request("GET", OBJECT + "/source/main?version=active")).text).to.contain("description }");
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
    await removalWarns();
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

  it("warns about an unsaved field removal immediately after successful activation with warm enabled", async () => {
    await stop();
    await start("1");
    const locked = await request("POST", OBJECT + "?_action=LOCK&accessMode=MODIFY");
    expect(locked.status, locked.text).to.equal(200);
    handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.text)?.[1];
    await save("@EndUserText.label: 'Warm recovery'\n" + VALID);
    success(await activate());
    await removalWarns();
  });
});

describe("DDLS semantic registry provenance and cache identity", function () {
  let root, options;
  const ddl = "src/zc_osd_pack.ddls.asddls";
  const view = "gen/cds/zvosdpack.view.xml";
  const snapshot = (generation, source) => {
    const dir = join(root, "build/by-input", generation);
    mkdirSync(join(dir, "source/gen/cds"), {recursive: true});
    writeFileSync(join(dir, "source", view), source);
    writeFileSync(join(dir, "source/.complete"), "1\n");
    writeFileSync(join(dir, "source-inputs.json"), JSON.stringify({[view]: createHash("sha256").update(source).digest("hex")}));
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ddls-registry-identity-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "gen/cds"), {recursive: true});
    for (const file of ["src/cds/zc_osd_pack.ddls.asddls", "src/cds/zc_osd_pack.ddls.xml", "src/status/zosd_pack.tabl.xml"]) {
      cpSync(file, join(root, "src", file.split("/").at(-1)));
    }
    cpSync("abaplint.jsonc", join(root, "abaplint.jsonc"));
    options = {root, roots: [{path: "src", writable: true}, {path: "gen", writable: false}], libs: []};
  });
  afterEach(() => rmSync(root, {recursive: true, force: true}));
  const baseline = () => readFileSync("gen/cds/zvosdpack.view.xml", "utf8");

  it("a cleaned build with failed generated artifacts cannot block repaired DDLS", () => {
    snapshot("failed", baseline());
    rmSync(join(root, "build"), {recursive: true});
    writeFileSync(join(root, view), baseline().replace("<VIEWFIELD>DESCRIPTION</VIEWFIELD>", "<VIEWFIELD>OSD_MISSING_COLUMN</VIEWFIELD>"));
    const store = new ObjectStore(options);
    expect([...store.registry().getObjectsByType("VIEW")]).to.have.length(0);
    expect(store.activate("DDLS", "ZC_OSD_PACK").issues).to.deep.equal([]);
    expect(store.activate("DDLS", "ZC_OSD_PACK").active).to.equal(true);
  });

  it("both existing stores and a new store see a newly published generation", () => {
    const first = new ObjectStore(options), second = new ObjectStore(options);
    first.find("DDLS", "ZC_OSD_PACK");
    second.find("DDLS", "ZC_OSD_PACK");
    const previous = first.registry();
    expect(second.registry()).to.equal(previous);
    snapshot("published", baseline());
    symlinkSync("by-input/published", join(root, "build/live"), "dir");
    const source = readFileSync(join(root, ddl), "utf8").replace("description as Description", "description as Renamed");
    for (const store of [first, second, new ObjectStore(options)]) {
      expect(store.registry().getObject("VIEW", "ZVOSDPACK")).not.to.equal(undefined);
      const issues = store.check("DDLS", "ZC_OSD_PACK", {source}).issues;
      expect(issues.some(issue => issue.severity === "W" && issue.message.includes("DESCRIPTION"))).to.equal(true);
      expect(store.registry()).not.to.equal(previous);
    }
  });

  it("a replacement snapshot at the same generation retires both parses and retained input maps", () => {
    const sharedSnapshot = source => {
      snapshot("published", source);
      const digest = createHash("sha256").update(source).digest("hex");
      mkdirSync(join(root, "build/source-by-digest"), {recursive: true});
      writeFileSync(join(root, "build/source-by-digest", digest), source);
      writeFileSync(join(root, "build/by-input/published/source-shared"), "1\n");
      rmSync(join(root, "build/by-input/published/source"), {recursive: true});
    };
    sharedSnapshot(baseline());
    const store = new ObjectStore(options);
    store.served = {running: true, generation: "published"};
    const previous = store.registry();
    sharedSnapshot(baseline().replace("<VIEWFIELD>DESCRIPTION</VIEWFIELD>", "<VIEWFIELD>OSD_MISSING_COLUMN</VIEWFIELD>"));
    expect(store.check("DDLS", "ZC_OSD_PACK").issues[0].message).to.contain("OSD_MISSING_COLUMN");
    expect(store.registry()).not.to.equal(previous);
    expect(new ObjectStore({...options, roots: [{path: "src", writable: true}]}).check("DDLS", "ZC_OSD_PACK").issues).to.deep.equal([]);
  });

  it("working source changes retire a parse even in another existing store", () => {
    const first = new ObjectStore(options), second = new ObjectStore(options);
    first.find("DDLS", "ZC_OSD_PACK");
    second.find("DDLS", "ZC_OSD_PACK");
    const previous = first.registry();
    expect(second.registry()).to.equal(previous);
    first.write("DDLS", "ZC_OSD_PACK", "definnnne vieeew\n");
    expect(second.check("DDLS", "ZC_OSD_PACK").issues[0].severity).to.equal("E");
    expect(second.registry()).not.to.equal(previous);
  });

  it("a serving store drops generated objects when their retained proof is cleaned", () => {
    snapshot("published", baseline());
    writeFileSync(join(root, view), baseline());
    const store = new ObjectStore(options);
    store.served = {running: true, generation: "published"};
    expect(store.registry().getObject("VIEW", "ZVOSDPACK")).not.to.equal(undefined);
    rmSync(join(root, "build"), {recursive: true});
    expect(store.registry().getObject("VIEW", "ZVOSDPACK")).to.equal(undefined);
  });

  it("stores with different exclusions or syntax configuration do not borrow the same parse", () => {
    const store = new ObjectStore(options);
    const previous = store.registry();
    expect(previous.getObject("TABL", "ZOSD_PACK")).not.to.equal(undefined);
    const excluded = new ObjectStore({...options, excluded: [/zosd_pack\.tabl\.xml$/]}).registry();
    expect(excluded.getObject("TABL", "ZOSD_PACK")).to.equal(undefined);
    cpSync(join(root, "abaplint.jsonc"), join(root, "other.jsonc"));
    const configured = store.registry("other.jsonc");
    expect(configured).not.to.equal(previous);
    const config = readFileSync(join(root, "other.jsonc"), "utf8");
    writeFileSync(join(root, "other.jsonc"), config + "\n");
    expect(store.registry("other.jsonc")).not.to.equal(configured);
  });
});
