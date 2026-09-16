import {expect} from "chai";
import {execFileSync, spawn} from "node:child_process";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

// The binary as a host of the same system (SP4, docs/bun-spike.md part
// three). What bit once is measured here every time, so a quirk between
// Node and the compiled binary is found by a test and not by a person:
// a class the bundle renamed, a generation the two hosts name differently
// (a directory read in host order), and a tool that starts another tool by
// a path that does not exist inside a binary. `npm run binary` builds it;
// without build/osd the runtime checks are skipped, the static one is not.
const root = process.cwd();
// which host: build/osd (the Bun binary) unless OSD_BINARY names another as
// a JSON array, e.g. '["node","build/osd-node/osd.mjs"]' or '["build/osd-sea"]'
const self = process.env.OSD_BINARY ? JSON.parse(process.env.OSD_BINARY) : [join(root, "build", "osd")];
const [binary, ...prefix] = self;
const built = existsSync(binary) || binary === "node" || binary === process.execPath;

describe("the binary: the same system, one file", function () {
  this.timeout(180000);

  it("no tool starts another tool by process.execPath and a script path, except the host module", () => {
    const offenders = [];
    for (const name of readdirSync(join(root, "tools")).filter((f) => f.endsWith(".mjs") && f !== "osd-host.mjs" && f !== "bench-cube.mjs")) {
      const text = readFileSync(join(root, "tools", name), "utf8");
      if (/spawn(Sync)?\(\s*process\.execPath/.test(text) || /execFileSync\(\s*process\.execPath/.test(text)) {
        offenders.push(name);
      }
    }
    expect(offenders, "route these through tools/osd-host.mjs").to.deep.equal([]);
  });

  it("the bundle renamed no runtime class, or the host put the names back", function () {
    if (!built) {
      this.skip();
    }
    const out = execFileSync(binary, [...prefix, "doctor"], {encoding: "utf8"});
    expect(out).to.contain("renamed by the bundle: 0");
  });

  it("the binary and node name the same generation for the same inputs", function () {
    if (!built) {
      this.skip();
    }
    const byNode = execFileSync(process.execPath, [join(root, "tools", "osd-build.mjs"), "hash"], {encoding: "utf8"}).trim().split(/\s+/).pop();
    const byBinary = execFileSync(binary, [...prefix, "build", "hash"], {encoding: "utf8"}).trim().split(/\s+/).pop();
    expect(byBinary).to.match(/^[0-9a-f]{16}$/);
    expect(byBinary).to.equal(byNode);
  });

  it("serves OData from a generation loaded after it was built", async function () {
    if (!built) {
      this.skip();
    }
    const port = 3090 + Math.floor(Math.random() * 100);
    const database = join(root, ".local", "db", `binary-test-${process.pid}.sqlite`);
    const child = spawn(binary, [...prefix, "up"], {cwd: root, env: {...process.env, STG_PORT: String(port), STG_DB_PATH: database, STG_ADT_SID: "OSX"}, stdio: ["ignore", "pipe", "pipe"]});
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    try {
      const url = `http://127.0.0.1:${port}/sap/opu/odata/sap/ZOSD_TEST_SRV/ItemSet?$top=1&$format=json`;
      let answer;
      for (let i = 0; i < 120; i++) {
        answer = await fetch(url).catch(() => undefined);
        if (answer?.ok) {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(answer?.status, log.slice(-1500)).to.equal(200);
      expect(answer.headers.get("x-osd-generation")).to.match(/^[0-9a-f]{16}$/);
      const body = await answer.json();
      expect(body.d.results).to.have.length(1);
      const build = await (await fetch(`http://127.0.0.1:${port}/sap/bc/adt/core/http/build`)).json();
      expect(build.system.serving).to.equal(build.system.live);
    } finally {
      child.kill("SIGTERM");
      // a host that will not go is killed rather than waited for: a Node
      // single executable built before 26.9 hung here for ten minutes
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 8000)).then(() => child.kill("SIGKILL")),
      ]);
      for (const suffix of ["", "-wal", "-shm"]) {
        try { (await import("node:fs")).rmSync(database + suffix, {force: true}); } catch { /* gone */ }
      }
    }
  });
});
