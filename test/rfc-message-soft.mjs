import {expect} from 'chai';
import {installRfcMessage} from '../tools/osd-rfc-message.mjs';

describe('RFC MESSAGE adapter on a host without CallFunctionTranspiler', () => {
  it('fails soft: returns false and says why, instead of throwing', () => {
    const lines = [], warn = console.warn;
    console.warn = (...a) => lines.push(a.join(' '));
    try {
      expect(installRfcMessage(undefined, class {}, {Expressions: {}})).to.equal(false);
      expect(installRfcMessage({}, class {}, {Expressions: {}})).to.equal(false);
    } finally { console.warn = warn; }
    expect(lines.length).to.be.at.least(1);
    expect(lines[0]).to.match(/MESSAGE targets are not supplied/);
  });
  it('still installs on a host that has it, once', () => {
    class Fake { transpile() { return {getCode: () => 'x'}; } }
    expect(installRfcMessage(Fake, class {}, {Expressions: {}})).to.equal(true);
    const patched = Fake.prototype.transpile;
    expect(installRfcMessage(Fake, class {}, {Expressions: {}})).to.equal(true);
    expect(Fake.prototype.transpile).to.equal(patched);
  });
});
