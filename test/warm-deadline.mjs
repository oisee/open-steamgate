// The warm compiler's deadline: sized to the prime's tree, scaled by the
// runner's measured speed, bounded, and overridable (tools/warm-deadline/).
import {expect} from "chai";
import {CEILING_MS, FACTOR_CEILING, OPERATION_MS, PRIME_FLOOR_MS, PRIME_MS_PER_FILE, REFERENCE_CALIBRATION_MS,
  calibrate, describe as said, scaled, speed, warmDeadline} from "../tools/warm-deadline/warm-deadline.mjs";

const at = ms => () => ms;

describe("warm deadline: sized to the work and the runner", () => {
  it("keeps a save at 30 s on a machine as fast as the reference or faster", () => {
    for (const ms of [REFERENCE_CALIBRATION_MS / 3, REFERENCE_CALIBRATION_MS]) {
      expect(warmDeadline({kind: "operation", env: {}, measure: at(ms)}).ms).to.equal(OPERATION_MS);
    }
  });
  it("sizes the prime by its input files, never below the floor", () => {
    expect(warmDeadline({kind: "prime", files: 10, env: {}, measure: at(REFERENCE_CALIBRATION_MS)}).ms).to.equal(PRIME_FLOOR_MS);
    expect(warmDeadline({kind: "prime", files: 7000, env: {}, measure: at(REFERENCE_CALIBRATION_MS)}).ms)
      .to.equal(7000 * PRIME_MS_PER_FILE);
  });
  it("scales both by the measured slowdown, within the ceiling", () => {
    const slow = warmDeadline({kind: "prime", files: 7000, env: {}, measure: at(REFERENCE_CALIBRATION_MS * 1.8)});
    expect(slow.factor).to.be.closeTo(1.8, 1e-9);
    expect(slow.ms).to.equal(Math.round(7000 * PRIME_MS_PER_FILE * 1.8));
    expect(said(slow)).to.include("speed factor 1.80").and.include("calibration");
    const crawling = warmDeadline({kind: "prime", files: 100000, env: {}, measure: at(REFERENCE_CALIBRATION_MS * 100)});
    expect(crawling.factor).to.equal(FACTOR_CEILING);
    expect(crawling.ms).to.equal(CEILING_MS);
  });
  it("takes an explicit store value first, then the environment", () => {
    const env = {OSD_WARM_DEADLINE_MS: "1234", OSD_WARM_PRIME_DEADLINE_MS: "5678", OSD_WARM_SPEED_FACTOR: "3"};
    expect(warmDeadline({kind: "prime", store: {warmDeadlineMs: 500}, env}).ms).to.equal(500);
    expect(warmDeadline({kind: "prime", env}).ms).to.equal(5678);
    expect(warmDeadline({kind: "operation", env}).ms).to.equal(1234);
    expect(warmDeadline({kind: "operation", env: {OSD_WARM_SPEED_FACTOR: "3"}}).ms).to.equal(3 * OPERATION_MS);
    expect(speed({OSD_WARM_SPEED_FACTOR: "0.2"}).factor, "a factor never shortens the deadline").to.equal(1);
    expect(scaled(1000, {OSD_WARM_SPEED_FACTOR: "2"})).to.equal(2000);
  });
  it("calibrates in a few hundred milliseconds", () => {
    const started = performance.now();
    const ms = calibrate();
    expect(ms).to.be.greaterThan(0);
    expect(performance.now() - started).to.be.lessThan(3000);
  });
});
