import {expect} from "chai";
import {fork} from "node:child_process";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {once} from "node:events";
import {join} from "node:path";
import {sendIPC} from "../tools/osd-ipc.mjs";
import {rows} from "../tools/osd-xref-seed.mjs";
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";
import {withCleanup} from "./helpers/with-cleanup.mjs";

const runtimeFixture = runtimeRootFixture();
const readinessMs = 10000;
const graceMs = 1000;
// No requests, carry rows or persistent file in this probe. Allow the grace
// plus one second for IPC delivery, commit and process teardown. Cold source
// parsing is fixture preparation, not part of this prepared-artifact contract.
const exitMs = graceMs + 1000;

describe("ADT carry IPC compatibility", function () {
  this.timeout(20000);
  let root;
  before(async function () {
    // copyRuntimeRoot copies the generation, but not build/xref. Populate its
    // content-keyed cache before measuring either carry mode: a cold whole-tree
    // parse blocked the event loop past readiness AND the cleanup deadline on CI.
    // rows() still derives from this private root; no foreign key or rows are used.
    this.timeout(60000);
    root = runtimeFixture.root;
    await rows(root);
  });
  for (const carry of ["", "1"]) it(carry === "1"
    ? "an opted-in IPC child times out its unanswered carry and reaches ready"
    : "a demo-data style IPC parent reaches ready without answering adt-state", async () => {
    const began = performance.now();
    const proc = fork("tools/osd-serve.mjs", ["0"], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      // Probe the prepared artifact directly; no source build or test/start.mjs.
      env: {...process.env, OSD_ROOT: root, OSD_OUTPUT: join(root, "output"), STG_DB: "sqlite", STG_DB_PATH: "", OSD_DEMO_ROWS: "0", OSD_ADT_CARRY: carry},
    });
    const said = [];
    let phase = "starting the child", requests = 0, readyElapsed;
    const phases = [];
    proc.on("message", (m) => {
      if (m?.type === "say") said.push(m.line);
      if (m?.type === "booting") {phase = m.phase; phases.push(m.phase);}
      if (m?.type === "adt-state-request") requests++;
    });
    const detail = () => `carry=${carry || "off"}, last phase: ${phase}; ${said.join("; ")}`;
    await withCleanup(async () => {
      const ready = await new Promise((resolve, reject) => {
        const finish = (error, message) => {
          clearTimeout(timer);
          proc.off("message", onMessage);
          proc.off("exit", onExit);
          proc.off("error", onError);
          if (error) reject(error); else resolve(message);
        };
        const onMessage = (m) => {if (m?.type === "ready") finish(undefined, m);};
        const onExit = (code, signal) => finish(new Error(`IPC child exited ${code ?? signal} before ready (${detail()})`));
        const onError = (error) => finish(error);
        const timer = setTimeout(() => finish(new Error(
          `IPC child never became ready within ${readinessMs} ms (elapsed ${Math.round(performance.now() - began)} ms; ${detail()})`)), readinessMs);
        proc.on("message", onMessage);
        proc.once("exit", onExit);
        proc.once("error", onError);
      });
      readyElapsed = Math.round(performance.now() - began);
      expect(readyElapsed, `IPC readiness exceeded ${readinessMs} ms (${detail()})`).to.be.at.most(readinessMs);
      expect(ready.port).to.be.greaterThan(0);
      expect(requests, "only opted-in carry requests adt-state").to.equal(carry === "1" ? 1 : 0);
      expect(said.some((line) => line.includes("no adt-state after 5 s"))).to.equal(carry === "1");
      // the carry contract, by time and by phase: opted-in waits its 5 s for
      // an answer that never comes; carry off never enters that wait
      // the carry contract, measured on the wait itself: the child reports
      // each boot phase with its length ("boot: <phase> <n> ms")
      const phaseMs = (name) => {
        const line = said.find((l) => l.startsWith(`boot: ${name} `));
        return line === undefined ? undefined : Number(/ (\d+) ms$/.exec(line)?.[1]);
      };
      if (carry === "1") {
        const waited = phaseMs("waiting for ADT state");
        expect(waited, `opted-in carry reported no adt-state wait (${detail()})`).to.be.a("number");
        expect(waited, `opted-in carry did not wait its 5 s (${detail()})`).to.be.within(4500, 7000);
      } else {
        expect(phaseMs("waiting for ADT state"), `carry off entered the adt-state wait (${detail()})`).to.equal(undefined);
        expect(phaseMs("ADT carry disabled"), `carry off spent time in its carry phase (${detail()})`).to.be.at.most(250);
      }
    }, async () => {
      if (proc.exitCode === null && proc.signalCode === null) {
        // resolve on exit only: once(proc, "exit") also rejects on "error",
        // which would clear the SIGKILL fallback with the child still alive
        const gone = new Promise((resolve) => proc.once("exit", (code, signal) => resolve([code, signal])));
        proc.once("error", (error) => console.error(`IPC child error during cleanup: ${error.message}`));
        const quiesceAt = performance.now();
        // Use IPC even on failed boot; boot-time signal listeners may consume TERM.
        let forced = false;
        const timer = setTimeout(() => {forced = true; proc.kill("SIGKILL");}, exitMs);
        try {
          sendIPC(proc, {type: "quiesce", grace: graceMs}, error => {if (error) proc.kill();});
          const [code, signal] = await gone;
          const elapsed = Math.round(performance.now() - quiesceAt);
          console.log(`IPC carry=${carry || "off"}: ready ${readyElapsed ?? "timed out"} ms; quiesce-to-exit ${elapsed} ms`);
          expect(forced, `IPC child did not quiesce within ${exitMs} ms (elapsed ${elapsed} ms; grace ${graceMs} ms; ${detail()})`).to.equal(false);
          expect(signal, "IPC quiesce exits normally").to.equal(null);
          expect(code).to.equal(0);
        } finally {clearTimeout(timer);}
      }
    });
  });
  it("the supervisor defaults carry OFF and does not call the snapshot provider", async () => {
    let snapshots = 0;
    const runtime = new ServingRuntime({
      root, env: {OSD_OUTPUT: join(root, "output"), OSD_ADT_ONE_RUNTIME: "", OSD_ADT_CARRY: "1", STG_DB: "sqlite", STG_DB_PATH: "", OSD_DEMO_ROWS: "0"},
      adtSnapshot: () => {snapshots++; throw new Error("disabled snapshot was called");},
    });
    await withCleanup(async () => {
      expect((await runtime.start()).started).to.equal(true);
      expect(snapshots).to.equal(0);
    }, () => runtime.stop());
  });
});

