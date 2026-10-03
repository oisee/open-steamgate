// Root hook runs after registration; setters in test bodies must also stay zero.
const Mocha = require('mocha');
exports.mochaHooks = {
  beforeAll() {
    for (const Type of [Mocha.Runnable, Mocha.Suite]) {
      Type.prototype.retries = function () { this._retries = 0; return arguments.length ? this : 0; };
    }
    const reset = (suite) => {
      suite.retries(0);
      for (const runnable of [...suite.tests, ...suite._beforeAll, ...suite._beforeEach, ...suite._afterAll, ...suite._afterEach]) runnable.retries(0);
      for (const child of suite.suites) reset(child);
    };
    reset(this.test.parent);
  },
};
