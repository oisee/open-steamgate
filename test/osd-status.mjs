import {expect} from "chai";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hostKind, packsInfo, portsOf, servicesOf, snapshot, socketsOn} from "../tools/osd-status.mjs";

// The snapshot the facade posts to ZCL_OSD_STATUS=>REFRESH. The contract is
// the JSON below and the Fiori app is built against it, so these tests say
// the shape out loud rather than only that nothing threw. Everything the
// snapshot cannot know without a real system — the pool, the listeners, the
// generation — is injected, which is what makes it testable at all.
describe("tools/osd-status: the system as one JSON object", () => {
  let root;
  const write = (file, text = "") => {
    mkdirSync(join(root, file, ".."), {recursive: true});
    writeFileSync(join(root, file), text);
  };

  // a supervisor's two children, as tools/osd-pool.mjs holds them
  const pool = (n) => ({
    generation: "gen-live",
    runtimes: Array.from({length: n}, (_, i) => ({
      child: {pid: 90001 + i},
      port: 38810 + i,
      generation: "gen-live",
      epoch: i + 1,
      running: true,
    })),
  });

  const listeners = [
    {port: 3060, protocol: "HTTP", purpose: "OData, apps, ADT"},
    {port: 44360, protocol: "HTTPS", purpose: "the same, for a client that refuses plain HTTP"},
  ];

  const take = (options = {}) => snapshot(root, {
    runtime: pool(2),
    listeners,
    env: {},
    genLive: "gen-live",
    startedAt: new Date("2026-09-17T09:00:00.000Z"),
    now: new Date("2026-09-17T09:00:30.000Z"),
    rss: 120 * 1048576,
    hostKind: "node",
    instances: [{pid: 90001, since: "2026-09-17T09:00:01.000Z"}],
    ...options,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-status-"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen"]}));
    write("src/zcl_ours.clas.abap", "CLASS zcl_ours DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS.\n");
    write("src/zsrv.sicf.xml", "<abapGit><URL>/sap/bc/zsrv/</URL><ICFHANDLER>ZCL_SRV_HANDLER</ICFHANDLER></abapGit>");
    write("src/zchan.sapc.xml", "<abapGit><PATH>/sap/bc/apc/sap/zchan</PATH><CLASS_NAME>ZCL_CHAN</CLASS_NAME></abapGit>");
    write("src/zdemo_mdl                     0001.iwmo.xml",
      "<abapGit><_-IWBEP_-I_MGW_OHD><TECHNICAL_NAME>ZDEMO_MDL</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>ZCL_ZDEMO_MPC_EXT</CLASS_NAME></_-IWBEP_-I_MGW_OHD></abapGit>");
    write("src/zdemo_srv                     0001.iwsv.xml",
      "<abapGit><_-IWBEP_-I_MGW_SRG><MODEL_TECH_NAME>ZDEMO_MDL</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG>" +
      "<_-IWBEP_-I_MGW_SRH><TECHNICAL_NAME>ZDEMO_SRV</TECHNICAL_NAME><VERSION>0001</VERSION><EXTERNAL_NAME>ZDEMO_SRV</EXTERNAL_NAME>" +
      "<CLASS_NAME>ZCL_ZDEMO_DPC_EXT</CLASS_NAME></_-IWBEP_-I_MGW_SRH><DESCRIPTION>a demo</DESCRIPTION></abapGit>");
    write("packs/vibes/osd-pack.json", JSON.stringify({order: 60, description: "the worked example"}));
    write("packs/vibes/src/zcl_theirs.clas.abap", "CLASS zcl_theirs DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS.\n");
    write("packs/vibes/src/zpack.sicf.xml", "<abapGit><URL>/sap/bc/zvibes/</URL><ICFHANDLER>ZCL_VIBES</ICFHANDLER></abapGit>");
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("names the system, the generation and the tree, and nothing above it", async () => {
    const s = await take();
    expect(s.system).to.deep.equal({
      sid: "OSG",
      host_kind: "node",
      gen_live: "gen-live",
      gen_serving: "gen-live",
      synced: true,
      workers: 2,
      started_at: "2026-09-17T09:00:00.000Z",
      snap_at: "2026-09-17T09:00:30.000Z",
      root_hint: s.system.root_hint,
    });
    // the basename of the tree, never a path anyone could walk back
    expect(s.system.root_hint).to.match(/^osd-status-/);
    expect(JSON.stringify(s)).to.not.include(root);
  });

  it("says so when the generation built is not the generation serving", async () => {
    const s = await take({runtime: {...pool(1), generation: "gen-old"}});
    expect(s.system.gen_live).to.equal("gen-live");
    expect(s.system.gen_serving).to.equal("gen-old");
    expect(s.system.synced).to.equal(false);
  });

  it("has a row per work process, plus the facade itself", async () => {
    const s = await take();
    expect(s.processes.map((p) => p.role)).to.deep.equal(["facade", "work", "work"]);
    expect(s.processes[0].pid).to.equal(process.pid);
    expect(s.processes[0].port).to.equal(3060);
    expect(s.processes[0].rss_mb).to.equal(120);
    expect(s.processes[1]).to.include({pid: 90001, role: "work", port: 38810, generation: "gen-live", epoch: 1, alive: true});
    // the registry knows when that child came up; the facade's own start is the fallback
    expect(s.processes[1].since).to.equal("2026-09-17T09:00:01.000Z");
    expect(s.processes[2].since).to.equal("2026-09-17T09:00:00.000Z");
    for (const one of s.processes) {
      expect(one.sockets).to.be.a("number");
      expect(one.rss_mb).to.be.a("number");
    }
  });

  it("reports a runtime that has not started as no process at all", async () => {
    const s = await take({runtime: {generation: "", runtimes: [{port: undefined, epoch: 0, running: false}]}});
    expect(s.processes).to.have.length(1);
    expect(s.processes[0].role).to.equal("facade");
  });

  it("carries the listeners it was given, and RFC and DIAG as absent with a note", async () => {
    const s = await take();
    const byPort = new Map(s.ports.map((p) => [p.port, p]));
    expect(byPort.get(3060).protocol).to.equal("HTTP");
    expect(byPort.get(44360).protocol).to.equal("HTTPS");
    // the instance is the listener's number, the way the TLS port is
    expect(byPort.get(3360).protocol).to.equal("RFC");
    expect(byPort.get(3260).protocol).to.equal("DIAG");
    expect(byPort.get(3360).state).to.equal("absent");
    expect(byPort.get(3360).note).to.include("open-rfc-go");
    expect(byPort.get(3260).note).to.include("DIAG");
    expect(s.ports.map((p) => p.port)).to.deep.equal([...s.ports.map((p) => p.port)].sort((a, b) => a - b));
  });

  it("lists the OData, ICF and APC services, each with the pack it came from", async () => {
    const found = servicesOf(root, {});
    expect(found).to.deep.include({path: "/sap/opu/odata/sap/ZDEMO_SRV", kind: "ODATA", handler: "ZCL_ZDEMO_DPC_EXT", pack: ""});
    expect(found).to.deep.include({path: "/sap/bc/zsrv", kind: "ICF", handler: "ZCL_SRV_HANDLER", pack: ""});
    expect(found).to.deep.include({path: "/sap/bc/zvibes", kind: "ICF", handler: "ZCL_VIBES", pack: "vibes"});
    expect(found).to.deep.include({path: "/sap/bc/apc/sap/zchan", kind: "APC", handler: "ZCL_CHAN", pack: ""});
  });

  it("counts the objects a pack owns", async () => {
    const packs = packsInfo(root, {});
    expect(packs).to.deep.equal([{
      name: "vibes",
      order: 60,
      objects: 2,
      folders: "packs/vibes/src",
      description: "the worked example",
    }]);
  });

  it("is JSON the ABAP side can parse: every value a string, a number or a boolean", async () => {
    const s = await take();
    const flat = (row) => {
      for (const value of Object.values(row)) {
        expect(["string", "number", "boolean"]).to.include(typeof value);
      }
    };
    flat(s.system);
    for (const key of ["processes", "ports", "services", "packs"]) {
      expect(s[key]).to.be.an("array");
      s[key].forEach(flat);
    }
    expect(Object.keys(s)).to.deep.equal(["system", "processes", "ports", "services", "packs"]);
    expect(Object.keys(s.processes[0])).to.deep.equal(["pid", "role", "port", "generation", "epoch", "since", "sockets", "rss_mb", "alive"]);
    expect(Object.keys(s.ports[0])).to.deep.equal(["port", "protocol", "purpose", "state", "note"]);
    expect(Object.keys(s.packs[0])).to.deep.equal(["name", "order", "objects", "folders", "description"]);
  });

  it("counts sockets rather than naming peers", () => {
    const rows = [
      {port: 3060, state: "01"}, {port: 3060, state: "01"}, {port: 3060, state: "0A"}, {port: 3061, state: "01"},
    ];
    expect(socketsOn(3060, rows)).to.equal(2);
    expect(socketsOn(3062, rows)).to.equal(0);
  });

  it("knows which host it is running on", () => {
    expect(["node", "bun", "sea"]).to.include(hostKind());
  });

  it("keeps a listener it was given even when nothing is listening on it", async () => {
    const ports = await portsOf([{port: 65533, protocol: "HTTP", purpose: "a port nobody opened"}], {instance: 33});
    const one = ports.find((p) => p.port === 65533);
    expect(one.state).to.equal("absent");
    expect(one.purpose).to.equal("a port nobody opened");
  });
});
