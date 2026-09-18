// The comparison instrument, tested where it must be silent and where it
// must not be (backlog W.1).
//
// The order of these tests is the argument. First the normalisation rules,
// because a rule that fires quietly is how such a tool starts lying. Then
// one system compared with itself, which MUST be empty - that is the
// calibration, and until it passes no comparison of two branches means
// anything. Only then the opposite test: a system compared with one that
// answers differently on purpose, which must report exactly that difference
// and no other. A tool that is silent because it is broken looks precisely
// like a tool that is silent because there is nothing to say.
import http from "node:http";
import {expect} from "chai";
import {startServer} from "./start.mjs";
import {normalise, firstDifference, compare, RULES} from "../tools/osd-compare.mjs";

const PORT = Number(process.env.STG_PORT ?? 3030);
const BASE = `http://localhost:${PORT}`;

describe("comparison: the normalisation rules", () => {
  it("masks what must differ between two systems, and says which rule did it", () => {
    const {text, applied} = normalise("uri: http://localhost:3030/x\ndate: Thu, 18 Sep 2026 20:00:00 GMT");
    expect(text).to.contain("{origin}");
    expect(text).to.contain("date: {when}");
    expect(applied).to.have.members(["host-port", "http-date"]);
  });

  it("leaves alone what might be data, until it is asked for by name", () => {
    const payload = `{"Created":"/Date(1758225600000)/","Id":"6f1b9c22-1111-2222-3333-444455556666"}`;
    const quiet = normalise(payload);
    expect(quiet.text, "a date in a payload is data until proven otherwise").to.equal(payload);
    expect(quiet.applied).to.be.empty;

    const asked = normalise(payload, ["volatile-dates", "guid"]);
    expect(asked.text).to.contain("{epoch}").and.to.contain("{guid}");
    expect(asked.applied).to.have.members(["volatile-dates", "guid"]);
  });

  it("every rule carries the reason it is allowed to mask something", () => {
    for (const [name, rule] of Object.entries(RULES)) {
      expect(rule.why, name).to.be.a("string").with.length.greaterThan(20);
    }
  });

  it("names the first line where two answers part company", () => {
    const difference = firstDifference("a\nb\nc\nd", "a\nb\nX\nd");
    expect(difference.line).to.equal(3);
    expect(difference.a).to.equal("c");
    expect(difference.b).to.equal("X");
    expect(firstDifference("same\ntext", "same\ntext")).to.equal(undefined);
  });
});

describe("comparison: against a live system", function () {
  this.timeout(20000);
  let server;
  let twin;
  let mangle = false;

  // The twin forwards to the same system and, when told to, changes one word
  // in what comes back. So "two systems" in these tests are the same code
  // twice, which is the only pair where the expected number of differences
  // is known exactly - zero, or one.
  before(async () => {
    server = startServer(true);
    twin = http.createServer(async (req, res) => {
      const answer = await fetch(new URL(req.url, BASE), {method: req.method, redirect: "manual"});
      let body = Buffer.from(await answer.arrayBuffer());
      if (mangle) body = Buffer.from(body.toString("utf8").replace("Travel", "Trevel"), "utf8");
      // Every header, not a favourite one. The first version copied only
      // content-type, so the twin dropped `dataserviceversion` and the
      // comparison reported a difference that belonged to the test rather
      // than to the systems - the instrument was right and the fixture was
      // lying, which is the more dangerous way round.
      const headers = {};
      answer.headers.forEach((value, name) => {
        if (!["content-length", "connection", "keep-alive", "transfer-encoding"].includes(name.toLowerCase())) {
          headers[name] = value;
        }
      });
      res.writeHead(answer.status, headers);
      res.end(body);
    });
    await new Promise((resolve) => twin.listen(0, resolve));
  });

  after(() => {
    twin.close();
    server.close();
  });

  const journal = [
    {n: 1, method: "GET", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=2&$format=json", headers: {accept: "application/json"}},
    {n: 2, method: "GET", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata", headers: {}},
    {n: 3, method: "GET", path: "/app/flp.html", headers: {}},
  ];

  const twinBase = () => `http://localhost:${twin.address().port}`;

  it("a system compared with itself has nothing to say", async () => {
    const result = await compare({journal, a: BASE, b: BASE});
    expect(result.compared).to.equal(journal.length);
    expect(result.differences, JSON.stringify(result.differences, null, 2)).to.be.empty;
  });

  it("and compared through a twin that changes nothing, still nothing", async () => {
    mangle = false;
    const result = await compare({journal, a: BASE, b: twinBase()});
    expect(result.differences, JSON.stringify(result.differences, null, 2)).to.be.empty;
  });

  it("but a twin that answers differently is caught, on the line where it does", async () => {
    mangle = true;
    const result = await compare({journal, a: BASE, b: twinBase()});
    mangle = false;
    expect(result.differences).to.have.length.greaterThan(0);
    const first = result.differences[0];
    expect(first.entry).to.contain("TravelSet");
    expect(first.b).to.contain("Trevel");
  });

  it("an approved difference is skipped, and skipping it is reported", async () => {
    mangle = true;
    const approved = new Set(["GET /sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=2&$format=json"]);
    const result = await compare({journal, a: BASE, b: twinBase(), approved});
    mangle = false;
    for (const difference of result.differences) {
      expect(difference.entry, "the approved one is gone, the others are not invented").to.not.contain("TravelSet");
    }
  });
});
