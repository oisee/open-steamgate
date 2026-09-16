import {expect} from "chai";
import {compiled, serveCommand, toolCommand, unitCommand} from "../tools/osd-host.mjs";

// The host module: which process starts which, in a checkout and in the
// binary. Under mocha this is a checkout, so the commands are node + path;
// the compiled shape is what bin/osd.mjs dispatches (SP4).
describe("tools/osd-host: how a tool starts another tool", () => {
  it("knows it is not a compiled binary here", () => {
    expect(compiled).to.equal(false);
  });

  it("starts a tool, the serving child and a unit run by path under node", () => {
    expect(toolCommand("/x/tools/cds2ddic.mjs", ["--all"])).to.deep.equal([process.execPath, "/x/tools/cds2ddic.mjs", "--all"]);
    expect(serveCommand("/x/tools/osd-serve.mjs")).to.deep.equal([process.execPath, "/x/tools/osd-serve.mjs"]);
    expect(unitCommand("/x/tools/osd-unit.mjs", ["CLAS", "ZCL_X", "--json"])).to.deep.equal([process.execPath, "/x/tools/osd-unit.mjs", "CLAS", "ZCL_X", "--json"]);
  });
});
