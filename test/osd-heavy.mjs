// tools/osd-heavy.sh: the slot is the wrapper's lease. A server the command leaves
// behind must not keep it, a killed wrapper must not leave it to its command, and a
// command that overruns OSD_HEAVY_TIMEOUT gives it up.
import {expect} from "chai";
import {spawn} from "node:child_process";
import {existsSync, mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const script = fileURLToPath(new URL("../tools/osd-heavy.sh", import.meta.url));
// one slot, so a second run can only start once the first lease has ended
const env = {...process.env, OSD_HEAVY_RANGE: process.env.OSD_HEAVY_TEST_RANGE ?? "87-89", OSD_HEAVY_SLOTS: "1"};

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const killGroup = (pid) => { try { process.kill(-pid, "SIGKILL"); } catch {} };

// The wrapper ignores TERM while its command runs, so a deadline kills the whole
// process group: a regression fails the case in seconds instead of hanging mocha.
function heavy(args, extra = {}, deadline = 15000, onSpawn = () => {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(script, args, {env: {...env, ...extra}, detached: true, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; onSpawn(stdout, child); });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, deadline);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({status, signal, stdout, stderr, timedOut, seconds: (Date.now() - started) / 1000});
    });
  });
}

describe("osd-heavy slot lease", function () {
  this.timeout(60000);
  const leftovers = [];
  afterEach(() => { for (const pid of leftovers.splice(0)) killGroup(pid); });

  it("frees the slot when the command returns, even if it left a process behind", async () => {
    // the orphan gets a process group of its own, so the cleanup can reach it
    const first = await heavy(["bash", "-c", "setsid sleep 30 >/dev/null 2>&1 </dev/null & echo $!"]);
    const orphan = Number(first.stdout.trim());
    if (orphan) leftovers.push(orphan);
    expect(first.status).to.equal(0);
    expect(alive(orphan), "the leftover process is still running").to.equal(true);
    const second = await heavy(["true"], {}, 8000);
    expect(second.timedOut, "the second run waited for the leftover's slot").to.equal(false);
    expect(second.status).to.equal(0);
    expect(alive(orphan)).to.equal(true);
  });

  it("frees the slot when the wrapper is killed while its command runs", async () => {
    let command = 0;
    const killed = new Promise((resolve) => {
      heavy(["bash", "-c", "echo $$; exec sleep 30"], {}, 15000, (out, child) => {
        if (command || !Number(out.trim())) return;
        command = Number(out.trim());
        leftovers.push(child.pid);
        process.kill(child.pid, "SIGKILL");
        setTimeout(resolve, 200);
      });
    });
    await killed;
    expect(alive(command), "the command outlived its wrapper").to.equal(true);
    const second = await heavy(["true"], {}, 8000);
    expect(second.timedOut, "the second run waited for a dead wrapper's slot").to.equal(false);
    expect(second.status).to.equal(0);
  });

  it("stops a command that overruns OSD_HEAVY_TIMEOUT and says so", async () => {
    const r = await heavy(["sleep", "30"], {OSD_HEAVY_TIMEOUT: "1s"});
    expect(r.timedOut).to.equal(false);
    expect(r.status).to.equal(124);
    expect(r.stderr).to.match(/ran past OSD_HEAVY_TIMEOUT=1s/);
    expect((await heavy(["true"], {}, 8000)).status).to.equal(0);
  });

  it("passes a command's own 124 through without blaming the timeout", async () => {
    const r = await heavy(["bash", "-c", "exit 124"], {OSD_HEAVY_TIMEOUT: "1h"});
    expect(r.status).to.equal(124);
    expect(r.stderr).not.to.match(/OSD_HEAVY_TIMEOUT/);
  });

  it("runs without a limit when OSD_HEAVY_TIMEOUT is 0, and reads 08m as eight minutes", async () => {
    expect((await heavy(["bash", "-c", "exit 7"], {OSD_HEAVY_TIMEOUT: "0"})).status).to.equal(7);
    expect((await heavy(["bash", "-c", "exit 7"], {OSD_HEAVY_TIMEOUT: "00s"})).status).to.equal(7);
    expect((await heavy(["true"], {OSD_HEAVY_TIMEOUT: "08m"})).status).to.equal(0);
  });

  for (const bad of ["soon", "1.5m", "0.5s", "-1"]) {
    it(`refuses OSD_HEAVY_TIMEOUT=${bad}`, async () => {
      const r = await heavy(["true"], {OSD_HEAVY_TIMEOUT: bad});
      expect(r.status).to.equal(2);
      expect(r.stderr).to.match(/OSD_HEAVY_TIMEOUT must be/);
    });
  }
});

describe("osd-heavy TMPDIR", function () {
  this.timeout(30000);

  it("makes the run's TMPDIR under OSD_HEAVY_TMP and removes it, also after a failure", async () => {
    const parent = mkdtempSync(join(tmpdir(), "heavy-parent-"));
    try {
      const ok = await heavy(["bash", "-c", "echo $TMPDIR"], {OSD_HEAVY_TMP: parent + "/"});
      expect(ok.status).to.equal(0);
      expect(ok.stdout.trim().startsWith(parent + "/")).to.equal(true);
      const failed = await heavy(["bash", "-c", "echo $TMPDIR; exit 3"], {OSD_HEAVY_TMP: parent});
      expect(failed.status).to.equal(3);
      expect(readdirSync(parent)).to.deep.equal([]);
    } finally { rmSync(parent, {recursive: true, force: true}); }
  });

  it("falls back to /tmp when OSD_HEAVY_TMP is empty", async () => {
    const run = await heavy(["bash", "-c", "echo $TMPDIR"], {OSD_HEAVY_TMP: ""});
    expect(run.status).to.equal(0);
    expect(run.stdout.trim()).to.match(/^\/tmp\/osd-heavy-/);
    expect(existsSync(run.stdout.trim())).to.equal(false);
  });

  it("refuses a parent that does not exist and gives the slot back", async () => {
    const run = await heavy(["true"], {OSD_HEAVY_TMP: "/nonexistent-osd-heavy-parent"});
    expect(run.status).to.not.equal(0);
    const next = await heavy(["true"], {}, 8000);
    expect(next.timedOut).to.equal(false);
    expect(next.status).to.equal(0);
  });
});
