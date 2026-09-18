import {expect} from "chai";
import {startServer} from "./start.mjs";

// The AMDP sandbox (backlog G.8, docs/amdp-in-hana.md): a SQLScript body typed
// on a screen and run against the database ABAP actually runs on.
//
// Two of these three need a HANA to talk to and say so rather than failing;
// the first does not, because what it checks is the page and the path from the
// form to the destination, which is where the defects were:
//
//   the form   cl_express_icf_shim fills form fields from the query string
//              only, so a POSTed body reads as empty and looks exactly like an
//              empty box (ANOMALY-2026-09-18-icf-shim-form-fields-from-body)
//   the names  a CALL FUNCTION carries its parameter names in the case they
//              were typed, which is lower; the function group declares them
//              upper. Matching case-sensitively answered into nothing, and a
//              page with no result and no error is the least informative
//              outcome there is
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/osd/amdp/`;

const hasHana = process.env.HANA_HOST !== undefined || process.env.HXE_HOST !== undefined
  || process.env.STG_AMDP_HANA === "1";

async function run(body) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({body}).toString(),
  });
  return {status: res.status, page: await res.text()};
}

describe("the AMDP sandbox", function () {
  this.timeout(120000);
  let server;
  before(() => {
    server = startServer(true);
  });
  // The AMDP destination holds a HANA connection open, and an open socket
  // keeps the event loop alive: without this the suite passes and then never
  // exits, which in a run of thirty files looks like a hang in whichever file
  // happens to come next.
  after(async () => {
    server?.close();
    await globalThis.abap?.context?.RFCDestinations?.AMDP?.close?.();
  });

  it("answers with a page carrying an example, and the example is runnable text", async () => {
    const page = await (await fetch(BASE)).text();
    expect(page, "the screen").to.contain("AMDP sandbox");
    const body = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(page)?.[1] ?? "";
    expect(body, "an example to run").to.contain("SELECT");
    expect(body, "with its lines intact").to.contain("\n");
    expect(page, "and it says what it does with what you type").to.contain("nothing typed here survives");
  });

  it("reads the body out of the POST, which is not where the shim looks", async () => {
    // the assertion is about the round trip of the text, not about HANA: the
    // body typed has to come back in the box, spaces and all
    const {status, page} = await run("SELECT 1 AS one FROM dummy;   -- kept");
    expect(status).to.equal(200);
    const back = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(page)?.[1] ?? "";
    expect(back, "the text came through the form").to.contain("SELECT 1 AS one FROM dummy");
    expect(back, "spaces and all -- a text literal loses its trailing blanks").to.contain(" AS one ");
  });

  it("says whether anything here can run SQLScript, by running the smallest body", async () => {
    // a name in a configuration says what somebody intended; this says what
    // happens, which is what the launchpad needs to decide whether its tile
    // is alive or grey
    const answer = await (await fetch(BASE + "engine")).json();
    expect(answer.destination, "which destination the body goes through").to.equal("AMDP");
    expect(answer.engine, "HDB or none, nothing else").to.be.oneOf(["HDB", "none"]);
    expect(answer.system_db, "and the system database, which is a different thing").to.be.a("string");
  });

  it("says where the body ran, because the two databases are not the same one", async () => {
    // Alice, looking at the deployment: the sandbox computes on HANA Express
    // through DESTINATION 'AMDP', while the system database of that same
    // deployment is SQLite. Correct, and indistinguishable from the screen --
    // so the screen says it, on the page where a person is already looking.
    const {page} = await run("SELECT 1 AS one FROM dummy;");
    expect(page, "the destination it went through").to.contain("DESTINATION 'AMDP'");
    expect(page, "and that it is not the system database").to.contain("does not touch it");
    // and who it ran as, which is the other half of the same question: a
    // sandbox on a page must not execute as the database's superuser
    expect(page, "the user").to.match(/as <b>[A-Z_0-9]+<\/b>, a user with no grant outside its own schema/);
  });

  (hasHana ? it : it.skip)("runs a body and shows the rows", async () => {
    const {page} = await run("lt = SELECT 6*7 AS answer FROM dummy;\nSELECT * FROM :lt;");
    expect(page, "the count and the time").to.match(/class="ok">\d+ row\(s\), \d+ ms/);
    expect(page, "the column, as the engine named it").to.contain("<th>ANSWER");
    expect(page, "and the value").to.contain("<td>42");
  });

  (hasHana ? it : it.skip)("hands back the engine's refusal, at the line the person typed on", async () => {
    const {page} = await run("SELEKT 1 FROM DUMMY;");
    expect(page, "the engine refused it").to.contain("the engine refused it");
    // the wrapper is one line, so the engine's line 2 is the person's line 1;
    // pointing at a line they cannot see is worse than saying nothing
    expect(page, "in the person's own numbering").to.match(/line 1 col \d+/);
    expect(page, "and untouched underneath").to.contain("before the lines were renumbered");
  });
});
