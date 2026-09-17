import {expect} from "chai";
import {startServer} from "./start.mjs";
import {cases} from "./conformance/suite.mjs";
import {Session, compare, select} from "./conformance/run.mjs";

// The black-box suite, run against the tree's own server so that `npm test`
// keeps it honest. The cases themselves know nothing about this repository:
// the same array, through the same runner, is what `npm run conformance`
// points at another host (docs/conformance.md). One `it` per case, so a
// failure names the case rather than a file.
//
// Read-only only. The writes are `--include-mutating` on the runner, which
// is a decision a person takes about a host, not something a test suite does
// on its own.
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}`;

describe("conformance: the questions over HTTP, against a base URL", () => {
  let server;
  let session;

  before(function () {
    this.timeout(120000);
    server = startServer(true);
    session = new Session(BASE);
  });

  after(() => server.close());

  for (const testCase of select(cases)) {
    it(`${testCase.id}: ${testCase.name}`, async function () {
      this.timeout(30000);
      const actual = await session.perform(testCase);
      const problems = compare(testCase.expect, actual, BASE);
      expect(problems.join("; ")).to.equal("");
    });
  }
});
