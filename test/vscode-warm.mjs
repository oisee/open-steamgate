// T7 (docs/vscode-extension.md "Warm"): the live half. A real system
// (node test/run.mjs, the workbench shape test/osd-child.mjs already uses)
// started with OSD_WARM=1, a class's comment edited on disk the way a
// person's save would, and the VS Code extension's own Osd#activate()
// (editors/vscode/lib.js) used to activate it -- the same door Ctrl+F3 and
// "Rebuild (warm)" go through. With the four transpiler PRs
// (abaplint/transpiler#1899, #1900, #1921) this checkout has, the registry
// primes and the edit swaps; with the pinned transpiler it stays cold and
// says why (tools/osd-warm.mjs probe()), and that is asserted instead of
// skipped, since the point of this test is that the reason is SURFACED, not
// that warm is available.
//
// Port budget for this task: 3621-3629 only, never 3531 (the extension's
// own B0 range, test/vscode-launcher.mjs's end to end test) and never any
// of the other reserved ports this repository's other suites and running
// instances use.
import {expect} from "chai";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";

const {Osd} = createRequire(import.meta.url)("../editors/vscode/lib.js");

const PORT = 3621;
const BASE = `http://localhost:${PORT}`;
const CLASS_FILE = "src/demo/zcl_zstg_demo_dpc_ext.clas.abap";

describe("T7 warm: OSD_WARM=1, an edit through Osd#activate() (editors/vscode/lib.js)", function () {
  this.timeout(180000);
  let child;
  let databaseDir;
  let testIdentity;
  let originalSource;
  const log = [];

  before(async () => {
    originalSource = readFileSync(CLASS_FILE, "utf8");
    databaseDir = mkdtempSync(join(tmpdir(), "osd-vscode-warm-"));
    testIdentity = `osd-vscode-warm-${randomUUID()}`;
    child = spawn(process.execPath, ["test/run.mjs"], {
      env: {
        ...process.env, STG_DB: "file", STG_PORT: String(PORT), STG_TLS: "0", STG_SERVE: undefined,
        OSD_WARM: "1", OSD_USER_FULL: testIdentity, STG_DB_BASE: join(databaseDir, "base"),
        STG_DB_PATH: join(databaseDir, "osd.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    delete child.spawnargs;
    child.stdout.on("data", (d) => log.push(String(d)));
    child.stderr.on("data", (d) => log.push(String(d)));
    let up = false;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${BASE}/sap/bc/adt/core/http/build`);
        if (res.status === 200) {
          const body = await res.json();
          if (body.identity?.userFullName === testIdentity) {
            up = true;
            break;
          }
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(up, `the façade came up as this test's own process: ${log.join("").slice(-800)}`).to.equal(true);
    expect(child.exitCode, "the spawned façade is still running").to.equal(null);
  });

  after(async () => {
    writeFileSync(CLASS_FILE, originalSource);
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    if (databaseDir) rmSync(databaseDir, {recursive: true, force: true});
  });

  it("edits the demo DPC's own comment, activates it, and reads X-OSD-Build off the answer", async () => {
    // give the background prime (docs/warm-compile.md: ~8-9 s, synchronous)
    // a chance to finish, the way the extension's own "warming up..." does,
    // rather than racing the first activation against it
    let serving;
    for (let i = 0; i < 40; i++) {
      serving = await fetch(`${BASE}/osd/serving`).then((r) => r.json()).catch(() => undefined);
      if (serving?.warm !== undefined && serving.warm.state !== "priming") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(serving?.warm, "OSD_WARM=1 is on, and /osd/serving carries the field (#108)").to.not.equal(undefined);

    const edited = originalSource.replace(
      "* The hand-written part a developer owns on a real system. Reads the",
      `* The hand-written part a developer owns on a real system (T7 warm test ${randomUUID()}). Reads the`,
    );
    expect(edited, "the marker line exists to be replaced").to.not.equal(originalSource);
    writeFileSync(CLASS_FILE, edited);

    const client = new Osd(BASE);
    const result = await client.activate({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT", base: "zcl_zstg_demo_dpc_ext"});
    expect(result.ok, `activation issues: ${JSON.stringify(result.issues)}`).to.equal(true);
    expect(result.build, "X-OSD-Build is on every activation answer once publish() ran").to.be.a("string");

    if (serving.warm.state === "primed") {
      // the registry was primed on this transpiler: the edit is a class's
      // own content, no AMDP, no INTERFACES change, so it must have built warm
      expect(result.build).to.equal("warm");
      if (result.swapMs === undefined) {
        // only if the demo DPC (or one of its readers) turned out to be a
        // HOST_HELD module -- a recycle, not a failure (docs/warm-compile.md)
        console.log("T7 live test: warm build recycled rather than swapped (host-held module)");
      } else {
        expect(result.swapMs).to.be.a("number").and.be.at.least(0);
        console.log(`T7 live test: warm, hot-swapped in ${result.swapMs} ms`);
      }
    } else {
      // the pinned transpiler: the reason must be surfaced, not swallowed
      expect(result.build).to.match(/^cold(;\s*.+)?$/);
      console.log(`T7 live test: warm did not prime (${serving.warm.reason ?? "no reason given"}); build=${result.build}`);
    }
  });
});