describe("IPC probe failure reporting", () => {
  it("keeps the readiness error primary and adds a failed quiesce", async () => {
    const body = new Error("IPC child never became ready");
    const cleanup = new Error("IPC child did not quiesce within 2000 ms");
    const caught = await withCleanup(() => {throw body;}, () => {throw cleanup;}).catch(error => error);
    expect(caught).to.equal(body);
    expect(caught.message).to.equal("IPC child never became ready\nAdditionally, cleanup failed: IPC child did not quiesce within 2000 ms");
    expect(caught.cleanupError).to.equal(cleanup);
    expect(caught.stack).to.include(cleanup.stack);
  });
  it("keeps an undefined body failure as the one thrown", async () => {
    let caught = "not thrown";
    try { await withCleanup(() => {throw undefined;}, () => {throw new Error("cleanup");}); } catch (error) { caught = error; }
    expect(caught).to.equal(undefined);
  });
  it("keeps a frozen body error even when the cleanup failure cannot be printed", async () => {
    const body = Object.freeze(new Error("frozen readiness failure"));
    const caught = await withCleanup(() => {throw body;}, () => {throw Symbol("cleanup");}).catch(error => error);
    expect(caught).to.equal(body);
  });
  it("still reports a cleanup failure when the body passed", async () => {
    const cleanup = new Error("quiesce failed");
    expect(await withCleanup(() => {}, () => {throw cleanup;}).catch(error => error)).to.equal(cleanup);
  });
  it("reaps the child after a body failure even when cleanup passes", async () => {
    const body = new Error("readiness failed");
    let reaped = false;
    expect(await withCleanup(() => {throw body;}, () => {reaped = true;}).catch(error => error)).to.equal(body);
    expect(reaped).to.equal(true);
  });
});
