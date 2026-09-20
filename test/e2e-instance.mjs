import {expect} from "chai";
import {freePorts, portsFor} from "../scripts/run-e2e-isolated.mjs";

describe("isolated E2E instance ports", () => {
  it("maps one number to every SAP-shaped sibling and the local test port", () => {
    expect(portsFor(50)).to.deep.equal({localHttp: 3050, diag: 3250, rfc: 3350,
      publicHttp: 8050, https: 44350});
    expect(portsFor(89)).to.deep.equal({localHttp: 3089, diag: 3289, rfc: 3389,
      publicHttp: 8089, https: 44389});
    expect(() => portsFor(49)).to.throw(RangeError);
    expect(() => portsFor(90)).to.throw(RangeError);
  });

  it("rejects an instance if even a non-HTTP sibling port is occupied", async () => {
    const checked = [];
    expect(await freePorts(89, async (port, host) => {
      checked.push([port, host]);
      return port !== portsFor(89).rfc;
    })).to.equal(false);
    expect(checked).to.deep.include([portsFor(89).rfc, "0.0.0.0"]);
    expect(checked).not.to.deep.include([portsFor(89).https, "0.0.0.0"]);
  });

  it("checks both address families for all five ports", async () => {
    const checked = [];
    expect(await freePorts(50, async (port, host) => { checked.push([port, host]); return true; })).to.equal(true);
    expect(checked).to.have.length(10);
  });
});
