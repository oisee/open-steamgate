// A request that WAITs keeps its own ICF request and response.
//
// WAIT gives the work process up (tools/osd-dialog-step.mjs), so another
// dialog step runs while the first is rolled out. Both go through
// cl_express_icf_shim, whose server is one static instance: each run puts a
// new request and response entity on it. Without the roll-out saving and the
// roll-in restoring them, the first handler resumed on the second request's
// entities -- it read the other path, wrote into the other response, and its
// own caller was answered with whatever the second handler had left there.
// The handler is real ABAP (test/integration/zcl_osd_icf_wait_probe), the
// shim is the pinned library's, and the steps are the hosts' own.
import {expect} from "chai";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";

const output = (file) => import(new URL(`../output/${file}`, import.meta.url).href);

/** an express response as far as cl_express_icf_shim uses one */
function recorder() {
  const answer = {headers: {}, body: ""};
  answer.append = (name, value) => { answer.headers[String(name).toLowerCase()] = String(value); return answer; };
  answer.status = (code) => { answer.code = code; return answer; };
  answer.send = (body) => { answer.body = Buffer.from(body).toString("utf8"); return answer; };
  return answer;
}

describe("a dialog step in a WAIT keeps its own ICF request and response", function () {
  this.timeout(30000);
  let shim;
  before(async () => {
    // the canonical inline boot, as the ADT suites take it
    await import("./start.mjs");
    ({cl_express_icf_shim: shim} = await output("cl_express_icf_shim.clas.mjs"));
    await output("zcl_osd_icf_wait_probe.clas.mjs");
  });
  afterEach(() => {
    expect(workProcess(), "the work process is free after the case").to.deep.include({held: false, waiting: 0});
  });

  const call = (path, wait) => {
    const res = recorder();
    const url = wait ? `${path}?wait=X` : path;
    const req = {method: "GET", headers: {}, url, path, body: Buffer.alloc(0)};
    return dialogStep(() => shim.run({req, res, class: "ZCL_OSD_ICF_WAIT_PROBE",
      base: new globalThis.abap.types.String().set("/sap/bc/osd_probe")}), `probe ${path}`).then(() => res);
  };

  it("a request served during another's WAIT does not take over its request or response", async () => {
    // A takes the work process at once and gives it up in its WAIT; B was
    // already queued behind it and runs to its end meanwhile
    const a = call("/sap/bc/osd_probe/first", true);
    const b = call("/sap/bc/osd_probe/second", false);
    const [first, second] = await Promise.all([a, b]);
    expect(second.headers["x-probe-after"], "B saw its own path").to.equal("/sap/bc/osd_probe/second");
    expect(second.body, "B answered into its own response").to.equal("/sap/bc/osd_probe/second");
    expect(first.headers["x-probe-before"], "A, before its WAIT").to.equal("/sap/bc/osd_probe/first");
    expect(first.headers["x-probe-after"], "A, after its WAIT, still its own path").to.equal("/sap/bc/osd_probe/first");
    expect(first.body, "A's caller got A's answer").to.equal("/sap/bc/osd_probe/first");
  });

  it("two requests that both WAIT each resume on their own", async () => {
    const a = call("/sap/bc/osd_probe/one", true);
    const b = call("/sap/bc/osd_probe/two", true);
    const [one, two] = await Promise.all([a, b]);
    expect([one.headers["x-probe-before"], one.headers["x-probe-after"], one.body])
      .to.deep.equal(["/sap/bc/osd_probe/one", "/sap/bc/osd_probe/one", "/sap/bc/osd_probe/one"]);
    expect([two.headers["x-probe-before"], two.headers["x-probe-after"], two.body])
      .to.deep.equal(["/sap/bc/osd_probe/two", "/sap/bc/osd_probe/two", "/sap/bc/osd_probe/two"]);
  });
});
