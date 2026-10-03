import {expect} from "chai";
import {fork} from "node:child_process";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {once} from "node:events";

describe("ADT carry IPC compatibility", function () {
  this.timeout(20000);
  for (const carry of ["", "1"]) it(carry === "1"
    ? "an opted-in IPC child times out its unanswered carry and reaches ready"
    : "a demo-data style IPC parent reaches ready without answering adt-state", async () => {
    const proc = fork("tools/osd-serve.mjs", ["0"], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {...process.env, STG_DB: "sqlite", STG_DB_PATH: "", OSD_DEMO_ROWS: "0", OSD_ADT_CARRY: carry},
    });
    const said = [];
    proc.on("message", (m) => {if (m?.type === "say") said.push(m.line);});
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("IPC child never became ready")), 10000);
        proc.on("message", (m) => { if (m?.type === "ready") {clearTimeout(timer); resolve(m);} });
        proc.once("exit", (code) => {clearTimeout(timer); reject(new Error(`child exited ${code}`));});
      });
      expect(ready.port).to.be.greaterThan(0);
      expect(said.some((line) => line.includes("no adt-state after 5 s"))).to.equal(carry === "1");
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) {const gone = once(proc, "exit"); proc.kill(); await gone;}
    }
  });
  it("the supervisor defaults carry OFF and does not call the snapshot provider", async () => {
    let snapshots = 0;
    const runtime = new ServingRuntime({
      env: {OSD_ADT_ONE_RUNTIME: "", OSD_ADT_CARRY: "1", STG_DB: "sqlite", STG_DB_PATH: "", OSD_DEMO_ROWS: "0"},
      adtSnapshot: () => {snapshots++; throw new Error("disabled snapshot was called");},
    });
    try {
      expect((await runtime.start()).started).to.equal(true);
      expect(snapshots).to.equal(0);
    } finally {await runtime.stop();}
  });

});
