import {expect} from "chai";
import {startServer} from "./start.mjs";

// The data browser (backlog G.9, /sap/bc/osd/se16/): pick a table, see its
// rows. What is asserted here is the property that makes it worth having --
// it reads **through the application**, using the same source classes the
// OData services use, rather than around it into the database. A browser
// that went straight to the database would show rows the application cannot
// see, and then "why does the app not show this row" would be unanswerable.
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/osd/se16/`;

describe("the data browser", function () {
  this.timeout(60000);
  let server;
  before(() => {
    server = startServer(true);
  });
  after(() => server?.close());

  it("lists the entities the system can read, and says how it reads them", async () => {
    const page = await (await fetch(BASE)).text();
    expect(page, "the screen").to.contain("Data browser");
    expect(page, "a count rather than a bare list").to.match(/\d+ entities the system can read/);
    expect(page, "and one of them is the demo's own").to.contain("?t=ZC_STG_TRAVEL");
    expect(page, "it says where the rows come from").to.contain("not around the application, through it");
  });

  it("shows a table's rows, with the source class named", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL`)).text();
    expect(page, "the columns the registry knows, not guessed from row one").to.contain("<th>TRAVELID");
    expect(page, "a seeded row").to.contain("Berlin to Copenhagen");
    // naming the class is the honest part: a reader can go and check that
    // this is the same path the OData service takes
    expect(page, "read through").to.match(/read through <b>ZCL_STG_CDS_\w+<\/b>/);
  });

  it("counts what it showed, not where the loop stopped", async () => {
    // `showing` used to be the loop index minus one, which is right only
    // when the limit ended the loop and wrong by one whenever the table
    // simply ran out -- the common case, and the believable wrong number
    const limited = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&max=3`)).text();
    expect(limited, "the limit stopped it").to.match(/(\d+) row\(s\), showing 3/);
    const whole = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&max=100`)).text();
    const [, total, shown] = /(\d+) row\(s\), showing (\d+)/.exec(whole) ?? [];
    expect(shown, "no limit, so it showed all of them").to.equal(total);
  });

  it("says a name it does not have is not there, rather than showing nothing", async () => {
    const page = await (await fetch(`${BASE}?t=NOPE_NOT_HERE`)).text();
    expect(page, "named, not silent").to.contain("No entity called");
    expect(page, "and a way back").to.contain('href="?"');
  });
});
