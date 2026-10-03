// Mocha's normal spec output, with elapsed wall time for each suite file.
const {writeFileSync} = require("node:fs");
const Mocha = require("mocha");
const {isAbsolute, relative} = require("node:path");

module.exports = class SuiteTimingReporter extends Mocha.reporters.Spec {
  constructor(runner, options) {
    super(runner, options);
    const timings = {};
    const failures = [];
    const internalRetries = [];
    runner.on("retry", (test) => {
      internalRetries.push({title: test.fullTitle()});
      console.error(`osd-suites: forbidden internal retry: ${test.fullTitle()}`);
    });
    let current;
    let began;
    const finish = () => {
      if (current) timings[current] = (timings[current] ?? 0) + Number(process.hrtime.bigint() - began) / 1e9;
    };
    runner.on("suite", (suite) => {
      if (!suite.file || !suite.parent?.root) return;
      const file = (isAbsolute(suite.file) ? relative(process.cwd(), suite.file) : suite.file).replace(/^\.\//, "");
      if (file === current) return;
      finish();
      current = file;
      began = process.hrtime.bigint();
    });
    runner.on("fail", (test) => {
      let owner = test;
      while (owner && !owner.file) owner = owner.parent;
      const path = owner?.file;
      const file = path ? (isAbsolute(path) ? relative(process.cwd(), path) : path).replace(/^\.\//, "") : null;
      failures.push({file, title: test.fullTitle()});
    });
    runner.on("end", () => {
      finish();
      writeFileSync(process.env.OSD_SUITE_TIMINGS_FILE, JSON.stringify({
        measuredAt: new Date().toISOString(),
        note: "Wall time including hooks and inter-file work; excludes module loading before the first suite.",
        completed: true,
        failures,
        internalRetries,
        totalFailures: runner.failures,
        seconds: Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b))),
      }, null, 2) + "\n");
    });
  }
}
