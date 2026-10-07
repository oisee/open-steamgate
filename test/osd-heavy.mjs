// tools/osd-heavy.sh: the slot is the wrapper's lease. A server the command leaves
// behind must not keep it, and a command that overruns OSD_HEAVY_TIMEOUT gives it up.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script = fileURLToPath(new URL("../tools/osd-heavy.sh", import.meta.url));
// one slot, so a second run can only start once the first lease has ended
const env = {...process.env, OSD_HEAVY_RANGE: process.env.OSD_HEAVY_TEST_RANGE ?? "87-89", OSD_HEAVY_SLOTS: "1"};

function heavy(args, extra = {}, timeout = 20000) {
  const started = Date.now();
  const r = spawnSync(script, args, {env: {...env, ...extra}, encoding: "utf8", timeout});
  return {...r, seconds: (Date.now() - started) / 1000};
}

describe("osd-heavy slot lease", function () {
  this.timeout(60000);
  const orphans = [];
  after(() => { for (const pid of orphans) try { process.kill(pid); } catch {} });

  it("frees the slot when the command returns, even if it left a process behind", () => {
    const first = heavy(["bash", "-c", "sleep 30 >/dev/null 2>&1 </dev/null & echo $!"]);
    expect(first.status).to.equal(0);
    orphans.push(Number(first.stdout.trim()));
    const second = heavy(["true"], {}, 10000);
    expect(second.error, "the second run waited for the orphan's slot").to.equal(undefined);
    expect(second.status).to.equal(0);
    expect(second.seconds).to.be.below(8);
  });

  it("stops a command that overruns OSD_HEAVY_TIMEOUT and says so", () => {
    const r = heavy(["sleep", "30"], {OSD_HEAVY_TIMEOUT: "1s"});
    expect(r.status).to.equal(124);
    expect(r.stderr).to.match(/overran OSD_HEAVY_TIMEOUT=1s/);
    expect(r.seconds).to.be.below(10);
    expect(heavy(["true"], {}, 10000).status).to.equal(0);
  });

  it("passes a command's own 124 through without blaming the timeout", () => {
    const r = heavy(["bash", "-c", "exit 124"], {OSD_HEAVY_TIMEOUT: "1h"});
    expect(r.status).to.equal(124);
    expect(r.stderr).not.to.match(/overran/);
  });

  it("runs without a limit when OSD_HEAVY_TIMEOUT is 0", () => {
    const r = heavy(["bash", "-c", "exit 7"], {OSD_HEAVY_TIMEOUT: "0"});
    expect(r.status).to.equal(7);
  });

  it("refuses a timeout that is not a duration", () => {
    const r = heavy(["true"], {OSD_HEAVY_TIMEOUT: "soon"});
    expect(r.status).to.equal(2);
    expect(r.stderr).to.match(/OSD_HEAVY_TIMEOUT must be/);
  });
});
